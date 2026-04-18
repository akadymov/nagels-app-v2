/**
 * Nägels Online - Complete Game Rules
 *
 * This module contains ALL game rules extracted from the legacy codebase.
 * These rules MUST be preserved exactly - no simplifications allowed.
 *
 * Source: https://github.com/akadymov/nagels-app/blob/main/api/info_en.html
 */

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export type Suit = 'diamonds' | 'hearts' | 'clubs' | 'spades' | 'notrump';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  id: string;
  suit: Exclude<Suit, 'notrump'>; // Cards cannot be 'notrump'
  rank: Rank;
}

export interface Player {
  id: string;
  name: string;
  isBot?: boolean;
}

export interface Bet {
  playerId: string;
  amount: number;
}

export interface Trick {
  cards: Array<{
    playerId: string;
    card: Card;
  }>;
  winnerId: string;
}

// ============================================================
// GAME STRUCTURE RULES
// ============================================================

/**
 * Rule 1: Number of players
 * - Minimum: 2 players
 * - Maximum: 6 players
 * - Optimal: 4-5 players
 */
export const PLAYER_LIMITS = {
  MIN: 2,
  MAX: 6,
  OPTIMAL_MIN: 4,
  OPTIMAL_MAX: 5,
} as const;

export function validatePlayerCount(count: number): boolean {
  return count >= PLAYER_LIMITS.MIN && count <= PLAYER_LIMITS.MAX;
}

/**
 * Rule 2: Number of dealt cards per hand
 * - Cards change by 1 each hand
 * - Exception: Hand with 1 card is played TWO TIMES in a row
 * - Pattern: Decrease to 1, then increase back to initial
 * - Maximum is 10 cards per player
 *
 * Example for 4 players (10 cards max):
 * Hands: 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
 * Total: 20 hands
 */
export function getMaxCards(playerCount: number): number {
  // Maximum 10 cards per player (game balance)
  // For 4 players: 40 cards dealt out of 52-card deck
  return Math.min(10, Math.floor(52 / playerCount));
}

export function getHandCards(handNumber: number, maxCards: number): number {
  // handNumber is 1-indexed
  // Pattern: max, max-1, ..., 2, 1, 1, 2, ..., max-1, max  (double "1" at the centre)
  // Decreasing phase: hands 1..maxCards  →  max, max-1, ..., 1
  // Increasing phase: hands maxCards+1..maxCards*2  →  1, 2, ..., max

  if (handNumber <= maxCards) {
    return maxCards - handNumber + 1;
  } else {
    return handNumber - maxCards;
  }
}

export function getTotalHands(maxCards: number): number {
  // 10,9,8,7,6,5,4,3,2,1,1,2,3,4,5,6,7,8,9,10 = 20 hands for maxCards=10
  return maxCards * 2;
}

export function getAllHandCards(maxCards: number): number[] {
  const hands: number[] = [];
  // Decreasing
  for (let i = maxCards; i >= 1; i--) {
    hands.push(i);
  }
  // Increasing (includes the second "1")
  for (let i = 1; i <= maxCards; i++) {
    hands.push(i);
  }
  return hands;
}

/**
 * Rule 3: Trump rotation
 * - Strict order: diamonds → hearts → clubs → spades → no trump
 * - Changes every hand
 */
export const TRUMP_ORDER: Suit[] = ['diamonds', 'hearts', 'clubs', 'spades', 'notrump'];

export function getTrumpForHand(handNumber: number): Suit {
  // handNumber is 1-indexed
  const index = (handNumber - 1) % TRUMP_ORDER.length;
  return TRUMP_ORDER[index];
}

/**
 * Rule 4: Starting player rotation
 * - Changes every hand counterclockwise
 * - For 4 players: 0 → 3 → 2 → 1 → 0 ... (counterclockwise)
 */
export function getStartingPlayer(handNumber: number, playerCount: number, firstHandStartingPlayer: number = 0): number {
  // Counterclockwise rotation: each hand the starting player steps back by 1 index
  // Hand 1: firstHandStartingPlayer
  // Hand 2: (firstHandStartingPlayer - 1 + playerCount) % playerCount
  // Hand 3: (firstHandStartingPlayer - 2 + playerCount) % playerCount
  return (firstHandStartingPlayer - (handNumber - 1) + playerCount * handNumber) % playerCount;
}

