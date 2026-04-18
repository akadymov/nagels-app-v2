/**
 * Nägels Online - Card Trick Component
 * Display the current trick (cards played by each player)
 */

import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { GlassCard } from '../glass';
import { PlayingCard, Suit, Rank } from './PlayingCard';
import { Colors, Spacing } from '../../constants';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export interface PlayedCard {
  playerId: string;
  playerName: string;
  card: {
    suit: Suit;
    rank: Rank;
  };
  isFirstLead?: boolean; // Was this the first card played (determines lead suit)
}

export interface CardTrickProps {
  playedCards: PlayedCard[];
  currentPlayerId?: string;
  myPlayerId?: string;
  winningPlayerId?: string;
}

/**
 * CardTrick - Display the current trick in the center
 *
 * Features:
 * - Shows cards played by each player
 * - Highlights winning card
 * - Rotates cards based on position
 * - Shows who played first (lead)
 */
export const CardTrick: React.FC<CardTrickProps> = ({
  playedCards,
  currentPlayerId,
  myPlayerId,
  winningPlayerId,
}) => {
  const getCardPosition = (index: number, total: number) => {
    // For 4 players, position cards in a diamond pattern
    const positions = [
      { top: 20, left: '50%' as const, transform: [{ translateX: -30 }, { rotate: '180deg' }] }, // Top (player 1)
      { right: 20, top: '50%' as const, transform: [{ translateY: -30 }, { rotate: '-90deg' }] }, // Right (player 2)
      { bottom: 20, left: '50%' as const, transform: [{ translateX: -30 }] }, // Bottom (player 3 - you)
      { left: 20, top: '50%' as const, transform: [{ translateY: -30 }, { rotate: '90deg' }] }, // Left (player 4)
    ];

    // For fewer than 4 players, adjust positions
    if (total <= 2) {
      return [
        { top: '40%' as const, left: '35%' as const, transform: [{ rotate: '180deg' }] },
        { top: '40%' as const, right: '35%' as const, transform: [] },
      ][index];
    }

    return positions[index % 4];
  };

  const renderPlayedCard = (played: PlayedCard, index: number) => {
    const isWinner = winningPlayerId === played.playerId;
    const position = getCardPosition(index, playedCards.length);

    return (
      <View
        key={played.playerId}
        style={[
          styles.playedCardContainer,
          position,
          isWinner && styles.winningCard,
        ]}
      >
        <GlassCard
          style={[
            styles.cardWrapper,
            isWinner && styles.winningCardWrapper,
          ]}
          dark
          blurAmount={20}
          borderWidth={isWinner ? 2 : 1}
          borderColor={isWinner ? Colors.highlight : Colors.glassLight}
        >
          <PlayingCard
            suit={played.card.suit}
            rank={played.card.rank}
            size="medium"
          />
        </GlassCard>

        {/* Player indicator */}
        <View style={[styles.playerIndicator, isWinner && styles.winnerIndicator]}>
          <View style={[
            styles.indicatorDot,
            { backgroundColor: played.playerId === currentPlayerId ? Colors.success : Colors.textMuted },
          ]} />
        </View>
      </View>
    );
  };

  if (playedCards.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <GlassCard style={styles.emptyCard} dark blurAmount={15}>
          <View style={styles.emptyContent}>
            <Text style={styles.emptyText}>?</Text>
          </View>
        </GlassCard>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {playedCards.map((played, index) => renderPlayedCard(played, index))}

      {/* Winner highlight */}
      {winningPlayerId && (
        <View style={styles.winnerGlow} />
      )}
    </View>
  );
};

// Need to import Text for the empty state
import { Text } from 'react-native';

const styles = StyleSheet.create({
  container: {
    width: 180,
    height: 180,
    position: 'relative',
  },
  emptyContainer: {
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    width: 80,
    height: 112,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.glassDark,
    borderStyle: 'dashed',
  },
  emptyContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 32,
    color: Colors.textMuted,
    opacity: 0.5,
  },
  playedCardContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardWrapper: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  winningCard: {
    zIndex: 10,
  },
  winningCardWrapper: {
    shadowColor: Colors.highlight,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 12,
  },
  playerIndicator: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.glassDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  winnerIndicator: {
    backgroundColor: Colors.highlight,
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  winnerGlow: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 120,
    height: 120,
    borderRadius: 60,
    transform: [{ translateX: -60 }, { translateY: -60 }],
    backgroundColor: Colors.highlight,
    opacity: 0.1,
  },
});

export default CardTrick;
