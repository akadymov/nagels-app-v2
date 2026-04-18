/**
 * Nägels Online - Color System
 * Light theme, inspired by the legacy app design
 * Primary: deep blue #13428f, background: light gray #e7e7e7
 */

export const Colors = {
  // Primary brand blue (legacy primary color)
  accent: '#13428f' as const,           // Deep blue (primary action)
  accentSecondary: '#5dc2fc' as const,  // Light cyan (secondary / hover)
  accentMuted: '#7ba7d4' as const,      // Muted blue (tertiary)

  // Highlight for key interactive elements
  highlight: '#13428f' as const,        // Deep blue

  // Card suits - 4-color deck (matching legacy)
  diamonds: '#0094FF' as const,         // Blue diamonds
  hearts: '#BE1931' as const,           // Crimson hearts
  clubs: '#308552' as const,            // Green clubs
  spades: '#1a1a1a' as const,           // Near-black spades

  // Surface / border colors - light theme
  glassLight: 'rgba(0, 0, 0, 0.12)' as const,       // Subtle border
  glassDark: 'rgba(255, 255, 255, 0.95)' as const,   // White surface
  glassMedium: 'rgba(0, 0, 0, 0.06)' as const,       // Very light tint
  glassHighlight: 'rgba(19, 66, 143, 0.1)' as const, // Blue tint highlight

  // Text colors - dark on light background
  textPrimary: '#1a1a1a' as const,      // Near black
  textSecondary: '#444444' as const,    // Dark gray
  textMuted: '#888888' as const,        // Medium gray
  textDisabled: '#bbbbbb' as const,     // Light gray

  // Background colors - light theme
  background: '#e8e8e8' as const,       // Light gray (legacy main background)
  backgroundDark: '#d8d8d8' as const,   // Slightly darker gray
  cardTable: '#e8e8e8' as const,        // Same light gray

  // Gradient presets - light theme
  warmTop: ['#f5f5f5', '#e8e8e8'] as const,
  warmBottom: ['#e8e8e8', '#d8d8d8'] as const,
  deepRich: ['#f2f2f2', '#e2e2e2'] as const,

  // Status colors
  success: '#308552' as const,          // Green
  warning: '#e67e22' as const,          // Orange
  error: '#b10000' as const,            // Red
  info: '#13428f' as const,             // Blue

  // Trump indicator
  trumpActive: '#13428f' as const,      // Blue when active
  trumpInactive: '#888888' as const,    // Gray when inactive
};

export type ColorKey = keyof typeof Colors;

/**
 * Get trump color by suit
 */
export const getTrumpColor = (suit: 'diamonds' | 'hearts' | 'clubs' | 'spades' | 'notrump'): string => {
  if (suit === 'notrump') return Colors.trumpActive;
  return Colors[suit];
};

/**
 * Suit symbols
 */
export const SuitSymbols = {
  diamonds: '♦',
  hearts: '♥',
  clubs: '♣',
  spades: '♠',
  notrump: 'NT',
} as const;
