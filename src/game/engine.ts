/**
 * Nagels Online - Pure Game Engine
 *
 * Stateless, pure functions that implement the full Nagels game logic.
 * NO Zustand, React, or Supabase dependencies - safe for server-side use
 * in Supabase Edge Functions (server-authoritative architecture).
 *
 * All state transitions are synchronous. A single applyAction call may
 * cascade through trick completion, hand completion, and scoring in one
 * invocation, returning the final state directly.
 */

import {
  Card,
  Suit,
  GamePhase,
  createDeck,
  getMaxCards,
  getTotalHands,
  getHandCards,
  getTrumpForHand,
  getNextPlayerIndex,
  isValidBet,
  isCardPlayable,
  determineTrickWinner,
  calculateHandScore,
  sortHand,
  type Bet,
  type BettingContext,
  type PlayContext,
} from './rules';
import { seededShuffle } from '../lib/multiplayer/seededRandom';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export interface ServerPlayer {
  id: string;
  name: string;
  hand: Card[];
  bet: number | null;
  tricksWon: number;
  score: number;
  bonus: number;
  isReady: boolean;
}

export interface ServerTrick {
  cards: Array<{ playerId: string; card: Card }>;
  winnerId: string;
  leadSuit: Exclude<Suit, 'notrump'> | '';
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

export interface ServerGameState {
  phase: GamePhase;
  handNumber: number;
  totalHands: number;
  playerCount: number;
  maxCardsPerPlayer: number;
  cardsPerPlayer: number;
  currentPlayerIndex: number;
  startingPlayerIndex: number;
  firstHandStartingPlayerIndex: number;
  bettingPlayerIndex: number;
  hasAllBets: boolean;
  trumpSuit: Suit;
  deck: Card[];
  currentTrick: ServerTrick | null;
  tricks: ServerTrick[];
  players: ServerPlayer[];
  scoreHistory: HandResult[];
  roomId?: string;
}

export type GameActionType = 'place_bet' | 'play_card' | 'start_game' | 'continue_hand';

export interface GameAction {
  type: GameActionType;
  playerId: string;
  data?: {
    bet?: number;
    cardId?: string;
    players?: Array<{ id: string; name: string }>;
    roomId?: string;
    firstHandStartingPlayerIndex?: number;
  };
}

export interface ActionResult {
  success: boolean;
  state: ServerGameState;
  error?: string;
}

// ============================================================
// INITIALIZATION
// ============================================================

/**
 * Create the initial game state for a new game.
 *
 * @param players - ordered list of players (order = seating order)
 * @param roomId - room identifier used as seed for deterministic shuffles
 * @param firstHandStartingPlayerIndex - index of the player who starts hand 1
 */
export function initGame(
  players: Array<{ id: string; name: string }>,
  roomId: string,
  firstHandStartingPlayerIndex: number
): ServerGameState {
  const playerCount = players.length;
  const maxCards = getMaxCards(playerCount);
  const totalHands = getTotalHands(maxCards);
  const cardsPerPlayer = getHandCards(1, maxCards);
  const trumpSuit = getTrumpForHand(1);

  const serverPlayers: ServerPlayer[] = players.map(p => ({
    id: p.id,
    name: p.name,
    hand: [],
    bet: null,
    tricksWon: 0,
    score: 0,
    bonus: 0,
    isReady: false,
  }));

  const state: ServerGameState = {
    phase: 'lobby',
    handNumber: 1,
    totalHands,
    playerCount,
    maxCardsPerPlayer: maxCards,
    cardsPerPlayer,
    currentPlayerIndex: firstHandStartingPlayerIndex,
    startingPlayerIndex: firstHandStartingPlayerIndex,
    firstHandStartingPlayerIndex,
    bettingPlayerIndex: firstHandStartingPlayerIndex,
    hasAllBets: false,
    trumpSuit,
    deck: [],
    currentTrick: null,
    tricks: [],
    players: serverPlayers,
    scoreHistory: [],
    roomId,
  };

  // Automatically deal the first hand
  return dealHand(state);
}

// ============================================================
// ACTION DISPATCHER
// ============================================================

/**
 * Apply a game action to the current state, returning the new state.
 * All transitions are synchronous - a single call may cascade through
 * trick completion, hand completion, and scoring.
 */
export function applyAction(state: ServerGameState, action: GameAction): ActionResult {
  switch (action.type) {
    case 'place_bet':
      return applyPlaceBet(state, action);
    case 'play_card':
      return applyPlayCard(state, action);
    case 'continue_hand':
      return applyContinueHand(state, action);
    case 'start_game':
      return applyStartGame(state, action);
    default:
      return { success: false, state, error: `Unknown action type: ${(action as GameAction).type}` };
  }
}

// ============================================================
// ACTION HANDLERS
// ============================================================

function applyStartGame(state: ServerGameState, action: GameAction): ActionResult {
  const { data } = action;
  if (!data?.players || !data.roomId) {
    return { success: false, state, error: 'start_game requires players and roomId in data' };
  }

  const firstHandStartingPlayerIndex = data.firstHandStartingPlayerIndex ?? 0;
  const newState = initGame(data.players, data.roomId, firstHandStartingPlayerIndex);
  return { success: true, state: newState };
}

/**
 * Place a bet for a player.
 * Validates: phase=betting, correct turn, valid bet amount.
 * When all bets are placed, auto-transitions to playing phase.
 */
function applyPlaceBet(state: ServerGameState, action: GameAction): ActionResult {
  if (state.phase !== 'betting') {
    return { success: false, state, error: 'Cannot place bet: not in betting phase' };
  }

  const { playerId, data } = action;
  const bet = data?.bet;
  if (bet === undefined || bet === null) {
    return { success: false, state, error: 'Cannot place bet: no bet amount provided' };
  }

  // Validate it is this player's turn to bet
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) {
    return { success: false, state, error: `Player ${playerId} not found` };
  }
  if (playerIndex !== state.bettingPlayerIndex) {
    return { success: false, state, error: `Not ${playerId}'s turn to bet` };
  }

