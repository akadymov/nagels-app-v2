import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult, RoomSnapshot } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

export async function placeBet(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'place_bet' }>,
): Promise<ActionResult> {
  const { data, error } = await svc.rpc('place_bet_action', {
    p_room_id:    action.room_id,
    p_session_id: actor.session_id,
    p_hand_id:    action.hand_id,
    p_bet:        action.bet,
  });
  if (error) {
    // Infrastructure failure — return empty snapshot, error.
    const s = await buildSnapshot(svc, action.room_id, actor.session_id).catch(() => ({} as RoomSnapshot));
    return { ok: false, error: 'rpc_failed', state: s, version: s.room?.version ?? 0 };
  }
  // The RPC returns my_hand-less snapshot via get_room_state. Attach my_hand.
  const result = data as { ok: boolean; error?: string; state: RoomSnapshot; version: number };
  if (result.state) {
    const fresh = await buildSnapshot(svc, action.room_id, actor.session_id);
    result.state = fresh;
  }
  return result as ActionResult;
}
