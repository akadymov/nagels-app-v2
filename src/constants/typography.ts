/**
 * Nägels Online - Typography System
 * Mobile-first, legible at small sizes
 */

import { TextStyle } from 'react-native';

export const Typography = {
  // Font sizes
  h1: 32 as const,
  h2: 24 as const,
  h3: 20 as const,
  body: 16 as const,
  caption: 14 as const,
  small: 12 as const,

  // Font weights
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,

  // Line heights
  tight: 1.2 as const,
  normal: 1.5 as const,
  relaxed: 1.8 as const,
};

/**
 * Text style presets
 */
export const TextStyles = {
  h1: {
    fontSize: Typography.h1,
    fontWeight: Typography.bold,
    lineHeight: Typography.h1 * Typography.tight,
    letterSpacing: -0.5,
  } as TextStyle,

  h2: {
    fontSize: Typography.h2,
    fontWeight: Typography.semibold,
    lineHeight: Typography.h2 * Typography.tight,
    letterSpacing: -0.3,
  } as TextStyle,

  h3: {
    fontSize: Typography.h3,
    fontWeight: Typography.medium,
    lineHeight: Typography.h3 * Typography.tight,
  } as TextStyle,

  body: {
    fontSize: Typography.body,
    fontWeight: Typography.regular,
    lineHeight: Typography.body * Typography.normal,
  } as TextStyle,

  bodyMedium: {
    fontSize: Typography.body,
    fontWeight: Typography.medium,
    lineHeight: Typography.body * Typography.normal,
  } as TextStyle,

  caption: {
    fontSize: Typography.caption,
    fontWeight: Typography.regular,
    lineHeight: Typography.caption * Typography.normal,
  } as TextStyle,

  small: {
    fontSize: Typography.small,
    fontWeight: Typography.regular,
    lineHeight: Typography.small * Typography.normal,
  } as TextStyle,

  button: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    lineHeight: Typography.body * Typography.normal,
    letterSpacing: 0.5,
  } as TextStyle,
};

/**
 * Platform-specific font family
 * Uses system fonts for native performance
 */
export const FontFamily = {
  ios: {
    regular: 'System',
    medium: 'System',
    semibold: 'System',
    bold: 'System',
  },
  android: {
    regular: 'Roboto',
    medium: 'Roboto-Medium',
    semibold: 'Roboto-Bold',
    bold: 'Roboto-Bold',
  },
  web: {
    regular: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    medium: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    semibold: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    bold: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
} as const;
