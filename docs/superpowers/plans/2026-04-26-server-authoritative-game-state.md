# Server-Authoritative Game State — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace client-side peer-to-peer game state with a single Supabase Edge Function that processes all game actions, eliminating Realtime event drop desync.

**Architecture:** One Edge Function `game-action` is the sole writer of `game_states`. Clients send actions via HTTP POST and read state via 2s polling. No Realtime for game state. Pure game engine extracted to `src/game/engine.ts` — used by both Edge Function and client (for UI helpers).

**Tech Stack:** Supabase Edge Functions (Deno/TypeScript), existing game rules from `src/game/rules.ts`, Zustand store as thin renderer

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/game/engine.ts` | Create | Pure game engine: `applyAction(state, action) → result` |
| `src/game/engine.test.ts` | Create | Unit tests for game engine |
| `supabase/functions/game-action/index.ts` | Create | Edge Function: read state → apply action → write state |
| `src/lib/multiplayer/gameActions.ts` | Rewrite | `callGameAction(roomId, playerId, type, data)` — HTTP to Edge Function |
| `src/store/gameStore.ts` | Modify | Remove game logic, keep as thin renderer + `forceRemoteState` |
| `src/screens/GameTableScreen.tsx` | Modify | Replace heartbeat/Realtime with 2s polling, call Edge Function for actions |
| `src/components/betting/BettingPhase.tsx` | Modify | Replace heartbeat with 2s polling, call Edge Function for bets |
| `src/lib/multiplayer/eventHandler.ts` | Modify | Remove game event handlers, keep room/player management only |

---

### Task 1: Extract Pure Game Engine

**Files:**
- Create: `src/game/engine.ts`
- Create: `src/game/engine.test.ts`

This is the core task. Extract all game logic from `gameStore.ts` (lines 274-738) into pure functions that take state and return new state.

- [ ] **Step 1: Define the ServerGameState type and action types**

Create `src/game/engine.ts`:

```typescript
/**
 * Nägels Online — Pure Game Engine
 *
 * Stateless functions: (state, action) → newState
 * Used by Supabase Edge Function (server) and client (UI helpers).
 * No Zustand, React, or Supabase dependencies.
 */

import {
  type Card,
  type Suit,
  type Rank,
  type GamePhase,
  type Bet,
  type BettingContext,
  type PlayContext,
  createDeck,
  shuffleDeck,
  sortHand,
  getMaxCards,
  getHandCards,
  getTrumpForHand,
  getTotalHands,
  getNextPlayerIndex,
  getAllowedBets as getAllowedBetsRule,
  isValidBet,
  getPlayableCards as getPlayableCardsRule,
  isCardPlayable,
  determineTrickWinner,
  calculateHandScore,
} from './rules';
import { seededShuffle } from '../lib/multiplayer/seededRandom';

// ============================================================
// TYPES
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
    card?: Card;
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
```

- [ ] **Step 2: Implement `initGame` — initialize game state for a new game**

Add to `src/game/engine.ts`:

```typescript
// ============================================================
// GAME INITIALIZATION
// ============================================================

export function initGame(
  players: Array<{ id: string; name: string }>,
  roomId: string,
  firstHandStartingPlayerIndex: number = 0,
): ServerGameState {
  const playerCount = players.length;
  const maxCardsPerPlayer = getMaxCards(playerCount);
  const totalHands = getTotalHands(maxCardsPerPlayer);
  const handNumber = 1;
  const cardsPerPlayer = getHandCards(handNumber, maxCardsPerPlayer);
  const trumpSuit = getTrumpForHand(handNumber);

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
    handNumber,
    totalHands,
    playerCount,
    maxCardsPerPlayer,
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

  // Deal cards for first hand
  return dealHand(state);
}

