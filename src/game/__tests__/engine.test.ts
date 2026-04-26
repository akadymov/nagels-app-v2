/**
 * Nagels Online - Pure Game Engine Tests
 *
 * Tests for src/game/engine.ts — the stateless, pure game engine.
 */

import {
  initGame,
  applyAction,
  ServerGameState,
  GameAction,
} from '../engine';
import {
  getNextPlayerIndex,
  getHandCards,
  getTrumpForHand,
  getMaxCards,
  getTotalHands,
} from '../rules';

// ============================================================
// HELPERS
// ============================================================

const PLAYERS_4 = [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Charlie' },
  { id: 'p4', name: 'Diana' },
];

const ROOM_ID = 'test-room-42';

/** Create a fresh 4-player game starting at player index 0. */
function freshGame(startIndex = 0): ServerGameState {
  return initGame(PLAYERS_4, ROOM_ID, startIndex);
}

/** Place all bets, starting from the current bettingPlayerIndex, cycling counterclockwise.
 *  Returns the state after all bets. Each player bets 0 except the last player
 *  who bets 1 (to satisfy the "total bets != cardsPerPlayer" rule on the first hand
 *  where cardsPerPlayer = 10 and 4 players each betting 0 would sum to 0 but
 *  cardsPerPlayer = 10, so sum=0 != 10 => valid. We use explicit bets for clarity.)
 */
function placeAllBets(state: ServerGameState, bets?: number[]): ServerGameState {
  const playerCount = state.playerCount;

  // Default: everyone bets 0 (for most hand sizes sum of 0s != cardsPerPlayer, which is valid)
  // But for the hand with 1 card and 4 players, 0+0+0+0 = 0 != 1, so last player CAN bet 0.
  // We need to be careful: last player can't make total = cardsPerPlayer.
  // If cardsPerPlayer = 4*0 = 0, but cardsPerPlayer >= 1, so always fine.
  // Actually: 0+0+0 = 0 for 3 bets, last player can't bet cardsPerPlayer - 0 = cardsPerPlayer.
  // So if cardsPerPlayer > 0, betting 0 for everyone is always valid IF sum(0) != cardsPerPlayer,
  // which is true since cardsPerPlayer >= 1.

  let currentState = state;

  for (let i = 0; i < playerCount; i++) {
    const bettingPlayer = currentState.players[currentState.bettingPlayerIndex];
    const bet = bets ? bets[i] : 0;

    const action: GameAction = {
      type: 'place_bet',
      playerId: bettingPlayer.id,
      data: { bet },
    };

    const result = applyAction(currentState, action);
    if (!result.success) {
      throw new Error(`Failed to place bet for ${bettingPlayer.name}: ${result.error}`);
    }
    currentState = result.state;
  }

  return currentState;
}

/** Play cards by extracting the first playable card from each player's hand, cycling through
 *  all players for one trick. Returns state after the trick. */
function playOneTrick(state: ServerGameState): ServerGameState {
  let currentState = state;
  const playerCount = state.playerCount;

  for (let i = 0; i < playerCount; i++) {
    const currentPlayer = currentState.players[currentState.currentPlayerIndex];
    // Pick the first card from hand (it will be playable if leading, and we accept
    // rule-engine rejections for non-playable cards by trying each card).
    let played = false;
    for (const card of currentPlayer.hand) {
      const action: GameAction = {
        type: 'play_card',
        playerId: currentPlayer.id,
        data: { cardId: card.id },
      };
      const result = applyAction(currentState, action);
      if (result.success) {
        currentState = result.state;
        played = true;
        break;
      }
    }
    if (!played) {
      throw new Error(`Could not play any card for ${currentPlayer.name}`);
    }
  }

  return currentState;
}

// ============================================================
// TESTS
// ============================================================

