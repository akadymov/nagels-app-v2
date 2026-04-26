/**
 * Nägels Online - Game State Management (Zustand)
 *
 * Central store for all game state with actions following Nägels rules.
 */

import { create } from 'zustand';
import {
  Card,
  Player,
  Suit,
  GamePhase,
  createDeck,
  shuffleDeck,
  dealCards,
  getMaxCards,
  getTotalHands,
  getHandCards,
  getTrumpForHand,
  getStartingPlayer,
  getAllowedBets,
  isValidBet,
  getPlayableCards,
  isCardPlayable,
  determineTrickWinner,
  calculateHandScore,
  getNextPlayerIndex,
  isHandComplete,
  isGameComplete,
  getCardRank,
  isTrump,
  type Bet,
  type BettingContext,
  type PlayContext,
  sortHand,
} from '../game';
import { multiplayerPlaceBet, multiplayerPlayCard } from '../lib/multiplayer/gameActions';
import { seededShuffle, createSeededRandom } from '../lib/multiplayer/seededRandom';
import { useMultiplayerStore } from './multiplayerStore';
import { trickWonHaptic } from '../utils/haptics';
import { getBotStrategy, type BotDifficulty, type BettingContext as BotBettingContext, type PlayingContext as BotPlayingContext } from '../lib/bot/botAI';

// ============================================================
// STORE TYPES
// ============================================================

export interface GamePlayer extends Player {
  score: number;
  bonus: number;
  tricksWon: number;
  bet: number | null;
  hand: Card[];
  isReady: boolean;
}

export interface Trick {
  cards: Array<{ playerId: string; card: Card }>;
  winnerId: string;
  leadSuit: Exclude<Suit, 'notrump'>;
}

export interface HandResult {
  handNumber: number;
  startingPlayerIndex: number;
  results: {
    playerId: string;
    bet: number;
    tricksWon: number;
    points: number;
    bonus: number;
  }[];
}

export interface GameStore {
  // Game info
  phase: GamePhase;
  handNumber: number;
  totalHands: number;
  playerCount: number;
  maxCardsPerPlayer: number;
  cardsPerPlayer: number;

  // Players
  players: GamePlayer[];
  currentPlayerIndex: number;
  startingPlayerIndex: number;
  firstHandStartingPlayerIndex: number; // Track for rotation
  myPlayerId: string | null;

  // Trump & dealing
  trumpSuit: Suit;
  deck: Card[];

  // Betting
  bettingPlayerIndex: number;
  hasAllBets: boolean;

  // Playing
  currentTrick: Trick | null;
  tricks: Trick[];

  // Score history (per round)
  scoreHistory: HandResult[];

  // Multiplayer mode
  isMultiplayer: boolean;

  // Bot difficulty for single-player
  botDifficulty: BotDifficulty;

  // State version (set by server in multiplayer)
  version: number;

  // Actions
  initGame: (players: Omit<Player, 'isBot'>[], myPlayerId: string) => void;
  startBetting: () => void;
  placeBet: (playerId: string, bet: number) => void;
  startPlaying: () => void;
  playCard: (playerId: string, card: Card) => void;
  completeTrick: () => void;
  completeHand: () => void;
  nextHand: () => void;
  endGame: () => void;
  reset: () => void;

  // Getters
  getBettingPlayer: () => GamePlayer | null;
  getCurrentPlayer: () => GamePlayer | null;
  getMyPlayer: () => GamePlayer | null;
  getPlayableCards: (playerId: string) => Card[];
  getAllowedBets: (playerId: string) => number[];
  canPlayCard: (playerId: string, card: Card) => boolean;
  isLastBettingPlayer: () => boolean;
  isBotTurn: () => boolean;

  // Bot actions
  placeBotBet: () => void;
  playBotCard: () => void;

  // Multiplayer sync
  forceRemoteState: (remoteState: Partial<GameStore> & { players: GamePlayer[] }) => void;
  setMultiplayerMode: (isMultiplayer: boolean) => void;
  setBotDifficulty: (difficulty: BotDifficulty) => void;
}

