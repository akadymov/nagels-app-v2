/**
 * Client-side turn timeout watcher.
 *
 * Tracks the time since the last `current_seat` change. When 30 s elapses
 * with no progress, ANY mounted client posts `request_timeout` to the
 * Edge Function, which idempotently auto-advances (auto-bet 0 / random
 * legal card). Multiple concurrent timeout requests are safe — the
 * server checks `expected_seat == current_seat` and no-ops on stale ones.
 */

import { useEffect, useRef } from 'react';
import { useRoomStore } from '../store/roomStore';
import { gameClient } from './gameClient';

// 5 minutes per turn. Anything shorter caused premature auto-bet=0 during
// real-paced play. After this, any client may post `request_timeout`; the
// server idempotently auto-advances (bet 0 / lowest legal card).
const TURN_TIMEOUT_MS = 5 * 60 * 1000;

export function useTurnTimeout(): void {
  const roomId   = useRoomStore((s) => s.snapshot?.room?.id);
  const handId   = useRoomStore((s) => s.snapshot?.current_hand?.id);
  const seat     = useRoomStore((s) => s.snapshot?.current_hand?.current_seat);
  const version  = useRoomStore((s) => s.version);

  const lastSeat = useRef<number | null>(null);
  const startedAt = useRef<number>(Date.now());

  useEffect(() => {
    if (!roomId || !handId || seat === undefined || seat === null) return;

    if (lastSeat.current !== seat) {
      lastSeat.current = seat;
      startedAt.current = Date.now();
    }

    const elapsed = Date.now() - startedAt.current;
    const remaining = TURN_TIMEOUT_MS - elapsed;

    if (remaining <= 0) {
      void gameClient.requestTimeout(roomId, handId, seat);
      return;
    }

    const t = setTimeout(() => {
      void gameClient.requestTimeout(roomId, handId, seat);
    }, remaining);
    return () => clearTimeout(t);
  }, [roomId, handId, seat, version]);
}
