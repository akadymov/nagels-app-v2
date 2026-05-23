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
    .select('id, room_id, hand_number, phase, starting_seat')
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
    .select('id, max_cards, min_cards_per_hand, player_count, mode, version').eq('id', action.room_id).single();

  await svc.from('hands').update({ phase: 'closed' }).eq('id', hand.id);

  const totalHands = getTotalHands(room.max_cards);
  if (hand.hand_number >= totalHands) {
    await svc.from('rooms').update({
      phase: 'finished',
      version: (room.version ?? 0) + 1,
    }).eq('id', room.id);

    // Stake settlement — runs once, atomically with the finished transition.
    {
      const { data: roomRow } = await svc
        .from('rooms')
        .select('stake')
        .eq('id', action.room_id)
        .maybeSingle();
      const stake = roomRow?.stake ?? 0;

      if (stake > 0) {
        // Opted-in players in this room with their session_id + auth_user_id.
        const { data: optIns } = await svc
          .from('room_players')
          .select('session_id, room_sessions!inner(auth_user_id)')
          .eq('room_id', action.room_id)
          .eq('opt_in_stake', true);
        const eligible = (optIns ?? [])
          .map((r: any) => ({
            session_id: r.session_id as string,
            user_id: r.room_sessions?.auth_user_id as string | null,
          }))
          .filter((r: { user_id: string | null }) => !!r.user_id) as { session_id: string; user_id: string }[];

        if (eligible.length >= 2) {
          // Aggregate final scores from hand_scores across all closed hands of this room.
          const { data: scoresRows } = await svc
            .from('hand_scores')
            .select('hand_id, session_id, hand_score, hands!inner(room_id, phase)')
            .eq('hands.room_id', action.room_id)
            .eq('hands.phase', 'closed');

          const totalsBySession = new Map<string, number>();
          for (const row of scoresRows ?? []) {
            const sid = (row as any).session_id as string;
            const s = ((row as any).hand_score as number) ?? 0;
            totalsBySession.set(sid, (totalsBySession.get(sid) ?? 0) + s);
          }

          const { computeSettlement } = await import('../../_shared/engine/stakes.ts');
          const inputs = eligible.map((e) => ({
            user_id: e.user_id,
            score: totalsBySession.get(e.session_id) ?? 0,
          }));
          const deltas = computeSettlement(inputs, stake);

          // Aggregate score for the journal row (base_score in events).
          const meanScore =
            inputs.reduce((s, x) => s + x.score, 0) / Math.max(inputs.length, 1);

          for (const d of deltas) {
            const baseScore = inputs.find((x) => x.user_id === d.user_id)!.score;
            await svc.from('rating_events').insert({
              user_id:    d.user_id,
              room_id:    action.room_id,
              reason:     'settle',
              delta:      d.delta,
              base_score: baseScore,
              mean_score: meanScore,
              stake,
            });
            // Upsert balance.
            await svc.rpc('apply_rating_delta', { p_user_id: d.user_id, p_delta: d.delta });
          }
        }
      }
    }

    // Always clear stake locks on finish so "Play again" can re-arm.
    await svc.from('rooms').update({ stake_locked: false }).eq('id', action.room_id);

    await svc.from('game_events').insert({
      room_id: action.room_id, hand_id: hand.id, session_id: actor.session_id,
      kind: 'game_finished', payload: {},
    });

    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: true, state: s, version: s.room?.version ?? 0 };
  }

  const nextNum = hand.hand_number + 1;
  const minCardsPerHand = (room as { min_cards_per_hand?: number }).min_cards_per_hand ?? 1;
  const cardsPerPlayer = getHandCards(nextNum, room.max_cards, minCardsPerHand);
  const trumpSuit = getTrumpForHand(nextNum);
  // Rotate one seat forward from whoever started the previous hand
  // (was: (nextNum - 1) % player_count, which silently assumed hand 1
  // always started at seat 0). With startGame now randomizing the
  // initial seat, the rotation has to be relative to the previous
  // hand's starting_seat instead of the absolute hand number.
  const startingSeat = (hand.starting_seat + 1) % room.player_count;
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
  if (hErr) {
    // Concurrent Continue clicks (3-4 players hit "Continue" at once) all
    // pass the phase==='scoring' check above before any of them can update
    // hand to 'closed'. The UNIQUE (room_id, hand_number) constraint then
    // rejects all but the first inserter with code 23505. Treat it as
    // idempotent success and return the snapshot the winner produced.
    if ((hErr as any).code === '23505') {
      const s = await buildSnapshot(svc, action.room_id, actor.session_id);
      return { ok: true, state: s, version: s.room?.version ?? 0 };
    }
    throw hErr;
  }

  // Scorekeeper mode: no cards are dealt — see startGame for the rationale.
  // The deck/seed is still generated above so other engine helpers that
  // expect `deck_seed` on hands have a value; nothing is dealt out.
  const isScorekeeper = (room as { mode?: string }).mode === 'scorekeeper';
  if (!isScorekeeper) {
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
  }

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
