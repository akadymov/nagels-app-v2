/**
 * Nägels Online - Color System
 * Supports light and dark themes.
 */

/** Shared colors — identical in both themes */
const shared = {
  // Brand
  accent: '#13428f',
  accentSecondary: '#5dc2fc',
  accentMuted: '#7ba7d4',
  highlight: '#13428f',

  // Card suits (4-color deck)
  diamonds: '#0094FF',
  hearts: '#BE1931',
  clubs: '#308552',
  spades: '#1a1a1a',

  // Status
  success: '#308552',
  warning: '#e67e22',
  error: '#b10000',
  info: '#13428f',

  // Trump
  trumpActive: '#13428f',
  trumpInactive: '#888888',

  // Player states
  activePlayerBorder: '#E6BF33',
  selectedCardBorder: '#E6BF33',
} as const;

export const lightColors = {
  ...shared,

  // Backgrounds
  background: '#e8e8e8',
  backgroundDark: '#d8d8d8',
  surface: '#ffffff',
  surfaceSecondary: '#f5f5f5',

  // Game table
  table: '#33734D',
  tableInner: '#296140',
  tableBorder: '#4D8C63',
  cardTable: '#e8e8e8',

  // Cards
  card: '#ffffff',
  cardBorder: '#C7C7CC',

  // Glass effects
  glassLight: 'rgba(0, 0, 0, 0.12)',
  glassDark: 'rgba(255, 255, 255, 0.95)',
  glassMedium: 'rgba(0, 0, 0, 0.06)',
  glassHighlight: 'rgba(19, 66, 143, 0.1)',

  // Text
  textPrimary: '#1a1a1a',
  textSecondary: '#444444',
  textMuted: '#888888',
  textDisabled: '#bbbbbb',

  // Player profiles
  profileBg: 'rgba(8, 10, 14, 0.7)',
  profileText: '#ffffff',
  profileStats: '#C0C0C7',

  // Gradients
  warmTop: ['#f5f5f5', '#e8e8e8'] as readonly [string, string],
  warmBottom: ['#e8e8e8', '#d8d8d8'] as readonly [string, string],
  deepRich: ['#f2f2f2', '#e2e2e2'] as readonly [string, string],

  // Status bar
  statusBarStyle: 'dark-content' as const,
  statusBarBg: '#e8e8e8',

  // Icon buttons
  iconButtonBg: '#F0F0F0',
  iconButtonText: '#1a1a1a',

  // Bid chips
  bidChipDisabled: '#D6D6D6',
  bidChipDisabledText: '#888888',
} as const;

export const darkColors = {
  ...shared,

  // Spades adopt a light gray on dark backgrounds — the shared near-black
  // (#1a1a1a) is invisible on the dark surface, top bars, and the green felt.
  // This also fixes the classic 2-color deck where clubs inherit the spades
  // color via useTheme.
  spades: '#D4D4D8',

  // Backgrounds
  background: '#141720',
  backgroundDark: '#0E1016',
  surface: '#1F2130',
  surfaceSecondary: '#292D38',

  // Game table
  table: '#595F70',
  tableInner: '#4D5463',
  tableBorder: '#6B7185',
  cardTable: '#141720',

  // Cards — white in dark theme too
  card: '#ffffff',
  cardBorder: '#C7C7CC',

  // Glass effects (adapted for dark)
  glassLight: 'rgba(255, 255, 255, 0.08)',
  glassDark: 'rgba(30, 33, 48, 0.95)',
  glassMedium: 'rgba(255, 255, 255, 0.04)',
  glassHighlight: 'rgba(93, 194, 252, 0.1)',

  // Text
  textPrimary: '#EDEDED',
  textSecondary: '#B3B3BA',
  textMuted: '#737380',
  textDisabled: '#4A4A55',

  // Player profiles
  profileBg: 'rgba(8, 10, 14, 0.7)',
  profileText: '#ffffff',
  profileStats: '#C0C0C7',

  // Gradients
  warmTop: ['#1F2130', '#141720'] as readonly [string, string],
  warmBottom: ['#141720', '#0E1016'] as readonly [string, string],
  deepRich: ['#1F2130', '#141720'] as readonly [string, string],

  // Status bar
  statusBarStyle: 'light-content' as const,
  statusBarBg: '#141720',

  // Icon buttons
  iconButtonBg: '#383D4D',
  iconButtonText: '#DEDEE2',

  // Bid chips
  bidChipDisabled: '#4D525C',
  bidChipDisabledText: '#737380',
} as const;

/** Theme color type — uses string for color values to allow both light and dark variants */
export type ThemeColors = {
  [K in keyof typeof lightColors]: (typeof lightColors)[K] extends readonly [string, string]
    ? readonly [string, string]
    : string;
};

/** Legacy Colors — maps to light theme for backward compatibility */
export const Colors = lightColors;

export type ColorKey = keyof typeof Colors;

/** Get colors for a specific theme */
export function getColors(theme: 'light' | 'dark'): ThemeColors {
  return theme === 'dark' ? darkColors : lightColors;
}

/** Get trump color by suit */
export const getTrumpColor = (
  suit: 'diamonds' | 'hearts' | 'clubs' | 'spades' | 'notrump',
): string => {
  if (suit === 'notrump') return shared.trumpActive;
  return shared[suit];
};

/** Suit symbols */
export const SuitSymbols = {
  diamonds: '♦',
  hearts: '♥',
  clubs: '♣',
  spades: '♠',
  notrump: 'NT',
} as const;
