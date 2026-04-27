import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult, RoomSnapshot } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';
import {
  getHandCards, getTrumpForHand, createDeck, seededShuffle,
} from '../../_shared/engine/index.ts';

function emptySnapshot(): RoomSnapshot {
  return {
    room: null, players: [], current_hand: null,
    hand_scores: [], current_trick: null, score_history: [], my_hand: [],
  };
}

export async function startGame(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'start_game' }>,
): Promise<ActionResult> {
  const { data: room } = await svc
    .from('rooms')
    .select('id, host_session_id, phase, player_count, max_cards, version')
    .eq('id', action.room_id)
    .maybeSingle();
  if (!room) return { ok: false, error: 'unknown_room', state: emptySnapshot(), version: 0 };

  if (room.host_session_id !== actor.session_id) {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: false, error: 'host_only', state: snapshot, version: snapshot.room?.version ?? 0 };
  }

  if (room.phase !== 'waiting') {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: true, state: snapshot, version: snapshot.room?.version ?? 0 };
  }

  const { data: players } = await svc
    .from('room_players')
    .select('session_id, seat_index, is_ready')
    .eq('room_id', room.id)
    .order('seat_index', { ascending: true });

  if (!players || players.length < 2) {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: false, error: 'not_all_seats_filled', state: snapshot, version: snapshot.room?.version ?? 0 };
  }
  if (!players.every((p: any) => p.is_ready)) {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: false, error: 'not_all_ready', state: snapshot, version: snapshot.room?.version ?? 0 };
  }

  // Lock the actual player count for this game in case it differs from the
  // room.player_count target (host can start before the room is "full").
  const actualPlayerCount = players.length;
  if (actualPlayerCount !== room.player_count) {
    await svc.from('rooms').update({ player_count: actualPlayerCount }).eq('id', room.id);
  }

  const handNumber = 1;
  const cardsPerPlayer = getHandCards(handNumber, room.max_cards);
  const trumpSuit = getTrumpForHand(handNumber);
  const startingSeat = 0;
  const seed = crypto.randomUUID();

  const deck = seededShuffle(createDeck(), seed);
  const cardsNeeded = cardsPerPlayer * actualPlayerCount;
  if (deck.length < cardsNeeded) throw new Error('not_enough_cards');

  const { data: hand, error: hErr } = await svc
    .from('hands')
    .insert({
      room_id: room.id,
      hand_number: handNumber,
      cards_per_player: cardsPerPlayer,
      trump_suit: trumpSuit,
      starting_seat: startingSeat,
      current_seat: startingSeat,
      phase: 'betting',
      deck_seed: seed,
    })
    .select('id')
    .single();
  if (hErr) throw hErr;

  const dealtRows: { hand_id: string; session_id: string; card: string }[] = [];
  for (let s = 0; s < actualPlayerCount; s++) {
    const player = players[s];
    for (let c = 0; c < cardsPerPlayer; c++) {
      const card = deck[s * cardsPerPlayer + c];
      dealtRows.push({
        hand_id: hand.id,
        session_id: player.session_id,
        card: `${card.suit}-${card.rank}`,
      });
    }
  }
  if (dealtRows.length) {
    const { error: dErr } = await svc.from('dealt_cards').insert(dealtRows);
    if (dErr) throw dErr;
  }

  await svc.from('rooms').update({
    phase: 'playing',
    current_hand_id: hand.id,
    version: (room.version ?? 0) + 1,
  }).eq('id', room.id);

  await svc.from('game_events').insert({
    room_id: room.id, hand_id: hand.id, session_id: actor.session_id,
    kind: 'start_game',
    payload: { hand_number: handNumber, trump_suit: trumpSuit, cards_per_player: cardsPerPlayer },
  });

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: snapshot.room?.version ?? 0 };
}