function dealHand(state: ServerGameState): ServerGameState {
  const deck = createDeck();
  const seed = `${state.roomId}-hand-${state.handNumber}`;
  const shuffledDeck = seededShuffle(deck, seed);

  const hands = new Map<string, Card[]>();
  for (const p of state.players) hands.set(p.id, []);

  let cardIndex = 0;
  for (let i = 0; i < state.cardsPerPlayer; i++) {
    for (const p of state.players) {
      if (cardIndex < shuffledDeck.length) {
        hands.get(p.id)!.push(shuffledDeck[cardIndex++]);
      }
    }
  }

  for (const p of state.players) {
    hands.set(p.id, sortHand(hands.get(p.id)!, state.trumpSuit));
  }

  const players = state.players.map(p => ({
    ...p,
    hand: hands.get(p.id) || [],
    bet: null,
    tricksWon: 0,
    isReady: false,
  }));

  return {
    ...state,
    phase: 'betting',
    players,
    deck: shuffledDeck,
    bettingPlayerIndex: state.startingPlayerIndex,
    hasAllBets: false,
    currentTrick: null,
    tricks: [],
  };
}
```

- [ ] **Step 3: Implement `applyPlaceBet`**

Add to `src/game/engine.ts`:

```typescript
// ============================================================
// ACTIONS
// ============================================================

function applyPlaceBet(state: ServerGameState, playerId: string, bet: number): ActionResult {
  if (state.phase !== 'betting') {
    return { success: false, state, error: 'Not in betting phase' };
  }

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) {
    return { success: false, state, error: 'Player not found' };
  }
  if (playerIndex !== state.bettingPlayerIndex) {
    return { success: false, state, error: 'Not your turn to bet' };
  }

  const currentBets: Bet[] = state.players
    .filter(p => p.bet !== null)
    .map(p => ({ playerId: p.id, amount: p.bet! }));

  const context: BettingContext = {
    totalCards: state.cardsPerPlayer,
    currentBets,
    playerCount: state.playerCount,
    isLastPlayer: currentBets.length === state.playerCount - 1,
  };

  if (!isValidBet(bet, context)) {
    return { success: false, state, error: 'Invalid bet' };
  }

  const players = [...state.players];
  players[playerIndex] = { ...players[playerIndex], bet };

  const nextIndex = getNextPlayerIndex(playerIndex, state.playerCount);
  const hasAllBets = players.every(p => p.bet !== null);

  let newState: ServerGameState = {
    ...state,
    players,
    bettingPlayerIndex: hasAllBets ? playerIndex : nextIndex,
    hasAllBets,
  };

  // Auto-transition to playing if all bets placed
  if (hasAllBets) {
    newState = {
      ...newState,
      phase: 'playing',
      currentPlayerIndex: state.startingPlayerIndex,
      currentTrick: { cards: [], winnerId: '', leadSuit: '' },
    };
  }

  return { success: true, state: newState };
}
```

- [ ] **Step 4: Implement `applyPlayCard`**

Add to `src/game/engine.ts`:

```typescript
function applyPlayCard(state: ServerGameState, playerId: string, cardId: string): ActionResult {
  if (state.phase !== 'playing') {
    return { success: false, state, error: 'Not in playing phase' };
  }

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) {
    return { success: false, state, error: 'Player not found' };
  }
  if (playerIndex !== state.currentPlayerIndex) {
    return { success: false, state, error: 'Not your turn' };
  }

  const player = state.players[playerIndex];
  const card = player.hand.find(c => c.id === cardId);
  if (!card) {
    return { success: false, state, error: 'Card not in hand' };
  }

  // Validate card play (follow suit rules)
  const trick = state.currentTrick || { cards: [], winnerId: '', leadSuit: '' };
  const leadCard = trick.cards.length > 0 ? trick.cards[0].card : null;
  const playContext: PlayContext = {
    handCards: player.hand,
    leadCard,
    trumpSuit: state.trumpSuit,
    currentTrick: trick.cards,
  };

  const { playable, reason } = isCardPlayable(card, playContext);
  if (!playable) {
    return { success: false, state, error: reason || 'Cannot play this card' };
  }

  // Remove card from hand
  const players = [...state.players];
  players[playerIndex] = {
    ...players[playerIndex],
    hand: player.hand.filter(c => c.id !== cardId),
  };

  // Add to trick
  const isFirstCard = trick.cards.length === 0;
  const updatedTrick: ServerTrick = {
    ...trick,
    cards: [...trick.cards, { playerId, card }],
    leadSuit: isFirstCard ? card.suit : trick.leadSuit,
  };

  // Check trick completion
  const trickComplete = updatedTrick.cards.length === state.playerCount;

  if (trickComplete) {
    return completeTrick({ ...state, players, currentTrick: updatedTrick });
  }

  // Move to next player
  const nextIndex = getNextPlayerIndex(state.currentPlayerIndex, state.playerCount);

  return {
    success: true,
    state: {
      ...state,
      players,
      currentTrick: updatedTrick,
      currentPlayerIndex: nextIndex,
    },
  };
}

