/**
 * Force a fresh snapshot + heartbeat whenever the tab returns to the
 * foreground or the network reports back online.
 *
 * Realtime broadcast is best-effort: when the tab is backgrounded long
 * enough that the WebSocket drops, missed `state_changed` events leave
 * the local snapshot stale. The user comes back, sees the old state, and
 * has to mash the sync button. These two listeners cover that gap.
 *
 * Mount once per screen that holds a room (WaitingRoom, GameTable).
 */

import { useEffect } from 'react';
import { useRoomStore } from '../store/roomStore';
import { gameClient } from './gameClient';
import { getSupabaseClient } from './supabase/client';

export function useReconnectOnFocus(): void {
  const roomId = useRoomStore((s) => s.snapshot?.room?.id);

  useEffect(() => {
    if (!roomId) return;

    const resync = () => {
      const supabase = getSupabaseClient();
      // Promise.resolve() to attach .catch — supabase.rpc returns a thenable
      // that doesn't expose .catch on its own.
      Promise.resolve(supabase.rpc('heartbeat', { p_room_id: roomId })).catch(() => {});
      void gameClient.refreshSnapshot(roomId);
    };

    const onVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'visible') resync();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', resync);
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', resync);
      }
    };
  }, [roomId]);
}
