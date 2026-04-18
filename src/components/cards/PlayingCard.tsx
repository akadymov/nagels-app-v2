/**
 * Nägels Online - Playing Card Component
 * Individual playing card with suit, rank, and visual styling
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  DimensionValue,
} from 'react-native';
import { GlassCard } from '../glass';
import { Colors, Spacing, Radius, TextStyles, SuitSymbols } from '../../constants';
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

/**
 * Get display label for rank
 */
const getRankLabel = (rank: Rank): string => {
  if (typeof rank === 'number') return rank.toString();
  return rank;
};

/**
 * Get color for suit
 */
const getSuitColor = (suit: Suit): string => {
  return Colors[suit];
};

/**
 * Get numeric value for rank (for sorting/comparison)
 */
export const getRankValue = (rank: Rank): number => {
  const rankOrder: Record<Rank, number> = {
    2: 0,
    3: 1,
    4: 2,
    5: 3,
    6: 4,
    7: 5,
    8: 6,
    9: 7,
    10: 8,
    J: 9,
    Q: 10,
    K: 11,
    A: 12,
  };
  return rankOrder[rank];
};

/**
 * PlayingCard - Individual card component
 *
 * Features:
 * - Glassmorphic card design
 * - Red/Black suit colors
 * - Multiple sizes (small/medium/large)
 * - Face-down state
 * - Selected/playable states
 * - Press handling with visual feedback
 */
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
  const suitColor = getSuitColor(suit);
  const suitSymbol = SuitSymbols[suit];
  const rankLabel = getRankLabel(rank);

  const getSizeConfig = () => {
    switch (size) {
      case 'small':
        return {
          width: 60,
          height: 84,
          cornerSize: 12,
          centerSuitSize: 24,
          padding: 5,
        };
      case 'large':
        return {
          width: 100,
          height: 140,
          cornerSize: 18,
          centerSuitSize: 40,
          padding: 10,
        };
      default: // medium
        return {
          width: 80,
          height: 112,
          cornerSize: 14,
          centerSuitSize: 32,
          padding: 7,
        };
    }
  };

  const sizeConfig = getSizeConfig();

  const renderFaceUp = () => (
    <View
      style={[
        styles.cardContent,
        {
          width: sizeConfig.width,
          height: sizeConfig.height,
        },
      ]}
    >
      {/* Top corner - Rank and Suit side-by-side */}
      <View style={[styles.corner, styles.topCorner]}>
        <Text style={[
          styles.cornerText,
          {
            color: suitColor,
            fontSize: sizeConfig.cornerSize,
            lineHeight: sizeConfig.cornerSize * 1.2,
          },
        ]}>
          {rankLabel}{suitSymbol}
        </Text>
      </View>

      {/* Center - ONLY Suit (large) */}
      <View style={styles.centerContainer}>
        <Text style={[
          styles.centerSuit,
          {
            color: suitColor,
            fontSize: sizeConfig.centerSuitSize,
            lineHeight: sizeConfig.centerSuitSize * 1.1,
          },
        ]}>
          {suitSymbol}
        </Text>
      </View>

      {/* Bottom corner (rotated) */}
      <View style={[styles.corner, styles.bottomCorner]}>
        <Text style={[
          styles.cornerText,
          {
            color: suitColor,
            fontSize: sizeConfig.cornerSize,
            lineHeight: sizeConfig.cornerSize * 1.2,
          },
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
        {
          width: sizeConfig.width,
          height: sizeConfig.height,
        },
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

  // Get solid background color based on suit
  const cardBackgroundColor = faceDown
    ? Colors.accent  // Blue card back (matching legacy blue theme)
    : '#FFFFFF';

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
          selected && styles.selectedContainer,
          playable && styles.playableContainer,
          style,
        ]}
        testID={testID}
      >
        <View
          style={[
            styles.solidCard,
            selected && styles.selectedCard,
            playable && styles.playableCard,
            { backgroundColor: cardBackgroundColor },
          ]}
        >
          {cardContent}
        </View>
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.container,
        selected && styles.selectedContainer,
        playable && styles.playableContainer,
        style,
      ]}
      testID={testID}
    >
      <View
        style={[
          styles.solidCard,
          selected && styles.selectedCard,
          playable && styles.playableCard,
          { backgroundColor: cardBackgroundColor },
        ]}
      >
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
  selectedContainer: {
    transform: [{ translateY: -8 }],
  },
  playableContainer: {
    transform: [{ translateY: -4 }],
  },
  glassCard: {
    overflow: 'hidden',
  },
  selectedCard: {
    shadowColor: Colors.highlight,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  playableCard: {
    shadowColor: Colors.success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
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
    backgroundColor: Colors.accent,
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
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.15)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
});

export default PlayingCard;
