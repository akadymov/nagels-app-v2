/**
 * Nagels Online - Server-Authoritative Game Action Edge Function
 *
 * Supabase Edge Function that processes game actions server-side.
 * Receives an action via HTTP POST, reads current state from the
 * game_states table, applies the action through the pure game engine,
 * and writes the resulting state back to the database.
 *
 * All game logic (rules, engine, seeded random) is inlined below
 * because Deno Edge Functions cannot import from the Expo src/ tree.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ============================================================
// CORS HEADERS
// ============================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

// ============================================================
// REQUEST HANDLER
// ============================================================

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { room_id, player_id, action_type, action_data } = await req.json();

    // ----------------------------------------------------------
    // Input validation
    // ----------------------------------------------------------
    if (!room_id || !player_id || !action_type) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required fields: room_id, player_id, action_type',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ----------------------------------------------------------
    // Create Supabase client with service role (bypasses RLS)
    // ----------------------------------------------------------
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Server misconfiguration: missing Supabase credentials' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ----------------------------------------------------------
    // Read current game state from database
    // ----------------------------------------------------------
    const { data: row, error: readError } = await supabase
      .from('game_states')
      .select('game_state, version')
      .eq('room_id', room_id)
      .single();

    if (readError && readError.code !== 'PGRST116') {
      // PGRST116 = "no rows returned" which is okay for start_game
      return new Response(
        JSON.stringify({ success: false, error: `Database read error: ${readError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const currentState: ServerGameState | Record<string, never> = row?.game_state ?? {};
    const currentVersion: number = row?.version ?? 0;

    // ----------------------------------------------------------
    // Build and apply the action
    // ----------------------------------------------------------
    const action: GameAction = {
      type: action_type as GameActionType,
      playerId: player_id,
      data: action_data,
    };

    const result = applyAction(currentState as ServerGameState, action);

    if (!result.success) {
      return new Response(
        JSON.stringify({ success: false, error: result.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ----------------------------------------------------------
    // Write new state back to database (upsert by room_id)
    // ----------------------------------------------------------
    const newVersion = currentVersion + 1;

    const { error: writeError } = await supabase
      .from('game_states')
      .upsert(
        {
          room_id,
          phase: result.state.phase,
          hand_number: result.state.handNumber,
          current_player_index: result.state.currentPlayerIndex,
          trump_suit: result.state.trumpSuit,
          cards_per_player: result.state.cardsPerPlayer,
          players: result.state.players,
          current_trick: result.state.currentTrick || {
            cards: [],
            winnerId: '',
            leadSuit: '',
          },
          tricks: result.state.tricks,
          deck: result.state.deck,
          version: newVersion,
          game_state: result.state,
        },
        { onConflict: 'room_id' },
      );

    if (writeError) {
      return new Response(
        JSON.stringify({ success: false, error: `Database write error: ${writeError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ----------------------------------------------------------
    // Success response
    // ----------------------------------------------------------
    return new Response(
      JSON.stringify({
        success: true,
        state: result.state,
        version: newVersion,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ success: false, error: `Internal error: ${message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

// ================================================================
// ================================================================
//
//  INLINED GAME ENGINE + RULES + SEEDED RANDOM
//
//  Everything below is copied (and de-exported) from:
//    1. src/lib/multiplayer/seededRandom.ts
//    2. src/game/rules.ts
//    3. src/game/engine.ts
//
//  DO NOT import from src/ — Deno cannot access those files.
//
// ================================================================
// ================================================================

// ============================================================
// 1. SEEDED RANDOM  (from src/lib/multiplayer/seededRandom.ts)
// ============================================================

/**
 * Simple seeded random number generator (Mulberry32)
 */
