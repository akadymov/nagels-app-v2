/**
 * Nägels Online - Settings State
 *
 * Persisted user preferences: theme, deck style.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface SettingsStore {
  themePreference: ThemePreference;
  fourColorDeck: boolean;
  gamesPlayedUnconfirmed: number;
  pendingEmail: string | null; // email registered but not yet confirmed
  _hydrated: boolean;

  setThemePreference: (pref: ThemePreference) => void;
  setFourColorDeck: (enabled: boolean) => void;
  incrementGamesPlayed: () => void;
  resetGamesPlayed: () => void;
  setPendingEmail: (email: string | null) => void;
  hydrate: () => Promise<void>;
}

const STORAGE_KEY = 'nagels_settings';

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  themePreference: 'system',
  fourColorDeck: true,
  gamesPlayedUnconfirmed: 0,
  pendingEmail: null,
  _hydrated: false,

  setThemePreference: (pref) => {
    set({ themePreference: pref });
    persistSettings(get());
  },

  setFourColorDeck: (enabled) => {
    set({ fourColorDeck: enabled });
    persistSettings(get());
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

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        set({
          themePreference: parsed.themePreference ?? 'system',
          fourColorDeck: parsed.fourColorDeck ?? true,
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
    gamesPlayedUnconfirmed: state.gamesPlayedUnconfirmed,
    pendingEmail: state.pendingEmail,
  };
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(() => {});
}
