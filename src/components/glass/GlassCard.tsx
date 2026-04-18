/**
 * Nägels Online - Card Component
 * Clean white card with subtle shadow — light theme
 */

import React from 'react';
import {
  View,
  StyleSheet,
  ViewStyle,
  StyleProp,
  Platform,
} from 'react-native';
import { Colors, Radius } from '../../constants';
import { useTheme } from '../../hooks/useTheme';

export interface GlassCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  blurAmount?: number;   // kept for API compatibility, unused in light theme
  opacity?: number;      // kept for API compatibility
  borderColor?: string;
  borderWidth?: number;
  shadow?: boolean;
  dark?: boolean;        // true = slightly tinted surface
  testID?: string;
}

/**
 * GlassCard - Clean white card with subtle shadow
 *
 * In the light theme this renders as a simple white/off-white panel with
 * a thin border and soft drop shadow — matching the legacy app's card aesthetic.
 */
export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  style,
  blurAmount: _blurAmount,
  opacity: _opacity,
  borderColor,
  borderWidth = 1,
  shadow = true,
  dark = false,
  testID,
}) => {
  const { colors, isDark } = useTheme();
  const resolvedBorderColor = borderColor ?? colors.glassLight;
  const backgroundColor = dark
    ? (isDark ? 'rgba(93, 194, 252, 0.08)' : 'rgba(19, 66, 143, 0.08)')
    : colors.surface;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor,
          borderColor: resolvedBorderColor,
          borderWidth,
        },
        shadow && (Platform.OS === 'web' ? styles.shadowWeb : styles.shadow),
        style,
      ]}
      testID={testID}
    >
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  shadowWeb: {
    // web shadow via boxShadow is not supported in RN StyleSheet directly
    // elevation-style fallback
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
});

export default GlassCard;