// ============================================================
// BETTING RULES
// ============================================================

/**
 * Rule 4: Betting constraints
 * - Every player makes bet (zero or more) in counterclockwise order
 * - Bet cannot exceed number of cards on hand
 * - CRITICAL: Sum of all bets must NOT equal number of dealt cards per player
 * - This restriction applies ONLY to the LAST betting player
 */

export interface BettingContext {
  playerCount: number;
  cardsPerPlayer: number;
  currentBets: Bet[];
  isLastPlayer: boolean;
}

export function isValidBet(bet: number, context: BettingContext): boolean {
  const { cardsPerPlayer, currentBets, isLastPlayer } = context;

  // Rule: Bet cannot exceed cards on hand
  if (bet < 0 || bet > cardsPerPlayer) {
    return false;
  }

  // Rule: Last player cannot make total bets equal to cards per player
  if (isLastPlayer) {
    const totalBets = currentBets.reduce((sum, b) => sum + b.amount, 0);
    if (totalBets + bet === cardsPerPlayer) {
      return false; // "Someone should stay unhappy"
    }
  }

  return true;
}

export function getAllowedBets(context: BettingContext): number[] {
  const { cardsPerPlayer } = context;
  const allowed: number[] = [];

  for (let bet = 0; bet <= cardsPerPlayer; bet++) {
    if (isValidBet(bet, context)) {
      allowed.push(bet);
    }
  }

  return allowed;
}

// ============================================================
// CARD PLAY RULES
// ============================================================

/**
 * Rule 5: Putting cards
 * - First player: No restriction (can play any card)
 * - Following players: Must play in suit of first card OR trump
 * - Exception 1: Can play any card if don't have suited card
 * - Exception 2: Cannot play trump lower than already played trump when lead is NOT trump
 */

export interface PlayContext {
  handCards: Card[]; // Cards in player's hand
  leadCard: Card | null; // First card played in trick
  trumpSuit: Suit;
  playedCards: Array<{ playerId: string; card: Card }>;
}

export function hasSuit(cards: Card[], suit: Exclude<Suit, 'notrump'>): boolean {
  const result = cards.some(c => c.suit === suit);
  // Debug logging for tracking suit issues
  if (cards.length > 0 && !result) {
    console.log(`[hasSuit] Looking for suit ${suit}, but hand has:`, cards.map(c => `${c.rank}${c.suit[0]}`).join(', '));
  }
  return result;
}

export function getLeadSuit(leadCard: Card | null): Exclude<Suit, 'notrump'> | null {
  return leadCard?.suit || null;
}

export function isTrump(card: Card, trumpSuit: Suit): boolean {
  return trumpSuit !== 'notrump' && card.suit === trumpSuit;
}

export function hasTrump(cards: Card[], trumpSuit: Suit): boolean {
  if (trumpSuit === 'notrump') return false;
  return cards.some(c => c.suit === trumpSuit);
}

export function getHighestTrumpInTrick(
  playedCards: Array<{ card: Card }>,
  trumpSuit: Suit
): { card: Card; rank: number } | null {
  if (trumpSuit === 'notrump') return null;

  const trumps = playedCards
    .filter(p => p.card.suit === trumpSuit)
    .map(p => ({ card: p.card, rank: getCardRank(p.card.rank, true) }))
    .sort((a, b) => b.rank - a.rank);

  return trumps[0] || null;
}

