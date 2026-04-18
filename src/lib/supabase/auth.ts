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
import { getSupabaseClient, isSupabaseConfigured } from './client';
import {
  getCurrentUser,
  signInAnonymously,
  signOut as supabaseSignOut,
} from './authService';
import type { GuestSession, DatabasePlayerSession } from './types';

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
      // Upsert profile row so player_name is stored server-side
      const playerName = await getPlayerName();
      await upsertPlayerProfile(user.id, playerName);

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
 * Update the current session (player name, language).
 */
export async function updateGuestSession(updates: {
  playerName?: string;
  language?: string;
}): Promise<void> {
  if (updates.playerName) {
    await AsyncStorage.setItem(PLAYER_NAME_KEY, updates.playerName);
  }

  if (!isSupabaseConfigured()) return;

  try {
    const sessionId = await AsyncStorage.getItem(SESSION_ID_KEY);
    if (!sessionId) return;

    const updateData: Record<string, string> = {};
    if (updates.playerName) updateData.player_name = updates.playerName;
    if (updates.language) updateData.language = updates.language;

    const supabase = getSupabaseClient();
    await supabase
      .from('player_sessions')
      .update(updateData)
      .eq('id', sessionId);
  } catch (err) {
    console.error('[Auth] updateGuestSession error:', err);
  }
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
 * Upsert a player_sessions row keyed by the Supabase Auth user.id.
 * This keeps the server-side profile in sync without changing room data.
 */
async function upsertPlayerProfile(userId: string, playerName: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const deviceId = await getDeviceId();

    // Try update first (row may already exist from a previous session)
    const { error: updateError } = await supabase
      .from('player_sessions')
      .update({
        player_name: playerName,
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (updateError) {
      // Row doesn't exist yet — insert it with explicit id = userId
      const { error: insertError } = await supabase
        .from('player_sessions')
        .insert({
          id: userId,
          device_id: deviceId,
          player_name: playerName,
          language: 'en',
        });

      if (insertError) {
        // player_sessions.id may not accept explicit values in this project —
        // that's fine, the auth session itself is the source of truth.
        console.warn('[Auth] Could not upsert player_sessions:', insertError.message);
      }
    }
  } catch (err) {
    // Non-fatal — session works fine without a player_sessions row
    console.warn('[Auth] upsertPlayerProfile error:', err);
  }
}

/**
 * Legacy path: look up / create a player_sessions row by device_id.
 * Used when Supabase Auth anonymous sign-in is not enabled in the dashboard.
 */
async function getLegacyGuestSession(): Promise<GuestSession | null> {
  try {
    const deviceId = await getDeviceId();
    const playerName = await getPlayerName();
    const supabase = getSupabaseClient();

    const { data: existing } = await supabase
      .from('player_sessions')
      .select('*')
      .eq('device_id', deviceId)
      .single();

    if (existing) {
      const { data: updated } = await supabase
        .from('player_sessions')
        .update({ last_seen_at: new Date().toISOString(), player_name: playerName })
        .eq('id', existing.id)
        .select()
        .single();

      const row = updated ?? existing;
      await AsyncStorage.setItem(SESSION_ID_KEY, row.id);
      return dbSessionToGuestSession(row);
    }

    const { data: created, error } = await supabase
      .from('player_sessions')
      .insert({ device_id: deviceId, player_name: playerName, language: 'en' })
      .select()
      .single();

    if (error) return getOfflineGuestSession();

    await AsyncStorage.setItem(SESSION_ID_KEY, created.id);
    return dbSessionToGuestSession(created);
  } catch {
    return getOfflineGuestSession();
  }
}

function dbSessionToGuestSession(db: DatabasePlayerSession): GuestSession {
  return {
    sessionId: db.id,
    deviceId: db.device_id,
    playerName: db.player_name || 'Guest',
    language: db.language as 'en' | 'ru' | 'es',
    createdAt: db.created_at,
    lastSeenAt: db.last_seen_at,
    isGuest: true,
    email: null,
  };
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
