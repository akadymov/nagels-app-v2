/**
 * Nägels Online - Theme Hook
 *
 * Resolves the active theme from user preference + system color scheme.
 * Components use this instead of importing Colors directly.
 */

import { useColorScheme } from 'react-native';
import { useSettingsStore } from '../store/settingsStore';
import { lightColors, darkColors, type ThemeColors } from '../constants/colors';

export interface ThemeResult {
  theme: 'light' | 'dark';
  colors: ThemeColors;
  isDark: boolean;
}

export function useTheme(): ThemeResult {
  const systemScheme = useColorScheme();
  const preference = useSettingsStore((s) => s.themePreference);
  const fourColorDeck = useSettingsStore((s) => s.fourColorDeck);

  const resolved =
    preference === 'system'
      ? (systemScheme ?? 'light')
      : preference;

  const base = resolved === 'dark' ? darkColors : lightColors;

  // The classic 2-color deck collapses the four-suit palette down to
  // red/black: diamonds adopt the hearts color, clubs adopt the spades
  // color. When fourColorDeck is on we keep the per-suit palette from
  // the theme. Without this override the toggle in Settings only
  // affects its own preview, not the cards on the table.
  const colors: ThemeColors = fourColorDeck
    ? base
    : { ...base, diamonds: base.hearts, clubs: base.spades };

  return { theme: resolved, colors, isDark: resolved === 'dark' };
}