export function isCardPlayable(card: Card, context: PlayContext): { playable: boolean; reason?: string } {
  const { handCards, leadCard, trumpSuit, playedCards } = context;

  // First player: Any card is valid
  if (!leadCard) {
    return { playable: true };
  }

  const leadSuit = leadCard.suit;
  const hasLeadSuit = hasSuit(handCards, leadSuit);

  // If player has lead suit, can play lead suit OR trump
  if (hasLeadSuit) {
    // JACK OF TRUMP EXCEPTION: When the lead IS trump and the player's only
    // trump card(s) are Jack(s), they are NOT forced to play the Jack.
    // The Jack of trump is special — it can always be withheld.
    if (leadSuit === trumpSuit && hasOnlyJackTrump(handCards, trumpSuit)) {
      return { playable: true };
    }

    if (card.suit === leadSuit) {
      return { playable: true };
    }
    // Can also play trump
    if (trumpSuit !== 'notrump' && card.suit === trumpSuit) {
      // Check if any trump has been played
      const playedTrumps = playedCards.filter(p => p.card.suit === trumpSuit);
      if (playedTrumps.length > 0) {
        // Get the highest trump played so far
        const highestPlayed = playedTrumps
          .map(p => ({ card: p.card, rank: getCardRank(p.card.rank, true) }))
          .sort((a, b) => b.rank - a.rank)[0];
        const cardRank = getCardRank(card.rank, true);
        // Cannot play lower trump than already played (only when lead is NOT trump),
        // and only if the player has non-trump alternatives.
        const hasNonTrump = handCards.some(c => c.suit !== trumpSuit);
        if (cardRank < highestPlayed.rank && leadCard.suit !== trumpSuit && hasNonTrump) {
          return { playable: false, reason: 'Cannot play lower trump' };
        }
      }
      return { playable: true };
    }
    return { playable: false, reason: 'Must follow suit or play trump' };
  }

  // Player doesn't have lead suit - can play trump or any card
  if (trumpSuit !== 'notrump') {
    // JACK OF TRUMP EXCEPTION: When trick starts with trump and player's only trump(s) are Jack(s),
    // they can play off-suit instead of being forced to play the Jack
    const hasOnlyJackAsTrump = hasOnlyJackTrump(handCards, trumpSuit);
    const isTrumpLead = leadCard.suit === trumpSuit;

    if (isTrumpLead && hasOnlyJackAsTrump && card.suit !== trumpSuit) {
      // Player is allowed to skip the Jack and play off-suit
      return { playable: true };
    }

    // Check if any trump has been played
    const playedTrumps = playedCards.filter(p => p.card.suit === trumpSuit);

    if (playedTrumps.length > 0) {
      // Get the highest trump played so far
      const highestPlayed = playedTrumps
        .map(p => ({ card: p.card, rank: getCardRank(p.card.rank, true) }))
        .sort((a, b) => b.rank - a.rank)[0];

      // If trying to play trump
      if (card.suit === trumpSuit) {
        const cardRank = getCardRank(card.rank, true);
        // Cannot play lower trump than already played (when lead is not trump),
        // BUT only if the player still has non-trump cards to play instead.
        // If all remaining cards are trump, any trump is allowed (no other choice).
        const hasNonTrump = handCards.some(c => c.suit !== trumpSuit);
        if (cardRank < highestPlayed.rank && leadCard.suit !== trumpSuit && hasNonTrump) {
          return { playable: false, reason: 'Cannot play lower trump' };
        }
        return { playable: true };
      }

      // Not playing trump - allowed (exception 1)
      return { playable: true };
    }

    // No trump played yet - any card is fine
    return { playable: true };
  }

  // No trump - any card is fine
  return { playable: true };
}

/**
 * Helper: Check if player's only trump cards are Jacks
 * Returns true if player has no trumps, or only has Jack(s) as trump
 */
function hasOnlyJackTrump(handCards: Card[], trumpSuit: Suit): boolean {
  if (trumpSuit === 'notrump') return false;

  const trumps = handCards.filter(c => c.suit === trumpSuit);
  if (trumps.length === 0) return false; // No trumps at all

  // Check if all trumps are Jacks
  return trumps.every(c => c.rank === 'J');
}

export function getPlayableCards(handCards: Card[], context: Omit<PlayContext, 'handCards'>): Card[] {
  const playable = handCards.filter(card =>
    isCardPlayable(card, { ...context, handCards }).playable
  );

  // EMERGENCY EXCEPTION: If no cards are playable under normal rules,
  // allow any card (game should never be blocked)
  if (playable.length === 0 && handCards.length > 0) {
    console.warn('[getPlayableCards] No playable cards under normal rules, allowing all cards (emergency exception)');
    return handCards;
  }

  return playable;
}

// ============================================================
// TRICK RESOLUTION RULES
// ============================================================

