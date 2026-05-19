/**
 * Turn countdown chip. Surfaces during the last COUNTDOWN_VISIBLE_MS
 * of the 2-min auto-play budget so players see "you have N seconds"
 * before the server force-advances the turn.
 *
 * Reads seconds-remaining from useTurnCountdown(), which shares its
 * startedAt with useTurnTimeout — the visible countdown can't drift
 * away from the timer that actually fires.
 *
 * URGENT_THRESHOLD swaps the colour to red and adds a subtle pulse so
 * the chip is impossible to miss in the final seconds.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../hooks/useTheme';
import { Radius, Spacing } from '../constants';
import { useTurnCountdown } from '../lib/turnTimeout';

const URGENT_THRESHOLD_S = 10;

export interface TurnTimerProps {
  /** Optional label rendered before the timer (e.g. "Alice"). When
   *  omitted, the chip shows just the countdown. */
  label?: string | null;
  /** Inline style override — caller positions the chip. */
  style?: any;
}

export const TurnTimer: React.FC<TurnTimerProps> = ({ label, style }) => {
  const remaining = useTurnCountdown();
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;
  const urgent = remaining !== null && remaining <= URGENT_THRESHOLD_S;

  useEffect(() => {
    if (!urgent) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 400, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [urgent, pulse]);

  if (remaining === null) return null;

  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  const text = `${mm}:${ss.toString().padStart(2, '0')}`;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.chip,
        {
          backgroundColor: urgent ? colors.error : colors.surface,
          borderColor: urgent ? colors.error : colors.glassLight,
          transform: [{ scale: pulse }],
        },
        style,
      ]}
      testID="turn-timer"
    >
      {label ? (
        <Text
          numberOfLines={1}
          style={[styles.label, { color: urgent ? '#ffffff' : colors.textSecondary }]}
        >
          {label}
        </Text>
      ) : null}
      <Text style={[styles.time, { color: urgent ? '#ffffff' : colors.textPrimary }]}>
        {text}
      </Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    borderWidth: 1,
    minWidth: 64,
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    maxWidth: 80,
  },
  time: {
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
