/**
 * Nägels Online - Card Hand Component
 * Display a hand of cards with overlap and scrolling
 */

import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  ScrollViewProps,
} from 'react-native';
import { PlayingCard, Suit, Rank } from './PlayingCard';
import { Spacing } from '../../constants';

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  faceDown?: boolean;
}

export interface CardHandProps extends ScrollViewProps {
  cards: Card[];
  selectedCards?: string[];
  playableCards?: string[];
  onCardPress?: (cardId: string) => void;
  /**
   * Card overlap in pixels OR number of cards (for dynamic calculation).
   * Pass cards.length for automatic overlap based on card count.
   * If undefined, uses default overlap (20px).
   */
  cardOverlap?: number;
  size?: 'tiny' | 'small' | 'medium' | 'large';
  horizontal?: boolean;
  maxHeight?: number;
}

/**
 * Get card width based on size
 */
const getCardWidth = (size: 'tiny' | 'small' | 'medium' | 'large'): number => {
  switch (size) {
    case 'tiny': return 60;
    case 'small': return 66;
    case 'large': return 100;
    default: return 80;
  }
};

/**
 * CardHand - Display multiple cards in a hand
 *
 * Features:
 * - Horizontal scrolling for many cards
 * - Card overlap for compact display
 * - Selected/playable states
 * - Size variants
 */
export const CardHand: React.FC<CardHandProps> = ({
  cards,
  selectedCards = [],
  playableCards = [],
  onCardPress,
  cardOverlap,
  size = 'medium',
  horizontal = true,
  maxHeight,
  style,
  contentContainerStyle,
  ...scrollViewProps
}) => {
  const cardWidth = getCardWidth(size);

  // Dynamic overlap calculation based on number of cards
  const calculateOverlap = (): number => {
    if (cardOverlap !== undefined) {
      // If passed as number (card count), calculate dynamically
      const cardCount = typeof cardOverlap === 'number' ? cardOverlap : cards.length;

      // Formula: more cards = more overlap
      if (cardCount <= 5) return 12; // Spacious for few cards
      if (cardCount <= 7) return 16; // Medium overlap
      if (cardCount <= 9) return 20; // Tighter for 8-9 cards
      return 24; // Maximum overlap for 10 cards
    }
    return 20; // Default overlap
  };

  const actualOverlap = calculateOverlap();
  const effectiveCardWidth = Math.max(cardWidth - actualOverlap, cardWidth * 0.4);

  // Calculate total content width to ensure scrolling works
  // First card: full width, rest: effective width (with overlap)
  const totalContentWidth = cardWidth + (cards.length - 1) * effectiveCardWidth;
  const paddingHorizontal = Spacing.lg;

  const renderCard = (card: Card, index: number) => {
    const isSelected = selectedCards.includes(card.id);
    const isPlayable = playableCards.includes(card.id);

    return (
      <View
        key={card.id}
        style={styles.cardWrapper}
      >
        <PlayingCard
          suit={card.suit}
          rank={card.rank}
          faceDown={card.faceDown}
          selected={isSelected}
          playable={false}
          size={size}
          onPress={() => onCardPress?.(card.id)}
          testID={`card-${card.suit}-${card.rank}`}
        />
      </View>
    );
  };

  // Grid mode: 2 rows of 5 cards (for 6+ cards)
  const useGrid = !horizontal && cards.length > 5;

  if (useGrid) {
    const perRow = 5;
    const rows: Card[][] = [];
    for (let i = 0; i < cards.length; i += perRow) {
      rows.push(cards.slice(i, i + perRow));
    }
    return (
      <View style={[styles.gridContainer, style]}>
        {rows.map((row, rowIdx) => (
          <View key={rowIdx} style={styles.gridRow}>
            {row.map((card) => renderCard(card, 0))}
          </View>
        ))}
      </View>
    );
  }

  // Horizontal scrolling mode (overlap)
  const contentStyle = [
    styles.contentContainer,
    {
      width: totalContentWidth + paddingHorizontal * 2,
      paddingHorizontal,
      height: maxHeight || undefined,
    },
    contentContainerStyle,
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      style={[styles.scrollView, style]}
      decelerationRate="fast"
      snapToInterval={effectiveCardWidth}
      {...scrollViewProps}
    >
      <View style={contentStyle}>
        {cards.map((card, index) => renderCard(card, index))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
  },
  scrollView: {
    flexDirection: 'row',
  },
  scrollContent: {
    alignItems: 'center',
    minHeight: '100%',
  },
  verticalScrollContent: {
    alignItems: 'center',
  },
  contentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardWrapper: {
    marginRight: -25, // Overlap cards in horizontal mode
  },
  gridContainer: {
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
});

export default CardHand;