// ============================================================
// INITIAL STATE
// ============================================================

const initialState = {
  phase: 'lobby' as GamePhase,
  handNumber: 1,
  totalHands: 20,
  playerCount: 4,
  maxCardsPerPlayer: 10,
  cardsPerPlayer: 10,

  players: [],
  currentPlayerIndex: 0,
  startingPlayerIndex: 0,
  firstHandStartingPlayerIndex: 0, // For rotation calculation
  myPlayerId: null,

  trumpSuit: 'diamonds' as Suit,
  deck: [],

  bettingPlayerIndex: 0,
  hasAllBets: false,

  currentTrick: null,
  tricks: [],
  scoreHistory: [],

  isMultiplayer: false,

  botDifficulty: 'medium' as BotDifficulty,

  version: 0,
};

// ============================================================
// STORE
// ============================================================

export const useGameStore = create<GameStore>((set, get) => ({
  ...initialState,

  // ============================================================
  // ACTIONS
  // ============================================================

  /**
   * Initialize a new game
   */
  initGame: (players, myPlayerId) => {
    const playerCount = players.length;
    const maxCards = getMaxCards(playerCount);
    const totalHands = getTotalHands(maxCards);

    // Shuffle players for random seating order
    // In multiplayer, use seeded random for consistency across all clients
    let shuffledPlayers: typeof players;
    let randomStartingPlayer: number;

    if (get().isMultiplayer) {
      const multiplayerStore = useMultiplayerStore.getState();
      const roomId = multiplayerStore.currentRoom?.id || 'default';
      const seed = `${roomId}-init`;

      // First sort by ID to ensure all clients have same input order
      const sortedPlayers = [...players].sort((a, b) => a.id.localeCompare(b.id));

      console.log('[GameStore] Using seeded random for multiplayer init:', seed);
      console.log('[GameStore] Players before shuffle:', sortedPlayers.map(p => p.name).join(', '));
      shuffledPlayers = seededShuffle(sortedPlayers, seed);

      // Use seeded random for starting player too
      const random = createSeededRandom(seed + '-starting');
      randomStartingPlayer = Math.floor(random() * playerCount);
    } else {
      shuffledPlayers = [...players].sort(() => Math.random() - 0.5);
      randomStartingPlayer = Math.floor(Math.random() * playerCount);
    }

    const gamePlayers: GamePlayer[] = shuffledPlayers.map((p, i) => ({
      ...p,
      score: 0,
      bonus: 0,
      tricksWon: 0,
      bet: null,
      hand: [],
      isReady: false,
    }));

    console.log('[GameStore] Random seating order:', gamePlayers.map((p, i) => `${i}: ${p.name}`));
    console.log('[GameStore] Random starting player for hand 1:', randomStartingPlayer, `(${gamePlayers[randomStartingPlayer].name})`);

    set({
      phase: 'lobby',
      handNumber: 1,
      totalHands,
      playerCount,
      maxCardsPerPlayer: maxCards,
      cardsPerPlayer: getHandCards(1, maxCards),
      players: gamePlayers,
      currentPlayerIndex: randomStartingPlayer,
      startingPlayerIndex: randomStartingPlayer,
      firstHandStartingPlayerIndex: randomStartingPlayer, // Track for rotation
      myPlayerId,
      trumpSuit: getTrumpForHand(1),
      deck: [],
      bettingPlayerIndex: randomStartingPlayer,
      hasAllBets: false,
      currentTrick: null,
      tricks: [],
    });
  },

  /**
   * Start betting phase for current hand
   */
  startBetting: () => {
    const state = get();
    const { cardsPerPlayer, playerCount, handNumber, trumpSuit, isMultiplayer } = state;

    // Create deck
    const deck = createDeck();

    // Shuffle deck (use seeded random in multiplayer)
    let shuffledDeck: Card[];
    if (isMultiplayer) {
      // Get room ID for seeding
      const multiplayerStore = useMultiplayerStore.getState();
      const roomId = multiplayerStore.currentRoom?.id || 'default';
      const seed = `${roomId}-hand-${handNumber}`;
      console.log('[GameStore] Using seeded random for multiplayer deck:', seed);
      shuffledDeck = seededShuffle(deck, seed);
    } else {
      shuffledDeck = shuffleDeck(deck);
    }

    // Deal cards to players
    // In multiplayer, deal to actual player IDs; otherwise use dealCards helper
    let hands: Map<string, Card[]>;
    if (isMultiplayer) {
      // Deal directly to actual players in their shuffled order
      hands = new Map();
      const playerIds = state.players.map(p => p.id);

      // Initialize empty hands
      for (const playerId of playerIds) {
        hands.set(playerId, []);
      }

      // Deal cards one at a time to each player
      let cardIndex = 0;
      for (let i = 0; i < cardsPerPlayer; i++) {
        for (const playerId of playerIds) {
          if (cardIndex < shuffledDeck.length) {
            hands.get(playerId)!.push(shuffledDeck[cardIndex++]);
          }
        }
      }

      // Sort each player's hand
      for (const playerId of playerIds) {
        const hand = hands.get(playerId)!;
        hands.set(playerId, sortHand(hand, trumpSuit));
      }
    } else {
      // Use dealCards helper for single-player
      hands = dealCards(shuffledDeck, playerCount, cardsPerPlayer, trumpSuit);
    }

    // Update players with their hands
    const updatedPlayers = state.players.map(p => ({
      ...p,
      hand: hands.get(p.id) || [],
      bet: null,
      tricksWon: 0,
      isReady: false,
    }));

    console.log('[GameStore] Starting betting - myPlayerId:', state.myPlayerId, 'hand:', updatedPlayers.find(p => p.id === state.myPlayerId)?.hand.map(c => `${c.rank}${c.suit[0]}`).join(', '));

    set({
      phase: 'betting',
      players: updatedPlayers,
      deck: shuffledDeck,
      bettingPlayerIndex: state.startingPlayerIndex,
      hasAllBets: false,
    });

  },

  /**
   * Place a bet for a player
   */
  placeBet: (playerId, bet) => {
    const state = get();

    if (state.phase !== 'betting') return;

    const bettingPlayerIndex = state.players.findIndex(p => p.id === playerId);
    if (bettingPlayerIndex !== state.bettingPlayerIndex) return;

    // Validate bet
    const currentBets: Bet[] = state.players
      .filter(p => p.bet !== null)
      .map(p => ({ playerId: p.id, amount: p.bet! }));

    const context: BettingContext = {
      playerCount: state.playerCount,
      cardsPerPlayer: state.cardsPerPlayer,
      currentBets,
      isLastPlayer: state.isLastBettingPlayer(),
    };

    if (!isValidBet(bet, context)) return;

    // Update player's bet
    const updatedPlayers = [...state.players];
    updatedPlayers[bettingPlayerIndex] = {
      ...updatedPlayers[bettingPlayerIndex],
      bet,
    };

    // Move to next betting player
    const nextIndex = getNextPlayerIndex(bettingPlayerIndex, state.playerCount);
    const hasAllBets = updatedPlayers.every(p => p.bet !== null);

    // Apply optimistic update locally first
    set({
      players: updatedPlayers,
      bettingPlayerIndex: hasAllBets ? bettingPlayerIndex : nextIndex,
      hasAllBets,
    });

    // In multiplayer mode, also call the Edge Function.
    // The server response (via forceRemoteState in gameActions) will
    // overwrite local state, ensuring server is the source of truth.
    if (state.isMultiplayer && playerId === state.myPlayerId) {
      multiplayerPlaceBet(playerId, bet).catch(err => {
        console.error('[GameStore] Failed to sync bet:', err);
      });
    }
  },

  /**
   * Start playing phase (after all bets are placed)
   */
  startPlaying: () => {
    const state = get();

    if (!state.hasAllBets) return;

    set({
      phase: 'playing',
      currentPlayerIndex: state.startingPlayerIndex,
      currentTrick: {
        cards: [],
        winnerId: '',
        leadSuit: 'diamonds', // Will be set when first card is played
      },
    });
  },

  /**
   * Play a card
   */
  playCard: (playerId, card) => {
    const state = get();

    if (state.phase !== 'playing') return;

    // Block if current trick is already complete (winnerId set, waiting for completeTrick timer).
    // Without this, the player who played the last card of a trick can immediately click
    // another card before the 1500ms timer fires, injecting an extra card into the finished trick.
    if (state.currentTrick?.winnerId) return;

    const playerIndex = state.players.findIndex(p => p.id === playerId);
    if (playerIndex !== state.currentPlayerIndex) return;

    // Check if card is playable
    if (!state.canPlayCard(playerId, card)) return;

    // Capture current state for rollback (before any changes)
    const currentState = {
      players: [...state.players],
      currentTrick: state.currentTrick ? { ...state.currentTrick } : null,
      currentPlayerIndex: state.currentPlayerIndex,
    };

    // Create new trick if needed (after previous trick was completed)
    if (!state.currentTrick) {
      set({
        currentTrick: {
          cards: [],
          winnerId: '',
          leadSuit: card.suit, // Will be set when first card is played
        },
      });
    }

    // Re-get state after potential update
    const updatedState = get();

    // Remove card from player's hand
    const updatedPlayers = [...updatedState.players];
    const player = updatedPlayers[playerIndex];
    updatedPlayers[playerIndex] = {
      ...player,
      hand: player.hand.filter(c => c.id !== card.id),
    };

    // Add to current trick
    const trick = updatedState.currentTrick!;
    const isFirstCard = trick.cards.length === 0;

    const updatedTrick: Trick = {
      ...trick,
      cards: [...trick.cards, { playerId, card }],
      leadSuit: isFirstCard ? card.suit : trick.leadSuit,
    };

    // Check if trick is complete
    const trickComplete = updatedTrick.cards.length === state.playerCount;

    if (trickComplete) {
      // Determine winner
      const { winnerId } = determineTrickWinner(
        updatedTrick.cards,
        state.trumpSuit
      );

      // Apply optimistic update locally first
      set({
        players: updatedPlayers,
        currentTrick: {
          ...updatedTrick,
          winnerId,
        },
      });

      // Schedule completeTrick from the store side (immune to component re-renders)
      setTimeout(() => {
        const s = get();
        if (s.phase === 'playing' && s.currentTrick?.winnerId === winnerId) {
          s.completeTrick();
        }
      }, 1500);
    } else {
      // Move to next player
      const nextIndex = getNextPlayerIndex(state.currentPlayerIndex, state.playerCount);

      // Apply optimistic update locally first
      set({
        players: updatedPlayers,
        currentTrick: updatedTrick,
        currentPlayerIndex: nextIndex,
      });
    }

    // In multiplayer mode, also call the Edge Function.
    // The server response (via forceRemoteState in gameActions) will
    // overwrite local state, ensuring server is the source of truth.
    if (state.isMultiplayer && playerId === state.myPlayerId) {
      multiplayerPlayCard(playerId, card.id).catch(err => {
        console.error('[GameStore] Failed to sync card play:', err);
      });
    }
  },

  /**
   * Complete the current trick (after animation)
   * Also auto-triggers completeHand() if this was the last trick.
   */
  completeTrick: () => {
    const state = get();

    if (!state.currentTrick || !state.currentTrick.winnerId) {
      console.log('[completeTrick] No current trick or winner, returning');
      return;
    }

    const winnerId = state.currentTrick.winnerId;
    const winner = state.players.find(p => p.id === winnerId);
    console.log('[completeTrick] Winner:', winner?.name, 'setting as current player');

    // Haptic feedback if I won the trick
    if (winnerId === state.myPlayerId) {
      trickWonHaptic();
    }

    // Update tricks won for winner
    const updatedPlayers = state.players.map(p => ({
      ...p,
      tricksWon: p.id === winnerId ? p.tricksWon + 1 : p.tricksWon,
    }));

    // Save trick to history
    const winnerIndex = updatedPlayers.findIndex(p => p.id === winnerId);
    const updatedTricks = [...state.tricks, state.currentTrick!];
    const isHandComplete = updatedTricks.length >= state.cardsPerPlayer;

    set({
      players: updatedPlayers,
      tricks: updatedTricks,
      currentTrick: null,
      currentPlayerIndex: winnerIndex, // Winner leads next trick
    });

    // If all tricks played, schedule completeHand (short delay for UI to settle)
    if (isHandComplete) {
      setTimeout(() => {
        const currentState = get();
        if (currentState.phase === 'playing') {
          currentState.completeHand();
        }
      }, 500);
    }
  },

  /**
   * Complete the hand (after all tricks are played)
   */
  completeHand: () => {
    const state = get();

    // Calculate scores
    const updatedPlayers = state.players.map(p => {
      const { points, bonus } = calculateHandScore({
        playerId: p.id,
        bet: p.bet || 0,
        tricksWon: p.tricksWon,
      });

      return {
        ...p,
        score: p.score + points,
        bonus: p.bonus + bonus,
      };
    });

    // Record hand result for score history
    const handResult: HandResult = {
      handNumber: state.handNumber,
      startingPlayerIndex: state.startingPlayerIndex,
      results: state.players.map(p => {
        const { points, bonus } = calculateHandScore({
          playerId: p.id,
          bet: p.bet || 0,
          tricksWon: p.tricksWon,
        });
        return {
          playerId: p.id,
          bet: p.bet || 0,
          tricksWon: p.tricksWon,
          points,
          bonus,
        };
      }),
    };

    set({
      phase: 'scoring',
      players: updatedPlayers,
      scoreHistory: [...state.scoreHistory, handResult],
    });
  },

  /**
   * Start the next hand
   */
  nextHand: () => {
    const state = get();

    // Guard: only advance from scoring phase. In multiplayer, setRemoteState may have
    // already applied the other player's nextHand() call (advancing to 'lobby'/'betting').
    // Calling nextHand() again would double-advance the hand number, causing desync.
    if (state.phase !== 'scoring') {
      console.log('[GameStore] nextHand() skipped — already advanced to phase:', state.phase, 'hand:', state.handNumber);
      return;
    }

    if (state.handNumber >= state.totalHands) {
      get().endGame();
      return;
    }

    const nextHandNumber = state.handNumber + 1;
    const maxCards = state.maxCardsPerPlayer;
    const cardsPerPlayer = getHandCards(nextHandNumber, maxCards);
    const trumpSuit = getTrumpForHand(nextHandNumber);

    // Rotate starting player counterclockwise from first hand.
    // Use double-modulo to guard against negative JS remainders:
    // e.g. (-1) % 2 = -1 in JS, but ((-1) % 2 + 2) % 2 = 1 ✓
    const P = state.playerCount;
    const startingPlayer = ((state.firstHandStartingPlayerIndex! - (nextHandNumber - 1)) % P + P) % P;

    console.log('[GameStore] Hand', nextHandNumber, 'starting player:', startingPlayer, `(${state.players[startingPlayer].name})`);

    // Reset hand-specific state
    const updatedPlayers = state.players.map(p => ({
      ...p,
      bet: null,
      tricksWon: 0,
      hand: [],
      isReady: false,
    }));

    set({
      phase: 'lobby', // Will transition to betting on startBetting
      handNumber: nextHandNumber,
      cardsPerPlayer,
      trumpSuit,
      startingPlayerIndex: startingPlayer,
      currentPlayerIndex: startingPlayer,
      players: updatedPlayers,
      bettingPlayerIndex: startingPlayer,
      hasAllBets: false,
      currentTrick: null,
      tricks: [],
    });
  },

  /**
   * End the game
   */
  endGame: () => {
    const state = get();
    set({
      phase: 'finished',
    });

  },

  /**
   * Reset the store
   */
  reset: () => {
    set(initialState);
  },

  // ============================================================
  // GETTERS
  // ============================================================

  getBettingPlayer: () => {
    const state = get();
    return state.phase === 'betting' ? state.players[state.bettingPlayerIndex] : null;
  },

  getCurrentPlayer: () => {
    const state = get();
    return state.phase === 'playing' ? state.players[state.currentPlayerIndex] : null;
  },

  getMyPlayer: () => {
    const state = get();
    return state.players.find(p => p.id === state.myPlayerId) || null;
  },

  getPlayableCards: (playerId) => {
    const state = get();
    const player = state.players.find(p => p.id === playerId);

    if (!player || state.phase !== 'playing') return [];

    const leadCard = state.currentTrick?.cards[0]?.card || null;

    const context: PlayContext = {
      handCards: player.hand,
      leadCard,
      trumpSuit: state.trumpSuit,
      playedCards: state.currentTrick?.cards || [],
    };

    const playable = getPlayableCards(player.hand, context);

    // Debug: Log why cards might not be playable
    if (playable.length === 0 && player.hand.length > 0) {
      console.error('[getPlayableCards] No playable cards for player', player.name);
      console.error('[getPlayableCards] Hand:', player.hand.map(c => `${c.rank}${c.suit[0]}`).join(', '));
      console.error('[getPlayableCards] Lead card:', leadCard ? `${leadCard.rank}${leadCard.suit[0]}` : 'none (leading)');
      console.error('[getPlayableCards] Trump:', state.trumpSuit);
      console.error('[getPlayableCards] Played cards:', state.currentTrick?.cards.map(c => `${c.card.rank}${c.card.suit[0]}`).join(', ') || 'none');
      // Check each card individually
      player.hand.forEach(card => {
        const result = isCardPlayable(card, context);
        console.error(`[getPlayableCards] Card ${card.rank}${card.suit[0]}:`, result.playable ? 'PLAYABLE' : result.reason || 'not playable');
      });
    }

    return playable;
  },

  getAllowedBets: (playerId) => {
    const state = get();
    const player = state.players.find(p => p.id === playerId);

    if (!player || state.phase !== 'betting') return [];

    const currentBets: Bet[] = state.players
      .filter(p => p.bet !== null && p.id !== playerId)
      .map(p => ({ playerId: p.id, amount: p.bet! }));

    const context: BettingContext = {
      playerCount: state.playerCount,
      cardsPerPlayer: state.cardsPerPlayer,
      currentBets,
      isLastPlayer: state.isLastBettingPlayer(),
    };

    return getAllowedBets(context);
  },

  canPlayCard: (playerId, card) => {
    const state = get();
    const player = state.players.find(p => p.id === playerId);

    if (!player || state.phase !== 'playing') return false;

    // Trick already complete — no card is playable until completeTrick() clears it
    if (state.currentTrick?.winnerId) return false;

    const leadCard = state.currentTrick?.cards[0]?.card || null;

    const context: PlayContext = {
      handCards: player.hand,
      leadCard,
      trumpSuit: state.trumpSuit,
      playedCards: state.currentTrick?.cards || [],
    };

    return isCardPlayable(card, context).playable;
  },

  isLastBettingPlayer: () => {
    const state = get();
    const playersWithoutBets = state.players.filter(p => p.bet === null);
    return playersWithoutBets.length === 1;
  },

  isBotTurn: () => {
    const state = get();
    if (state.phase === 'betting') {
      const bettingPlayer = state.players[state.bettingPlayerIndex];
      return bettingPlayer?.isBot ?? false;
    }
    if (state.phase === 'playing') {
      const currentPlayer = state.players[state.currentPlayerIndex];
      return currentPlayer?.isBot ?? false;
    }
    return false;
  },

  /**
   * Bot AI: Place a bet based on hand strength and difficulty
   */
  placeBotBet: () => {
    const state = get();

    if (state.phase !== 'betting') return;

    const bettingPlayer = state.players[state.bettingPlayerIndex];
    if (!bettingPlayer?.isBot) return;

    // Get bot strategy based on difficulty
    const strategy = getBotStrategy(state.botDifficulty);

    // Build betting context
    const allowedBets = state.getAllowedBets(bettingPlayer.id);
    const context: BotBettingContext = {
      hand: bettingPlayer.hand,
      cardsPerPlayer: state.cardsPerPlayer,
      trumpSuit: state.trumpSuit,
      allowedBets,
      playerCount: state.playerCount,
      currentBets: state.players.filter(p => p.bet !== null).map(p => p.bet!),
    };

    // Get bet from strategy
    const selectedBet = strategy.placeBet(context);
    state.placeBet(bettingPlayer.id, selectedBet);
  },

  /**
   * Bot AI: Play a card based on rules and strategy with difficulty
   */
  playBotCard: () => {
    const state = get();

    if (state.phase !== 'playing') return;

    const currentPlayer = state.players[state.currentPlayerIndex];
    if (!currentPlayer?.isBot) return;

    // Get playable cards
    const playableCards = state.getPlayableCards(currentPlayer.id);

    if (playableCards.length === 0) {
      console.error('[Bot] ERROR: No playable cards for', currentPlayer.name);

      // EMERGENCY FALLBACK: Play the first card from hand
      if (currentPlayer.hand.length > 0) {
        state.playCard(currentPlayer.id, currentPlayer.hand[0]);
      } else {
        // Force advance to next player
        const nextIndex = getNextPlayerIndex(state.currentPlayerIndex, state.playerCount);
        set({ currentPlayerIndex: nextIndex });
      }
      return;
    }

    // Get bot strategy based on difficulty
    const strategy = getBotStrategy(state.botDifficulty);

    // Build playing context with all player scores for sabotage
    const allPlayerScores = state.players.map(p => ({
      playerId: p.id,
      score: p.score,
      bet: p.bet,
      tricksWon: p.tricksWon,
    }));

    const context: BotPlayingContext = {
      hand: currentPlayer.hand,
      playableCards,
      trumpSuit: state.trumpSuit,
      currentTrick: state.currentTrick?.cards || [],
      playerCount: state.playerCount,
      tricksWon: currentPlayer.tricksWon,
      bet: currentPlayer.bet,
      tricksPlayed: state.tricks.length,
      allPlayerScores,
    };

    // Get card from strategy
    const cardToPlay = strategy.playCard(context);
    state.playCard(currentPlayer.id, cardToPlay);
  },

  // ============================================================
  // MULTIPLAYER SYNC
  // ============================================================

  /**
   * Force-apply remote state, bypassing most guards.
   * Used by sync button and heartbeat to recover from desync.
   * Only guard: never skip scoring phase (user needs to see scoreboard).
   */
  forceRemoteState: (remoteState) => {
    const state = get();

    // Don't skip past scoring — user needs to see the scoreboard and press Continue
    if (state.phase === 'scoring') {
      console.log('[GameStore] Force-apply skipped: local is in scoring phase');
      return;
    }

    console.log('[GameStore] Force-applying remote state:', {
      phase: remoteState.phase,
      handNumber: remoteState.handNumber,
      currentPlayerIndex: remoteState.currentPlayerIndex,
    });
    set({
      ...remoteState,
      myPlayerId: state.myPlayerId,
    });

    // If the snapshot contains a completed trick (winnerId set), clear it immediately.
    // Without this, playCard() blocks forever because no completeTrick timer is running.
    const applied = get();
    if (applied.currentTrick?.winnerId) {
      console.log('[GameStore] Force-apply: clearing completed trick');
      setTimeout(() => get().completeTrick(), 500);
    }
  },

  /**
   * Set multiplayer mode
   * When enabled, bets and card plays will sync to server
   */
  setMultiplayerMode: (isMultiplayer: boolean) => {
    console.log('[GameStore] Multiplayer mode:', isMultiplayer);
    set({ isMultiplayer });
  },

  /**
   * Set bot difficulty for single-player mode
   */
  setBotDifficulty: (difficulty: BotDifficulty) => {
    console.log('[GameStore] Bot difficulty set to:', difficulty);
    set({ botDifficulty: difficulty });
  },
}));
