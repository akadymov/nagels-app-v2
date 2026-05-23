import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult, RoomSnapshot } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

export async function restartGame(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'restart_game' }>,
): Promise<ActionResult> {
  const { data, error } = await svc.rpc('restart_game', {
    p_room_id:    action.room_id,
    p_session_id: actor.session_id,
  });
  if (error) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id).catch(() => ({} as RoomSnapshot));
    return { ok: false, error: 'rpc_failed', state: s, version: s.room?.version ?? 0 };
  }

  // The restart_game RPC predates conditional stakes; unlock the wager
  // and clear per-player opt-ins so the WaitingRoom is re-armed for the
  // next match. rooms.stake is intentionally preserved (same group usually
  // keeps the same wager).
  await svc.from('rooms').update({ stake_locked: false }).eq('id', action.room_id);
  await svc.from('room_players').update({ opt_in_stake: false }).eq('room_id', action.room_id);

  return data as ActionResult;
}
