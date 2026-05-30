/**
 * Client-side turn timeout watcher + visible countdown.
 *
 * Budget is 2 minutes for everyone (LONG == SHORT) — we used to drop to
 * a shorter SHORT for offline players but it was punitive on real-life
 * mobile network hiccups / backgrounded tabs / "walked away". Kept the
 * two constants separate in case we add a real "kick player" UX later.
 *
 * After the budget elapses with no progress, ANY mounted client posts
 * `request_timeout` to the Edge Function, which idempotently auto-
 * advances (auto-bet 0 / lowest legal card). Concurrent requests are
 * safe — the server checks `expected_seat == current_seat` and no-ops
 * on stale ones.
 *
 * `useTurnCountdown()` reads the SAME turn-start moment to render a
 * visible countdown chip during the last COUNTDOWN_VISIBLE_MS of the
 * budget. Both hooks share a module-level startedAt so the visual
 * timer can't drift away from the timeout that actually fires.
 */

import { useEffect, useRef, useState } from 'react';
import { useRoomStore } from '../store/roomStore';
import { gameClient } from './gameClient';

export const TURN_TIMEOUT_LONG_MS  = 120 * 1000;     // 2 min — humans thinking
export const TURN_TIMEOUT_SHORT_MS = 120 * 1000;     // 2 min — offline player too
/** Show the countdown chip only when remaining ≤ this. Keeps the UI
 *  quiet for the first part of the turn; surfaces urgency in the
 *  second half. */
export const COUNTDOWN_VISIBLE_MS = 60 * 1000;
const OFFLINE_THRESHOLD_MS = 30 * 1000;        // 30 s since last heartbeat

// Shared across useTurnTimeout + useTurnCountdown so the visible
// countdown never drifts away from the timer that actually fires.
let _turnStartedAt = Date.now();
let _turnKey: string | null = null;

function markTurnIfChanged(handId: string | null | undefined, seat: number | null | undefined): string | null {
  if (!handId || seat === undefined || seat === null) return null;
  const key = `${handId}:${seat}`;
  if (_turnKey !== key) {
    _turnKey = key;
    _turnStartedAt = Date.now();
  }
  return key;
}

function isPlayerOffline(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt) return true;
  const ts = Date.parse(lastSeenAt);
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > OFFLINE_THRESHOLD_MS;
}

export function useTurnTimeout(): void {
  const roomId   = useRoomStore((s) => s.snapshot?.room?.id);
  const mode     = useRoomStore((s) => s.snapshot?.room?.mode);
  const handId   = useRoomStore((s) => s.snapshot?.current_hand?.id);
  const seat     = useRoomStore((s) => s.snapshot?.current_hand?.current_seat);
  const players  = useRoomStore((s) => s.snapshot?.players);
  const version  = useRoomStore((s) => s.version);

  // Determine the budget for the player whose turn it currently is.
  const currentPlayer = players?.find((p) => p.seat_index === seat);
  const offline = currentPlayer ? isPlayerOffline(currentPlayer.last_seen_at) : false;
  const budget = offline ? TURN_TIMEOUT_SHORT_MS : TURN_TIMEOUT_LONG_MS;

  useEffect(() => {
    // Scorekeeper (offline) mode: no auto-bet / auto-play — humans run the
    // hand with real cards at their own pace. Never fire request_timeout.
    if (mode === 'scorekeeper') return;
    if (!roomId || !handId || seat === undefined || seat === null) return;
    markTurnIfChanged(handId, seat);

    const elapsed = Date.now() - _turnStartedAt;
    const remaining = budget - elapsed;

    if (remaining <= 0) {
      void gameClient.requestTimeout(roomId, handId, seat);
      return;
    }

    const t = setTimeout(() => {
      void gameClient.requestTimeout(roomId, handId, seat);
    }, remaining);
    return () => clearTimeout(t);
  }, [roomId, handId, seat, version, budget, mode]);
}

/**
 * Visible turn countdown. Returns seconds remaining (rounded up) when
 * remaining ≤ COUNTDOWN_VISIBLE_MS, else null.
 *
 * Re-renders ~ every 500 ms while visible — cheap enough; tied to the
 * mounted hook so it stops when the screen unmounts.
 */
export function useTurnCountdown(): number | null {
  const mode   = useRoomStore((s) => s.snapshot?.room?.mode);
  const handId = useRoomStore((s) => s.snapshot?.current_hand?.id);
  const seat   = useRoomStore((s) => s.snapshot?.current_hand?.current_seat);
  const phase  = useRoomStore((s) => s.snapshot?.current_hand?.phase);
  const players = useRoomStore((s) => s.snapshot?.players);

  markTurnIfChanged(handId, seat);

  const [, tick] = useState(0);
  useEffect(() => {
    if (mode === 'scorekeeper') return;
    if (!handId || seat === undefined || seat === null) return;
    if (phase !== 'playing') return;
    const id = setInterval(() => tick((n) => (n + 1) % 1_000_000), 500);
    return () => clearInterval(id);
  }, [handId, seat, phase, mode]);

  // Scorekeeper (offline) mode: no visible auto-play countdown.
  if (mode === 'scorekeeper') return null;
  if (!handId || seat === undefined || seat === null) return null;
  if (phase !== 'playing') return null;

  const currentPlayer = players?.find((p) => p.seat_index === seat);
  const offline = currentPlayer ? isPlayerOffline(currentPlayer.last_seen_at) : false;
  const budget = offline ? TURN_TIMEOUT_SHORT_MS : TURN_TIMEOUT_LONG_MS;
  const remaining = budget - (Date.now() - _turnStartedAt);
  if (remaining > COUNTDOWN_VISIBLE_MS) return null;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / 1000);
}
