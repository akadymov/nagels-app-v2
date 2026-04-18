/**
 * Nägels Online - Rejoin Manager
 *
 * Persists the player's active room to AsyncStorage so that after a browser
 * refresh or app restart the session can be automatically restored.
 *
 * Flow:
 *   createRoom / joinRoom   → saveActiveRoom()
 *   leaveRoom               → clearActiveRoom()
 *   App startup             → tryRejoin() → navigate to WaitingRoom / GameTable
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient, isSupabaseConfigured } from '../supabase/client';

// ============================================================
// TYPES
// ============================================================

const ACTIVE_ROOM_KEY = 'nagels_active_room';

/** Maximum age of a saved room before we discard it (12 hours) */
const MAX_ROOM_AGE_MS = 12 * 60 * 60 * 1000;

export type RejoinScreen = 'WaitingRoom' | 'GameTable';

export interface ActiveRoomData {
  roomId: string;
  roomCode: string;
  screen: RejoinScreen;
  savedAt: number; // Date.now()
}

// ============================================================
// SAVE / CLEAR
// ============================================================

export async function saveActiveRoom(
  roomId: string,
  roomCode: string,
  screen: RejoinScreen = 'WaitingRoom'
): Promise<void> {
  const data: ActiveRoomData = { roomId, roomCode, screen, savedAt: Date.now() };
  await AsyncStorage.setItem(ACTIVE_ROOM_KEY, JSON.stringify(data));
  console.log('[RejoinManager] Saved active room:', roomCode, screen);
}

export async function updateActiveRoomScreen(screen: RejoinScreen): Promise<void> {
  const data = await getActiveRoom();
  if (data) {
    await saveActiveRoom(data.roomId, data.roomCode, screen);
  }
}

export async function clearActiveRoom(): Promise<void> {
  await AsyncStorage.removeItem(ACTIVE_ROOM_KEY);
  console.log('[RejoinManager] Cleared active room');
}

export async function getActiveRoom(): Promise<ActiveRoomData | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_ROOM_KEY);
    if (!raw) return null;

    const data: ActiveRoomData = JSON.parse(raw);

    // Discard stale data
    if (Date.now() - data.savedAt > MAX_ROOM_AGE_MS) {
      await clearActiveRoom();
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

// ============================================================
// REJOIN CHECK
// ============================================================

export interface RejoinResult {
  success: boolean;
  screen?: RejoinScreen;
  roomCode?: string;
  roomId?: string;
}

/**
 * Check whether the player is still in their saved room and return rejoin info.
 *
 * @param playerId  The current Supabase Auth user.id / sessionId
 */
export async function tryRejoin(playerId: string): Promise<RejoinResult> {
  if (!playerId || !isSupabaseConfigured()) return { success: false };

  const saved = await getActiveRoom();
  if (!saved) return { success: false };

  try {
    const supabase = getSupabaseClient();

    // 1. Verify room still exists and is in a joinable state
    const { data: room } = await supabase
      .from('rooms')
      .select('id, status, room_code')
      .eq('id', saved.roomId)
      .single();

    if (!room || room.status === 'abandoned') {
      await clearActiveRoom();
      return { success: false };
    }

    // 2. Verify player is still listed in room_players
    const { data: playerRow } = await supabase
      .from('room_players')
      .select('id')
      .eq('room_id', saved.roomId)
      .eq('player_id', playerId)
      .single();

    if (!playerRow) {
      await clearActiveRoom();
      return { success: false };
    }

    // 3. Determine target screen based on room status
    const screen: RejoinScreen =
      room.status === 'playing' ? 'GameTable' : 'WaitingRoom';

    // Update saved screen in case it changed
    await saveActiveRoom(saved.roomId, room.room_code, screen);

    console.log('[RejoinManager] Rejoin available:', room.room_code, '→', screen);
    return {
      success: true,
      screen,
      roomCode: room.room_code,
      roomId: room.id,
    };
  } catch (err) {
    console.warn('[RejoinManager] tryRejoin error:', err);
    return { success: false };
  }
}
