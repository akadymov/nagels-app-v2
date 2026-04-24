/**
 * PullToRefresh — gesture-based pull-to-refresh without ScrollView.
 *
 * Uses PanResponder to detect a downward swipe starting in the top
 * zone of the screen.  Shows an ActivityIndicator while refreshing.
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  PanResponder,
  Animated,
  ActivityIndicator,
  StyleSheet,
  type GestureResponderEvent,
  type PanResponderGestureState,
  type ViewStyle,
} from 'react-native';

const ACTIVATION_ZONE_Y = 100; // px from top of component
const PULL_THRESHOLD = 60;     // px to drag before triggering
const DEBOUNCE_MS = 2000;      // minimum interval between refreshes

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  enabled?: boolean;
  children: React.ReactNode;
  style?: ViewStyle;
}

export const PullToRefresh: React.FC<PullToRefreshProps> = ({
  onRefresh,
  enabled = true,
  children,
  style,
}) => {
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const enabledRef = useRef(enabled);
  const lastRefreshRef = useRef(0);
  const pullDistance = useRef(new Animated.Value(0)).current;

  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const handleRefresh = useCallback(async () => {
    const now = Date.now();
    if (now - lastRefreshRef.current < DEBOUNCE_MS) return;
    lastRefreshRef.current = now;

    setRefreshing(true);
    refreshingRef.current = true;
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
      refreshingRef.current = false;
      Animated.timing(pullDistance, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [onRefresh, pullDistance]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (
        evt: GestureResponderEvent,
        gestureState: PanResponderGestureState,
      ) => {
        if (!enabledRef.current || refreshingRef.current) return false;
        // Only capture if touch started in the top activation zone
        const touchStartY = evt.nativeEvent.pageY - gestureState.dy;
        if (touchStartY > ACTIVATION_ZONE_Y) return false;
        // Only capture downward swipes (dy > 10 filters out taps)
        return gestureState.dy > 10 && Math.abs(gestureState.dx) < gestureState.dy;
      },

      onPanResponderMove: (_evt, gestureState) => {
        if (gestureState.dy > 0) {
          // Dampen the pull — max visual travel is PULL_THRESHOLD
          const clamped = Math.min(gestureState.dy, PULL_THRESHOLD);
          pullDistance.setValue(clamped);
        }
      },

      onPanResponderRelease: (_evt, gestureState) => {
        if (gestureState.dy >= PULL_THRESHOLD) {
          handleRefresh();
        } else {
          Animated.timing(pullDistance, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }).start();
        }
      },

      onPanResponderTerminate: () => {
        Animated.timing(pullDistance, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  return (
    <View style={[styles.container, style]} {...panResponder.panHandlers}>
      {/* Pull indicator (hidden during active refresh) */}
      {!refreshing && <Animated.View
        style={[
          styles.indicator,
          {
            opacity: pullDistance.interpolate({
              inputRange: [0, PULL_THRESHOLD * 0.5, PULL_THRESHOLD],
              outputRange: [0, 0.5, 1],
            }),
            transform: [{ translateY: pullDistance.interpolate({
              inputRange: [0, PULL_THRESHOLD],
              outputRange: [-30, 0],
            }) }],
          },
        ]}
      >
        <ActivityIndicator size="small" color="#888" />
      </Animated.View>}

      {/* Refreshing indicator (stays visible during fetch) */}
      {refreshing && (
        <View style={styles.refreshingBar}>
          <ActivityIndicator size="small" color="#888" />
        </View>
      )}

      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  indicator: {
    position: 'absolute',
    top: 4,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  refreshingBar: {
    position: 'absolute',
    top: 4,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
});
