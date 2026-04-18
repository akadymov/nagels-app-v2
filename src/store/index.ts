/**
 * Nägels Online - State Management
 * Central export for all Zustand stores
 */

export { useGameStore } from './gameStore';
export type { GameStore, GamePlayer, Trick } from './gameStore';

export { useAuthStore } from './authStore';
export type { AuthStore } from './authStore';

export { useSettingsStore } from './settingsStore';
export type { SettingsStore, ThemePreference } from './settingsStore';
