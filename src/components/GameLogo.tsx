/**
 * Nägels Online - Compact Game Logo
 * Used in screen headers to identify the app across all screens
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, SuitSymbols } from '../constants';

interface GameLogoProps {
  size?: 'sm' | 'md';
}

export const GameLogo: React.FC<GameLogoProps> = ({ size = 'md' }) => {
  const isSm = size === 'sm';

  return (
    <View style={styles.container}>
      <Text style={[styles.wordmark, isSm && styles.wordmarkSm]}>
        NÄGELS
      </Text>
      <View style={styles.suits}>
        <Text style={[styles.suit, styles.diamonds, isSm && styles.suitSm]}>
          {SuitSymbols.diamonds}
        </Text>
        <Text style={[styles.suit, styles.hearts, isSm && styles.suitSm]}>
          {SuitSymbols.hearts}
        </Text>
        <Text style={[styles.suit, styles.clubs, isSm && styles.suitSm]}>
          {SuitSymbols.clubs}
        </Text>
        <Text style={[styles.suit, styles.spades, isSm && styles.suitSm]}>
          {SuitSymbols.spades}
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
  wordmark: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 3,
    color: Colors.accent,
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
  diamonds: { color: Colors.diamonds },
  hearts: { color: Colors.hearts },
  clubs: { color: Colors.clubs },
  spades: { color: Colors.spades },
});