function completeTrick(state: ServerGameState): ActionResult {
  const trick = state.currentTrick!;
  const { winnerId } = determineTrickWinner(trick.cards, state.trumpSuit);

  const players = state.players.map(p =>
    p.id === winnerId ? { ...p, tricksWon: p.tricksWon + 1 } : p
  );

  const winnerIndex = players.findIndex(p => p.id === winnerId);
  const updatedTricks = [...state.tricks, { ...trick, winnerId }];
  const isHandDone = updatedTricks.length >= state.cardsPerPlayer;

  if (isHandDone) {
    return completeHand({
      ...state,
      players,
      tricks: updatedTricks,
      currentTrick: null,
      currentPlayerIndex: winnerIndex,
    });
  }

  return {
    success: true,
    state: {
      ...state,
      players,
      tricks: updatedTricks,
      currentTrick: null,
      currentPlayerIndex: winnerIndex,
    },
  };
}

function completeHand(state: ServerGameState): ActionResult {
  const players = state.players.map(p => {
    const { points, bonus } = calculateHandScore({
      playerId: p.id,
      bet: p.bet || 0,
      tricksWon: p.tricksWon,
    });
    return { ...p, score: p.score + points, bonus: p.bonus + bonus };
  });

  const handResult: HandResult = {
    handNumber: state.handNumber,
    startingPlayerIndex: state.startingPlayerIndex,
    results: state.players.map(p => {
      const { points, bonus } = calculateHandScore({
        playerId: p.id,
        bet: p.bet || 0,
        tricksWon: p.tricksWon,
      });
      return { playerId: p.id, bet: p.bet || 0, tricksWon: p.tricksWon, points, bonus };
    }),
  };

  return {
    success: true,
    state: {
      ...state,
      phase: 'scoring',
      players,
      scoreHistory: [...state.scoreHistory, handResult],
    },
  };
}
```

- [ ] **Step 5: Implement `applyContinueHand` and the main `applyAction` dispatcher**

Add to `src/game/engine.ts`:

```typescript
function applyContinueHand(state: ServerGameState, playerId: string): ActionResult {
  // Only advance from scoring
  if (state.phase !== 'scoring') {
    return { success: false, state, error: 'Not in scoring phase' };
  }

  if (state.handNumber >= state.totalHands) {
    return { success: true, state: { ...state, phase: 'finished' } };
  }

  const nextHandNumber = state.handNumber + 1;
  const cardsPerPlayer = getHandCards(nextHandNumber, state.maxCardsPerPlayer);
  const trumpSuit = getTrumpForHand(nextHandNumber);
  const P = state.playerCount;
  const startingPlayer = ((state.firstHandStartingPlayerIndex - (nextHandNumber - 1)) % P + P) % P;

  const resetPlayers = state.players.map(p => ({
    ...p, bet: null, tricksWon: 0, hand: [], isReady: false,
  }));

  const nextState: ServerGameState = {
    ...state,
    phase: 'lobby',
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

  // Deal and transition to betting
  return { success: true, state: dealHand(nextState) };
}

function applyStartGame(state: ServerGameState, action: GameAction): ActionResult {
  if (!action.data?.players || !action.data?.roomId) {
    return { success: false, state, error: 'Missing players or roomId' };
  }

  const newState = initGame(
    action.data.players,
    action.data.roomId,
    action.data.firstHandStartingPlayerIndex ?? 0,
  );

  return { success: true, state: newState };
}

// ============================================================
// MAIN DISPATCHER
// ============================================================

export function applyAction(state: ServerGameState, action: GameAction): ActionResult {
  switch (action.type) {
    case 'start_game':
      return applyStartGame(state, action);
    case 'place_bet':
      if (action.data?.bet === undefined) return { success: false, state, error: 'Missing bet' };
      return applyPlaceBet(state, action.playerId, action.data.bet);
    case 'play_card':
      if (!action.data?.cardId) return { success: false, state, error: 'Missing cardId' };
      return applyPlayCard(state, action.playerId, action.data.cardId);
    case 'continue_hand':
      return applyContinueHand(state, action.playerId);
    default:
      return { success: false, state, error: `Unknown action: ${action.type}` };
  }
}
```

- [ ] **Step 6: Write unit tests for game engine**

Create `src/game/engine.test.ts`:

```typescript
import { initGame, applyAction, type ServerGameState } from './engine';

describe('Game Engine', () => {
  const players = [
    { id: 'p1', name: 'Alice' },
    { id: 'p2', name: 'Bob' },
    { id: 'p3', name: 'Carol' },
    { id: 'p4', name: 'Dave' },
  ];

  let state: ServerGameState;

  beforeEach(() => {
    state = initGame(players, 'test-room', 0);
  });

  test('initGame deals correct cards and sets betting phase', () => {
    expect(state.phase).toBe('betting');
    expect(state.playerCount).toBe(4);
    expect(state.players.every(p => p.hand.length === state.cardsPerPlayer)).toBe(true);
    expect(state.bettingPlayerIndex).toBe(0);
  });

  test('place_bet validates turn order', () => {
    const wrong = applyAction(state, { type: 'place_bet', playerId: 'p2', data: { bet: 0 } });
    expect(wrong.success).toBe(false);
    expect(wrong.error).toContain('Not your turn');

    const right = applyAction(state, { type: 'place_bet', playerId: 'p1', data: { bet: 0 } });
    expect(right.success).toBe(true);
    expect(right.state.players[0].bet).toBe(0);
  });

  test('all bets placed auto-transitions to playing', () => {
    let s = state;
    for (let i = 0; i < 4; i++) {
      const pid = s.players[s.bettingPlayerIndex].id;
      const r = applyAction(s, { type: 'place_bet', playerId: pid, data: { bet: 0 } });
      expect(r.success).toBe(true);
      s = r.state;
    }
    expect(s.phase).toBe('playing');
    expect(s.currentTrick).not.toBeNull();
  });

  test('play_card validates turn and updates trick', () => {
    // Fast-forward to playing phase
    let s = state;
    for (let i = 0; i < 4; i++) {
      const pid = s.players[s.bettingPlayerIndex].id;
      s = applyAction(s, { type: 'place_bet', playerId: pid, data: { bet: 0 } }).state;
    }

    const currentPlayer = s.players[s.currentPlayerIndex];
    const card = currentPlayer.hand[0];
    const r = applyAction(s, { type: 'play_card', playerId: currentPlayer.id, data: { cardId: card.id } });
    expect(r.success).toBe(true);
    expect(r.state.currentTrick!.cards.length).toBe(1);
    expect(r.state.players[s.currentPlayerIndex].hand.length).toBe(currentPlayer.hand.length - 1);
  });

  test('complete trick determines winner and advances', () => {
    let s = state;
    // Bet
    for (let i = 0; i < 4; i++) {
      const pid = s.players[s.bettingPlayerIndex].id;
      s = applyAction(s, { type: 'place_bet', playerId: pid, data: { bet: 0 } }).state;
    }
    // Play one full trick
    for (let i = 0; i < 4; i++) {
      const cp = s.players[s.currentPlayerIndex];
      const card = cp.hand[0]; // Play first available card
      const r = applyAction(s, { type: 'play_card', playerId: cp.id, data: { cardId: card.id } });
      expect(r.success).toBe(true);
      s = r.state;
    }
    // After 4 cards, trick should be complete
    expect(s.currentTrick).toBeNull(); // Cleared
    expect(s.tricks.length).toBe(1);
    expect(s.tricks[0].winnerId).not.toBe('');
  });

  test('continue_hand deals new cards', () => {
    // Play a full hand (need to go through all tricks)
    // For simplicity, just test the transition
    const scoringState: ServerGameState = { ...state, phase: 'scoring', handNumber: 1 };
    const r = applyAction(scoringState, { type: 'continue_hand', playerId: 'p1' });
    expect(r.success).toBe(true);
    expect(r.state.phase).toBe('betting');
    expect(r.state.handNumber).toBe(2);
  });

  test('last hand leads to finished', () => {
    const lastHandScoring: ServerGameState = {
      ...state,
      phase: 'scoring',
      handNumber: state.totalHands,
    };
    const r = applyAction(lastHandScoring, { type: 'continue_hand', playerId: 'p1' });
    expect(r.success).toBe(true);
    expect(r.state.phase).toBe('finished');
  });
});
```

- [ ] **Step 7: Run tests**

Run: `npx jest src/game/engine.test.ts --no-cache`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/game/engine.ts src/game/engine.test.ts
git commit -m "feat: extract pure game engine for server-authoritative state"
```

---

### Task 2: Create Supabase Edge Function

**Files:**
- Create: `supabase/functions/game-action/index.ts`

- [ ] **Step 1: Initialize Supabase functions directory**

```bash
mkdir -p supabase/functions/game-action
```

- [ ] **Step 2: Create the Edge Function**

Create `supabase/functions/game-action/index.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Import game engine — in Deno, we need to inline or use a URL import
// For now, we'll include the engine logic directly via a shared module approach
// The game engine will be copied/bundled into the function

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { room_id, player_id, action_type, action_data } = await req.json();

    if (!room_id || !player_id || !action_type) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Create Supabase client with service role key for database access
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Read current game state (with row lock)
    const { data: row, error: readError } = await supabase
      .from('game_states')
      .select('game_state, version')
      .eq('room_id', room_id)
      .single();

    if (readError && action_type !== 'start_game') {
      return new Response(
        JSON.stringify({ success: false, error: 'Game not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const currentState = row?.game_state || {};
    const currentVersion = row?.version || 0;

    // Apply action using game engine
    const action = { type: action_type, playerId: player_id, data: action_data };
    const result = applyAction(currentState, action);

    if (!result.success) {
      return new Response(
        JSON.stringify({ success: false, error: result.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Write new state
    const newVersion = currentVersion + 1;
    const { error: writeError } = await supabase
      .from('game_states')
      .upsert({
        room_id,
        phase: result.state.phase,
        hand_number: result.state.handNumber,
        current_player_index: result.state.currentPlayerIndex,
        trump_suit: result.state.trumpSuit,
        cards_per_player: result.state.cardsPerPlayer,
        players: result.state.players,
        current_trick: result.state.currentTrick || { cards: [], winnerId: '', leadSuit: '' },
        tricks: result.state.tricks,
        deck: result.state.deck,
        version: newVersion,
        game_state: result.state,
      }, { onConflict: 'room_id' });

    if (writeError) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to save state: ' + writeError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, state: result.state, version: newVersion }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

// ============================================================
// INLINE GAME ENGINE
// ============================================================
// The game engine functions (applyAction, etc.) need to be included
// here because Deno Edge Functions can't import from the Expo project.
// This will be a copy of the core logic from src/game/engine.ts.
//
// IMPORTANT: When implementing this task, copy the full applyAction
// function and all its dependencies (applyPlaceBet, applyPlayCard,
// completeTrick, completeHand, applyContinueHand, initGame, dealHand)
// from src/game/engine.ts. Also copy the needed functions from
// src/game/rules.ts (createDeck, sortHand, determineTrickWinner, etc.)
// and src/lib/multiplayer/seededRandom.ts (seededShuffle).
//
// The implementer should:
// 1. Read src/game/engine.ts (from Task 1)
// 2. Read src/game/rules.ts
// 3. Read src/lib/multiplayer/seededRandom.ts
// 4. Copy all needed code into this file (no imports from src/)
```

Note: The Edge Function must be self-contained — it cannot import from the Expo project. The implementer must copy the game engine, rules, and seeded random code into the function file.

- [ ] **Step 3: Deploy the Edge Function**

```bash
npx supabase functions deploy game-action --project-ref evcaqgmkdlqesqisjfyh
```

If `supabase` CLI is not installed: `npm install -g supabase`

- [ ] **Step 4: Test the Edge Function manually**

```bash
curl -X POST https://evcaqgmkdlqesqisjfyh.supabase.co/functions/v1/game-action \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ANON_KEY" \
  -d '{"room_id":"test","player_id":"p1","action_type":"start_game","action_data":{"players":[{"id":"p1","name":"Alice"},{"id":"p2","name":"Bob"}],"roomId":"test"}}'
```

Expected: `{ "success": true, "state": { "phase": "betting", ... }, "version": 1 }`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/game-action/index.ts
git commit -m "feat: add Supabase Edge Function for server-authoritative game actions"
```

---

### Task 3: Rewrite Client gameActions to Call Edge Function

**Files:**
- Rewrite: `src/lib/multiplayer/gameActions.ts`

- [ ] **Step 1: Replace gameActions with Edge Function calls**

Rewrite `src/lib/multiplayer/gameActions.ts`:

```typescript
/**
 * Nägels Online — Multiplayer Game Actions
 *
 * All game actions go through the Supabase Edge Function.
 * The server is the single source of truth.
 */

import { getSupabaseClient } from '../supabase/client';
import { useMultiplayerStore } from '../../store/multiplayerStore';
import { useGameStore } from '../../store/gameStore';

const EDGE_FUNCTION_URL = process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1/game-action';

async function callGameAction(
  actionType: string,
  actionData?: Record<string, unknown>,
): Promise<{ success: boolean; state?: any; version?: number; error?: string }> {
  const multiplayerState = useMultiplayerStore.getState();
  const roomId = multiplayerState.currentRoom?.id;
  const gameState = useGameStore.getState();
  const playerId = gameState.myPlayerId;

  if (!roomId || !playerId) {
    return { success: false, error: 'Not in a room' };
  }

  try {
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        room_id: roomId,
        player_id: playerId,
        action_type: actionType,
        action_data: actionData,
      }),
    });

    const result = await response.json();

    if (result.success && result.state) {
      // Apply server state immediately (actor gets instant feedback)
      useGameStore.getState().forceRemoteState({
        ...result.state,
        version: result.version,
        players: result.state.players,
      });
    }

    return result;
  } catch (error) {
    console.error('[GameActions] Edge Function call failed:', error);
    return { success: false, error: 'Network error' };
  }
}