describe('initGame', () => {
  it('creates a game in betting phase with correct cards dealt', () => {
    const state = freshGame(0);

    expect(state.phase).toBe('betting');
    expect(state.handNumber).toBe(1);
    expect(state.playerCount).toBe(4);
    expect(state.totalHands).toBe(getTotalHands(getMaxCards(4)));
    expect(state.trumpSuit).toBe(getTrumpForHand(1));
    expect(state.cardsPerPlayer).toBe(getHandCards(1, getMaxCards(4)));

    // Each player should have the correct number of cards
    for (const player of state.players) {
      expect(player.hand.length).toBe(state.cardsPerPlayer);
      expect(player.bet).toBeNull();
      expect(player.tricksWon).toBe(0);
      expect(player.score).toBe(0);
      expect(player.bonus).toBe(0);
    }
  });

  it('deals deterministic cards for the same roomId and hand', () => {
    const state1 = initGame(PLAYERS_4, ROOM_ID, 0);
    const state2 = initGame(PLAYERS_4, ROOM_ID, 0);

    for (let i = 0; i < PLAYERS_4.length; i++) {
      const hand1Ids = state1.players[i].hand.map(c => c.id);
      const hand2Ids = state2.players[i].hand.map(c => c.id);
      expect(hand1Ids).toEqual(hand2Ids);
    }
  });

  it('deals different cards for different roomIds', () => {
    const state1 = initGame(PLAYERS_4, 'room-A', 0);
    const state2 = initGame(PLAYERS_4, 'room-B', 0);

    const hand1Ids = state1.players[0].hand.map(c => c.id);
    const hand2Ids = state2.players[0].hand.map(c => c.id);
    expect(hand1Ids).not.toEqual(hand2Ids);
  });

  it('sets starting/betting player index correctly', () => {
    const state = freshGame(2);
    expect(state.startingPlayerIndex).toBe(2);
    expect(state.bettingPlayerIndex).toBe(2);
    expect(state.currentPlayerIndex).toBe(2);
    expect(state.firstHandStartingPlayerIndex).toBe(2);
  });
});

