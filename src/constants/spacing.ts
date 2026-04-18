/**
 * Nägels Online - Spacing System
 * 8px base unit for consistent spacing
 */

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

/**
 * Border radius values
 */
export const Radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  full: 9999,
} as const;

/**
 * Safe area insets (minimum values)
 */
export const SafeArea = {
  top: 44,
  bottom: 34,
  sides: 16,
} as const;

/**
 * Touch target sizes
 */
export const TouchTarget = {
  minimum: 44,
  comfortable: 48,
} as const;

/**
 * Component-specific dimensions
 */
export const Dimensions = {
  // Button heights
  buttonSmall: 44,
  buttonMedium: 56,
  buttonLarge: 64,

  // Avatar sizes
  avatarSmall: 32,
  avatarMedium: 48,
  avatarLarge: 64,

  // Card sizes
  cardWidth: 60,
  cardHeight: 84,
  cardSmallWidth: 40,
  cardSmallHeight: 56,

  // Screen width percentages
  screenWide: 0.9,
  screenMedium: 0.8,
  screenNarrow: 0.7,
} as const;
