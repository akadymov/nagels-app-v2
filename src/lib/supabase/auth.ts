/**
 * Nägels Online - Guest Authentication
 *
 * Identity resolution order:
 *   1. Supabase Auth session (anonymous or email) — preferred; survives refresh & cross-device
 *   2. Legacy device-ID based guest session in player_sessions table — fallback
 *   3. Fully offline session — fallback when Supabase is not configured
 *
 * The sessionId returned is always the Supabase Auth user.id when available,
 * which is the same UUID used as player_id in rooms/room_players.
 */

import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isSupabaseConfigured } from './client';
import {
  getCurrentUser,
  signInAnonymously,
  signOut as supabaseSignOut,
} from './authService';

export interface GuestSession {
  sessionId: string;
  deviceId: string;
  playerName: string;
  language: string;
  createdAt: string;
  lastSeenAt: string;
  isGuest: boolean;
  email: string | null;
}

// ============================================================
// CONSTANTS
// ============================================================

const DEVICE_ID_KEY = 'nagels_device_id';
const SESSION_ID_KEY = 'nagels_session_id';
const PLAYER_NAME_KEY = 'nagels_player_name';

// ============================================================
// DEVICE ID MANAGEMENT
// ============================================================

/**
 * Get or create a persistent device ID.
 * Used as fallback identity when Supabase Auth is unavailable.
 */
export async function getDeviceId(): Promise<string> {
  try {
    const existingId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existingId) return existingId;

    await Device.getDeviceTypeAsync(); // warm up expo-device
    const newId = `device_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, newId);
    console.log('[Auth] Generated device ID:', newId);
    return newId;
  } catch {
    return `fallback_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

export function getDeviceInfo(): { brand: string; model: string } {
  return {
    brand: Device.brand || 'Unknown',
    model: Device.modelName || Device.deviceName || 'Unknown',
  };
}

// ============================================================
// GUEST SESSION — PRIMARY ENTRY POINT
// ============================================================

/**
 * Get or create the current player's session.
 *
 * Priority:
 *   1. Existing Supabase Auth session (restored from AsyncStorage automatically)
 *   2. New anonymous Supabase Auth session
 *   3. Legacy device-ID based player_sessions row
 *   4. Offline session
 */
export async function getGuestSession(): Promise<GuestSession | null> {
  if (!isSupabaseConfigured()) {
    return getOfflineGuestSession();
  }

  try {
    // 1. Check for existing Supabase Auth session (auto-restored by the client)
    let user = await getCurrentUser();

    // 2. No session — try anonymous sign-in (requires dashboard config)
    if (!user) {
      user = await signInAnonymously();
    }

    if (user) {
      // Profile is created server-side by the Edge Function on first action;
      // no client-side upsert needed since the player_sessions table was
      // replaced by room_sessions (managed by supabase/functions/game-action).
      const playerName = await getPlayerName();

      const session: GuestSession = {
        sessionId: user.id,
        deviceId: await getDeviceId(),
        playerName,
        language: 'en',
        createdAt: user.created_at,
        lastSeenAt: new Date().toISOString(),
        isGuest: !!user.is_anonymous,
        email: user.email ?? null,
      };

      await AsyncStorage.setItem(SESSION_ID_KEY, user.id);
      console.log('[Auth] Session ready, uid:', user.id, 'anonymous:', user.is_anonymous);
      return session;
    }

    // 3. Supabase Auth unavailable — fall back to legacy device-ID session
    return getLegacyGuestSession();
  } catch (err) {
    console.error('[Auth] getGuestSession error:', err);
    return getOfflineGuestSession();
  }
}

/**
 * Update the current session locally.
 *
 * Previously this also wrote to the `player_sessions` table — that table
 * was removed in the sync redesign (replaced by `room_sessions`, managed
 * server-side by the Edge Function). We now keep only the AsyncStorage
 * side so player name / language preferences still persist on-device.
 */
export async function updateGuestSession(updates: {
  playerName?: string;
  language?: string;
}): Promise<void> {
  if (updates.playerName) {
    await AsyncStorage.setItem(PLAYER_NAME_KEY, updates.playerName);
  }
  // Note: language is only used client-side (i18n); no server write needed.
  // Server-side profile state lives in `room_sessions` and is created by
  // the Edge Function on first action.
}

/**
 * Clear the current session (log out).
 * After calling this, a fresh anonymous session will be created on next getGuestSession().
 */
export async function clearGuestSession(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_ID_KEY);
  await supabaseSignOut();
  console.log('[Auth] Session cleared');
}

export async function hasGuestSession(): Promise<boolean> {
  const sessionId = await AsyncStorage.getItem(SESSION_ID_KEY);
  return !!sessionId;
}

// ============================================================
// PLAYER NAME MANAGEMENT
// ============================================================

export async function getPlayerName(): Promise<string> {
  try {
    const savedName = await AsyncStorage.getItem(PLAYER_NAME_KEY);
    if (savedName) return savedName;

    const randomNum = Math.floor(Math.random() * 9000) + 1000;
    const defaultName = `Guest #${randomNum}`;
    await AsyncStorage.setItem(PLAYER_NAME_KEY, defaultName);
    return defaultName;
  } catch {
    return 'Guest';
  }
}

export async function setPlayerName(name: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PLAYER_NAME_KEY, name);
    await updateGuestSession({ playerName: name });
  } catch (err) {
    console.error('[Auth] setPlayerName error:', err);
  }
}

// ============================================================
// PRIVATE HELPERS
// ============================================================

/**
 * Deprecated: the `player_sessions` table was replaced by `room_sessions`,
 * which is managed entirely server-side by the Edge Function (see
 * supabase/functions/game-action). Kept as a no-op stub so any lingering
 * callers won't crash; full removal is scheduled for Milestone 9.
 */
async function upsertPlayerProfile(_userId: string, _playerName: string): Promise<void> {
  // Deprecated: room_sessions row is created by the Edge Function.
  return;
}

/**
 * Legacy path: previously looked up / created a `player_sessions` row by
 * device_id. The table was removed in the sync redesign — anonymous Supabase
 * Auth is now the only path. Kept as a no-op returning null so callers fall
 * through to the offline session.
 */
async function getLegacyGuestSession(): Promise<GuestSession | null> {
  return null;
}

async function getOfflineGuestSession(): Promise<GuestSession> {
  const deviceId = await getDeviceId();
  const playerName = await getPlayerName();
  return {
    sessionId: `offline_${deviceId}`,
    deviceId,
    playerName,
    language: 'en',
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    isGuest: true,
    email: null,
  };
}
