import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult, RoomSnapshot } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';
import { canActForTable } from '../onBehalf.ts';

export async function undoBet(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'undo_bet' }>,
): Promise<ActionResult> {
  const { data: room } = await svc.from('rooms')
    .select('tournament_id, host_session_id, mode').eq('id', action.room_id).maybeSingle();
  const { data: t } = room?.tournament_id
    ? await svc.from('tournaments').select('admin_session_id').eq('id', room.tournament_id).maybeSingle()
    : { data: null };
  if (!room || !canActForTable(room, t?.admin_session_id ?? null, actor.session_id)) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'not_recorder', state: s, version: s.room?.version ?? 0 };
  }
  const { data, error } = await svc.rpc('undo_last_bet_action', {
    p_room_id: action.room_id, p_hand_id: action.hand_id,
  });
  if (error) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id).catch(() => ({} as RoomSnapshot));
    return { ok: false, error: 'rpc_failed', state: s, version: s.room?.version ?? 0 };
  }
  const result = data as ActionResult;
  result.state = await buildSnapshot(svc, action.room_id, actor.session_id);
  return result;
}
