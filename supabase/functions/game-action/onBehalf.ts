import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext } from '../_shared/types.ts';

/**
 * Recording for other seats: in a tournament room the table's recorder
 * (room host) or the tournament admin; in a regular scorekeeper room the
 * host. Standard rooms keep strict one-session-one-seat semantics.
 */
export function canActForTable(
  room: { tournament_id: string | null; host_session_id: string; mode?: string | null },
  tournamentAdminSessionId: string | null,
  actorSessionId: string,
): boolean {
  if (room.tournament_id) {
    return room.host_session_id === actorSessionId || tournamentAdminSessionId === actorSessionId;
  }
  return room.mode === 'scorekeeper' && room.host_session_id === actorSessionId;
}

/**
 * Rating stakes are real: outside a tournament, nobody but the player
 * enters or edits values for a seat that has an account while a stake is
 * set. Offline seats (no account) never settle rating.
 */
export function stakeBlocksProxy(
  room: { tournament_id: string | null; stake?: number | null },
  seat: { session_id: string; has_account: boolean },
  actorSessionId: string,
): boolean {
  if (room.tournament_id || !(room.stake && room.stake > 0)) return false;
  return seat.has_account && seat.session_id !== actorSessionId;
}

export async function resolveOnBehalfActor(
  svc: SupabaseClient,
  actor: ActorContext,
  room_id: string,
  seat: number,
): Promise<{ ok: true; actor: ActorContext } | { ok: false; error: 'not_recorder' | 'no_such_seat' | 'stake_seat' }> {
  const { data: room } = await svc.from('rooms')
    .select('tournament_id, host_session_id, mode, stake').eq('id', room_id).maybeSingle();
  if (!room) return { ok: false, error: 'not_recorder' };

  const { data: t } = room.tournament_id
    ? await svc.from('tournaments').select('admin_session_id').eq('id', room.tournament_id).maybeSingle()
    : { data: null };
  if (!canActForTable(room, t?.admin_session_id ?? null, actor.session_id)) {
    return { ok: false, error: 'not_recorder' };
  }

  const { data: rp } = await svc.from('room_players')
    .select('session_id, room_sessions!inner(display_name, auth_user_id)')
    .eq('room_id', room_id).eq('seat_index', seat).maybeSingle();
  if (!rp) return { ok: false, error: 'no_such_seat' };
  const rs = (rp as any).room_sessions ?? {};
  if (stakeBlocksProxy(room, { session_id: rp.session_id as string, has_account: !!rs.auth_user_id }, actor.session_id)) {
    return { ok: false, error: 'stake_seat' };
  }

  return {
    ok: true,
    actor: {
      auth_user_id: actor.auth_user_id,
      session_id: rp.session_id as string,
      display_name: rs.display_name ?? 'proxy',
    },
  };
}