export async function multiplayerPlaceBet(playerId: string, bet: number): Promise<void> {
  const result = await callGameAction('place_bet', { bet });
  if (!result.success) {
    console.error('[GameActions] Place bet failed:', result.error);
    throw new Error(result.error || 'Failed to place bet');
  }
}

export async function multiplayerPlayCard(playerId: string, cardId: string, card: any): Promise<void> {
  const result = await callGameAction('play_card', { cardId });
  if (!result.success) {
    console.error('[GameActions] Play card failed:', result.error);
    throw new Error(result.error || 'Failed to play card');
  }
}

export async function multiplayerContinueHand(): Promise<void> {
  const result = await callGameAction('continue_hand');
  if (!result.success) {
    console.error('[GameActions] Continue hand failed:', result.error);
  }
}

export async function multiplayerStartGame(
  players: Array<{ id: string; name: string }>,
  firstHandStartingPlayerIndex: number,
): Promise<void> {
  const multiplayerState = useMultiplayerStore.getState();
  const roomId = multiplayerState.currentRoom?.id;
  const result = await callGameAction('start_game', {
    players,
    roomId,
    firstHandStartingPlayerIndex,
  });
  if (!result.success) {
    throw new Error(result.error || 'Failed to start game');
  }
}

/**
 * Send a chat message (unchanged — still writes to game_events)
 */
