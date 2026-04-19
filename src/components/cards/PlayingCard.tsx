/**
 * Nägels Online - Playing Card Component
 * Individual playing card with suit, rank, and visual styling.
 * Theme-aware: works in both light and dark modes.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Radius, SuitSymbols } from '../../constants';
import { useTheme } from '../../hooks/useTheme';
import { cardSelectHaptic } from '../../utils/haptics';

export type Suit = 'diamonds' | 'hearts' | 'clubs' | 'spades';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 'J' | 'Q' | 'K' | 'A';

export interface PlayingCardProps {
  suit: Suit;
  rank: Rank;
  faceDown?: boolean;
  selected?: boolean;
  playable?: boolean;
  disabled?: boolean;
  size?: 'small' | 'medium' | 'large';
  onPress?: () => void;
  style?: any;
  testID?: string;
}

const getRankLabel = (rank: Rank): string => {
  if (typeof rank === 'number') return rank.toString();
  return rank;
};

export const getRankValue = (rank: Rank): number => {
  const rankOrder: Record<Rank, number> = {
    2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8,
    J: 9, Q: 10, K: 11, A: 12,
  };
  return rankOrder[rank];
};

export const PlayingCard: React.FC<PlayingCardProps> = ({
  suit,
  rank,
  faceDown = false,
  selected = false,
  playable = false,
  disabled = false,
  size = 'medium',
  onPress,
  style,
  testID,
}) => {
  const { colors } = useTheme();
  const suitColor = colors[suit];
  const suitSymbol = SuitSymbols[suit];
  const rankLabel = getRankLabel(rank);

  const getSizeConfig = () => {
    switch (size) {
      case 'small':
        return {
          width: 88,
          height: 122,
          cornerSize: 14,
          centerSuitSize: 30,
        };
      case 'large':
        return {
          width: 100,
          height: 140,
          cornerSize: 18,
          centerSuitSize: 40,
        };
      default: // medium
        return {
          width: 80,
          height: 112,
          cornerSize: 14,
          centerSuitSize: 32,
        };
    }
  };

  const sizeConfig = getSizeConfig();

  // Always reserve space for max border to prevent layout jump
  const borderWidth = selected ? 4 : 2;
  const borderColor = selected
    ? colors.selectedCardBorder
    : playable
      ? colors.success
      : colors.cardBorder;

  const cardBorderStyle = { borderColor, borderWidth, margin: selected ? 0 : 2 };
  const cardOpacity = disabled ? 0.4 : 1;

  const renderFaceUp = () => (
    <View
      style={[
        styles.cardContent,
        { width: sizeConfig.width, height: sizeConfig.height },
      ]}
    >
      {/* Top corner — Rank + Suit */}
      <View style={[styles.corner, styles.topCorner]}>
        <Text style={[
          styles.cornerText,
          { color: suitColor, fontSize: sizeConfig.cornerSize, lineHeight: sizeConfig.cornerSize * 1.2 },
        ]}>
          {rankLabel}{suitSymbol}
        </Text>
      </View>

      {/* Center suit */}
      <View style={styles.centerContainer}>
        <Text style={[
          styles.centerSuit,
          { color: suitColor, fontSize: sizeConfig.centerSuitSize, lineHeight: sizeConfig.centerSuitSize * 1.1 },
        ]}>
          {suitSymbol}
        </Text>
      </View>

      {/* Bottom corner (rotated) */}
      <View style={[styles.corner, styles.bottomCorner]}>
        <Text style={[
          styles.cornerText,
          { color: suitColor, fontSize: sizeConfig.cornerSize, lineHeight: sizeConfig.cornerSize * 1.2 },
        ]}>
          {rankLabel}{suitSymbol}
        </Text>
      </View>
    </View>
  );

  const renderFaceDown = () => (
    <View
      style={[
        styles.cardBack,
        { width: sizeConfig.width, height: sizeConfig.height, backgroundColor: colors.accent },
      ]}
    >
      <View style={styles.cardBackPattern}>
        <Text style={styles.cardBackSymbol}>♠</Text>
        <Text style={styles.cardBackSymbol}>♥</Text>
        <Text style={styles.cardBackSymbol}>♦</Text>
        <Text style={styles.cardBackSymbol}>♣</Text>
      </View>
    </View>
  );

  const cardContent = faceDown ? renderFaceDown() : renderFaceUp();
  const cardBackgroundColor = faceDown ? colors.accent : colors.card;

  const solidCardStyle = [
    styles.solidCard,
    cardBorderStyle,
    { backgroundColor: cardBackgroundColor, opacity: cardOpacity },
  ];

  if (onPress && !disabled) {
    const handlePress = () => {
      cardSelectHaptic();
      onPress();
    };

    return (
      <Pressable
        onPress={handlePress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.pressableContainer,
          pressed && styles.pressed,
          style,
        ]}
        testID={testID}
      >
        <View style={solidCardStyle}>
          {cardContent}
        </View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.container, style]} testID={testID}>
      <View style={solidCardStyle}>
        {cardContent}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
  },
  pressableContainer: {
    alignSelf: 'flex-start',
  },
  pressed: {
    transform: [{ scale: 0.95 }],
  },
  cardContent: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  corner: {
    position: 'absolute',
    alignItems: 'center',
  },
  topCorner: {
    top: 6,
    left: 6,
  },
  bottomCorner: {
    bottom: 6,
    right: 6,
    transform: [{ rotate: '180deg' }],
  },
  cornerText: {
    fontWeight: '900',
    fontSize: 20,
    letterSpacing: -0.5,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerSuit: {
    fontWeight: '700',
  },
  cardBack: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBackPattern: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.4,
  },
  cardBackSymbol: {
    fontSize: 18,
    color: '#ffffff',
    fontWeight: '600',
  },
  solidCard: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
});

export default PlayingCard;
