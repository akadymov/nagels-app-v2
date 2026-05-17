/**
 * Nägels Online - Game Logo
 * Shark icon + NÄGELS wordmark + suit symbols
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors, SuitSymbols } from '../constants';
import { useTheme } from '../hooks/useTheme';

interface GameLogoProps {
  size?: 'sm' | 'md' | 'xs';
  // When provided, the logo becomes a Pressable that calls onPress.
  // Screens that don't want logo navigation (Auth, ResetPassword,
  // Lobby — already there) simply omit this prop.
  onPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
}

export const GameLogo: React.FC<GameLogoProps> = ({
  size = 'md',
  onPress,
  testID,
  accessibilityLabel,
}) => {
  const { colors } = useTheme();
  const isSm = size === 'sm';
  const isXs = size === 'xs';

  const inner = (
    <View style={[styles.container, isXs && styles.containerXs]}>
      {!isXs && <Text style={[styles.shark, isSm && styles.sharkSm]}>🦈</Text>}
      <Text style={[styles.wordmark, isSm && styles.wordmarkSm, isXs && styles.wordmarkXs, { color: colors.accent }]}>
        NÄGELS
      </Text>
      <View style={styles.suits}>
        <Text style={[styles.suit, isSm && styles.suitSm, isXs && styles.suitXs, { color: colors.spades }]}>
          {SuitSymbols.spades}
        </Text>
        <Text style={[styles.suit, isSm && styles.suitSm, isXs && styles.suitXs, { color: colors.hearts }]}>
          {SuitSymbols.hearts}
        </Text>
        <Text style={[styles.suit, isSm && styles.suitSm, isXs && styles.suitXs, { color: colors.clubs }]}>
          {SuitSymbols.clubs}
        </Text>
        <Text style={[styles.suit, isSm && styles.suitSm, isXs && styles.suitXs, { color: colors.diamonds }]}>
          {SuitSymbols.diamonds}
        </Text>
      </View>
    </View>
  );

  if (!onPress) return inner;

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {inner}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 2,
  },
  containerXs: {
    gap: 0,
  },
  shark: {
    fontSize: 28,
    marginBottom: 2,
  },
  sharkSm: {
    fontSize: 18,
    marginBottom: 0,
  },
  wordmark: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 3,
  },
  wordmarkSm: {
    fontSize: 16,
    letterSpacing: 2,
  },
  suits: {
    flexDirection: 'row',
    gap: 4,
  },
  suit: {
    fontSize: 11,
    fontWeight: '600',
  },
  suitSm: {
    fontSize: 9,
  },
  wordmarkXs: {
    fontSize: 13,
    letterSpacing: 2,
  },
  suitXs: {
    fontSize: 7,
  },
  pressed: {
    opacity: 0.6,
  },
});