export async function multiplayerSendChat(
  playerId: string,
  playerName: string,
  text: string,
): Promise<void> {
  const state = useMultiplayerStore.getState();
  if (!state.currentRoom?.id) throw new Error('Not in a room');

  const supabase = getSupabaseClient();
  const { error } = await supabase.from('game_events').insert({
    room_id: state.currentRoom.id,
    event_type: 'chat_message',
    event_data: { player_id: playerId, player_name: playerName, text, timestamp: Date.now() },
    player_id: playerId,
    version: 1,
  });

  if (error) throw new Error('Failed to send message');
}

// Remove saveGameSnapshot — no longer needed, Edge Function writes game_states directly
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/multiplayer/gameActions.ts
git commit -m "feat: rewrite gameActions to call Edge Function instead of local state"
```

---

### Task 4: Simplify gameStore to Thin Renderer

**Files:**
- Modify: `src/store/gameStore.ts`

- [ ] **Step 1: Remove server-side game logic, keep UI helpers and forceRemoteState**

The following functions should be **removed** from gameStore.ts (game logic now lives in Edge Function):
- `startBetting` (lines 274-345) — replaced by `start_game` Edge Function action
- `placeBet` (lines 352-425) — replaced by `place_bet` Edge Function action
- `startPlaying` (lines 429-445) — auto-triggered by Edge Function when all bets placed
- `playCard` (lines 451-569) — replaced by `play_card` Edge Function action
- `completeTrick` (lines 573-615) — auto-triggered by Edge Function
- `completeHand` (lines 625-670) — auto-triggered by Edge Function
- `nextHand` (lines 676-718) — replaced by `continue_hand` Edge Function action
- `endGame` (lines 732-738) — auto-triggered by Edge Function
- `applyRemoteBet` (lines 1047-1099) — no longer needed
- `applyRemoteCardPlay` (lines 1105-1224) — no longer needed
- `setRemoteState` with guards (lines 940-1007) — replaced by simpler forceRemoteState
- `saveGameSnapshot` import and calls
- `pendingActions`, `incrementVersion`, `addPendingAction`, etc.

The following should be **kept/simplified**:
- `forceRemoteState` — simplified to just `set({...remoteState, myPlayerId: state.myPlayerId})` with no guards except scoring phase
- `getCurrentPlayer`, `getMyPlayer`, `getPlayableCards`, `getAllowedBets`, `canPlayCard`, `isBotTurn` — UI read-only helpers
- `reset` — clear state
- `initGame` — simplified to just set myPlayerId and player list (actual game init via Edge Function)
- `setMultiplayerMode`, `setBotDifficulty`

This is a large modification. The implementer should:
1. Read the full current gameStore.ts
2. Keep the interface properties (phase, handNumber, etc.)
3. Remove all game logic methods
4. Keep `forceRemoteState` (simplified)
5. Keep all getter/helper methods
6. Keep bot-related methods (single-player still uses local logic)

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/store/gameStore.ts
git commit -m "feat: simplify gameStore to thin renderer — game logic moved to server"
```

