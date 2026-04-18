/**
 * Nägels Online - Bot AI Module
 * Different difficulty levels with varying strategies
 *
 * Strategy Priorities (for Medium+):
 * 1. Match bet (get exactly bet tricks) for +10 bonus
 * 2. Take extra tricks for points
 * 3. Sabotage leaders (prevent them from making their bets)
 */

import { Card, Suit, getCardRank, determineTrickWinner } from '../../game';

// ============================================================
// TYPES
// ============================================================

export type BotDifficulty = 'easy' | 'medium' | 'hard';

export interface BotStrategy {
  placeBet: (context: BettingContext) => number;
  playCard: (context: PlayingContext) => Card;
}

export interface BettingContext {
  hand: Card[];
  cardsPerPlayer: number;
  trumpSuit: Suit;
  allowedBets: number[];
  playerCount: number;
  currentBets?: number[]; // bets already placed by other players
}

export interface PlayingContext {
  hand: Card[];
  playableCards: Card[];
  trumpSuit: Suit;
  currentTrick: Array<{ playerId: string; card: Card }>;
  playerCount: number;
  tricksWon: number;
  bet: number | null;
  tricksPlayed: number;
  allPlayerScores: Array<{ playerId: string; score: number; bet: number | null; tricksWon: number }>;
}

// ============================================================
// CARD STRENGTH ANALYSIS
// ============================================================

/**
 * Calculate the strength of a hand (0-100 scale)
 */
function calculateHandStrength(hand: Card[], trumpSuit: Suit): number {
  let strength = 0;

  for (const card of hand) {
    // Base value for rank
    switch (card.rank) {
      case 'A': strength += 14; break;
      case 'K': strength += 13; break;
      case 'Q': strength += 12; break;
      case 'J': strength += 11; break;
      case 10: strength += 10; break;
      case 9: strength += 9; break;
      case 8: strength += 8; break;
      case 7: strength += 7; break;
      default:
        if (typeof card.rank === 'number') {
          strength += card.rank;
        }
        break;
    }

    // Bonus for trumps
    if (card.suit === trumpSuit) {
      strength += 5;

      // Extra bonus for trump J and 9 (strong cards in many trick-taking games)
      if (card.rank === 'J') strength += 10;
      if (card.rank === 9) strength += 7;
      if (card.rank === 10 || card.rank === 'A') strength += 5;
    }

    // Bonus for honors in non-trump suits
    if (card.suit !== trumpSuit) {
      if (card.rank === 'A' || card.rank === 'K') strength += 3;
      if (card.rank === 'Q') strength += 2;
    }
  }

  return strength;
}

/**
 * Count winners in hand (cards that would likely win a trick)
 */
function countWinners(hand: Card[], trumpSuit: Suit): number {
  let winners = 0;

  // Count high trumps
  const trumps = hand.filter(c => c.suit === trumpSuit);
  winners += trumps.filter(c => ['A', 'K', 'J'].includes(c.rank as string)).length;

  // Count high non-trumps
  const nonTrumps = hand.filter(c => c.suit !== trumpSuit);
  for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
    if (suit === trumpSuit) continue;
    const suitCards = nonTrumps.filter(c => c.suit === suit);
    if (suitCards.length > 0) {
      // First Ace or King in suit is likely a winner
      if (suitCards.some(c => c.rank === 'A')) winners++;
      else if (suitCards.some(c => c.rank === 'K')) winners += 0.5;
    }
  }

  return winners;
}

/**
 * Estimate how many tricks a player will take with their hand
 * Target: average hand → cardsPerPlayer / playerCount tricks
 */
