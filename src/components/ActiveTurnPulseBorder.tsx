/**
 * Pulsing yellow screen-edge overlay shown when it's the local user's
 * turn — to bet during the betting phase or to play a card at the
 * table. Pure visual cue; lets all touches through via pointerEvents.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useTheme } from '../hooks/useTheme';

export interface ActiveTurnPulseBorderProps {
  /** True when the pulse should be visible and animating. */
  active: boolean;
  /** Outer corner radius, matches the host container if it's rounded. */
  borderRadius?: number;
}

export const ActiveTurnPulseBorder: React.FC<ActiveTurnPulseBorderProps> = ({
  active,
  borderRadius = 0,
}) => {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      opacity.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.25, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, opacity]);

  if (!active) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        styles.border,
        { borderColor: colors.activePlayerBorder, borderRadius, opacity },
      ]}
      testID="active-turn-pulse"
    />
  );
};

const styles = StyleSheet.create({
  border: {
    borderWidth: 8,
    zIndex: 999,
  },
});

export default ActiveTurnPulseBorder;