---

### Task 5: Replace Realtime with Polling in GameTableScreen

**Files:**
- Modify: `src/screens/GameTableScreen.tsx`

- [ ] **Step 1: Replace heartbeat/Realtime with 2s polling + Edge Function calls**

Key changes:
- Remove heartbeat (`lastStateChangeRef`, `heartbeatRef`, heartbeat useEffect)
- Remove `handleSync` (subscribeToRoomEvents/replayMissedEvents)
- Add simple 2s polling useEffect that calls `refreshGameState(roomId, true)`
- Change `handleScoreboardContinue` to call `multiplayerContinueHand()` instead of `nextHand()`/`endGame()`
- Keep sync button (calls `refreshGameState` for manual refresh)
- Keep stuck detection useEffect (all cards gone + playing phase → call `multiplayerContinueHand`)
- Remove `subscribeToRoomEvents` import and usage

The polling useEffect:
```typescript
useEffect(() => {
  if (!isMultiplayer || !currentRoom?.id) return;
  const roomId = currentRoom.id;
  const interval = setInterval(async () => {
    try { await refreshGameState(roomId, true); } catch (_) {}
  }, 2000);
  return () => clearInterval(interval);
}, [isMultiplayer, currentRoom?.id]);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/screens/GameTableScreen.tsx
git commit -m "feat: replace Realtime with 2s polling in GameTableScreen"
```

