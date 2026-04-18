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
  _hydrated: boolean;

  setThemePreference: (pref: ThemePreference) => void;
  setFourColorDeck: (enabled: boolean) => void;
  hydrate: () => Promise<void>;
}

const STORAGE_KEY = 'nagels_settings';

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  themePreference: 'system',
  fourColorDeck: true,
  _hydrated: false,

  setThemePreference: (pref) => {
    set({ themePreference: pref });
    persistSettings(get());
  },

  setFourColorDeck: (enabled) => {
    set({ fourColorDeck: enabled });
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
  };
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(() => {});
}
