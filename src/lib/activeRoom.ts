/**
 * Persists the user's active room across app reloads.
 *
 * On first action (createRoom/joinRoom), call `setActiveRoom(roomId, code, role)`.
 * On explicit leave, call `clearActiveRoom()`.
 * On app boot, RejoinGuard reads the value and restores the session via
 * `get_room_state`. Server-side host status is preserved via
 * `room_sessions.auth_user_id`, which is stable across anonymous sign-in
 * restoration — i.e. browser close + reopen keeps you as host.
 *
 * Defensive fallback: if `get_my_session_id` returns null (anon session was
 * recreated, or `room_sessions` row got cleaned up), and the room is still
 * in 'waiting' phase, we silently re-join by the saved room code so the
 * guest doesn't end up viewing the room without a seat.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from './supabase/client';
import { useRoomStore } from '../store/roomStore';
import { useAuthStore } from '../store/authStore';
import { subscribeRoom } from './realtimeBroadcast';
import type { RoomSnapshot } from '../../supabase/functions/_shared/types';

const ACTIVE_ROOM_KEY = 'active_room_id_v1';
const ACTIVE_ROOM_META_KEY = 'active_room_meta_v1';

type ActiveRoomMeta = { code?: string; role?: 'player' | 'spectator' };

export async function setActiveRoom(
  roomId: string,
  code?: string,
  role: 'player' | 'spectator' = 'player',
): Promise<void> {
  try {
    await AsyncStorage.setItem(ACTIVE_ROOM_KEY, roomId);
    if (code) {
      const meta: ActiveRoomMeta = { code, role };
      await AsyncStorage.setItem(ACTIVE_ROOM_META_KEY, JSON.stringify(meta));
    }
  } catch {}
}

export async function clearActiveRoom(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ACTIVE_ROOM_KEY);
    await AsyncStorage.removeItem(ACTIVE_ROOM_META_KEY);
  } catch {}
}

export async function getActiveRoom(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(ACTIVE_ROOM_KEY);
  } catch {
    return null;
  }
}

async function getActiveRoomMeta(): Promise<ActiveRoomMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_ROOM_META_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveRoomMeta;
  } catch {
    return null;
  }
}

/**
 * Tries to restore the active room. Returns:
 *   - 'WaitingRoom' if the room is in 'waiting' phase
 *   - 'GameTable'   if the room is in 'playing' or 'finished' phase
 *   - null          if there is no active room or the saved room has gone
 */
export async function tryRestoreActiveRoom(): Promise<'WaitingRoom' | 'GameTable' | null> {
  // 1. Server-side lookup first (cross-device authoritative path).
  // Falls through to the local AsyncStorage cache for anonymous guests
  // (no auth.uid()) or transient server failures.
  let roomId: string | null = null;
  try {
    const { gameClient } = await import('./gameClient');
    const active = await gameClient.getMyActiveRoom();
    if (active?.room_id) {
      roomId = active.room_id;
      // Sync the local cache so a subsequent offline boot still works.
      await setActiveRoom(active.room_id, active.code, active.role);
    }
  } catch (err) {
    console.warn('[rejoin] get_my_active_room failed, falling back to cache:', err);
  }

  // 2. Fallback: AsyncStorage (guests, server miss).
  if (!roomId) {
    roomId = await getActiveRoom();
  }
  if (!roomId) return null;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('get_room_state', { p_room_id: roomId });
  if (error || !data) {
    await clearActiveRoom();
    return null;
  }

  let snapshot = data as unknown as RoomSnapshot;
  if (!snapshot.room) {
    await clearActiveRoom();
    return null;
  }

  // Room finished (host left or game over) — clear so the user can freely
  // create or join a new room.
  if (snapshot.room.phase === 'finished') {
    await clearActiveRoom();
    return null;
  }

  // Get our session_id via SECURITY DEFINER RPC so the UI knows which
  // player row in the snapshot represents us (host detection, "your turn", etc.)
  let { data: mySession } = await supabase.rpc('get_my_session_id');

  // Fallback: anon session was recreated or our room_sessions row was
  // garbage-collected. Re-join silently by code if the room is still
  // pre-game so the guest doesn't end up seatless in their own room.
  if (!mySession && snapshot.room.phase === 'waiting') {
    const meta = await getActiveRoomMeta();
    if (meta?.code) {
      try {
        const { gameClient } = await import('./gameClient');
        if (meta.role === 'spectator') {
          const res = await gameClient.joinRoomAsSpectator(meta.code);
          if (res?.ok) {
            mySession = res.session_id as any;
            useRoomStore.getState().setIsSpectator(true);
            snapshot = (res.state as any) ?? snapshot;
          }
        } else {
          const displayName = useAuthStore.getState().displayName || 'Guest';
          const res = await gameClient.joinRoom(displayName, meta.code);
          if (res?.ok && (res.state as any)?.room) {
            snapshot = res.state as any;
            const { data: retry } = await supabase.rpc('get_my_session_id');
            mySession = retry ?? null;
          }
        }
      } catch (err) {
        console.warn('[rejoin] silent re-join by code failed:', err);
      }
    }
  }

  if (mySession) {
    useRoomStore.getState().setMyPlayerId(mySession as string);
  }

  // Re-narrow after the re-join fallback may have reassigned `snapshot`.
  const room = snapshot.room;
  if (!room) {
    await clearActiveRoom();
    return null;
  }
  useRoomStore.getState().applySnapshot(snapshot, room.version);
  subscribeRoom(roomId);

  return room.phase === 'waiting' ? 'WaitingRoom' : 'GameTable';
}