/**
 * Rule 5 (continued): Trick winner determination
 * - Winner: Player with highest suited card OR trump
 * - Trump hierarchy: Jack (highest) → Nine (second highest) → A → K → Q → 10 → 8 → 7 → 6 → 5 → 4 → 3 → 2
 * - This hierarchy applies ONLY for trump suit
 * - For non-trump suits: A → K → Q → J → 10 → 9 → 8 → 7 → 6 → 5 → 4 → 3 → 2
 */

export function getCardRank(rank: Rank, isTrump: boolean): number {
  // For non-trump: 2=0, 3=1, 4=2, 5=3, 6=4, 7=5, 8=6, 9=7, 10=8, J=9, Q=10, K=11, A=12
  const normalRank: Record<Rank, number> = {
    2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8, J: 9, Q: 10, K: 11, A: 12,
  };

  // For trump: 2=0, 3=1, 4=2, 5=3, 6=4, 7=5, 8=6, 10=7, Q=8, K=9, A=10, 9=11, J=12 (J and 9 are elevated!)
  const trumpRank: Record<Rank, number> = {
    2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 10: 7, Q: 8, K: 9, A: 10, 9: 11, J: 12,
  };

  return isTrump ? trumpRank[rank] : normalRank[rank];
}

export function compareCards(a: Card, b: Card, trumpSuit: Suit, leadSuit: Exclude<Suit, 'notrump'>): number {
  const aIsTrump = isTrump(a, trumpSuit);
  const bIsTrump = isTrump(b, trumpSuit);
  const aIsLeadSuit = a.suit === leadSuit;
  const bIsLeadSuit = b.suit === leadSuit;

  // Trump beats non-trump
  if (aIsTrump && !bIsTrump) return 1;
  if (!aIsTrump && bIsTrump) return -1;

  // Both non-trump: lead suit beats other suits
  if (!aIsTrump && !bIsTrump) {
    if (aIsLeadSuit && !bIsLeadSuit) return 1;  // a is lead suit, b is not
    if (!aIsLeadSuit && bIsLeadSuit) return -1; // b is lead suit, a is not
    // Both are lead suit or both are off-suit - compare ranks
  }

  // Both trump or both lead suit (or both off-suit) - compare ranks
  const aRank = getCardRank(a.rank, aIsTrump);
  const bRank = getCardRank(b.rank, bIsTrump);

  if (aRank !== bRank) return aRank - bRank;

  // Same rank - same suit (for trump comparison)
  return 0;
}

export function determineTrickWinner(
  playedCards: Array<{ playerId: string; card: Card }>,
  trumpSuit: Suit
): { winnerId: string; winningCard: Card } {
  if (playedCards.length === 0) {
    throw new Error('Cannot determine winner of empty trick');
  }

  const leadSuit = playedCards[0].card.suit;

  // Find highest card
  let winner = playedCards[0];

  for (let i = 1; i < playedCards.length; i++) {
    const comparison = compareCards(
      playedCards[i].card,
      winner.card,
      trumpSuit,
      leadSuit
    );
    if (comparison > 0) {
      winner = playedCards[i];
    }
  }

  return { winnerId: winner.playerId, winningCard: winner.card };
}

// ============================================================
// SCORING RULES
// ============================================================

/**
 * Rule 6: Hand scores
 * - Points = number of tricks won
 * - Bonus: +10 points IF tricks taken equals made bet
 * - Bonus is awarded EXACTLY (not per trick over)
 */

export interface HandScoreContext {
  playerId: string;
  bet: number;
  tricksWon: number;
}

export function calculateHandScore(context: HandScoreContext): { points: number; bonus: number } {
  const { bet, tricksWon } = context;

  const points = tricksWon;
  const bonus = tricksWon === bet ? 10 : 0;

  return { points, bonus };
}

/**
 * Rule 7: Game winner determination
 * - Primary: Highest cumulative score
 * - Tiebreaker: Highest cumulative bonus count
 */

export interface GameScoreContext {
  playerId: string;
  totalScore: number;
  totalBonus: number;
}

