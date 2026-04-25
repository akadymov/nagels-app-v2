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
import { multiplayerPlaceBet, multiplayerPlayCard, saveGameSnapshot } from '../lib/multiplayer/gameActions';
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

  // State versioning for conflict resolution
  version: number;
  pendingActions: Map<string, { action: string; data: any; localVersion: number }>;

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
  setRemoteState: (remoteState: Partial<GameStore> & { players: GamePlayer[] }) => void;
  forceRemoteState: (remoteState: Partial<GameStore> & { players: GamePlayer[] }) => void;
  applyRemoteBet: (playerId: string, bet: number) => void;
  applyRemoteCardPlay: (playerId: string, card: Card) => void;
  setMultiplayerMode: (isMultiplayer: boolean) => void;
  setBotDifficulty: (difficulty: BotDifficulty) => void;

  // Version control & conflict resolution
  incrementVersion: () => void;
  addPendingAction: (actionId: string, action: string, data: any) => void;
  removePendingAction: (actionId: string) => void;
  rollbackPendingActions: () => void;
  getVersion: () => number;
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
  pendingActions: new Map(),
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

    // Sync to multiplayer server if in multiplayer mode
    if (state.isMultiplayer && playerId === state.myPlayerId) {
      const actionId = `bet-${playerId}-${Date.now()}`;

      // Track pending action
      get().addPendingAction(actionId, 'placeBet', { playerId, bet });
      get().incrementVersion();

      multiplayerPlaceBet(playerId, bet)
        .then(() => {
          // Server confirmed - remove pending action
          get().removePendingAction(actionId);
        })
        .catch(err => {
          console.error('[GameStore] Failed to sync bet:', err);
          // Rollback optimistic update
          const currentState = get();
          const rollbackPlayers = [...currentState.players];
          rollbackPlayers[bettingPlayerIndex] = {
            ...rollbackPlayers[bettingPlayerIndex],
            bet: null, // Rollback to null
          };

          set({
            players: rollbackPlayers,
            bettingPlayerIndex,
            hasAllBets: false,
          });

          get().removePendingAction(actionId);
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

    // Sync to multiplayer server if in multiplayer mode (after optimistic update)
    if (state.isMultiplayer && playerId === state.myPlayerId) {
      const actionId = `play-${playerId}-${card.id}-${Date.now()}`;
      get().addPendingAction(actionId, 'playCard', { playerId, card });
      get().incrementVersion();

      multiplayerPlayCard(playerId, card.id, card)
        .then(() => {
          console.log('[GameStore] Card play synced successfully');
          get().removePendingAction(actionId);
        })
        .catch(err => {
          console.error('[GameStore] Failed to sync card play:', err);
          // Rollback optimistic update
          console.log('[GameStore] Rolling back card play...');
          set({
            players: currentState.players,
            currentTrick: currentState.currentTrick,
            currentPlayerIndex: currentState.currentPlayerIndex,
          });
          get().removePendingAction(actionId);
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

    // Save scoring snapshot — only host writes to avoid concurrent upsert conflicts
    if (state.isMultiplayer && useMultiplayerStore.getState().isHost) saveGameSnapshot();
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

    if (state.isMultiplayer && useMultiplayerStore.getState().isHost) saveGameSnapshot();
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
   * Apply remote state from server
   * Used to sync game state in multiplayer mode
   */
  setRemoteState: (remoteState) => {
    const state = get();

    // Block only the specific stale-snapshot regression: a server snapshot with
    // phase='playing' (currentTrick=null) must not overwrite our local phase='scoring'
    // that was just computed by completeTrick/completeHand.
    // We do NOT use a broad phase-order guard because rounds cycle backward
    // (scoring → betting for the next hand), which a rank comparison would block.
    if (state.phase === 'scoring' && remoteState.phase === 'playing') {
      console.log('[GameStore] Ignoring stale playing snapshot that would overwrite scoring phase');
      return;
    }

    // Don't clear an in-progress completed trick (winnerId set, awaiting completeTrick timer)
    if (state.currentTrick?.winnerId && !remoteState.currentTrick?.winnerId) {
      console.log('[GameStore] Ignoring remote state that would clear active trick winner');
      return;
    }

    // Don't restore a trick we already completed locally.
    // Scenario: completeTrick() fired (currentTrick = null), then a stale snapshot
    // with currentTrick.winnerId arrives.  The timer won't fire again → deadlock.
    if (!state.currentTrick && remoteState.currentTrick?.winnerId) {
      console.log('[GameStore] Ignoring stale remote state that would restore already-completed trick');
      return;
    }

    // Don't rewind to an earlier hand.
    // Scenario: nextHand() already advanced to hand N+1, but a stale snapshot for
    // hand N arrives and overwrites phase/players back — betting never starts.
    if (state.handNumber > 1 && remoteState.handNumber < state.handNumber) {
      console.log('[GameStore] Ignoring stale remote state for earlier hand', remoteState.handNumber, '<', state.handNumber);
      return;
    }

    // Within the same hand, don't revert to an earlier phase.
    // Scenario: startBetting() set phase='betting', then a stale snapshot with
    // phase='lobby' (same handNumber) arrives and clears the dealt hands.
    // Note: only block if LOCAL is AHEAD; if local is behind, apply remote to catch up.
    const phaseRank: Record<string, number> = { lobby: 0, betting: 1, playing: 2, scoring: 3, finished: 4 };
    if (
      remoteState.handNumber === state.handNumber &&
      (phaseRank[remoteState.phase as string] ?? 0) < (phaseRank[state.phase as string] ?? 0)
    ) {
      console.log('[GameStore] Ignoring stale remote state with earlier phase', remoteState.phase, '<', state.phase);
      return;
    }

    set({
      ...remoteState,
      myPlayerId: state.myPlayerId,
    });
  },

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
   * Apply a bet placed by another player (received from server)
   * Skips if this is the local player (already updated locally)
   * Detects conflicts with pending local actions
   */
  applyRemoteBet: (playerId, bet) => {
    const state = get();

    // Skip if this is the local player (already updated)
    if (state.myPlayerId === playerId) {
      console.log('[GameStore] Skipping remote bet for local player:', playerId);
      return;
    }

    // Check for conflicts with pending actions
    // If we have pending actions for other players, it might indicate we're out of sync
    const hasPendingActions = state.pendingActions.size > 0;
    if (hasPendingActions) {
      console.warn('[GameStore] Receiving remote bet while having pending actions - potential conflict');
      // In a real conflict resolution scenario, we would check if this remote bet
      // conflicts with our pending actions. For now, we trust the server.
    }

    // If we receive a bet event while still in 'lobby' phase (race condition: the other
    // player placed their bet before our startBetting() fired), fast-forward to betting.
    if (state.phase === 'lobby' && state.handNumber > 0 && state.players.length > 0) {
      console.log('[GameStore] Received remote bet in lobby phase — fast-forwarding to betting');
      get().startBetting();
    }

    const refreshedState = get();
    if (refreshedState.phase !== 'betting') return;

    const bettingPlayerIndex = refreshedState.players.findIndex(p => p.id === playerId);
    if (bettingPlayerIndex === -1) return;

    // Update player's bet (use refreshedState which may have been updated by startBetting)
    const updatedPlayers = [...refreshedState.players];
    updatedPlayers[bettingPlayerIndex] = {
      ...updatedPlayers[bettingPlayerIndex],
      bet,
    };

    // Move to next betting player
    const nextIndex = getNextPlayerIndex(bettingPlayerIndex, refreshedState.playerCount);
    const hasAllBets = updatedPlayers.every(p => p.bet !== null);

    console.log('[GameStore] Remote bet applied:', playerId, 'bet:', bet, 'next:', nextIndex, 'allBets:', hasAllBets);

    set({
      players: updatedPlayers,
      bettingPlayerIndex: hasAllBets ? bettingPlayerIndex : nextIndex,
      hasAllBets,
    });

    // Increment version after applying remote change
    get().incrementVersion();
  },

  /**
   * Apply a card play by another player (received from server)
   * Skips if this is the local player (already updated locally)
   * Detects conflicts with pending local actions
   */
  applyRemoteCardPlay: (playerId, card) => {
    const state = get();

    // Skip if this is the local player (already updated)
    if (state.myPlayerId === playerId) {
      console.log('[GameStore] Skipping remote card play for local player:', playerId);
      return;
    }

    // Check for conflicts with pending actions
    const hasPendingActions = state.pendingActions.size > 0;
    if (hasPendingActions) {
      console.warn('[GameStore] Receiving remote card play while having pending actions - potential conflict');
      // In a real conflict resolution scenario, we would check if this remote card play
      // conflicts with our pending actions. For now, we trust the server.
    }

    // If we receive a card-play event while still in 'betting' phase (all bets are in but
    // our local startPlaying() hasn't fired yet), fast-forward to playing phase.
    if (state.phase === 'betting' && state.hasAllBets) {
      console.log('[GameStore] Received remote card play in betting phase — fast-forwarding to playing');
      get().startPlaying();
    }

    const playingState = get();
    if (playingState.phase !== 'playing') return;

    const playerIndex = playingState.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;

    // If the previous trick is complete (winnerId set) but its timer hasn't fired yet,
    // complete it immediately. This prevents the race condition where the trick winner
    // plays their first card of the next trick before the remote completeTrick timer fires,
    // causing the new card to be incorrectly appended to the finished trick.
    if (get().currentTrick?.winnerId) {
      console.log('[GameStore] Completing lingering trick before applying new card play');
      get().completeTrick();
    }

    // Create new trick if needed
    if (!get().currentTrick) {
      set({
        currentTrick: {
          cards: [],
          winnerId: '',
          leadSuit: card.suit,
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
    const trickComplete = updatedTrick.cards.length === playingState.playerCount;

    if (trickComplete) {
      // Determine winner
      const { winnerId } = determineTrickWinner(
        updatedTrick.cards,
        playingState.trumpSuit
      );

      console.log('[GameStore] Remote card play completed trick, winner:', winnerId);

      set({
        players: updatedPlayers,
        currentTrick: {
          ...updatedTrick,
          winnerId,
        },
      });

      // Schedule completeTrick from the store side (same as playCard)
      setTimeout(() => {
        const s = get();
        if (s.phase === 'playing' && s.currentTrick?.winnerId === winnerId) {
          s.completeTrick();
        }
      }, 1500);
    } else {
      // Move to next player
      const nextIndex = getNextPlayerIndex(playingState.currentPlayerIndex, playingState.playerCount);

      console.log('[GameStore] Remote card play applied:', playerId, 'card:', card, 'next:', nextIndex);

      set({
        players: updatedPlayers,
        currentTrick: updatedTrick,
        currentPlayerIndex: nextIndex,
      });
    }

    // Increment version after applying remote change
    get().incrementVersion();
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

  // ============================================================
  // VERSION CONTROL & CONFLICT RESOLUTION
  // ============================================================

  /**
   * Increment state version after local change
   */
  incrementVersion: () => {
    const state = get();
    const newVersion = state.version + 1;
    console.log('[GameStore] Version incremented:', state.version, '->', newVersion);
    set({ version: newVersion });
  },

  /**
   * Add pending action (optimistic update)
   */
  addPendingAction: (actionId: string, action: string, data: any) => {
    const state = get();
    const pending = new Map(state.pendingActions);
    pending.set(actionId, { action, data, localVersion: state.version });
    console.log('[GameStore] Pending action added:', actionId, 'v' + state.version);
    set({ pendingActions: pending });
  },

  /**
   * Remove pending action (confirmed by server)
   */
  removePendingAction: (actionId: string) => {
    const state = get();
    const pending = new Map(state.pendingActions);
    const removed = pending.delete(actionId);
    if (removed) {
      console.log('[GameStore] Pending action confirmed:', actionId);
      set({ pendingActions: pending });
    }
  },

  /**
   * Rollback all pending actions (on conflict)
   */
  rollbackPendingActions: () => {
    const state = get();
    if (state.pendingActions.size > 0) {
      console.warn('[GameStore] Rolling back', state.pendingActions.size, 'pending actions');
      set({ pendingActions: new Map() });
    }
  },

  /**
   * Get current version
   */
  getVersion: () => {
    return get().version;
  },
}));
