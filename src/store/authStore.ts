/**
 * Nägels Online - Auth State
 *
 * Zustand store that mirrors the Supabase Auth session.
 * Initialised by AppNavigator on app start via onAuthStateChange().
 */

import { create } from 'zustand';
import type { User } from '@supabase/supabase-js';

export interface AuthStore {
  // Current Supabase user (null = not yet initialised or signed out)
  user: User | null;

  // true  = anonymous / no account
  // false = registered with email
  isGuest: boolean;

  // Display name (from player_name in storage or user_metadata.display_name)
  displayName: string;

  // true while the initial session check is in flight
  isLoading: boolean;

  // true after the first auth state event has been processed —
  // used to gate the rejoin check so it only runs once
  isInitialized: boolean;

  // Actions
  setUser: (user: User | null, isGuest?: boolean) => void;
  setDisplayName: (name: string) => void;
  setIsLoading: (loading: boolean) => void;
  setIsInitialized: (initialized: boolean) => void;

  // Helpers
  isAuthenticated: () => boolean;  // true for both guest and registered
  userId: () => string | null;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  isGuest: true,
  displayName: 'Guest',
  isLoading: true,
  isInitialized: false,

  setUser: (user, isGuest = true) =>
    set({
      user,
      isGuest: user ? isGuest : true,
      displayName:
        (user?.user_metadata?.display_name as string | undefined) ||
        get().displayName,
    }),

  setDisplayName: (name) => set({ displayName: name }),

  setIsLoading: (loading) => set({ isLoading: loading }),

  setIsInitialized: (initialized) => set({ isInitialized: initialized }),

  isAuthenticated: () => !!get().user,

  userId: () => get().user?.id ?? null,
}));
