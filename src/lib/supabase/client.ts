/**
 * Nägels Online - Supabase Client
 *
 * Singleton Supabase client for database and realtime operations
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  DatabaseRoom,
  DatabaseRoomPlayer,
  DatabaseGameState,
  DatabaseGameEvent,
} from './types';

// ============================================================
// ENVIRONMENT CONFIGURATION
// ============================================================

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// Validate environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Missing environment variables. Multiplayer features will be disabled.');
  console.warn('[Supabase] Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.local');
}

// ============================================================
// SUPABASE CLIENT SINGLETON
// ============================================================

let supabaseClient: SupabaseClient | null = null;

/**
 * Get or create the Supabase client singleton
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase environment variables not set');
    }

    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,          // Survive browser refresh / app restart
        autoRefreshToken: true,        // Keep JWT fresh automatically
        storage: AsyncStorage,         // React Native / web compatible
        // On web: detect the token in the URL after email confirmation redirect.
        // On native: not needed (deep links handled separately).
        detectSessionInUrl: Platform.OS === 'web',
      },
      realtime: {
        params: {
          eventsPerSecond: 10, // Game state updates
        },
        // Enable automatic reconnection
        heartbeatIntervalMs: 15000, // Send heartbeat every 15s (detect drops faster)
        reconnectAfterMs: (tries: number) => {
          // Aggressive reconnect: 500ms, 1s, 2s, 4s, max 10s
          return Math.min(500 * Math.pow(2, tries), 10000);
        },
      },
    });

    console.log('[Supabase] Client initialized');
  }

  return supabaseClient;
}

/**
 * Check if Supabase is properly configured
 */
export function isSupabaseConfigured(): boolean {
  return !!(supabaseUrl && supabaseAnonKey);
}

/**
 * Reset the Supabase client (for testing)
 */
export function resetSupabaseClient(): void {
  supabaseClient = null;
}

// ============================================================
// DATABASE HELPERS
// ============================================================

/**
 * Get a typed Supabase client for the 'public' schema
 */
export function getDb() {
  const client = getSupabaseClient();
  return client.from('rooms');
}

// ============================================================
// REALTIME HELPERS
// ============================================================

/**
 * Subscribe to room changes
 */
export function subscribeToRoom(
  roomId: string,
  callbacks: {
    onRoomChange?: (payload: any) => void;
    onGameStateChange?: (payload: any) => void;
    onGameEvent?: (payload: any) => void;
    onPlayerChange?: (payload: any) => void;
  }
) {
  const client = getSupabaseClient();
  const channel = client.channel(`room:${roomId}`);

  // Note: Room status changes disabled for now - using polling instead
  // The Realtime payload structure seems to have issues
  // TODO: Debug and re-enable Realtime room subscriptions

  // // Subscribe to room status changes
  // if (callbacks.onRoomChange) {
  //   channel.on(
  //     'postgres_changes' as any,
  //     {
  //       event: 'UPDATE',
  //       schema: 'public',
  //       table: 'rooms',
  //       filter: `id=eq.${roomId}`,
  //     },
  //     (payload: any) => {
  //       console.log('[Supabase] Room change payload:', payload);
  //       callbacks.onRoomChange?.(payload);
  //     }
  //   );
  // }

  // Subscribe to game state changes
  if (callbacks.onGameStateChange) {
    channel.on(
      'postgres_changes' as any,
      {
        event: '*',
        schema: 'public',
        table: 'game_states',
        filter: `room_id=eq.${roomId}`,
      },
      (payload: any) => {
        console.log('[Supabase] Game state payload:', payload);
        callbacks.onGameStateChange?.(payload);
      }
    );
  }

  // Subscribe to game events
  if (callbacks.onGameEvent) {
    channel.on(
      'postgres_changes' as any,
      {
        event: 'INSERT',
        schema: 'public',
        table: 'game_events',
        filter: `room_id=eq.${roomId}`,
      },
      (payload: any) => {
        console.log('[Supabase] Game event payload:', payload);
        callbacks.onGameEvent?.(payload);
      }
    );
  }

  // Subscribe to player changes
  if (callbacks.onPlayerChange) {
    channel.on(
      'postgres_changes' as any,
      {
        event: '*',
        schema: 'public',
        table: 'room_players',
        filter: `room_id=eq.${roomId}`,
      },
      (payload: any) => {
        console.log('[Supabase] Player change payload:', payload);
        callbacks.onPlayerChange?.(payload);
      }
    );
  }

  channel.subscribe((status) => {
    console.log('[Supabase] Room channel status:', status);

    // Import store dynamically to avoid circular dependency
    const { useMultiplayerStore } = require('../../store/multiplayerStore');
    const store = useMultiplayerStore.getState();

    switch (status) {
      case 'SUBSCRIBED':
        console.log('[Supabase] Channel subscribed successfully');
        store.setIsConnected(true);
        store.setSyncStatus('connected');
        store.setIsReconnecting(false);
        store.setError(null);
        break;

      case 'CHANNEL_ERROR':
        console.error('[Supabase] Channel error');
        store.setIsConnected(false);
        store.setSyncStatus('disconnected');
        store.setError('Channel connection error');
        break;

      case 'TIMED_OUT':
        console.error('[Supabase] Channel timed out');
        store.setIsConnected(false);
        store.setSyncStatus('disconnected');
        store.setError('Connection timed out');
        break;

      case 'CLOSED':
        console.log('[Supabase] Channel closed');
        store.setIsConnected(false);
        store.setSyncStatus('disconnected');
        break;
    }
  });

  return channel;
}
