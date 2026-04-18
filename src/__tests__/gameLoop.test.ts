/**
 * Full game loop simulation test
 *
 * Simulates a complete Nägels game from start to finish using only
 * the pure game logic from rules.ts (no React, no Zustand, no mocks).
 *
 * Specifically validates the hand 4→5 transition (first notrump hand)
 * which was causing a freeze in the UI.
 */

import {
  createDeck,
  shuffleDeck,
  dealCards,
  getMaxCards,
  getTotalHands,
  getHandCards,
  getTrumpForHand,
  getAllowedBets,
  getPlayableCards,
  determineTrickWinner,
  calculateHandScore,
  getNextPlayerIndex,
  type Suit,
  type Card,
} from '../game/rules';

// ---------------------------------------------------------------------------
// Minimal game state type (mirrors gameStore without React/Zustand)
// ---------------------------------------------------------------------------

interface SimPlayer {
  id: string;
  hand: Card[];
  bet: number | null;
  tricksWon: number;
  score: number;
  bonus: number;
}

interface SimState {
  handNumber: number;
  totalHands: number;
  maxCards: number;
  cardsPerPlayer: number;
  trumpSuit: Suit;
  startingPlayerIndex: number;
  players: SimPlayer[];
  phase: 'lobby' | 'betting' | 'playing' | 'scoring' | 'finished';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initSim(playerCount: number): SimState {
  const maxCards = getMaxCards(playerCount);
  return {
    handNumber: 1,
    totalHands: getTotalHands(maxCards),
    maxCards,
    cardsPerPlayer: getHandCards(1, maxCards),
    trumpSuit: getTrumpForHand(1),
    startingPlayerIndex: 0,
    players: Array.from({ length: playerCount }, (_, i) => ({
      id: `player-${i}`,
      hand: [],
      bet: null,
      tricksWon: 0,
      score: 0,
      bonus: 0,
    })),
    phase: 'lobby',
  };
}

function dealHand(state: SimState): SimState {
  const deck = shuffleDeck(createDeck());
  const hands = dealCards(deck, state.players.length, state.cardsPerPlayer, state.trumpSuit);
  return {
    ...state,
    phase: 'betting',
    players: state.players.map(p => ({
      ...p,
      hand: hands.get(p.id) || [],
      bet: null,
      tricksWon: 0,
    })),
  };
}

/** Place bets: last player forbidden from equalising total to cardsPerPlayer */
function placeBets(state: SimState): SimState {
  let players = [...state.players];
  const n = players.length;

  for (let i = 0; i < n; i++) {
    const idx = (state.startingPlayerIndex + (n - 1) * i) % n; // counterclockwise
    const placedBets = players
      .filter(p => p.bet !== null)
      .map(p => ({ playerId: p.id, amount: p.bet! }));

    const isLast = placedBets.length === n - 1;
    const allowed = getAllowedBets({
      playerCount: n,
      cardsPerPlayer: state.cardsPerPlayer,
      currentBets: placedBets,
      isLastPlayer: isLast,
    });

    expect(allowed.length).toBeGreaterThan(0);

    // Simple strategy: bet the midpoint of allowed bets
    const bet = allowed[Math.floor(allowed.length / 2)];
    players = players.map((p, j) => (j === idx ? { ...p, bet } : p));
  }

  return { ...state, phase: 'playing', players };
}

/** Play a single trick, return updated state */
function playTrick(state: SimState, leadIndex: number): { state: SimState; winnerIndex: number } {
  const n = state.players.length;
  const played: Array<{ playerId: string; card: Card }> = [];
  let players = [...state.players];

  for (let i = 0; i < n; i++) {
    const idx = (leadIndex + (n - 1) * i) % n; // counterclockwise
    const player = players[idx];
    const leadCard = played[0]?.card ?? null;

    const playable = getPlayableCards(player.hand, {
      leadCard,
      trumpSuit: state.trumpSuit,
      playedCards: played,
    });

    expect(playable.length).toBeGreaterThan(0);

    // Play the first legal card (deterministic)
    const card = playable[0];
    played.push({ playerId: player.id, card });
    players = players.map((p, j) =>
      j === idx ? { ...p, hand: p.hand.filter(c => c.id !== card.id) } : p
    );
  }

  const { winnerId } = determineTrickWinner(played, state.trumpSuit);
  const winnerIndex = players.findIndex(p => p.id === winnerId);

  players = players.map(p =>
    p.id === winnerId ? { ...p, tricksWon: p.tricksWon + 1 } : p
  );

  return { state: { ...state, players }, winnerIndex };
}

/** Score the hand and transition to next */
function scoreHand(state: SimState): SimState {
  const players = state.players.map(p => {
    const { points, bonus } = calculateHandScore({
      playerId: p.id,
      bet: p.bet ?? 0,
      tricksWon: p.tricksWon,
    });
    return { ...p, score: p.score + points, bonus: p.bonus + bonus };
  });

  if (state.handNumber >= state.totalHands) {
    return { ...state, players, phase: 'finished' };
  }

  const nextHand = state.handNumber + 1;
  const nextCards = getHandCards(nextHand, state.maxCards);
  const nextTrump = getTrumpForHand(nextHand);
  const nextStart = (state.startingPlayerIndex + state.players.length - 1) % state.players.length;

  return {
    ...state,
    phase: 'lobby',
    handNumber: nextHand,
    cardsPerPlayer: nextCards,
    trumpSuit: nextTrump,
    startingPlayerIndex: nextStart,
    players: players.map(p => ({ ...p, hand: [], bet: null, tricksWon: 0 })),
  };
}

/** Simulate one full hand: deal → bet → play all tricks → score */
function simulateHand(state: SimState): SimState {
  // Deal
  state = dealHand(state);

  // Bet
  state = placeBets(state);

  // Play all tricks
  let leadIndex = state.startingPlayerIndex;
  for (let trick = 0; trick < state.cardsPerPlayer; trick++) {
    const result = playTrick(state, leadIndex);
    state = result.state;
    leadIndex = result.winnerIndex;
  }

  // Verify all hands are empty after playing
  state.players.forEach(p => {
    expect(p.hand.length).toBe(0);
  });

  // Score
  state = scoreHand(state);
  return state;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getHandCards / getTrumpForHand', () => {
  test('hand sequence for 4 players is 10→1→1→10 (20 hands)', () => {
    const maxCards = getMaxCards(4);
    expect(maxCards).toBe(10);
    expect(getTotalHands(10)).toBe(20);

    const sequence = Array.from({ length: 20 }, (_, i) => getHandCards(i + 1, 10));
    expect(sequence).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('hand 5 is always notrump regardless of player count', () => {
    for (let n = 2; n <= 6; n++) {
      expect(getTrumpForHand(5)).toBe('notrump');
    }
  });

  test('trump rotation is diamonds→hearts→clubs→spades→notrump→...', () => {
    const expected: Suit[] = ['diamonds', 'hearts', 'clubs', 'spades', 'notrump'];
    for (let i = 0; i < 10; i++) {
      expect(getTrumpForHand(i + 1)).toBe(expected[i % 5]);
    }
  });
});

// ---------------------------------------------------------------------------
// Player count selection
//
// By default all valid player counts (2–7) are tested.
// To run for a specific count only, set the PLAYER_COUNT env variable:
//
//   PLAYER_COUNT=5 npx jest gameLoop
//   PLAYER_COUNT=7 npx jest gameLoop
// ---------------------------------------------------------------------------

const ALL_PLAYER_COUNTS = [2, 3, 4, 5, 6, 7] as const;

const envCount = process.env.PLAYER_COUNT ? parseInt(process.env.PLAYER_COUNT, 10) : null;

if (envCount !== null && !ALL_PLAYER_COUNTS.includes(envCount as any)) {
  throw new Error(`PLAYER_COUNT must be one of ${ALL_PLAYER_COUNTS.join(', ')}, got: ${envCount}`);
}

const playerCountsToTest: number[] = envCount !== null ? [envCount] : [...ALL_PLAYER_COUNTS];

// Pre-compute expected totals for each player count:
// 2-5 players → maxCards=10, totalHands=20
// 6 players   → maxCards=8,  totalHands=16
// 7 players   → maxCards=7,  totalHands=14
const expectedTotals: Record<number, { maxCards: number; totalHands: number }> = Object.fromEntries(
  ALL_PLAYER_COUNTS.map(n => {
    const mc = getMaxCards(n);
    return [n, { maxCards: mc, totalHands: getTotalHands(mc) }];
  })
);

describe('Full game simulation', () => {
  test.each(playerCountsToTest.map(n => [n]))(
    '%d-player game completes all hands without hanging',
    (playerCount) => {
      const { maxCards, totalHands } = expectedTotals[playerCount];
      expect(getMaxCards(playerCount)).toBe(maxCards);
      expect(getTotalHands(maxCards)).toBe(totalHands);

      let state = initSim(playerCount);
      while (state.phase !== 'finished') {
        state = simulateHand(state);
      }

      expect(state.handNumber).toBe(totalHands);
      state.players.forEach(p => {
        expect(p.score).toBeGreaterThanOrEqual(0);
      });
    }
  );

  test('hand 4→5 (spades→notrump) transition produces valid game state (4 players)', () => {
    let state = initSim(4);

    // Fast-forward to hand 4
    for (let h = 1; h <= 4; h++) {
      state = simulateHand(state);
    }

    expect(state.handNumber).toBe(5);
    expect(state.trumpSuit).toBe('notrump');
    expect(state.phase).toBe('lobby');
    expect(state.cardsPerPlayer).toBe(6); // hand 5 = 10-5+1 = 6 cards

    // Hand 5 (notrump) must deal and play without errors
    state = dealHand(state);
    expect(state.phase).toBe('betting');
    state.players.forEach(p => {
      expect(p.hand.length).toBe(6);
    });

    state = placeBets(state);
    expect(state.phase).toBe('playing');

    // Play all 6 tricks of hand 5
    let leadIndex = state.startingPlayerIndex;
    for (let trick = 0; trick < 6; trick++) {
      const result = playTrick(state, leadIndex);
      state = result.state;
      leadIndex = result.winnerIndex;
    }

    state.players.forEach(p => expect(p.hand.length).toBe(0));
  });

  test.each(playerCountsToTest.map(n => [n]))(
    'bets never produce invalid sum — last player rule (%d players)',
    (playerCount) => {
      const { totalHands } = expectedTotals[playerCount];
      let state = initSim(playerCount);
      const violations: string[] = [];

      for (let h = 1; h <= totalHands; h++) {
        state = dealHand(state);
        state = placeBets(state);

        const totalBets = state.players.reduce((s, p) => s + (p.bet ?? 0), 0);
        if (totalBets === state.cardsPerPlayer) {
          violations.push(`Hand ${h}: bets sum to ${totalBets} = cardsPerPlayer`);
        }

        // Score without playing (just testing bet constraint)
        state = scoreHand(state);
      }

      expect(violations).toEqual([]);
    }
  );
});
