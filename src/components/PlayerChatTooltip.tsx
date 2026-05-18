import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useChatTooltipStore } from '../store/chatTooltipStore';
import { useTheme } from '../hooks/useTheme';
import { Radius, Spacing } from '../constants';

export interface PlayerChatTooltipProps {
  sessionId: string;
  onPress: () => void;
}

export const PlayerChatTooltip: React.FC<PlayerChatTooltipProps> = ({
  sessionId,
  onPress,
}) => {
  const tooltip = useChatTooltipStore((s) => s.tooltips[sessionId]);
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;
  const visible = !!tooltip;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 4,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, opacity, translateY]);

  if (!tooltip) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          opacity,
          transform: [{ translateX: -50 }, { translateY }],
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        testID={`chat-tooltip-${sessionId}`}
        style={[
          styles.bubble,
          {
            backgroundColor: colors.surface,
            borderColor: colors.glassLight,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.body, { color: colors.textPrimary }]}
        >
          {tooltip.body}
        </Text>
      </Pressable>
      <View
        style={[
          styles.arrow,
          { borderTopColor: colors.surface },
        ]}
      />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: '100%',
    left: '50%',
    marginBottom: 4,
    width: 100, // anchor width — translateX:-50 centers it; actual bubble width below
    alignItems: 'center',
    zIndex: 50,
  },
  bubble: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.md,
    borderWidth: 1,
    maxWidth: 200,
    minWidth: 80,
  },
  body: {
    fontSize: 12,
    lineHeight: 16,
  },
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
