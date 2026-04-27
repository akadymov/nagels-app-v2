/**
 * Nägels Online - Supabase Client
 *
 * Singleton Supabase client for database and realtime operations
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

// Realtime subscriptions live in src/lib/realtimeBroadcast.ts now.