function estimateTrickCount(hand: Card[], trumpSuit: Suit, cardsPerPlayer: number, playerCount: number = 4): number {
  const strength = calculateHandStrength(hand, trumpSuit);
  const winners = countWinners(hand, trumpSuit);

  // Normalize strength to 0.0–2.0 scale (average card ~10 pts, so avg hand = hand.length * 10)
  const normalizedStrength = strength / (hand.length * 10);

  // Expected tricks for a perfectly average hand
  const expectedAvgTricks = cardsPerPlayer / playerCount;

  // Scale: normalizedStrength=1.0 → expectedAvgTricks, stronger hands → more
  let estimate = normalizedStrength * expectedAvgTricks;

  // Small winner bonus (partially captured in strength already)
  estimate += winners * 0.3;

  return Math.max(0, Math.min(cardsPerPlayer, Math.round(estimate)));
}

/**
 * Check if a card would win the current trick
 */
function wouldWinTrick(card: Card, currentTrick: Array<{ playerId: string; card: Card }>, trumpSuit: Suit): boolean {
  const result = determineTrickWinner(
    [...currentTrick, { playerId: 'test', card }],
    trumpSuit
  );
  return result.winnerId === 'test';
}

// ============================================================
// EASY BOT STRATEGY
// ============================================================

/**
 * Easy Bot - Makes random reasonable choices
 * - Bets randomly within reasonable range
 * - Plays cards with simple logic
 */
export const EasyBotStrategy: BotStrategy = {
  placeBet: (context) => {
    const { hand, allowedBets, cardsPerPlayer } = context;

    // Random bet in middle range
    const minBet = 1;
    const maxBet = Math.min(cardsPerPlayer - 1, Math.floor(hand.length / 2) + 1);

    const reasonableBets = allowedBets.filter(b => b >= minBet && b <= maxBet);

    if (reasonableBets.length === 0) {
      return allowedBets[Math.floor(Math.random() * allowedBets.length)];
    }

    return reasonableBets[Math.floor(Math.random() * reasonableBets.length)];
  },

  playCard: (context) => {
    const { playableCards, currentTrick } = context;

    // If leading, play random card
    if (currentTrick.length === 0) {
      return playableCards[Math.floor(Math.random() * playableCards.length)];
    }

    // If following, 30% chance to play winning card, otherwise dump
    if (Math.random() < 0.3) {
      // Try to win with highest card
      return playableCards[playableCards.length - 1];
    } else {
      // Dump lowest card
      return playableCards[0];
    }
  },
};

// ============================================================
// MEDIUM BOT STRATEGY
// Priority 1: Match bet, Priority 2: Get extra tricks
// ============================================================

/**
 * Medium Bot - Focuses on matching bet, then gets extra tricks
 */
export const MediumBotStrategy: BotStrategy = {
  placeBet: (context) => {
    const { hand, allowedBets, cardsPerPlayer, trumpSuit, playerCount } = context;

    // Estimate tricks from hand strength
    const estimate = estimateTrickCount(hand, trumpSuit, cardsPerPlayer, playerCount);

    // Find closest allowed bet
    const closest = allowedBets.reduce((prev, curr) => {
      return Math.abs(curr - estimate) < Math.abs(prev - estimate) ? curr : prev;
    });

    return closest;
  },

  playCard: (context) => {
    const { playableCards, currentTrick, trumpSuit, bet, tricksWon } = context;

    const targetTricks = bet || 0;
    const isLeading = currentTrick.length === 0;

    if (isLeading) {
      // Leading strategy
      if (tricksWon >= targetTricks) {
        // Already made bet - lead low
        const nonTrumps = playableCards.filter(c => c.suit !== trumpSuit);
        if (nonTrumps.length > 0) {
          return nonTrumps.sort((a, b) =>
            getCardRank(a.rank, false) - getCardRank(b.rank, false)
          )[0];
        }
        return playableCards[0];
      } else {
        // Need tricks - lead high
        const nonTrumps = playableCards.filter(c => c.suit !== trumpSuit);
        if (nonTrumps.length > 0) {
          return nonTrumps.sort((a, b) =>
            getCardRank(b.rank, false) - getCardRank(a.rank, false)
          )[0];
        }
        return playableCards[playableCards.length - 1];
      }
    }

    // Following strategy - find winning cards
    const winningCards = playableCards.filter(card => {
      const result = determineTrickWinner(
        [...currentTrick, { playerId: 'bot', card }],
        trumpSuit
      );
      return result.winnerId === 'bot';
    });

    const tricksStillNeeded = targetTricks - tricksWon;

    if (tricksStillNeeded > 0 && winningCards.length > 0) {
      // Need more tricks - win with lowest winning card (sort ascending by rank)
      const sorted = [...winningCards].sort((a, b) =>
        getCardRank(a.rank, a.suit === trumpSuit) - getCardRank(b.rank, b.suit === trumpSuit)
      );
      return sorted[0];
    } else if (tricksStillNeeded <= 0 && winningCards.length > 0) {
      // Made bet or ahead - try to duck, dump lowest
      const nonWinningCards = playableCards.filter(card => {
        const result = determineTrickWinner(
          [...currentTrick, { playerId: 'bot', card }],
          trumpSuit
        );
        return result.winnerId !== 'bot';
      });
      return nonWinningCards.length > 0 ? nonWinningCards[0] : playableCards[0];
    } else {
      // Can't win - dump lowest
      return playableCards[0];
    }
  },
};

