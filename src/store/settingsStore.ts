/**
 * Nägels Online - Settings State
 *
 * Persisted user preferences: theme, deck style.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { updateUserMetadata } from '../lib/supabase/authService';

export type ThemePreference = 'system' | 'light' | 'dark';

export type OnboardingTipName = 'bidding' | 'trumpRank' | 'noTrump' | 'scoring';
export type ShownTips = Record<OnboardingTipName, boolean>;

const DEFAULT_SHOWN_TIPS: ShownTips = {
  bidding: false,
  trumpRank: false,
  noTrump: false,
  scoring: false,
};

export interface SettingsStore {
  themePreference: ThemePreference;
  fourColorDeck: boolean;
  language: string;
  gamesPlayedUnconfirmed: number;
  pendingEmail: string | null;
  shownTips: ShownTips;
  _hydrated: boolean;

  setThemePreference: (pref: ThemePreference) => void;
  setFourColorDeck: (enabled: boolean) => void;
  setLanguage: (lang: string) => void;
  incrementGamesPlayed: () => void;
  resetGamesPlayed: () => void;
  setPendingEmail: (email: string | null) => void;
  markTipShown: (name: OnboardingTipName) => void;
  resetShownTips: () => void;
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
  shownTips: { ...DEFAULT_SHOWN_TIPS },
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

  markTipShown: (name) => {
    set({ shownTips: { ...get().shownTips, [name]: true } });
    persistSettings(get());
  },

  resetShownTips: () => {
    set({ shownTips: { ...DEFAULT_SHOWN_TIPS } });
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
          shownTips: { ...DEFAULT_SHOWN_TIPS, ...(parsed.shownTips ?? {}) },
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
    shownTips: state.shownTips,
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
