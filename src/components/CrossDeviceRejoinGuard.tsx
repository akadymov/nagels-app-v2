// src/components/CrossDeviceRejoinGuard.tsx
import { useEffect } from 'react';
import { AppState } from 'react-native';
import type { NavigationContainerRef } from '@react-navigation/native';
import { getSupabaseClient } from '../lib/supabase/client';
import { useRoomStore } from '../store/roomStore';

interface Props {
  /**
   * The navigation ref from AppNavigator. Used to dispatch navigation
   * without a useNavigation() hook, so this guard can mount above the
   * Stack.Navigator.
   */
  navigationRef: NavigationContainerRef<any>;
}

/**
 * Listens for events that indicate the user might have an active room
 * elsewhere and auto-navigates them into it.
 *
 * Triggers:
 *   1. Supabase auth SIGNED_IN — login on this device
 *   2. AppState becomes 'active' — tab/PWA came back to foreground
 *
 * Boot-time rejoin is already handled by RejoinGuard inside Welcome.
 * This component covers the "user logs in / focuses tab AFTER boot"
 * cases that the existing guard misses.
 *
 * Side-effect-free when the user is already in a room (gated by
 * roomStore snapshot) — realtime keeps state synced from there.
 */
export function CrossDeviceRejoinGuard({ navigationRef }: Props) {
  useEffect(() => {
    const supabase = getSupabaseClient();
    let lastCheckMs = 0;
    const COOLDOWN_MS = 5_000;

    const check = async (reason: string) => {
      const now = Date.now();
      if (now - lastCheckMs < COOLDOWN_MS) return;
      lastCheckMs = now;
      // Already in a room on this device — realtime keeps us synced.
      if (useRoomStore.getState().snapshot?.room?.id) return;
      try {
        const { tryRestoreActiveRoom } = await import('../lib/activeRoom');
        const dest = await tryRestoreActiveRoom();
        if (!dest || !navigationRef.isReady()) return;
        if (dest === 'GameTable') {
          // Restored room is always multiplayer.
          (navigationRef as any).navigate('GameTable', { isMultiplayer: true });
        } else {
          navigationRef.navigate(dest as never);
        }
      } catch (err) {
        console.warn(`[CrossDeviceRejoin:${reason}] failed:`, err);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') void check('signed_in');
    });
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check('app_active');
    });

    return () => {
      subscription.unsubscribe();
      appStateSub.remove();
    };
  }, [navigationRef]);

  return null;
}
