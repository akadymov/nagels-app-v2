/**
 * Nägels Online - Game Logo
 * Shark icon + NÄGELS wordmark + suit symbols
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, SuitSymbols } from '../constants';
import { useTheme } from '../hooks/useTheme';

interface GameLogoProps {
  size?: 'sm' | 'md' | 'xs';
}

export const GameLogo: React.FC<GameLogoProps> = ({ size = 'md' }) => {
  const { colors } = useTheme();
  const isSm = size === 'sm';
  const isXs = size === 'xs';

  return (
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
});