function createSeededRandom(seed: string): () => number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(seed.charCodeAt(i), 31) + hash;
  }

  let t = (hash += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

  return () => {
    t += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shuffle an array using seeded random (Fisher-Yates)
 */
function seededShuffle<T>(array: T[], seed: string): T[] {
  const random = createSeededRandom(seed);
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

// ============================================================
// 2. GAME RULES  (from src/game/rules.ts)
// ============================================================

// --- Type definitions ---

type Suit = 'diamonds' | 'hearts' | 'clubs' | 'spades' | 'notrump';
type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 'J' | 'Q' | 'K' | 'A';

interface Card {
  id: string;
  suit: Exclude<Suit, 'notrump'>;
  rank: Rank;
}

interface Bet {
  playerId: string;
  amount: number;
}

interface BettingContext {
  playerCount: number;
  cardsPerPlayer: number;
  currentBets: Bet[];
  isLastPlayer: boolean;
}

interface PlayContext {
  handCards: Card[];
  leadCard: Card | null;
  trumpSuit: Suit;
  playedCards: Array<{ playerId: string; card: Card }>;
}

interface HandScoreContext {
  playerId: string;
  bet: number;
  tricksWon: number;
}

type GamePhase = 'lobby' | 'betting' | 'playing' | 'scoring' | 'finished';

// --- Constants ---

const TRUMP_ORDER: Suit[] = ['diamonds', 'hearts', 'clubs', 'spades', 'notrump'];

// --- Game structure functions ---

function getMaxCards(playerCount: number): number {
  return Math.min(10, Math.floor(52 / playerCount));
}

function getHandCards(handNumber: number, maxCards: number): number {
  if (handNumber <= maxCards) {
    return maxCards - handNumber + 1;
  } else {
    return handNumber - maxCards;
  }
}

function getTotalHands(maxCards: number): number {
  return maxCards * 2;
}

function getTrumpForHand(handNumber: number): Suit {
  const index = (handNumber - 1) % TRUMP_ORDER.length;
  return TRUMP_ORDER[index];
}

function getNextPlayerIndex(currentIndex: number, playerCount: number): number {
  return (currentIndex + playerCount - 1) % playerCount;
}

// --- Betting rules ---

function isValidBet(bet: number, context: BettingContext): boolean {
  const { cardsPerPlayer, currentBets, isLastPlayer } = context;

  if (bet < 0 || bet > cardsPerPlayer) {
    return false;
  }

  if (isLastPlayer) {
    const totalBets = currentBets.reduce((sum, b) => sum + b.amount, 0);
    if (totalBets + bet === cardsPerPlayer) {
      return false;
    }
  }

  return true;
}

// --- Card play rules ---

function hasSuit(cards: Card[], suit: Exclude<Suit, 'notrump'>): boolean {
  return cards.some((c) => c.suit === suit);
}

function isTrump(card: Card, trumpSuit: Suit): boolean {
  return trumpSuit !== 'notrump' && card.suit === trumpSuit;
}

function getCardRank(rank: Rank, isTrumpCard: boolean): number {
  const normalRank: Record<Rank, number> = {
    2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8, J: 9, Q: 10, K: 11, A: 12,
  };
  const trumpRank: Record<Rank, number> = {
    2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 10: 7, Q: 8, K: 9, A: 10, 9: 11, J: 12,
  };
  return isTrumpCard ? trumpRank[rank] : normalRank[rank];
}

/**
 * Helper: Check if player's only trump cards are Jacks
 */
function hasOnlyJackTrump(handCards: Card[], trumpSuit: Suit): boolean {
  if (trumpSuit === 'notrump') return false;
  const trumps = handCards.filter((c) => c.suit === trumpSuit);
  if (trumps.length === 0) return false;
  return trumps.every((c) => c.rank === 'J');
}

function isCardPlayable(
  card: Card,
  context: PlayContext,
): { playable: boolean; reason?: string } {
  const { handCards, leadCard, trumpSuit, playedCards } = context;

  // First player: Any card is valid
  if (!leadCard) {
    return { playable: true };
  }

  const leadSuit = leadCard.suit;
  const hasLeadSuit = hasSuit(handCards, leadSuit);

  if (hasLeadSuit) {
    // Jack of trump exception
    if (leadSuit === trumpSuit && hasOnlyJackTrump(handCards, trumpSuit)) {
      return { playable: true };
    }

    if (card.suit === leadSuit) {
      return { playable: true };
    }
    // Can also play trump
    if (trumpSuit !== 'notrump' && card.suit === trumpSuit) {
      const playedTrumps = playedCards.filter((p) => p.card.suit === trumpSuit);
      if (playedTrumps.length > 0) {
        const highestPlayed = playedTrumps
          .map((p) => ({ card: p.card, rank: getCardRank(p.card.rank, true) }))
          .sort((a, b) => b.rank - a.rank)[0];
        const cardRankValue = getCardRank(card.rank, true);
        const hasNonTrump = handCards.some((c) => c.suit !== trumpSuit);
        if (cardRankValue < highestPlayed.rank && leadCard.suit !== trumpSuit && hasNonTrump) {
          return { playable: false, reason: 'Cannot play lower trump' };
        }
      }
      return { playable: true };
    }
    return { playable: false, reason: 'Must follow suit or play trump' };
  }

  // Player doesn't have lead suit
  if (trumpSuit !== 'notrump') {
    const hasOnlyJackAsTrump = hasOnlyJackTrump(handCards, trumpSuit);
    const isTrumpLead = leadCard.suit === trumpSuit;

    if (isTrumpLead && hasOnlyJackAsTrump && card.suit !== trumpSuit) {
      return { playable: true };
    }

    const playedTrumps = playedCards.filter((p) => p.card.suit === trumpSuit);

    if (playedTrumps.length > 0) {
      const highestPlayed = playedTrumps
        .map((p) => ({ card: p.card, rank: getCardRank(p.card.rank, true) }))
        .sort((a, b) => b.rank - a.rank)[0];

      if (card.suit === trumpSuit) {
        const cardRankValue = getCardRank(card.rank, true);
        const hasNonTrump = handCards.some((c) => c.suit !== trumpSuit);
        if (cardRankValue < highestPlayed.rank && leadCard.suit !== trumpSuit && hasNonTrump) {
          return { playable: false, reason: 'Cannot play lower trump' };
        }
        return { playable: true };
      }

      return { playable: true };
    }

    return { playable: true };
  }

  return { playable: true };
}

// --- Trick resolution ---

function compareCards(
  a: Card,
  b: Card,
  trumpSuit: Suit,
  leadSuit: Exclude<Suit, 'notrump'>,
): number {
  const aIsTrump = isTrump(a, trumpSuit);
  const bIsTrump = isTrump(b, trumpSuit);
  const aIsLeadSuit = a.suit === leadSuit;
  const bIsLeadSuit = b.suit === leadSuit;

  if (aIsTrump && !bIsTrump) return 1;
  if (!aIsTrump && bIsTrump) return -1;

  if (!aIsTrump && !bIsTrump) {
    if (aIsLeadSuit && !bIsLeadSuit) return 1;
    if (!aIsLeadSuit && bIsLeadSuit) return -1;
  }

  const aRank = getCardRank(a.rank, aIsTrump);
  const bRank = getCardRank(b.rank, bIsTrump);

  if (aRank !== bRank) return aRank - bRank;
  return 0;
}

function determineTrickWinner(
  playedCards: Array<{ playerId: string; card: Card }>,
  trumpSuit: Suit,
): { winnerId: string; winningCard: Card } {
  if (playedCards.length === 0) {
    throw new Error('Cannot determine winner of empty trick');
  }

  const leadSuit = playedCards[0].card.suit;
  let winner = playedCards[0];

  for (let i = 1; i < playedCards.length; i++) {
    const comparison = compareCards(
      playedCards[i].card,
      winner.card,
      trumpSuit,
      leadSuit,
    );
    if (comparison > 0) {
      winner = playedCards[i];
    }
  }

  return { winnerId: winner.playerId, winningCard: winner.card };
}

// --- Scoring ---

function calculateHandScore(context: HandScoreContext): { points: number; bonus: number } {
  const { bet, tricksWon } = context;
  const points = tricksWon;
  const bonus = tricksWon === bet ? 10 : 0;
  return { points, bonus };
}

// --- Deck and dealing ---

function createDeck(): Card[] {
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

function sortHand(hand: Card[], trumpSuit: Suit = 'notrump'): Card[] {
  const suitOrder: Exclude<Suit, 'notrump'>[] = ['clubs', 'spades', 'hearts', 'diamonds'];

  return [...hand].sort((a, b) => {
    const aIsTrump = trumpSuit !== 'notrump' && a.suit === trumpSuit;
    const bIsTrump = trumpSuit !== 'notrump' && b.suit === trumpSuit;

    if (aIsTrump && !bIsTrump) return -1;
    if (!aIsTrump && bIsTrump) return 1;

    if (a.suit === b.suit) {
      const aRank = getCardRank(a.rank, aIsTrump);
      const bRank = getCardRank(b.rank, bIsTrump);
      return bRank - aRank;
    }

    return suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
  });
}

// ============================================================
// 3. GAME ENGINE  (from src/game/engine.ts)
// ============================================================

// --- Type definitions ---

interface ServerPlayer {
  id: string;
  name: string;
  hand: Card[];
  bet: number | null;
  tricksWon: number;
  score: number;
  bonus: number;
  isReady: boolean;
}

interface ServerTrick {
  cards: Array<{ playerId: string; card: Card }>;
  winnerId: string;
  leadSuit: Exclude<Suit, 'notrump'> | '';
}

interface HandResult {
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

interface ServerGameState {
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

type GameActionType = 'place_bet' | 'play_card' | 'start_game' | 'continue_hand';

interface GameAction {
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

interface ActionResult {
  success: boolean;
  state: ServerGameState;
  error?: string;
}

// --- Initialization ---

function initGame(
  players: Array<{ id: string; name: string }>,
  roomId: string,
  firstHandStartingPlayerIndex: number,
): ServerGameState {
  const playerCount = players.length;
  const maxCards = getMaxCards(playerCount);
  const totalHands = getTotalHands(maxCards);
  const cardsPerPlayer = getHandCards(1, maxCards);
  const trumpSuit = getTrumpForHand(1);

  const serverPlayers: ServerPlayer[] = players.map((p) => ({
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

  return dealHand(state);
}

// --- Action dispatcher ---

function applyAction(state: ServerGameState, action: GameAction): ActionResult {
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
      return {
        success: false,
        state,
        error: `Unknown action type: ${(action as GameAction).type}`,
      };
  }
}

// --- Action handlers ---

function applyStartGame(state: ServerGameState, action: GameAction): ActionResult {
  const { data } = action;
  if (!data?.players || !data.roomId) {
    return {
      success: false,
      state,
      error: 'start_game requires players and roomId in data',
    };
  }

  const firstHandStartingPlayerIndex = data.firstHandStartingPlayerIndex ?? 0;
  const newState = initGame(data.players, data.roomId, firstHandStartingPlayerIndex);
  return { success: true, state: newState };
}

function applyPlaceBet(state: ServerGameState, action: GameAction): ActionResult {
  if (state.phase !== 'betting') {
    return { success: false, state, error: 'Cannot place bet: not in betting phase' };
  }

  const { playerId, data } = action;
  const bet = data?.bet;
  if (bet === undefined || bet === null) {
    return { success: false, state, error: 'Cannot place bet: no bet amount provided' };
  }

  const playerIndex = state.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) {
    return { success: false, state, error: `Player ${playerId} not found` };
  }
  if (playerIndex !== state.bettingPlayerIndex) {
    return { success: false, state, error: `Not ${playerId}'s turn to bet` };
  }

  const playersWithoutBets = state.players.filter((p) => p.bet === null);
  const isLastPlayer = playersWithoutBets.length === 1;

  const currentBets: Bet[] = state.players
    .filter((p) => p.bet !== null)
    .map((p) => ({ playerId: p.id, amount: p.bet! }));

  const bettingContext: BettingContext = {
    playerCount: state.playerCount,
    cardsPerPlayer: state.cardsPerPlayer,
    currentBets,
    isLastPlayer,
  };

  if (!isValidBet(bet, bettingContext)) {
    return { success: false, state, error: `Invalid bet: ${bet}` };
  }

  const updatedPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, bet } : p,
  );

  const hasAllBets = updatedPlayers.every((p) => p.bet !== null);
  const nextBettingIndex = hasAllBets
    ? state.bettingPlayerIndex
    : getNextPlayerIndex(state.bettingPlayerIndex, state.playerCount);

  let newState: ServerGameState = {
    ...state,
    players: updatedPlayers,
    bettingPlayerIndex: nextBettingIndex,
    hasAllBets,
  };

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

function applyPlayCard(state: ServerGameState, action: GameAction): ActionResult {
  if (state.phase !== 'playing') {
    return { success: false, state, error: 'Cannot play card: not in playing phase' };
  }

  const { playerId, data } = action;
  const cardId = data?.cardId;
  if (!cardId) {
    return { success: false, state, error: 'Cannot play card: no cardId provided' };
  }

  const playerIndex = state.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) {
    return { success: false, state, error: `Player ${playerId} not found` };
  }
  if (playerIndex !== state.currentPlayerIndex) {
    return { success: false, state, error: `Not ${playerId}'s turn to play` };
  }

  const player = state.players[playerIndex];
  const card = player.hand.find((c) => c.id === cardId);
  if (!card) {
    return { success: false, state, error: `Card ${cardId} not in player's hand` };
  }

  const currentTrick: ServerTrick = state.currentTrick ?? {
    cards: [],
    winnerId: '',
    leadSuit: '' as Exclude<Suit, 'notrump'> | '',
  };

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

  const updatedPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, hand: p.hand.filter((c) => c.id !== cardId) } : p,
  );

  const isFirstCard = currentTrick.cards.length === 0;
  const updatedTrick: ServerTrick = {
    ...currentTrick,
    cards: [...currentTrick.cards, { playerId, card }],
    leadSuit: isFirstCard ? card.suit : currentTrick.leadSuit,
  };

  const trickComplete = updatedTrick.cards.length === state.playerCount;

  if (trickComplete) {
    const { winnerId } = determineTrickWinner(updatedTrick.cards, state.trumpSuit);
    const completedTrick: ServerTrick = { ...updatedTrick, winnerId };

    return completeTrick({ ...state, players: updatedPlayers }, completedTrick);
  }

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

// --- Trick and hand completion ---

function completeTrick(
  state: ServerGameState,
  completedTrick: ServerTrick,
): ActionResult {
  const winnerId = completedTrick.winnerId;

  const updatedPlayers = state.players.map((p) =>
    p.id === winnerId ? { ...p, tricksWon: p.tricksWon + 1 } : p,
  );

  const updatedTricks = [...state.tricks, completedTrick];
  const isHandDone = updatedTricks.length >= state.cardsPerPlayer;
  const winnerIndex = updatedPlayers.findIndex((p) => p.id === winnerId);

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

function completeHand(state: ServerGameState): ActionResult {
  const updatedPlayers = state.players.map((p) => {
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

  const handResult: HandResult = {
    handNumber: state.handNumber,
    startingPlayerIndex: state.startingPlayerIndex,
    results: state.players.map((p) => {
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

function applyContinueHand(state: ServerGameState, _action: GameAction): ActionResult {
  if (state.phase !== 'scoring') {
    return { success: false, state, error: 'Cannot continue hand: not in scoring phase' };
  }

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

  const P = state.playerCount;
  const startingPlayer =
    ((state.firstHandStartingPlayerIndex - (nextHandNumber - 1)) % P + P) % P;

  const resetPlayers = state.players.map((p) => ({
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

  return { success: true, state: dealHand(nextState) };
}

// --- Dealing ---

function dealHand(state: ServerGameState): ServerGameState {
  const { cardsPerPlayer, handNumber, trumpSuit, roomId, players } = state;

  const deck = createDeck();
  const seed = `${roomId || 'default'}-hand-${handNumber}`;
  const shuffledDeck = seededShuffle(deck, seed);

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

  const dealtPlayers = players.map((p) => ({
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