  // Check if this is the last player to bet
  const playersWithoutBets = state.players.filter(p => p.bet === null);
  const isLastPlayer = playersWithoutBets.length === 1;

  // Build betting context and validate
  const currentBets: Bet[] = state.players
    .filter(p => p.bet !== null)
    .map(p => ({ playerId: p.id, amount: p.bet! }));

  const bettingContext: BettingContext = {
    playerCount: state.playerCount,
    cardsPerPlayer: state.cardsPerPlayer,
    currentBets,
    isLastPlayer,
  };

  if (!isValidBet(bet, bettingContext)) {
    return { success: false, state, error: `Invalid bet: ${bet}` };
  }

  // Apply the bet
  const updatedPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, bet } : p
  );

  const hasAllBets = updatedPlayers.every(p => p.bet !== null);
  const nextBettingIndex = hasAllBets
    ? state.bettingPlayerIndex
    : getNextPlayerIndex(state.bettingPlayerIndex, state.playerCount);

  let newState: ServerGameState = {
    ...state,
    players: updatedPlayers,
    bettingPlayerIndex: nextBettingIndex,
    hasAllBets,
  };

  // Auto-transition to playing phase when all bets are in
  if (hasAllBets) {
    newState = {
      ...newState,
      phase: 'playing',
      currentPlayerIndex: state.startingPlayerIndex,
      currentTrick: {
        cards: [],
        winnerId: '',
        leadSuit: '',
      },
    };
  }

  return { success: true, state: newState };
}

/**
 * Play a card for a player.
 * Validates: phase=playing, correct turn, card in hand, card playable.
 * When a trick completes, determines the winner and cascades through
 * hand/game completion if appropriate.
 */
function applyPlayCard(state: ServerGameState, action: GameAction): ActionResult {
  if (state.phase !== 'playing') {
    return { success: false, state, error: 'Cannot play card: not in playing phase' };
  }

  const { playerId, data } = action;
  const cardId = data?.cardId;
  if (!cardId) {
    return { success: false, state, error: 'Cannot play card: no cardId provided' };
  }

  // Validate it is this player's turn
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) {
    return { success: false, state, error: `Player ${playerId} not found` };
  }
  if (playerIndex !== state.currentPlayerIndex) {
    return { success: false, state, error: `Not ${playerId}'s turn to play` };
  }

  // Find the card in the player's hand
  const player = state.players[playerIndex];
  const card = player.hand.find(c => c.id === cardId);
  if (!card) {
    return { success: false, state, error: `Card ${cardId} not in player's hand` };
  }

  // Ensure we have a current trick
  const currentTrick = state.currentTrick ?? {
    cards: [],
    winnerId: '',
    leadSuit: '' as Exclude<Suit, 'notrump'> | '',
  };

  // Validate card is playable
  const leadCard = currentTrick.cards[0]?.card ?? null;
  const playContext: PlayContext = {
    handCards: player.hand,
    leadCard,
    trumpSuit: state.trumpSuit,
    playedCards: currentTrick.cards,
  };

  const { playable, reason } = isCardPlayable(card, playContext);
  if (!playable) {
    return { success: false, state, error: `Card not playable: ${reason}` };
  }

  // Remove card from player's hand
  const updatedPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, hand: p.hand.filter(c => c.id !== cardId) } : p
  );

  // Add card to trick
  const isFirstCard = currentTrick.cards.length === 0;
  const updatedTrick: ServerTrick = {
    ...currentTrick,
    cards: [...currentTrick.cards, { playerId, card }],
    leadSuit: isFirstCard ? card.suit : currentTrick.leadSuit,
  };

  // Check if trick is complete
  const trickComplete = updatedTrick.cards.length === state.playerCount;

  if (trickComplete) {
    // Determine winner
    const { winnerId } = determineTrickWinner(updatedTrick.cards, state.trumpSuit);
    const completedTrick: ServerTrick = { ...updatedTrick, winnerId };

    // Apply trick completion inline (synchronous cascade)
    return completeTrick(
      { ...state, players: updatedPlayers },
      completedTrick
    );
  }

  // Trick not complete - advance to next player
  const nextIndex = getNextPlayerIndex(state.currentPlayerIndex, state.playerCount);

  return {
    success: true,
    state: {
      ...state,
      players: updatedPlayers,
      currentTrick: updatedTrick,
      currentPlayerIndex: nextIndex,
    },
  };
}

