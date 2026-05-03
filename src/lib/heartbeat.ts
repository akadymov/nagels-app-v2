/**
 * Client heartbeat — pings the server every 10s with the current room id
 * so room_players.last_seen_at + is_connected stay fresh.
 *
 * Used by the smart-timeout logic and the offline indicator on profile
 * cards. Without this, the server has no way to tell which players
 * actually have an open browser tab.
 */

import { useEffect } from 'react';
import { useRoomStore } from '../store/roomStore';
import { getSupabaseClient } from './supabase/client';

const HEARTBEAT_INTERVAL_MS = 10_000;

export function useHeartbeat(): void {
  const roomId = useRoomStore((s) => s.snapshot?.room?.id);

  useEffect(() => {
    if (!roomId) return;
    const supabase = getSupabaseClient();

    const ping = async () => {
      try {
        await supabase.rpc('heartbeat', { p_room_id: roomId });
      } catch {
        // Heartbeat is fire-and-forget — server will mark us offline once
        // last_seen_at expires. No retry, no error surface.
      }
    };

    void ping();
    const id = setInterval(ping, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [roomId]);
}
