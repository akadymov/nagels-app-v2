import { useEffect, useState } from 'react';

/**
 * Forces a re-render every `intervalMs` (default 15s) so that the
 * host-left-rescue banner can detect heartbeat staleness even when no
 * realtime broadcast lands. Without this, a stale host could go
 * undetected until the next snapshot refresh, which may be longer
 * than HOST_STALE_MS.
 *
 * Returns a tick counter just to make React see "new value" each
 * interval; the value itself is irrelevant.
 */
export function useHostAbsentTicker(intervalMs: number = 15_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}
