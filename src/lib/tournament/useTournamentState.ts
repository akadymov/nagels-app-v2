import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseClient } from '../supabase/client';
import { gameClient } from '../gameClient';
import type { TournamentState } from './types';

const FALLBACK_POLL_MS = 15_000;
const REFETCH_DEBOUNCE_MS = 250;

/**
 * Read model for the TV / recorder / admin screens. Independent of
 * useRoomStore (which holds one room) — subscribes to the tournament
 * channel plus every current-tour room channel and refetches the whole
 * get_tournament_state on any change. A slow poll covers missed broadcasts.
 *
 * `opts.roomChannels` (default true): false subscribes only the tournament
 * channel, for callers that own the room channel themselves (recorder).
 * `opts.skipRoomId`: a room the caller already subscribes to via
 * subscribeRoom (supabase-js returns the same channel instance for a
 * duplicate topic), so it is left out of the room channel list here.
 */
export function useTournamentState(code: string | undefined, opts?: { skipRoomId?: string; roomChannels?: boolean }) {
  const [data, setData] = useState<TournamentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipRoomId = opts?.skipRoomId;
  const roomChannels = opts?.roomChannels ?? true;

  const refetch = useCallback(async () => {
    if (!code) return;
    try {
      const s = await gameClient.getTournamentState(code);
      setData(s);
      setError(s ? null : 'not_found');
    } catch (e: any) {
      setError(e?.message ?? 'fetch_failed');
    } finally {
      setLoading(false);
    }
  }, [code]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void refetch(); }, REFETCH_DEBOUNCE_MS);
  }, [refetch]);

  useEffect(() => {
    void refetch();
    const id = setInterval(() => { void refetch(); }, FALLBACK_POLL_MS);
    return () => { clearInterval(id); if (timer.current) clearTimeout(timer.current); };
  }, [refetch]);

  const tournamentId = data?.tournament.id;
  const roomKey = !roomChannels ? '' : (data?.tables ?? [])
    .map((t) => t.room_id)
    .filter((rid) => rid !== skipRoomId)
    .join(',');

  useEffect(() => {
    if (!tournamentId) return;
    const supabase = getSupabaseClient();
    const channels: RealtimeChannel[] = [
      supabase.channel(`tournament:${tournamentId}`)
        .on('broadcast', { event: 'tournament_changed' }, schedule),
      ...roomKey.split(',').filter(Boolean).map((rid) =>
        supabase.channel(`room:${rid}`).on('broadcast', { event: 'state_changed' }, schedule)),
    ];
    channels.forEach((c) => c.subscribe());
    return () => { channels.forEach((c) => supabase.removeChannel(c)); };
  }, [tournamentId, roomKey, schedule]);

  return { data, loading, error, refetch };
}
