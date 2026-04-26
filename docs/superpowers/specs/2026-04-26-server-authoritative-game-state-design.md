# Server-Authoritative Game State via Supabase Edge Function

## Problem

Each client independently computes game state. Supabase Realtime drops events intermittently, causing permanent client divergence. No amount of client-side patching (heartbeat, snapshots, polling) reliably fixes this because the fundamental architecture is peer-to-peer with no single source of truth.

## Solution

One Supabase Edge Function (`game-action`) is the sole writer of `game_states`. Clients are pure renderers: they send actions to the server and read state via polling. No Realtime subscriptions. No client-side game logic.

## Architecture

```
Client → POST /game-action → Edge Function → game_states (DB)
                                    ↓
                              Return new state → actor updates instantly

All clients: poll game_states every 2s → render
```

Single writer. Polling readers. No Realtime.

## Components

### 1. Game Engine (`src/game/engine.ts`)

Pure functions extracted from `gameStore.ts`. No Zustand, React, or Supabase dependencies.

```typescript
interface GameState {
  phase: 'lobby' | 'betting' | 'playing' | 'scoring' | 'finished';
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
  trumpSuit: string;
  deck: Card[];
  currentTrick: Trick | null;
  tricks: Trick[];
  players: PlayerState[];
  scoreHistory: HandResult[];
}

interface GameAction {
  type: 'place_bet' | 'play_card' | 'start_game' | 'continue_hand';
  playerId: string;
  data?: { bet?: number; cardId?: string; card?: Card };
}

interface ActionResult {
  success: boolean;
  state?: GameState;
  error?: string;
}

function applyAction(state: GameState, action: GameAction): ActionResult
```

The engine handles the full chain: `play_card → trick_complete → hand_complete → scoring → next_hand → deal` in a single call. No timers, no async — pure synchronous state transitions.

Functions to extract from gameStore.ts:
- `placeBet` → validate bet, update player, advance bettingPlayerIndex, check hasAllBets, auto-transition to playing
- `playCard` → validate card, add to trick, check trick complete, determine winner, check hand complete, calculate scores, check game over, deal next hand
- `startBetting` → create seeded deck, deal cards
- `nextHand` → rotate starting player, reset hand state
- `completeHand` → calculate scores, record history

### 2. Supabase Edge Function (`supabase/functions/game-action/index.ts`)

Single endpoint handling all game actions.

**Request:**
```json
{
  "room_id": "uuid",
  "player_id": "uuid",
  "action_type": "place_bet",
  "action_data": { "bet": 3 }
}
```

**Logic:**
1. Read current state: `SELECT game_state FROM game_states WHERE room_id = $1 FOR UPDATE`
2. Validate and apply: `applyAction(currentState, action)`
3. Write new state: `UPDATE game_states SET game_state = $2, version = version + 1, phase = $3, ... WHERE room_id = $1`
4. Return: `{ success: true, state: newState, version: newVersion }`

`SELECT FOR UPDATE` locks the row for the duration of the transaction, preventing concurrent modifications.

**Response (success):**
```json
{
  "success": true,
  "state": { ...fullGameState },
  "version": 42
}
```

**Response (error):**
```json
{
  "success": false,
  "error": "Not your turn"
}
```

### 3. Client (thin renderer)

**Action flow (actor):**
1. User clicks bet/card → UI shows loading state on button
2. `const result = await callGameAction(roomId, playerId, actionType, actionData)`
3. If success → `gameStore.forceRemoteState(result.state)` → UI updates
4. If error → show error toast, UI stays unchanged

**Polling (all clients):**
- `setInterval` every 2 seconds
- `SELECT game_state, version FROM game_states WHERE room_id = $1`
- If `version > localVersion` → `gameStore.forceRemoteState(state)` → UI updates
- If same version → skip (no-op)
- Version tracking prevents unnecessary re-renders

**Chat:**
- Sending: `INSERT INTO game_events` (same as now)
- Receiving: poll `game_events WHERE event_type = 'chat_message'` every 3 seconds (already exists)

**What getPlayableCards / getAllowedBets become:**
- Pure read-only filters that operate on the current state from server
- No game logic — just "given this state, which cards can I legally play?"
- These stay on the client as UI helpers

### 4. What Gets Removed

- All Supabase Realtime subscriptions for game state (`onGameEvent`, `onGameStateChange`, channel management)
- `applyRemoteBet`, `applyRemoteCardPlay` in gameStore
- `replayMissedEvents`, heartbeat, event replay logic
- `networkMonitor.ts` reconnect logic for Realtime
- `saveGameSnapshot` from gameActions
- `handleGameStateChange`, `handleCardPlayed`, `handleBetPlaced` event handlers
- `setRemoteState` guards (no longer needed — server is always right)

### 5. What Stays

- `gameStore.ts` — simplified to: hold state + render helpers (`getPlayableCards`, `getCurrentPlayer`, etc.)
- `forceRemoteState` — simplified, no guards needed (server is authoritative)
- Chat polling (already exists in GameTableScreen)
- Sync button (🔄) — now calls polling manually for instant refresh
- Game initialization flow (room create/join, player setup)

## Data Flow: Complete Hand

All transitions happen in a single Edge Function call:

1. Player plays last card of last trick
2. Edge Function: `play_card` → detects trick complete → `completeTrick` → detects hand complete → `completeHand` → calculates scores → if not last hand: `nextHand` → `startBetting` → deals cards
3. Returns state with `phase: 'scoring'`, updated scores, AND pre-dealt next hand
4. Client shows scoreboard
5. Client clicks "Continue" → `callGameAction('continue_hand')` → Edge Function returns state with `phase: 'betting'` (cards already dealt)
6. If last hand: returns `phase: 'finished'` instead

No client-side timers. No setTimeout for completeTrick. No race conditions.

## Error Handling

| Scenario | Handling |
|----------|----------|
| Edge Function unreachable | Show "Connection error" toast, retry 3 times with 1s delay |
| Version conflict (concurrent write) | Re-read state from server, show current state |
| Invalid action (not your turn, etc.) | `{ success: false, error }` → UI shows error briefly |
| Polling fails | Skip, retry on next 2s tick |
| Player disconnects mid-game | Other players continue; disconnected player polls and catches up when reconnecting |

## Database Changes

- `game_states.game_state` JSONB column: already exists, becomes the primary state store
- Add `updated_at` auto-trigger: already exists from this session
- Version column: already exists, incremented by Edge Function

No new tables needed.

## Deployment

- Edge Function deployed via `supabase functions deploy game-action`
- Client code updated to call Edge Function URL from `EXPO_PUBLIC_SUPABASE_URL + '/functions/v1/game-action'`
- No environment variable changes needed (uses existing Supabase URL + anon key)

## Testing

- Game engine: unit tests for all state transitions (pure functions, easy to test)
- Edge Function: integration test via demo script
- Demo: should complete full 20-hand 4-player game without any idle/timeout
- Success criteria: 0 desync, all 4 players see Game Over