/**
 * Complete a trick: increment winner's tricksWon, archive the trick,
 * and cascade into hand completion if this was the last trick.
 */
function completeTrick(state: ServerGameState, completedTrick: ServerTrick): ActionResult {
  const winnerId = completedTrick.winnerId;

  // Increment winner's tricksWon
  const updatedPlayers = state.players.map(p =>
    p.id === winnerId ? { ...p, tricksWon: p.tricksWon + 1 } : p
  );

  // Archive trick
  const updatedTricks = [...state.tricks, completedTrick];

  // Check if hand is complete (all tricks for this hand played)
  const isHandDone = updatedTricks.length >= state.cardsPerPlayer;

  const winnerIndex = updatedPlayers.findIndex(p => p.id === winnerId);

  const newState: ServerGameState = {
    ...state,
    players: updatedPlayers,
    tricks: updatedTricks,
    currentTrick: null,
    currentPlayerIndex: winnerIndex,
  };

  if (isHandDone) {
    return completeHand(newState);
  }

  return { success: true, state: newState };
}

/**
 * Complete a hand: calculate scores, record results, transition to scoring phase.
 */
function completeHand(state: ServerGameState): ActionResult {
  // Calculate scores for each player
  const updatedPlayers = state.players.map(p => {
    const { points, bonus } = calculateHandScore({
      playerId: p.id,
      bet: p.bet ?? 0,
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
        bet: p.bet ?? 0,
        tricksWon: p.tricksWon,
      });
      return {
        playerId: p.id,
        bet: p.bet ?? 0,
        tricksWon: p.tricksWon,
        points,
        bonus,
      };
    }),
  };

  return {
    success: true,
    state: {
      ...state,
      phase: 'scoring',
      players: updatedPlayers,
      scoreHistory: [...state.scoreHistory, handResult],
    },
  };
}

/**
 * Continue to the next hand (called from scoring phase).
 * If this was the last hand, transitions to finished.
 * Otherwise, advances hand number, rotates starting player, deals new cards.
 */
function applyContinueHand(state: ServerGameState, _action: GameAction): ActionResult {
  if (state.phase !== 'scoring') {
    return { success: false, state, error: 'Cannot continue hand: not in scoring phase' };
  }

  // Last hand? Game is finished.
  if (state.handNumber >= state.totalHands) {
    return {
      success: true,
      state: { ...state, phase: 'finished' },
    };
  }

  const nextHandNumber = state.handNumber + 1;
  const maxCards = state.maxCardsPerPlayer;
  const cardsPerPlayer = getHandCards(nextHandNumber, maxCards);
  const trumpSuit = getTrumpForHand(nextHandNumber);

  // Rotate starting player counterclockwise from first hand.
  // Use double-modulo to guard against negative JS remainders.
  const P = state.playerCount;
  const startingPlayer =
    ((state.firstHandStartingPlayerIndex - (nextHandNumber - 1)) % P + P) % P;

  // Reset hand-specific state
  const resetPlayers = state.players.map(p => ({
    ...p,
    bet: null,
    tricksWon: 0,
    hand: [],
    isReady: false,
  }));

  const nextState: ServerGameState = {
    ...state,
    handNumber: nextHandNumber,
    cardsPerPlayer,
    trumpSuit,
    startingPlayerIndex: startingPlayer,
    currentPlayerIndex: startingPlayer,
    bettingPlayerIndex: startingPlayer,
    hasAllBets: false,
    currentTrick: null,
    tricks: [],
    players: resetPlayers,
  };

  // Deal new hand
  return { success: true, state: dealHand(nextState) };
}

// ============================================================
// DEALING
// ============================================================

/**
 * Deal cards for the current hand.
 * Uses seeded shuffle with `${roomId}-hand-${handNumber}` for deterministic results.
 * Transitions state to betting phase.
 */
function dealHand(state: ServerGameState): ServerGameState {
  const { cardsPerPlayer, handNumber, trumpSuit, roomId, players } = state;

  const deck = createDeck();
  const seed = `${roomId || 'default'}-hand-${handNumber}`;
  const shuffledDeck = seededShuffle(deck, seed);

  // Deal cards round-robin
  const hands: Map<string, Card[]> = new Map();
  for (const player of players) {
    hands.set(player.id, []);
  }

  let cardIndex = 0;
  for (let round = 0; round < cardsPerPlayer; round++) {
    for (const player of players) {
      if (cardIndex < shuffledDeck.length) {
        hands.get(player.id)!.push(shuffledDeck[cardIndex++]);
      }
    }
  }

  // Sort each hand
  const dealtPlayers = players.map(p => ({
    ...p,
    hand: sortHand(hands.get(p.id) || [], trumpSuit),
  }));

  return {
    ...state,
    phase: 'betting',
    players: dealtPlayers,
    deck: shuffledDeck,
    bettingPlayerIndex: state.startingPlayerIndex,
    hasAllBets: false,
  };
}
