/**
 * Persists the user's active room across app reloads.
 *
 * On first action (createRoom/joinRoom), call `setActiveRoom(roomId)`.
 * On explicit leave, call `clearActiveRoom()`.
 * On app boot, RejoinGuard reads the value and restores the session via
 * `get_room_state`. Server-side host status is preserved via
 * `room_sessions.auth_user_id`, which is stable across anonymous sign-in
 * restoration — i.e. browser close + reopen keeps you as host.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from './supabase/client';
import { useRoomStore } from '../store/roomStore';
import { subscribeRoom } from './realtimeBroadcast';
import type { RoomSnapshot } from '../../supabase/functions/_shared/types';

const ACTIVE_ROOM_KEY = 'active_room_id_v1';

export async function setActiveRoom(roomId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(ACTIVE_ROOM_KEY, roomId);
  } catch {}
}

export async function clearActiveRoom(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ACTIVE_ROOM_KEY);
  } catch {}
}

export async function getActiveRoom(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(ACTIVE_ROOM_KEY);
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
  const roomId = await getActiveRoom();
  if (!roomId) return null;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('get_room_state', { p_room_id: roomId });
  if (error || !data) {
    await clearActiveRoom();
    return null;
  }

  const snapshot = data as unknown as RoomSnapshot;
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
  const { data: mySession } = await supabase.rpc('get_my_session_id');
  if (mySession) {
    useRoomStore.getState().setMyPlayerId(mySession as string);
  }

  useRoomStore.getState().applySnapshot(snapshot, snapshot.room.version);
  subscribeRoom(roomId);

  return snapshot.room.phase === 'waiting' ? 'WaitingRoom' : 'GameTable';
}
