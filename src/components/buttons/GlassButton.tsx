/**
 * Nägels Online - Button Component
 * Solid blue buttons — light theme matching legacy app
 */

import React, { useState } from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  ActivityIndicator,
  Platform,
  StyleProp,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors, Radius, Spacing, TextStyles } from '../../constants';
import { useTheme } from '../../hooks/useTheme';

// Button heights
const BUTTON_HEIGHTS = {
  small: 40,
  medium: 52,
  large: 56,
} as const;

export type GlassButtonSize = 'small' | 'medium' | 'large';
export type GlassButtonVariant = 'primary' | 'secondary' | 'outline';

export interface GlassButtonProps {
  title: string;
  onPress: () => void;
  size?: GlassButtonSize;
  variant?: GlassButtonVariant;
  accentColor?: string;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * GlassButton - Solid button with haptic feedback
 *
 * Variants:
 * - primary:   solid deep-blue background, white text
 * - secondary: white background, blue border & text
 * - outline:   transparent background, blue border & text
 */
export const GlassButton: React.FC<GlassButtonProps> = ({
  title,
  onPress,
  size = 'medium',
  variant = 'primary',
  accentColor = Colors.accent,
  disabled = false,
  loading = false,
  icon,
  style,
  textStyle,
  testID,
}) => {
  const { colors } = useTheme();
  const [pressed, setPressed] = useState(false);

  const handlePress = async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {
        // Haptics not available, ignore
      }
    }
    onPress();
  };

  const height = BUTTON_HEIGHTS[size];

  const getVariantStyles = (): { container: object; textColor: string } => {
    switch (variant) {
      case 'primary':
        return {
          container: {
            backgroundColor: accentColor,
            borderColor: accentColor,
            borderWidth: 2,
          },
          textColor: '#ffffff',
        };
      case 'secondary':
        return {
          container: {
            backgroundColor: colors.surface,
            borderColor: accentColor,
            borderWidth: 2,
          },
          textColor: accentColor,
        };
      case 'outline':
        return {
          container: {
            backgroundColor: 'transparent',
            borderColor: accentColor,
            borderWidth: 2,
          },
          textColor: accentColor,
        };
    }
  };

  const { container: variantContainer, textColor } = getVariantStyles();

  return (
    <Pressable
      testID={testID}
      onPress={handlePress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled || loading}
      style={({ pressed: pressedState }) => [
        styles.button,
        { height, minHeight: height },
        variantContainer,
        disabled && styles.disabled,
        (pressed || pressedState) && styles.pressed,
        style,
      ]}
      hitSlop={10}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <>
          {icon && <>{icon}</>}
          <Text
            style={[styles.text, { color: textColor }, textStyle]}
            numberOfLines={1}
          >
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    gap: Spacing.sm,
    minWidth: 120,
  },
  text: {
    ...TextStyles.button,
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});

export default GlassButton;
