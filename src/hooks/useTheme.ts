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

  const resolved =
    preference === 'system'
      ? (systemScheme ?? 'light')
      : preference;

  const colors = resolved === 'dark' ? darkColors : lightColors;

  return { theme: resolved, colors, isDark: resolved === 'dark' };
}