describe('place_bet', () => {
  it('validates turn order - rejects wrong player', () => {
    const state = freshGame(0);
    const wrongPlayer = state.players[1]; // Not the betting player

    const result = applyAction(state, {
      type: 'place_bet',
      playerId: wrongPlayer.id,
      data: { bet: 1 },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('turn');
  });

  it('rejects bet when not in betting phase', () => {
    const state = freshGame(0);
    const playingState = { ...state, phase: 'playing' as const };

    const result = applyAction(playingState, {
      type: 'place_bet',
      playerId: state.players[0].id,
      data: { bet: 1 },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('betting phase');
  });

  it('advances bettingPlayerIndex counterclockwise after each bet', () => {
    let state = freshGame(0);
    const firstBetter = state.players[state.bettingPlayerIndex];

    const result = applyAction(state, {
      type: 'place_bet',
      playerId: firstBetter.id,
      data: { bet: 1 },
    });

    expect(result.success).toBe(true);
    const expectedNext = getNextPlayerIndex(0, 4);
    expect(result.state.bettingPlayerIndex).toBe(expectedNext);
  });

  it('records the bet on the player', () => {
    let state = freshGame(0);
    const bettingPlayer = state.players[state.bettingPlayerIndex];

    const result = applyAction(state, {
      type: 'place_bet',
      playerId: bettingPlayer.id,
      data: { bet: 3 },
    });

    expect(result.success).toBe(true);
    const updatedPlayer = result.state.players.find(p => p.id === bettingPlayer.id);
    expect(updatedPlayer!.bet).toBe(3);
  });

  it('rejects invalid bet for last player (sum cannot equal cardsPerPlayer)', () => {
    let state = freshGame(0);

    // Place bets for first 3 players (0 each)
    for (let i = 0; i < 3; i++) {
      const bettingPlayer = state.players[state.bettingPlayerIndex];
      const result = applyAction(state, {
        type: 'place_bet',
        playerId: bettingPlayer.id,
        data: { bet: 0 },
      });
      expect(result.success).toBe(true);
      state = result.state;
    }

    // Last player: sum so far is 0, cardsPerPlayer = 10
    // Betting 10 would make sum = 10 = cardsPerPlayer, which is forbidden
    const lastBetter = state.players[state.bettingPlayerIndex];
    const result = applyAction(state, {
      type: 'place_bet',
      playerId: lastBetter.id,
      data: { bet: 10 },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid bet');
  });
});

describe('all bets placed -> auto-transition to playing', () => {
  it('transitions to playing phase when all bets are placed', () => {
    let state = freshGame(0);
    state = placeAllBets(state);

    expect(state.phase).toBe('playing');
    expect(state.hasAllBets).toBe(true);
    expect(state.currentPlayerIndex).toBe(state.startingPlayerIndex);
    expect(state.currentTrick).not.toBeNull();
    expect(state.currentTrick!.cards).toHaveLength(0);
  });
});

describe('play_card', () => {
  it('validates turn order - rejects wrong player', () => {
    let state = freshGame(0);
    state = placeAllBets(state);

    // Try to play from a player who is NOT at currentPlayerIndex
    const wrongIndex = (state.currentPlayerIndex + 1) % state.playerCount;
    const wrongPlayer = state.players[wrongIndex];

    const result = applyAction(state, {
      type: 'play_card',
      playerId: wrongPlayer.id,
      data: { cardId: wrongPlayer.hand[0].id },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('turn');
  });

  it('rejects card not in hand', () => {
    let state = freshGame(0);
    state = placeAllBets(state);

    const currentPlayer = state.players[state.currentPlayerIndex];
    const result = applyAction(state, {
      type: 'play_card',
      playerId: currentPlayer.id,
      data: { cardId: 'nonexistent-card-id' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not in player');
  });

  it('removes card from hand and adds to trick', () => {
    let state = freshGame(0);
    state = placeAllBets(state);

    const currentPlayer = state.players[state.currentPlayerIndex];
    const cardToPlay = currentPlayer.hand[0];
    const handSizeBefore = currentPlayer.hand.length;

    const result = applyAction(state, {
      type: 'play_card',
      playerId: currentPlayer.id,
      data: { cardId: cardToPlay.id },
    });

    expect(result.success).toBe(true);
    const updatedPlayer = result.state.players.find(p => p.id === currentPlayer.id);
    expect(updatedPlayer!.hand.length).toBe(handSizeBefore - 1);
    expect(updatedPlayer!.hand.find(c => c.id === cardToPlay.id)).toBeUndefined();
    expect(result.state.currentTrick!.cards).toHaveLength(1);
    expect(result.state.currentTrick!.cards[0].card.id).toBe(cardToPlay.id);
  });

  it('advances to next player after playing a card', () => {
    let state = freshGame(0);
    state = placeAllBets(state);

    const currentIdx = state.currentPlayerIndex;
    const currentPlayer = state.players[currentIdx];

    const result = applyAction(state, {
      type: 'play_card',
      playerId: currentPlayer.id,
      data: { cardId: currentPlayer.hand[0].id },
    });

    expect(result.success).toBe(true);
    expect(result.state.currentPlayerIndex).toBe(
      getNextPlayerIndex(currentIdx, state.playerCount)
    );
  });
});

describe('complete trick', () => {
  it('determines winner and increments tricksWon when trick completes', () => {
    let state = freshGame(0);
    state = placeAllBets(state);

    // Play one full trick (4 cards)
    state = playOneTrick(state);

    // After a completed trick, currentTrick should be null (archived)
    // and one player should have tricksWon = 1
    // The state could be in 'playing' (more tricks) or 'scoring' (hand done)
    const totalTricksWon = state.players.reduce((sum, p) => sum + p.tricksWon, 0);
    expect(totalTricksWon).toBe(1);
    expect(state.tricks.length).toBeGreaterThanOrEqual(1);
  });

  it('sets winner as next trick leader', () => {
    let state = freshGame(0);
    state = placeAllBets(state);

    state = playOneTrick(state);

    // If still in playing phase, currentPlayerIndex should be the trick winner
    if (state.phase === 'playing') {
      const lastTrick = state.tricks[state.tricks.length - 1];
      const winnerIndex = state.players.findIndex(p => p.id === lastTrick.winnerId);
      expect(state.currentPlayerIndex).toBe(winnerIndex);
    }
  });
});

describe('complete hand -> scoring', () => {
  it('transitions to scoring after all tricks in a hand', () => {
    let state = freshGame(0);
    state = placeAllBets(state);

    // Play all tricks for this hand
    const tricksToPlay = state.cardsPerPlayer;
    for (let t = 0; t < tricksToPlay; t++) {
      state = playOneTrick(state);
    }

    expect(state.phase).toBe('scoring');

    // Score history should have an entry
    expect(state.scoreHistory.length).toBe(1);
    expect(state.scoreHistory[0].handNumber).toBe(1);

    // Total tricksWon should equal cardsPerPlayer (each trick won by someone)
    const totalTricksWon = state.players.reduce((sum, p) => sum + p.tricksWon, 0);
    expect(totalTricksWon).toBe(tricksToPlay);
  });

  it('calculates scores correctly (exact bet = 10 + tricks, otherwise just tricks)', () => {
    let state = freshGame(0);
    // All bet 0, so players who win 0 tricks get bonus 10
    state = placeAllBets(state);

    const tricksToPlay = state.cardsPerPlayer;
    for (let t = 0; t < tricksToPlay; t++) {
      state = playOneTrick(state);
    }

    expect(state.phase).toBe('scoring');

    // Each player bet 0. Players with 0 tricks won get bonus 10.
    // Players with >0 tricks get their trick count as points but no bonus.
    for (const player of state.players) {
      const result = state.scoreHistory[0].results.find(r => r.playerId === player.id)!;
      if (result.tricksWon === 0) {
        expect(result.bonus).toBe(10);
        expect(result.points).toBe(0);
      } else {
        expect(result.bonus).toBe(0);
        expect(result.points).toBe(result.tricksWon);
      }
    }
  });
});

describe('continue_hand', () => {
  it('deals new cards and advances hand number', () => {
    let state = freshGame(0);
    state = placeAllBets(state);

    // Complete hand 1
    for (let t = 0; t < state.cardsPerPlayer; t++) {
      state = playOneTrick(state);
    }
    expect(state.phase).toBe('scoring');

    // Continue to hand 2
    const result = applyAction(state, {
      type: 'continue_hand',
      playerId: state.players[0].id,
    });

    expect(result.success).toBe(true);
    expect(result.state.phase).toBe('betting');
    expect(result.state.handNumber).toBe(2);
    expect(result.state.cardsPerPlayer).toBe(getHandCards(2, state.maxCardsPerPlayer));
    expect(result.state.trumpSuit).toBe(getTrumpForHand(2));

    // All players should have new hands
    for (const player of result.state.players) {
      expect(player.hand.length).toBe(result.state.cardsPerPlayer);
      expect(player.bet).toBeNull();
      expect(player.tricksWon).toBe(0);
    }

    // Scores from hand 1 should persist
    const totalScore = result.state.players.reduce((sum, p) => sum + p.score + p.bonus, 0);
    expect(totalScore).toBeGreaterThan(0);
  });

  it('rotates starting player counterclockwise', () => {
    let state = freshGame(0);
    const hand1Starter = state.startingPlayerIndex;

    state = placeAllBets(state);
    for (let t = 0; t < state.cardsPerPlayer; t++) {
      state = playOneTrick(state);
    }

    const result = applyAction(state, {
      type: 'continue_hand',
      playerId: state.players[0].id,
    });

    expect(result.success).toBe(true);
    // Hand 2 starting player should be counterclockwise from hand 1
    const expectedStarter = ((hand1Starter - 1) % 4 + 4) % 4;
    expect(result.state.startingPlayerIndex).toBe(expectedStarter);
  });

  it('rejects continue_hand when not in scoring phase', () => {
    const state = freshGame(0);
    const result = applyAction(state, {
      type: 'continue_hand',
      playerId: state.players[0].id,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('scoring phase');
  });
});

describe('last hand leads to finished', () => {
  it('transitions to finished after the last hand', () => {
    // Use 2 players to make the game shorter (maxCards = 26, totalHands = 52... too many)
    // Actually, let's just simulate by creating a state at the last hand.
    const players2 = [
      { id: 'p1', name: 'Alice' },
      { id: 'p2', name: 'Bob' },
    ];

    let state = initGame(players2, ROOM_ID, 0);
    const totalHands = state.totalHands;

    // Fast-forward: set handNumber to totalHands and phase to scoring
    // to test that continue_hand correctly transitions to finished.
    const lastHandState: ServerGameState = {
      ...state,
      phase: 'scoring',
      handNumber: totalHands,
    };

    const result = applyAction(lastHandState, {
      type: 'continue_hand',
      playerId: 'p1',
    });

    expect(result.success).toBe(true);
    expect(result.state.phase).toBe('finished');
  });
});

describe('full game flow (2 hands)', () => {
  it('plays through 2 consecutive hands correctly', () => {
    let state = freshGame(0);

    for (let hand = 1; hand <= 2; hand++) {
      expect(state.phase).toBe('betting');
      expect(state.handNumber).toBe(hand);

      // Place bets
      state = placeAllBets(state);
      expect(state.phase).toBe('playing');

      // Play all tricks
      for (let t = 0; t < state.cardsPerPlayer; t++) {
        state = playOneTrick(state);
      }
      expect(state.phase).toBe('scoring');
      expect(state.scoreHistory.length).toBe(hand);

      // Continue to next hand (or verify scoring on last)
      if (hand < 2) {
        const result = applyAction(state, {
          type: 'continue_hand',
          playerId: state.players[0].id,
        });
        expect(result.success).toBe(true);
        state = result.state;
      }
    }

    // After 2 hands, we should have 2 score history entries
    expect(state.scoreHistory.length).toBe(2);

    // Total tricks won across both hands should be correct
    const totalTricks = state.scoreHistory.reduce(
      (sum, hr) => sum + hr.results.reduce((s, r) => s + r.tricksWon, 0),
      0
    );
    const expectedTricks = getHandCards(1, state.maxCardsPerPlayer)
      + getHandCards(2, state.maxCardsPerPlayer);
    expect(totalTricks).toBe(expectedTricks);
  });
});

describe('edge cases', () => {
  it('works with 2 players', () => {
    const players2 = [
      { id: 'p1', name: 'Alice' },
      { id: 'p2', name: 'Bob' },
    ];
    const state = initGame(players2, 'room-2p', 0);
    expect(state.phase).toBe('betting');
    expect(state.playerCount).toBe(2);
    expect(state.players[0].hand.length).toBe(state.cardsPerPlayer);
    expect(state.players[1].hand.length).toBe(state.cardsPerPlayer);
  });

  it('works with 6 players', () => {
    const players6 = [
      { id: 'p1', name: 'A' },
      { id: 'p2', name: 'B' },
      { id: 'p3', name: 'C' },
      { id: 'p4', name: 'D' },
      { id: 'p5', name: 'E' },
      { id: 'p6', name: 'F' },
    ];
    const state = initGame(players6, 'room-6p', 0);
    expect(state.phase).toBe('betting');
    expect(state.playerCount).toBe(6);
    expect(state.maxCardsPerPlayer).toBe(getMaxCards(6));
    for (const p of state.players) {
      expect(p.hand.length).toBe(state.cardsPerPlayer);
    }
  });

  it('no duplicate cards across all player hands', () => {
    const state = freshGame(0);
    const allCardIds = state.players.flatMap(p => p.hand.map(c => c.id));
    const unique = new Set(allCardIds);
    expect(unique.size).toBe(allCardIds.length);
  });
});
