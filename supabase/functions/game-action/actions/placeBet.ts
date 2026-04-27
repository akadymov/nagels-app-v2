import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

export async function placeBet(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'place_bet' }>,
): Promise<ActionResult> {
  const { data: hand } = await svc
    .from('hands')
    .select('id, room_id, cards_per_player, current_seat, phase, starting_seat')
    .eq('id', action.hand_id)
    .maybeSingle();
  if (!hand || hand.room_id !== action.room_id) {
    return { ok: false, error: 'unknown_hand', state: await buildSnapshot(svc, action.room_id, actor.session_id), version: 0 };
  }
  if (hand.phase !== 'betting') {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'not_in_betting', state: s, version: s.room?.version ?? 0 };
  }

  const { data: rp } = await svc.from('room_players')
    .select('seat_index')
    .eq('room_id', action.room_id)
    .eq('session_id', actor.session_id)
    .maybeSingle();
  if (!rp) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'not_in_room', state: s, version: s.room?.version ?? 0 };
  }
  if (rp.seat_index !== hand.current_seat) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'not_your_turn', state: s, version: s.room?.version ?? 0 };
  }

  if (action.bet < 0 || action.bet > hand.cards_per_player) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'invalid_bet', state: s, version: s.room?.version ?? 0 };
  }

  const { data: scores } = await svc
    .from('hand_scores')
    .select('bet')
    .eq('hand_id', hand.id);
  const sumSoFar = (scores ?? []).reduce((a: number, r: any) => a + r.bet, 0);
  const { count: countPlayers } = await svc
    .from('room_players')
    .select('session_id', { count: 'exact', head: true })
    .eq('room_id', action.room_id);
  const isLastBidder = (scores?.length ?? 0) === ((countPlayers ?? 0) - 1);
  if (isLastBidder && sumSoFar + action.bet === hand.cards_per_player) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'someone_must_be_unhappy', state: s, version: s.room?.version ?? 0 };
  }

  // UNIQUE(hand_id, session_id) guards against double-bet race.
  const { error: insErr } = await svc.from('hand_scores').insert({
    hand_id: hand.id,
    session_id: actor.session_id,
    bet: action.bet,
  });
  if (insErr) {
    if ((insErr as any).code === '23505') {
      const s = await buildSnapshot(svc, action.room_id, actor.session_id);
      return { ok: false, error: 'already_bet', state: s, version: s.room?.version ?? 0 };
    }
    throw insErr;
  }

  const numPlayers = countPlayers ?? 0;
  const newCount = (scores?.length ?? 0) + 1;

  let next_seat = (hand.current_seat + 1) % numPlayers;
  let nextPhase: 'betting' | 'playing' = 'betting';
  let trickInsert: { hand_id: string; trick_number: number; lead_seat: number } | null = null;

  if (newCount === numPlayers) {
    nextPhase = 'playing';
    next_seat = hand.starting_seat;
    trickInsert = { hand_id: hand.id, trick_number: 1, lead_seat: next_seat };
  }

  await svc.from('hands').update({
    current_seat: next_seat,
    phase: nextPhase,
  }).eq('id', hand.id);

  if (trickInsert) {
    await svc.from('tricks').insert(trickInsert);
  }

  await svc.from('game_events').insert({
    room_id: action.room_id, hand_id: hand.id, session_id: actor.session_id,
    kind: 'bet', payload: { bet: action.bet, seat: rp.seat_index },
  });

  const { data: roomNow } = await svc.from('rooms')
    .select('version').eq('id', action.room_id).single();
  const newVersion = (roomNow?.version ?? 0) + 1;
  await svc.from('rooms').update({ version: newVersion }).eq('id', action.room_id);

  const s = await buildSnapshot(svc, action.room_id, actor.session_id);
  return { ok: true, state: s, version: newVersion };
}