---

### Task 6: Replace Realtime with Polling in BettingPhase

**Files:**
- Modify: `src/components/betting/BettingPhase.tsx`

- [ ] **Step 1: Replace heartbeat with 2s polling**

Same pattern as Task 5:
- Remove heartbeat refs and useEffect
- Add simple 2s polling useEffect
- Change bet placement to call `multiplayerPlaceBet` (already does, but verify it goes through Edge Function)

- [ ] **Step 2: Commit**

```bash
git add src/components/betting/BettingPhase.tsx
git commit -m "feat: replace Realtime with 2s polling in BettingPhase"
```

---

### Task 7: Clean Up eventHandler — Remove Game Event Handling

**Files:**
- Modify: `src/lib/multiplayer/eventHandler.ts`

- [ ] **Step 1: Remove game event handlers, keep room/player management**

Remove:
- `handleBetPlaced`, `handleCardPlayed`, `handleTrickCompleted`, `handleHandCompleted`, `handleGameFinished`
- `replayMissedEvents`
- `lastProcessedEventTime`
- Game event cases from `handleGameEvent` switch (keep `chat_message`, `player_joined`, `player_left`)
- `saveGameSnapshot` import

Keep:
- `subscribeToRoomEvents` — still needed for room/player changes and chat
- `refreshGameState` — still used by polling
- `handleGameStateChange` — still used by refreshGameState → forceRemoteState
- `handleRoomChange`, `handlePlayerJoined`, `handlePlayerLeft`
- `handleChatMessage`
- `refreshRoom`, `refreshPlayers`

- [ ] **Step 2: Commit**

```bash
git add src/lib/multiplayer/eventHandler.ts
git commit -m "feat: strip game event handlers from eventHandler — server handles game state"
```

---

### Task 8: Integration Test with Demo

**Files:**
- Modify: `demo/play-demo.js` (if needed)

- [ ] **Step 1: Start dev server and run demo**

```bash
npx expo start --port 8081 &
sleep 15
DEMO_SLOW=10 npm run demo
```

- [ ] **Step 2: Verify full game completion**

Expected: All 4 players complete 20 hands, all 4 see Game Over, 0 timeouts, 0 desync.

- [ ] **Step 3: Fix any issues found during demo**

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "test: verify full 4-player game with server-authoritative state"
```
