import React, { useEffect, useRef, useState } from 'react';
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

  // Keep the view mounted during the 200ms exit animation so the fade-out
  // has frames to play. setKeepMounted(false) is called only after the
  // animation finishes.
  const [keepMounted, setKeepMounted] = useState<boolean>(visible);

  // Preserve the last non-null body so the text stays visible during
  // the exit animation after the store has already cleared the slot.
  const lastBodyRef = useRef<string>('');
  if (tooltip) lastBodyRef.current = tooltip.body;

  useEffect(() => {
    if (visible) {
      setKeepMounted(true);
      const anim = Animated.parallel([
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
      ]);
      anim.start();
      return () => anim.stop();
    } else {
      const anim = Animated.parallel([
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
      ]);
      anim.start(({ finished }) => {
        if (finished) setKeepMounted(false);
      });
      return () => anim.stop();
    }
  }, [visible, opacity, translateY]);

  if (!keepMounted) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          opacity,
          transform: [{ translateY }],
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
          {tooltip?.body ?? lastBodyRef.current}
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
    left: 0,
    right: 0,
    marginBottom: 4,
    alignItems: 'center',
    zIndex: 100,
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
