import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext } from '../_shared/types.ts';

/**
 * Offline tournament: the table's recorder (room host) or the tournament
 * admin enters bets/tricks for proxy seats. Only ever inside a tournament
 * room — regular rooms keep strict one-session-one-seat semantics.
 */
export function canActForTable(
  room: { tournament_id: string | null; host_session_id: string },
  tournamentAdminSessionId: string | null,
  actorSessionId: string,
): boolean {
  if (!room.tournament_id) return false;
  return room.host_session_id === actorSessionId || tournamentAdminSessionId === actorSessionId;
}

export async function resolveOnBehalfActor(
  svc: SupabaseClient,
  actor: ActorContext,
  room_id: string,
  seat: number,
): Promise<{ ok: true; actor: ActorContext } | { ok: false; error: 'not_tournament' | 'not_recorder' | 'no_such_seat' }> {
  const { data: room } = await svc.from('rooms')
    .select('tournament_id, host_session_id').eq('id', room_id).maybeSingle();
  if (!room?.tournament_id) return { ok: false, error: 'not_tournament' };

  const { data: t } = await svc.from('tournaments')
    .select('admin_session_id').eq('id', room.tournament_id).maybeSingle();
  if (!canActForTable(room, t?.admin_session_id ?? null, actor.session_id)) {
    return { ok: false, error: 'not_recorder' };
  }

  const { data: rp } = await svc.from('room_players')
    .select('session_id, room_sessions!inner(display_name)')
    .eq('room_id', room_id).eq('seat_index', seat).maybeSingle();
  if (!rp) return { ok: false, error: 'no_such_seat' };

  return {
    ok: true,
    actor: {
      auth_user_id: actor.auth_user_id,
      session_id: rp.session_id as string,
      display_name: (rp as any).room_sessions?.display_name ?? 'proxy',
    },
  };
}