// ============================================================
// HARD BOT STRATEGY
//
// Betting priority:
//   Угадать ровно столько взяток, сколько реально возьмёшь
//   (учитывая свои карты и уже сделанные ставки других игроков)
//
// Playing priorities:
//   P1 — взять РОВНО столько взяток, сколько заказал (не больше, не меньше)
//   P2 — если ОЧЕВИДНО возьмёшь больше (уже перебрал) → брать максимум
//   P3 — если P1 выполнен → мешать другим попасть в свои ставки
// ============================================================

/**
 * Hard Bot - strategy based on accurate bidding and precise trick control
 */
export const HardBotStrategy: BotStrategy = {
  placeBet: (context) => {
    const { hand, allowedBets, cardsPerPlayer, trumpSuit, playerCount, currentBets } = context;

    // Step 1: estimate based on hand strength
    let estimate = estimateTrickCount(hand, trumpSuit, cardsPerPlayer, playerCount);

    // Step 2: adjust based on tricks already claimed by others
    // If others have bet many tricks, fewer remain available for us
    if (currentBets && currentBets.length > 0) {
      const totalOtherBets = currentBets.reduce((sum, b) => sum + b, 0);
      const remainingPlayers = playerCount - currentBets.length; // including this bot
      const availableForRemaining = cardsPerPlayer - totalOtherBets;
      const fairShare = remainingPlayers > 0 ? availableForRemaining / remainingPlayers : estimate;

      // Hand strength is primary (60%), availability shifts estimate (40%)
      estimate = Math.round(estimate * 0.6 + fairShare * 0.4);
      estimate = Math.max(0, Math.min(cardsPerPlayer, estimate));
    }

    // Find closest allowed bet to our estimate
    return allowedBets.reduce((prev, curr) =>
      Math.abs(curr - estimate) < Math.abs(prev - estimate) ? curr : prev
    );
  },

  playCard: (context) => {
    const {
      playableCards,
      trumpSuit,
      currentTrick,
      bet,
      tricksWon,
      allPlayerScores,
      playerCount,
    } = context;

    const targetBet = bet ?? 0;
    const tricksStillNeeded = targetBet - tricksWon; // >0 need more, 0 at bet, <0 over
    const clearlyOverBet = tricksWon > targetBet;
    const isLeading = currentTrick.length === 0;
    const isLastToPlay = currentTrick.length === playerCount - 1;

    // ---- helpers ----
    const sortAsc = (cards: Card[]) =>
      [...cards].sort((a, b) =>
        getCardRank(a.rank, a.suit === trumpSuit) - getCardRank(b.rank, b.suit === trumpSuit)
      );
    const sortDesc = (cards: Card[]) =>
      [...cards].sort((a, b) =>
        getCardRank(b.rank, b.suit === trumpSuit) - getCardRank(a.rank, a.suit === trumpSuit)
      );
    const winningCards = () =>
      playableCards.filter(card => wouldWinTrick(card, currentTrick, trumpSuit));
    const lowestWinner = () => sortAsc(winningCards())[0];
    const lowestCard = sortAsc(playableCards)[0];
    const highestCard = sortDesc(playableCards)[0];

    // ================================================================
    // P2: Уже перебрал ставку → брать максимум взяток
    // ================================================================
    if (clearlyOverBet) {
      if (isLeading) return highestCard;
      const winners = winningCards();
      if (winners.length > 0) return sortDesc(winners)[0]; // бьём как можно старше
      return lowestCard;
    }

    // ================================================================
    // P1a: Нужно взять ещё взятки → стараемся выиграть
    // ================================================================
    if (tricksStillNeeded > 0) {
      if (isLeading) {
        // Ведём с сильной масти не-козырь (козыри оставляем на крайний случай)
        const nonTrumps = playableCards.filter(c => c.suit !== trumpSuit);
        if (nonTrumps.length > 0) return sortDesc(nonTrumps)[0];
        return highestCard;
      }
      // Следуем: берём минимально достаточной картой
      const lw = lowestWinner();
      if (lw) return lw;
      return lowestCard; // не можем взять — сбрасываем наименьшую
    }

    // ================================================================
    // P1b: Ровно выполнили ставку → уклоняемся от лишних взяток
    // ================================================================
    if (tricksStillNeeded === 0) {
      if (isLeading) return lowestCard; // ведём самой слабой картой

      // Следуем: ищем карту, которая не выиграет
      const nonWinning = sortAsc(
        playableCards.filter(card => !wouldWinTrick(card, currentTrick, trumpSuit))
      );
      if (nonWinning.length > 0) return nonWinning[0];

      // Все карты выигрывают — вынуждены взять.
      // Используем это стратегически: по возможности берём у того,
      // кому эта взятка критически нужна для выполнения ставки (P3).
      if (isLastToPlay) {
        const currentWinnerId = determineTrickWinner(currentTrick, trumpSuit).winnerId;
        const winnerScore = allPlayerScores.find(p => p.playerId === currentWinnerId);
        if (winnerScore?.bet !== null) {
          const theyNeedExactlyThis = (winnerScore!.bet! - winnerScore!.tricksWon) === 1;
          if (theyNeedExactlyThis) {
            const lw = lowestWinner();
            if (lw) return lw; // крадём нужную им взятку
          }
        }
      }

      return lowestCard; // берём минимальной картой
    }

    // ================================================================
    // P3: Ставка выполнена с запасом — мешаем другим выполнить свои
    // ================================================================

    // Ищем игрока, которому критически нужна следующая взятка
    if (isLastToPlay && !isLeading) {
      const currentWinnerId = determineTrickWinner(currentTrick, trumpSuit).winnerId;
      const winnerScore = allPlayerScores.find(p => p.playerId === currentWinnerId);
      if (winnerScore?.bet !== null) {
        const theyNeedThis = (winnerScore!.bet! - winnerScore!.tricksWon) === 1;
        if (theyNeedThis) {
          const lw = lowestWinner();
          if (lw) return lw; // перебиваем — они промажут по ставке
        }
      }
    }

    return lowestCard;
  },
};

// ============================================================
// STRATEGY SELECTOR
// ============================================================

export function getBotStrategy(difficulty: BotDifficulty): BotStrategy {
  switch (difficulty) {
    case 'easy':
      return EasyBotStrategy;
    case 'medium':
      return MediumBotStrategy;
    case 'hard':
      return HardBotStrategy;
    default:
      return MediumBotStrategy;
  }
}

export const BotDifficulties: Record<BotDifficulty, { name: string; description: string }> = {
  easy: { name: 'Easy', description: 'Relaxed gameplay for beginners' },
  medium: { name: 'Medium', description: 'Balanced challenge for casual players' },
  hard: { name: 'Hard', description: 'Advanced AI with strategic sabotage' },
};
