/**
 * Nägels Online - Game State Sync
 *
 * Handles synchronization of game state between clients and server
 */

import { getSupabaseClient, isSupabaseConfigured } from '../supabase/client';
import type { DatabaseGameState, GameEventType } from '../supabase/types';

// ============================================================
// STATE SERIALIZATION
// ============================================================

/**
 * Serialize game state for storage/transmission
 */
export function serializeGameState(state: unknown): string {
  try {
    return JSON.stringify(state);
  } catch (error) {
    console.error('[GameStateSync] Error serializing state:', error);
    return '{}';
  }
}

/**
 * Deserialize game state from storage/transmission
 */
export function deserializeGameState<T = unknown>(data: string | unknown): T | null {
  try {
    if (typeof data === 'string') {
      return JSON.parse(data) as T;
    }
    return data as T;
  } catch (error) {
    console.error('[GameStateSync] Error deserializing state:', error);
    return null;
  }
}

// ============================================================
// SERVER STATE FETCHING
// ============================================================

/**
 * Fetch current game state from server
 */
export async function fetchGameState(roomId: string): Promise<DatabaseGameState | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('game_states')
    .select('*')
    .eq('room_id', roomId)
    .single();

  if (error) {
    console.error('[GameStateSync] Error fetching game state:', error);
    return null;
  }

  return data;
}

/**
 * Fetch missed events since last sync
 */
export async function fetchMissedEvents(
  roomId: string,
  sinceVersion: number
): Promise<DatabaseGameState[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('game_events')
    .select('*')
    .eq('room_id', roomId)
    .gt('version', sinceVersion)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[GameStateSync] Error fetching missed events:', error);
    return [];
  }

  return data || [];
}

// ============================================================
// STATE VERSIONING
// ============================================================

/**
 * Check if server state is newer than local state
 */
export function isServerStateNewer(localVersion: number, serverVersion: number): boolean {
  return serverVersion > localVersion;
}

/**
 * Calculate version difference
 */
export function getVersionDifference(localVersion: number, serverVersion: number): number {
  return serverVersion - localVersion;
}

// ============================================================
// CONFLICT RESOLUTION
// ============================================================

/**
 * Merge server state with local state (server wins)
 */
export function mergeWithServerState<T extends { version: number }>(
  localState: T,
  serverState: T
): T {
  // Server is always authoritative
  return serverState;
}

/**
 * Check if action can be applied (version matches)
 */
export function canApplyAction(expectedVersion: number, currentVersion: number): boolean {
  return expectedVersion === currentVersion;
}

// ============================================================
// GAME ACTIONS (RPC)
// ============================================================

/**
 * Place a bet (via Supabase RPC)
 */
export async function placeBet(
  roomId: string,
  playerId: string,
  bet: number,
  version: number
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }

  const supabase = getSupabaseClient();

  // Call RPC function
  const { data, error } = await supabase.rpc('place_bet', {
    room_id: roomId,
    player_id: playerId,
    bet,
    version,
  });

  if (error) {
    console.error('[GameStateSync] Error placing bet:', error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Play a card (via Supabase RPC)
 */
export async function playCard(
  roomId: string,
  playerId: string,
  cardId: string,
  version: number
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }

  const supabase = getSupabaseClient();

  // Call RPC function
  const { data, error } = await supabase.rpc('play_card', {
    room_id: roomId,
    player_id: playerId,
    card_id: cardId,
    version,
  });

  if (error) {
    console.error('[GameStateSync] Error playing card:', error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Start next hand (via Supabase RPC)
 */
export async function nextHand(
  roomId: string,
  version: number
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }

  const supabase = getSupabaseClient();

  // Call RPC function
  const { data, error } = await supabase.rpc('next_hand', {
    room_id: roomId,
    version,
  });

  if (error) {
    console.error('[GameStateSync] Error starting next hand:', error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ============================================================
// STATE RECONCILIATION
// ============================================================

/**
 * Reconcile state after reconnection.
 * Always succeeds if Supabase is reachable — game_states may be empty
 * because gameplay only writes to game_events, not game_states.
 */
export async function reconcileState(roomId: string, localVersion: number): Promise<{
  success: boolean;
  newState?: DatabaseGameState;
  missedEvents?: unknown[];
}> {
  if (!isSupabaseConfigured()) {
    return { success: false };
  }

  try {
    // Fetch missed events (primary source of truth during gameplay)
    const missedEvents = await fetchMissedEvents(roomId, localVersion);

    // Try to fetch current server state (may not exist — that's OK)
    const serverState = await fetchGameState(roomId);

    return {
      success: true,
      newState: serverState ?? undefined,
      missedEvents,
    };
  } catch (error) {
    console.error('[GameStateSync] Reconcile failed:', error);
    return { success: false };
  }
}

// ============================================================
// OPTIMISTIC UPDATES
// ============================================================

/**
 * Apply optimistic update (local only, pending server confirmation)
 */
export function applyOptimisticUpdate<T>(currentState: T, update: Partial<T>): T {
  return {
    ...currentState,
    ...update,
  };
}

/**
 * Rollback optimistic update
 */
export function rollbackOptimisticUpdate<T>(
  currentState: T,
  previousState: T
): T {
  return previousState;
}

// ============================================================
// EVENT BROADCASTING
// ============================================================

/**
 * Broadcast game event to all clients
 */
export async function broadcastEvent(
  roomId: string,
  eventType: GameEventType,
  eventData: Record<string, unknown>,
  playerId: string,
  version: number
): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.warn('[GameStateSync] Cannot broadcast event: Supabase not configured');
    return;
  }

  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('game_events')
    .insert({
      room_id: roomId,
      event_type: eventType,
      event_data: eventData,
      player_id: playerId,
      version,
    });

  if (error) {
    console.error('[GameStateSync] Error broadcasting event:', error);
  }
}
