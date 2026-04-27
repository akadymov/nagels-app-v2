import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';
import { placeBet } from './placeBet.ts';
import { playCard } from './playCard.ts';

export async function requestTimeout(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'request_timeout' }>,
): Promise<ActionResult> {
  const { data: hand } = await svc.from('hands')
    .select('id, room_id, current_seat, phase, cards_per_player')
    .eq('id', action.hand_id).maybeSingle();
  if (!hand || hand.room_id !== action.room_id) {
    return { ok: false, error: 'unknown_hand',
             state: await buildSnapshot(svc, action.room_id, actor.session_id), version: 0 };
  }
  if (hand.current_seat !== action.expected_seat) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: true, state: s, version: s.room?.version ?? 0 };
  }

  const { data: rp } = await svc.from('room_players')
    .select('session_id')
    .eq('room_id', action.room_id)
    .eq('seat_index', hand.current_seat)
    .maybeSingle();
  if (!rp) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: true, state: s, version: s.room?.version ?? 0 };
  }

  const stuckActor: ActorContext = {
    auth_user_id: actor.auth_user_id,
    session_id: rp.session_id,
    display_name: 'timeout',
  };

  await svc.from('game_events').insert({
    room_id: action.room_id, hand_id: hand.id, session_id: rp.session_id,
    kind: 'timeout', payload: { seat: hand.current_seat },
  });

  if (hand.phase === 'betting') {
    for (let bet = 0; bet <= hand.cards_per_player; bet++) {
      const r = await placeBet(svc, stuckActor, {
        kind: 'place_bet', room_id: action.room_id, hand_id: hand.id, bet,
      });
      if (r.ok) return r;
    }
    return { ok: false, error: 'no_legal_bet',
             state: await buildSnapshot(svc, action.room_id, actor.session_id), version: 0 };
  }

  if (hand.phase === 'playing') {
    const { data: cards } = await svc.from('dealt_cards')
      .select('card').eq('hand_id', hand.id).eq('session_id', rp.session_id);
    const allTricksData = await svc.from('tricks').select('id').eq('hand_id', hand.id);
    const trickIds = (allTricksData.data ?? []).map((t: any) => t.id);
    const playedData = trickIds.length
      ? await svc.from('trick_cards')
          .select('card, trick_id, seat_index')
          .in('trick_id', trickIds)
          .eq('seat_index', hand.current_seat)
      : { data: [] as any[] };
    const playedSet = new Set((playedData.data ?? []).map((r: any) => r.card));
    const remaining = (cards ?? []).map((r: any) => r.card).filter((c: string) => !playedSet.has(c));

    for (const card of remaining) {
      const r = await playCard(svc, stuckActor, {
        kind: 'play_card', room_id: action.room_id, hand_id: hand.id, card,
      });
      if (r.ok) return r;
    }
    return { ok: false, error: 'no_legal_card',
             state: await buildSnapshot(svc, action.room_id, actor.session_id), version: 0 };
  }

  const s = await buildSnapshot(svc, action.room_id, actor.session_id);
  return { ok: true, state: s, version: s.room?.version ?? 0 };
}
