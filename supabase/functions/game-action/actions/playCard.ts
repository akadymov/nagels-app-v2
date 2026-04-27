import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';
import { calculateHandScore } from '../../_shared/engine/index.ts';

function parseCard(s: string): { suit: string; rank: string } {
  const idx = s.lastIndexOf('-');
  return { suit: s.substring(0, idx), rank: s.substring(idx + 1) };
}

const RANK_ORDER: Record<string, number> = {
  '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

function determineWinner(
  trick: Array<{ seat: number; suit: string; rank: string }>,
  trumpSuit: string,
): number {
  const leadSuit = trick[0].suit;
  let winner = trick[0];
  for (const c of trick.slice(1)) {
    const cIsTrump = c.suit === trumpSuit;
    const wIsTrump = winner.suit === trumpSuit;
    if (cIsTrump && !wIsTrump) winner = c;
    else if (cIsTrump && wIsTrump && RANK_ORDER[c.rank] > RANK_ORDER[winner.rank]) winner = c;
    else if (!cIsTrump && !wIsTrump && c.suit === leadSuit && winner.suit === leadSuit
             && RANK_ORDER[c.rank] > RANK_ORDER[winner.rank]) winner = c;
  }
  return winner.seat;
}

export async function playCard(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'play_card' }>,
): Promise<ActionResult> {
  const { data: hand } = await svc.from('hands')
    .select('id, room_id, current_seat, phase, cards_per_player, trump_suit, starting_seat, hand_number')
    .eq('id', action.hand_id).maybeSingle();
  if (!hand || hand.room_id !== action.room_id) {
    return { ok: false, error: 'unknown_hand', state: await buildSnapshot(svc, action.room_id, actor.session_id), version: 0 };
  }
  if (hand.phase !== 'playing') {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'not_in_playing', state: s, version: s.room?.version ?? 0 };
  }

  const { data: rp } = await svc.from('room_players')
    .select('seat_index')
    .eq('room_id', action.room_id)
    .eq('session_id', actor.session_id)
    .maybeSingle();
  if (!rp || rp.seat_index !== hand.current_seat) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'not_your_turn', state: s, version: s.room?.version ?? 0 };
  }

  const { data: dealt } = await svc.from('dealt_cards')
    .select('card')
    .eq('hand_id', hand.id)
    .eq('session_id', actor.session_id)
    .eq('card', action.card)
    .maybeSingle();
  if (!dealt) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'card_not_in_hand', state: s, version: s.room?.version ?? 0 };
  }

  const { data: trick } = await svc.from('tricks')
    .select('id, trick_number, lead_seat')
    .eq('hand_id', hand.id)
    .is('closed_at', null)
    .order('trick_number', { ascending: false })
    .limit(1).maybeSingle();
  if (!trick) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'no_open_trick', state: s, version: s.room?.version ?? 0 };
  }

  const { data: tcards } = await svc.from('trick_cards')
    .select('seat_index, card')
    .eq('trick_id', trick.id)
    .order('played_at', { ascending: true });
  const trickCards = (tcards ?? []).map((r: any) => ({ seat: r.seat_index, ...parseCard(r.card) }));
  const leadSuit = trickCards.length > 0 ? trickCards[0].suit : null;
  const played = parseCard(action.card);

  if (leadSuit && played.suit !== leadSuit) {
    const { data: hasLead } = await svc.from('dealt_cards')
      .select('card')
      .eq('hand_id', hand.id)
      .eq('session_id', actor.session_id)
      .like('card', `${leadSuit}-%`);
    const allTricksData = await svc.from('tricks').select('id').eq('hand_id', hand.id);
    const trickIds = (allTricksData.data ?? []).map((t: any) => t.id);
    const playedByMeData = trickIds.length
      ? await svc.from('trick_cards')
          .select('card, trick_id, seat_index')
          .in('trick_id', trickIds)
          .eq('seat_index', rp.seat_index)
      : { data: [] as any[] };
    const playedSet = new Set((playedByMeData.data ?? []).map((r: any) => r.card));
    const leadInHand = (hasLead ?? []).filter((r: any) => !playedSet.has(r.card));
    if (leadInHand.length > 0) {
      const s = await buildSnapshot(svc, action.room_id, actor.session_id);
      return { ok: false, error: 'must_follow_suit', state: s, version: s.room?.version ?? 0 };
    }
  }

  const { error: tcErr } = await svc.from('trick_cards').insert({
    trick_id: trick.id, seat_index: rp.seat_index, card: action.card,
  });
  if (tcErr) {
    if ((tcErr as any).code === '23505') {
      const s = await buildSnapshot(svc, action.room_id, actor.session_id);
      return { ok: false, error: 'already_played', state: s, version: s.room?.version ?? 0 };
    }
    throw tcErr;
  }

  await svc.from('game_events').insert({
    room_id: action.room_id, hand_id: hand.id, session_id: actor.session_id,
    kind: 'play_card', payload: { card: action.card, seat: rp.seat_index, trick_id: trick.id },
  });

  const { count: numPlayers } = await svc.from('room_players')
    .select('session_id', { count: 'exact', head: true })
    .eq('room_id', action.room_id);
  const totalPlayers = numPlayers ?? 0;
  const cardsInTrick = trickCards.length + 1;

  let nextSeat = (rp.seat_index + 1) % totalPlayers;
  let handClosed = false;

  if (cardsInTrick === totalPlayers) {
    const allCards = [...trickCards, { seat: rp.seat_index, ...played }];
    const winnerSeat = determineWinner(allCards, hand.trump_suit);
    await svc.from('tricks').update({
      winner_seat: winnerSeat, closed_at: new Date().toISOString(),
    }).eq('id', trick.id);

    const { data: winnerPlayer } = await svc.from('room_players')
      .select('session_id').eq('room_id', action.room_id).eq('seat_index', winnerSeat).maybeSingle();
    if (winnerPlayer) {
      await svc.rpc('increment_taken_tricks', {
        p_hand_id: hand.id, p_session_id: winnerPlayer.session_id,
      });
    }

    nextSeat = winnerSeat;

    const { count: closedTricks } = await svc.from('tricks')
      .select('id', { count: 'exact', head: true })
      .eq('hand_id', hand.id)
      .not('closed_at', 'is', null);
    if ((closedTricks ?? 0) === hand.cards_per_player) {
      handClosed = true;
      const { data: scores } = await svc.from('hand_scores')
        .select('session_id, bet, taken_tricks').eq('hand_id', hand.id);
      for (const row of scores ?? []) {
        const { points, bonus } = calculateHandScore({
          playerId: row.session_id,
          bet: row.bet,
          tricksWon: row.taken_tricks,
        });
        await svc.from('hand_scores').update({ hand_score: points + bonus })
          .eq('hand_id', hand.id).eq('session_id', row.session_id);
      }
      await svc.from('hands').update({
        phase: 'scoring',
        closed_at: new Date().toISOString(),
      }).eq('id', hand.id);
    } else {
      await svc.from('tricks').insert({
        hand_id: hand.id,
        trick_number: trick.trick_number + 1,
        lead_seat: nextSeat,
      });
    }
  }

  if (!handClosed) {
    await svc.from('hands').update({ current_seat: nextSeat }).eq('id', hand.id);
  }

  const { data: roomRow } = await svc.from('rooms')
    .select('version').eq('id', action.room_id).single();
  const newVersion = (roomRow?.version ?? 0) + 1;
  await svc.from('rooms').update({ version: newVersion }).eq('id', action.room_id);

  const s = await buildSnapshot(svc, action.room_id, actor.session_id);
  return { ok: true, state: s, version: newVersion };
}
