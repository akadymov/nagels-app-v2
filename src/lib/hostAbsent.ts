import type { RoomSnapshot } from '../../supabase/functions/_shared/types.ts';

/**
 * Time since the host's last heartbeat before we consider them gone,
 * even if their room_players row still exists. 10 minutes is
 * conservative — won't fire on a brief network blip or mobile
 * background sleep, only on a host that's clearly given up.
 */
export const HOST_STALE_MS = 600_000;

/**
 * True iff the room's host has effectively left:
 *   - host_session_id is set, AND
 *   - either no player row matches it (host deleted from room_players),
 *     OR the matching row's last_seen_at is older than HOST_STALE_MS
 *     (heartbeat dead — tab closed / device offline / network gone).
 *
 * Used by the host-left rescue banner to surface a Leave button when
 * the auto-eject signal didn't reach this client or the host's row
 * lingers with is_connected stuck on true.
 *
 * `now` is injectable for tests; defaults to Date.now().
 */
export function isHostAbsent(
  snap: Pick<RoomSnapshot, 'room' | 'players'>,
  now: number = Date.now(),
): boolean {
  const room = snap.room;
  if (!room?.host_session_id) return false;
  const host = snap.players.find((p) => p.session_id === room.host_session_id);
  if (!host) return true;
  const lastSeen = (host as { last_seen_at?: string | null }).last_seen_at;
  if (!lastSeen) return false;
  const lastSeenMs = Date.parse(lastSeen);
  if (Number.isNaN(lastSeenMs)) return false;
  return now - lastSeenMs > HOST_STALE_MS;
}
