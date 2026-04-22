/**
 * Nägels Online - Settings State
 *
 * Persisted user preferences: theme, deck style.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { updateUserMetadata } from '../lib/supabase/authService';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface SettingsStore {
  themePreference: ThemePreference;
  fourColorDeck: boolean;
  language: string;
  gamesPlayedUnconfirmed: number;
  pendingEmail: string | null;
  _hydrated: boolean;

  setThemePreference: (pref: ThemePreference) => void;
  setFourColorDeck: (enabled: boolean) => void;
  setLanguage: (lang: string) => void;
  incrementGamesPlayed: () => void;
  resetGamesPlayed: () => void;
  setPendingEmail: (email: string | null) => void;
  syncFromUserMetadata: (metadata: Record<string, any>) => void;
  hydrate: () => Promise<void>;
}

const STORAGE_KEY = 'nagels_settings';

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  themePreference: 'system',
  fourColorDeck: true,
  language: 'en',
  gamesPlayedUnconfirmed: 0,
  pendingEmail: null,
  _hydrated: false,

  setThemePreference: (pref) => {
    set({ themePreference: pref });
    persistSettings(get());
    syncToProfile(get());
  },

  setFourColorDeck: (enabled) => {
    set({ fourColorDeck: enabled });
    persistSettings(get());
    syncToProfile(get());
  },

  setLanguage: (lang) => {
    set({ language: lang });
    persistSettings(get());
    syncToProfile(get());
  },

  incrementGamesPlayed: () => {
    set({ gamesPlayedUnconfirmed: get().gamesPlayedUnconfirmed + 1 });
    persistSettings(get());
  },

  resetGamesPlayed: () => {
    set({ gamesPlayedUnconfirmed: 0, pendingEmail: null });
    persistSettings(get());
  },

  setPendingEmail: (email) => {
    set({ pendingEmail: email });
    persistSettings(get());
  },

  syncFromUserMetadata: (metadata) => {
    const updates: Partial<SettingsStore> = {};
    if (metadata.theme_preference) updates.themePreference = metadata.theme_preference;
    if (metadata.four_color_deck !== undefined) updates.fourColorDeck = metadata.four_color_deck;
    if (metadata.language) updates.language = metadata.language;
    if (Object.keys(updates).length > 0) {
      set(updates);
      persistSettings(get());
    }
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        set({
          themePreference: parsed.themePreference ?? 'system',
          fourColorDeck: parsed.fourColorDeck ?? true,
          language: parsed.language ?? 'en',
          gamesPlayedUnconfirmed: parsed.gamesPlayedUnconfirmed ?? 0,
          pendingEmail: parsed.pendingEmail ?? null,
          _hydrated: true,
        });
      } else {
        set({ _hydrated: true });
      }
    } catch {
      set({ _hydrated: true });
    }
  },
}));

function persistSettings(state: SettingsStore) {
  const data = {
    themePreference: state.themePreference,
    fourColorDeck: state.fourColorDeck,
    language: state.language,
    gamesPlayedUnconfirmed: state.gamesPlayedUnconfirmed,
    pendingEmail: state.pendingEmail,
  };
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(() => {});
}

function syncToProfile(state: SettingsStore) {
  // Fire-and-forget sync to Supabase user_metadata
  updateUserMetadata({
    theme_preference: state.themePreference,
    four_color_deck: state.fourColorDeck,
    language: state.language,
  }).catch(() => {
    // Silent — user might not be logged in
  });
}
