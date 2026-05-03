/**
 * Client-side turn timeout watcher.
 *
 * Two budgets:
 *   • LONG (5 min) — for present-but-thinking players
 *   • SHORT (20 s) — when the current_seat player is offline
 *     (last_seen_at older than OFFLINE_THRESHOLD_MS) so the table
 *     doesn't hang for 5 minutes whenever someone closes their tab.
 *
 * After the chosen budget elapses with no progress, ANY mounted client
 * posts `request_timeout` to the Edge Function, which idempotently
 * auto-advances (auto-bet 0 / lowest legal card). Concurrent requests
 * are safe — the server checks `expected_seat == current_seat` and
 * no-ops on stale ones.
 */

import { useEffect, useRef } from 'react';
import { useRoomStore } from '../store/roomStore';
import { gameClient } from './gameClient';

const TURN_TIMEOUT_LONG_MS  = 5 * 60 * 1000;  // 5 min — humans thinking
const TURN_TIMEOUT_SHORT_MS = 3 * 60 * 1000;  // 3 min — offline player; was 20s
                                              // but auto-advancing a dropped
                                              // player that fast made
                                              // accidental disconnects (tab
                                              // backgrounded, mobile network
                                              // hiccup) feel punitive.
const OFFLINE_THRESHOLD_MS  = 30 * 1000;       // 30 s since last heartbeat

function isPlayerOffline(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt) return true;
  const ts = Date.parse(lastSeenAt);
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > OFFLINE_THRESHOLD_MS;
}

export function useTurnTimeout(): void {
  const roomId   = useRoomStore((s) => s.snapshot?.room?.id);
  const handId   = useRoomStore((s) => s.snapshot?.current_hand?.id);
  const seat     = useRoomStore((s) => s.snapshot?.current_hand?.current_seat);
  const players  = useRoomStore((s) => s.snapshot?.players);
  const version  = useRoomStore((s) => s.version);

  const lastSeat = useRef<number | null>(null);
  const startedAt = useRef<number>(Date.now());

  // Determine the budget for the player whose turn it currently is.
  const currentPlayer = players?.find((p) => p.seat_index === seat);
  const offline = currentPlayer ? isPlayerOffline(currentPlayer.last_seen_at) : false;
  const budget = offline ? TURN_TIMEOUT_SHORT_MS : TURN_TIMEOUT_LONG_MS;

  useEffect(() => {
    if (!roomId || !handId || seat === undefined || seat === null) return;

    if (lastSeat.current !== seat) {
      lastSeat.current = seat;
      startedAt.current = Date.now();
    }

    const elapsed = Date.now() - startedAt.current;
    const remaining = budget - elapsed;

    if (remaining <= 0) {
      void gameClient.requestTimeout(roomId, handId, seat);
      return;
    }

    const t = setTimeout(() => {
      void gameClient.requestTimeout(roomId, handId, seat);
    }, remaining);
    return () => clearTimeout(t);
  }, [roomId, handId, seat, version, budget]);
}
