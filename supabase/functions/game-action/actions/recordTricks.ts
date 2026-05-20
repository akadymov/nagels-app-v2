import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult, RoomSnapshot } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

export async function recordTricks(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'record_tricks' }>,
): Promise<ActionResult> {
  const { data, error } = await svc.rpc('record_tricks_action', {
    p_room_id:    action.room_id,
    p_session_id: actor.session_id,
    p_hand_id:    action.hand_id,
    p_tricks:     action.tricks,
  });
  if (error) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id)
      .catch(() => ({} as RoomSnapshot));
    return { ok: false, error: 'rpc_failed', state: s, version: s.room?.version ?? 0 };
  }
  const result = data as { ok: boolean; error?: string; state: RoomSnapshot; version: number };
  if (result.state) {
    // get_room_state omits my_hand — refresh through buildSnapshot so the
    // caller's hand stays attached (mirrors placeBet handler).
    const fresh = await buildSnapshot(svc, action.room_id, actor.session_id);
    result.state = fresh;
  }
  return result as ActionResult;
}