export function determineWinner(scores: GameScoreContext[]): GameScoreContext {
  // Sort by score (descending), then by bonus (descending)
  const sorted = [...scores].sort((a, b) => {
    if (b.totalScore !== a.totalScore) {
      return b.totalScore - a.totalScore;
    }
    return b.totalBonus - a.totalBonus;
  });

  return sorted[0];
}

// ============================================================
// DECK AND DEALING
// ============================================================

/**
 * Create a full deck of cards (ranks 2 through A, all suits)
 * Total: 52 cards (13 ranks × 4 suits)
 */
export function createDeck(): Card[] {
  const suits: Exclude<Suit, 'notrump'>[] = ['diamonds', 'hearts', 'clubs', 'spades'];
  const ranks: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A'];

  const deck: Card[] = [];
  let id = 0;

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ id: `${suit}-${rank}-${id++}`, suit, rank });
    }
  }

  return deck;
}

/**
 * Shuffle deck using Fisher-Yates algorithm
 */
export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Deal cards to players
 */
export function dealCards(deck: Card[], playerCount: number, cardsPerPlayer: number, trumpSuit: Suit = 'notrump'): Map<string, Card[]> {
  const hands = new Map<string, Card[]>();
  const playerIds = Array.from({ length: playerCount }, (_, i) => `player-${i}`);

  for (const playerId of playerIds) {
    hands.set(playerId, []);
  }

  // Deal cards one at a time to each player
  let cardIndex = 0;
  for (let i = 0; i < cardsPerPlayer; i++) {
    for (const playerId of playerIds) {
      if (cardIndex < deck.length) {
        hands.get(playerId)!.push(deck[cardIndex++]);
      }
    }
  }

  // Sort each player's hand with trump suit for proper ordering
  for (const playerId of playerIds) {
    const hand = hands.get(playerId)!;
    hands.set(playerId, sortHand(hand, trumpSuit));
  }

  return hands;
}

/**
 * Sort a hand of cards by suit and value
 * - Trump suit first (on left)
 * - Within each suit: higher cards on left, lower on right
 * - Jack and 9 of trump are highest (always on left)
 */
export function sortHand(hand: Card[], trumpSuit: Suit = 'notrump'): Card[] {
  const suitOrder: Exclude<Suit, 'notrump'>[] = ['clubs', 'spades', 'hearts', 'diamonds'];

  return [...hand].sort((a, b) => {
    const aIsTrump = trumpSuit !== 'notrump' && a.suit === trumpSuit;
    const bIsTrump = trumpSuit !== 'notrump' && b.suit === trumpSuit;

    // Trump suit always comes first (on left)
    if (aIsTrump && !bIsTrump) return -1;
    if (!aIsTrump && bIsTrump) return 1;

    // Same suit (both trump or both non-trump) - sort by rank (higher on left)
    if (a.suit === b.suit) {
      const aRank = getCardRank(a.rank, aIsTrump);
      const bRank = getCardRank(b.rank, bIsTrump);
      return bRank - aRank; // Descending (higher on left)
    }

    // Different non-trump suits - sort by suit order
    return suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
  });
}

// ============================================================
// GAME STATE TRANSITIONS
// ============================================================

export type GamePhase = 'lobby' | 'betting' | 'playing' | 'scoring' | 'finished';

export interface GameState {
  phase: GamePhase;
  handNumber: number;
  totalHands: number;
  playerCount: number;
  players: Player[];
  currentPlayerIndex: number;
  startingPlayerIndex: number;
  trumpSuit: Suit;
  cardsPerPlayer: number;
  hands: Map<string, Card[]>;
  bets: Map<string, number>;
  currentTrick: Array<{ playerId: string; card: Card }>;
  tricksWon: Map<string, number>;
  scores: Map<string, number>;
  bonuses: Map<string, number>;
}

/**
 * Get next player index (counterclockwise)
 */
export function getNextPlayerIndex(currentIndex: number, playerCount: number): number {
  return (currentIndex + playerCount - 1) % playerCount;
}

/**
 * Check if hand is complete
 */
export function isHandComplete(state: GameState): boolean {
  return Array.from(state.hands.values()).every(hand => hand.length === 0);
}

/**
 * Check if game is complete
 */
export function isGameComplete(state: GameState): boolean {
  return state.handNumber > state.totalHands;
}
