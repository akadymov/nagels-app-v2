import type { RoomSnapshot } from '../../supabase/functions/_shared/types.ts';

/**
 * True iff the room exists, has a host_session_id, and no player in the
 * snapshot's players list matches that session_id. Used by the host-left
 * rescue banner to detect a stuck client where the auto-eject broadcast
 * was lost.
 */
export function isHostAbsent(
  snap: Pick<RoomSnapshot, 'room' | 'players'>,
): boolean {
  const room = snap.room;
  if (!room?.host_session_id) return false;
  return !snap.players.some((p) => p.session_id === room.host_session_id);
}
