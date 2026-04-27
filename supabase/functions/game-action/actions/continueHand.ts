import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';
import {
  getTotalHands, getHandCards, getTrumpForHand,
  createDeck, seededShuffle,
} from '../../_shared/engine/index.ts';

export async function continueHand(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'continue_hand' }>,
): Promise<ActionResult> {
  const { data: hand } = await svc.from('hands')
    .select('id, room_id, hand_number, phase')
    .eq('id', action.hand_id).maybeSingle();
  if (!hand || hand.room_id !== action.room_id) {
    return { ok: false, error: 'unknown_hand',
             state: await buildSnapshot(svc, action.room_id, actor.session_id), version: 0 };
  }

  // IDEMPOTENT — fixes the Continue race from production.
  if (hand.phase !== 'scoring') {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: true, state: s, version: s.room?.version ?? 0 };
  }

  const { data: room } = await svc.from('rooms')
    .select('id, max_cards, player_count, version').eq('id', action.room_id).single();

  await svc.from('hands').update({ phase: 'closed' }).eq('id', hand.id);

  const totalHands = getTotalHands(room.max_cards);
  if (hand.hand_number >= totalHands) {
    await svc.from('rooms').update({
      phase: 'finished',
      version: (room.version ?? 0) + 1,
    }).eq('id', room.id);

    await svc.from('game_events').insert({
      room_id: action.room_id, hand_id: hand.id, session_id: actor.session_id,
      kind: 'game_finished', payload: {},
    });

    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: true, state: s, version: s.room?.version ?? 0 };
  }

  const nextNum = hand.hand_number + 1;
  const cardsPerPlayer = getHandCards(nextNum, room.max_cards);
  const trumpSuit = getTrumpForHand(nextNum);
  const startingSeat = (nextNum - 1) % room.player_count;
  const seed = crypto.randomUUID();

  const deck = seededShuffle(createDeck(), seed);
  const { data: nextHand, error: hErr } = await svc.from('hands').insert({
    room_id: room.id,
    hand_number: nextNum,
    cards_per_player: cardsPerPlayer,
    trump_suit: trumpSuit,
    starting_seat: startingSeat,
    current_seat: startingSeat,
    phase: 'betting',
    deck_seed: seed,
  }).select('id').single();
  if (hErr) throw hErr;

  const { data: players } = await svc.from('room_players')
    .select('session_id, seat_index')
    .eq('room_id', room.id)
    .order('seat_index', { ascending: true });
  const dealtRows: { hand_id: string; session_id: string; card: string }[] = [];
  for (let s = 0; s < room.player_count; s++) {
    for (let c = 0; c < cardsPerPlayer; c++) {
      const card = deck[s * cardsPerPlayer + c];
      dealtRows.push({
        hand_id: nextHand.id,
        session_id: players![s].session_id,
        card: `${card.suit}-${card.rank}`,
      });
    }
  }
  await svc.from('dealt_cards').insert(dealtRows);

  await svc.from('rooms').update({
    current_hand_id: nextHand.id,
    version: (room.version ?? 0) + 1,
  }).eq('id', room.id);

  await svc.from('game_events').insert({
    room_id: room.id, hand_id: nextHand.id, session_id: actor.session_id,
    kind: 'continue_hand',
    payload: { hand_number: nextNum, trump_suit: trumpSuit, cards_per_player: cardsPerPlayer },
  });

  const s2 = await buildSnapshot(svc, action.room_id, actor.session_id);
  return { ok: true, state: s2, version: s2.room?.version ?? 0 };
}
