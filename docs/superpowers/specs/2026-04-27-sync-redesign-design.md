# Sync Redesign — Server-Authoritative + Normalized Schema + Broadcast Push

**Status:** Approved 2026-04-27. Supersedes `2026-04-26-server-authoritative-game-state-design.md` (same direction, but the prior spec kept the JSON-blob `game_states` table and polling readers; this one normalizes the schema and uses Realtime Broadcast pings instead of polling).

## Problem

Production prod tests of the 4-player flow surface three classes of bugs that all trace to the same root cause:

1. `TypeError: Cannot read properties of undefined (reading 'version')` on game start — random non-host player hits this on every match.
2. Race condition on the Continue button (`[GameActions] Continue hand failed: Cannot continue hand: not in scoring phase`) when more than one client clicks the scoreboard's Continue at the same time.
3. Bets from non-host players are not all observable from the autoplay test, even though the game progresses — strong signal of state divergence.

Root cause is architectural, not local: each client maintains its own `gameStore` with optimistic updates, runs the rules engine locally with a seeded shuffle, and only writes a JSON blob (`game_states.game_state`) to the server. Realtime CDC events on that blob can drop or arrive out of order. There is no single source of truth — every client is computing what it believes the state should be, then trying to reconcile.

Patching this with heartbeats, polling, snapshot-pull-on-stuck, or `forceRemoteState` guards has been attempted in the current codebase and has not held. Each patch removes one symptom and exposes another.

## Solution

Replace the peer-to-peer model with a strict server-authoritative pipeline:

- **One writer:** a Supabase Edge Function (`game-action`) is the only code path that mutates game state. RLS forbids all client writes to game tables.
- **Normalized schema:** game state lives in relational tables (`hands`, `hand_scores`, `tricks`, `trick_cards`, `game_events`) where database constraints (`UNIQUE(hand_id, session_id)`, `UNIQUE(trick_id, seat_index)`) make race conditions physically impossible.
- **Single mutex per room:** every Edge invocation takes `pg_advisory_xact_lock(hashtext(room_id))` before reading state. Two simultaneous actions in the same room serialize; different rooms run in parallel.
- **Push = ping, pull = snapshot:** after the transaction commits, the Edge Function sends one `state_changed { version }` event over a Realtime Broadcast channel. Clients react by calling a single `get_room_state(room_id)` RPC and replacing local state with the result.
- **Client is a renderer:** the client never computes game state. It applies what the server returns. The shared rules engine (`src/engine/`) stays only for single-player vs bots and as the source the Edge Function imports.

## Architecture

```
┌─────────────────────┐    HTTPS POST       ┌──────────────────────────┐
│ Client (Expo / RN)  │ ──action────────►   │ Edge Function            │
│                     │ ◄────new state──    │ /game-action             │
│ • renderer          │                     │                          │
│ • roomStore cache   │                     │ 1. JWT verify            │
│ • Broadcast sub     │                     │ 2. pg_advisory_xact_lock │
│ • RPC pull on ping  │                     │ 3. validate via engine   │
│                     │                     │ 4. write SQL transaction │
│                     │                     │ 5. compute snapshot      │
│                     │ ◄═══Broadcast═══    │ 6. broadcast {ver, kind} │
└─────────────────────┘   "state_changed"   └────────────┬─────────────┘
        ▲                                                │
        │ get_room_state(room_id) RPC                    ▼
        └────────────────────────────────────  ┌─────────────────────┐
                                               │ Postgres            │
                                               │ • rooms             │
                                               │ • room_sessions     │
                                               │ • room_players      │
                                               │ • hands             │
                                               │ • dealt_cards       │
                                               │ • hand_scores       │
                                               │ • tricks            │
                                               │ • trick_cards       │
                                               │ • game_events       │
                                               └─────────────────────┘
```

## Data Model

```sql
-- Identity
auth.users                       -- Supabase: anonymous + linked identities

room_sessions
  id              uuid PK
  auth_user_id    uuid FK → auth.users
  display_name    text
  created_at      timestamptz

-- Rooms
rooms
  id              uuid PK
  code            text UNIQUE
  host_session_id uuid FK → room_sessions
  player_count    int   CHECK (player_count BETWEEN 2 AND 6)
  max_cards       int   DEFAULT 10
  phase           text  CHECK (phase IN ('waiting','playing','finished'))
  current_hand_id uuid FK → hands NULL
  version         bigint DEFAULT 0
  created_at      timestamptz
  updated_at      timestamptz

room_players
  room_id         uuid FK → rooms
  session_id      uuid FK → room_sessions
  seat_index      int
  is_ready        bool DEFAULT false
  is_connected    bool DEFAULT true
  last_seen_at    timestamptz
  PRIMARY KEY (room_id, session_id)
  UNIQUE (room_id, seat_index)

-- Hands
hands
  id               uuid PK
  room_id          uuid FK → rooms
  hand_number      int
  cards_per_player int
  trump_suit       text
  starting_seat    int
  current_seat     int
  phase            text CHECK (phase IN ('betting','playing','scoring','closed'))
  deck_seed        text
  started_at       timestamptz
  closed_at        timestamptz
  UNIQUE (room_id, hand_number)

dealt_cards
  hand_id         uuid FK → hands
  session_id      uuid FK → room_sessions
  card            text
  PRIMARY KEY (hand_id, session_id, card)

hand_scores                       -- bets and round results
  hand_id         uuid FK → hands
  session_id      uuid FK → room_sessions
  bet             int  NOT NULL
  taken_tricks    int  DEFAULT 0
  hand_score      int  DEFAULT 0
  PRIMARY KEY (hand_id, session_id)

-- Tricks
tricks
  id              uuid PK
  hand_id         uuid FK → hands
  trick_number    int
  lead_seat       int
  winner_seat     int  NULL
  closed_at       timestamptz NULL
  UNIQUE (hand_id, trick_number)

trick_cards
  trick_id        uuid FK → tricks
  seat_index      int
  card            text
  played_at       timestamptz
  PRIMARY KEY (trick_id, seat_index)

-- Append-only audit + replay
game_events
  id              bigserial PK
  room_id         uuid FK → rooms
  hand_id         uuid FK → hands NULL
  session_id      uuid FK → room_sessions NULL
  kind            text         -- 'bet','play_card','timeout','continue',
                               -- 'start_game','disconnect','reconnect'
  payload         jsonb
  created_at      timestamptz DEFAULT now()
  INDEX (room_id, created_at)
```

**Invariants enforced by schema (not by application code):**
- `UNIQUE(hand_id, session_id)` on `hand_scores` — a player cannot bet twice in the same hand. The second insert fails with a unique violation; the Edge Function returns `{ ok: false, error: 'already_bet' }`.
- `UNIQUE(trick_id, seat_index)` on `trick_cards` — a player cannot play two cards in the same trick.
- `hands.current_seat` is the single source of truth for "whose turn." Every action transaction begins with `SELECT ... FROM hands WHERE id = $1 FOR UPDATE` and validates `current_seat = sender.seat_index`.
- `rooms.version` increments on every successful mutation; clients use it to detect stale local state.

## Server Contract

Single Edge endpoint: `POST /functions/v1/game-action`.

**Request:**
```ts
{
  room_id: string,
  client_version?: number,
  action:
    | { kind: 'create_room', player_count, max_cards }
    | { kind: 'join_room', code }
    | { kind: 'leave_room' }
    | { kind: 'ready', is_ready: boolean }
    | { kind: 'start_game' }                   // host-only
    | { kind: 'place_bet', hand_id, bet }
    | { kind: 'play_card', hand_id, card }
    | { kind: 'continue_hand', hand_id }
    | { kind: 'request_timeout', hand_id, expected_seat }
}
```

**Response:**
```ts
// Success
{
  ok: true,
  state: RoomSnapshot,
  version: number,
  events?: GameEvent[]
}

// Idempotent error (returns current snapshot so client can sync without
// a separate RPC call):
{
  ok: false,
  error: 'not_your_turn' | 'invalid_bet' | 'card_not_in_hand'
       | 'already_bet' | 'unknown_room' | 'auth_failed',
  state?: RoomSnapshot,
  version?: number
}
```

**Idempotency rule:** the server treats out-of-order or repeated client actions by returning the current snapshot, never a hard error that requires UI handling. Examples:
- `place_bet` from a player whose bet is already recorded → `{ ok:false, error:'already_bet', state, version }`. Client silently applies the snapshot. No toast, no retry.
- `continue_hand` when the room is no longer in `scoring` phase → `{ ok:true, state, version }`. The race on Continue (current bug) becomes a no-op.
- `request_timeout` with a stale `expected_seat` → no-op return of current snapshot.

**Read-side RPC** (used on first mount, on reconnect, and when a Broadcast ping has a higher version than local):

```sql
CREATE FUNCTION get_room_state(p_room_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
  -- Joins rooms, room_players, current hand, dealt_cards (only for caller),
  -- hand_scores, current trick, score history. Returns RoomSnapshot.
$$;
```

**Edge Function pseudocode:**

```ts
serve(async (req) => {
  const jwt = req.headers.get('Authorization');
  const auth_user_id = await verifyJwt(jwt);
  const body = await req.json();
  const session_id = await getOrCreateSession(auth_user_id, body.display_name);

  return await withTx(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [body.room_id]);

    const result = await applyAction(tx, session_id, body.action);
    if (!result.ok) {
      const state = await snapshot(tx, body.room_id);
      return jsonResponse({ ok: false, ...result, state, version: state.version });
    }

    await tx.query('UPDATE rooms SET version = version + 1 WHERE id = $1', [body.room_id]);
    await tx.query('INSERT INTO game_events (...) VALUES (...)', [...]);
    const state = await snapshot(tx, body.room_id);

    after(() => realtimeBroadcast(body.room_id, {
      kind: 'state_changed',
      version: state.version,
    }));

    return jsonResponse({ ok: true, state, version: state.version });
  });
});
```

## Client Architecture

```
roomStore (Zustand)
  • snapshot           ← only ever written via applySnapshot(s)
  • version
  • myPlayerId
  • connState

authStore
  • session_id
  • display_name
  • jwt

UI components are pure: render(snapshot), onAction(...) → POST /game-action.
```

**Removed from v2:**
| v2 module | Replacement |
|---|---|
| `gameStore` (rules, optimistic updates, seeded shuffle) | deleted; replaced by `roomStore` (cache only) |
| `eventHandler.ts` | deleted; replaced by single `applySnapshot` after RPC |
| `gameActions.ts.saveGameSnapshot` | deleted; server transaction is canonical |
| `forceRemoteState` + guards | deleted; server is authoritative, no merge logic |
| 10s heartbeat, 2s polling | deleted; Broadcast pings + RPC on demand |
| `BettingPhase` 2s polling refresh | deleted |

**Kept:**
- UI rendering of `GameTable`, `BettingPhase`, `ScoreboardModal`, etc.
- Lobby, settings, chat (chat may move to `game_events` table later, out of scope).
- `multiplayerStore` for connection / chat state — without any game logic.
- `src/engine/` (Nagels rules) — refactored into a Deno-compatible shared module imported by both the Edge Function (server-side validation) and the client (single-player vs bots only).

**No optimistic UI.** Every action is a full request/response round-trip; the UI shows a small pending indicator during the in-flight action and applies state from the response. This trades 50–200 ms of perceived latency for zero divergence.

## Sync Mechanism

```
Player A taps "Place Bet"
  ↓
POST /game-action { place_bet, … }
  ↓
Edge tx commits (lock released)
  ↓
Edge response  ─►  Player A applies state synchronously (instant UI)
  +
Realtime Broadcast "state_changed v=N"  ─►  Players B, C, D
                                              ↓
                                    if N > localVersion:
                                      get_room_state(room_id)
                                      apply
```

Steady-state operations involve no polling, no heartbeat, no client-side timers.

**Reconnect:**
- App mount: read JWT → `get_room_state(my_room_id)` → apply.
- Broadcast WS disconnect: show "syncing…" indicator → on reconnect, run `get_room_state` → resume.
- Foreground from background: always run `get_room_state` regardless of suspected freshness.

## Auth & Identity

**Guest start:** `supabase.auth.signInAnonymously()` on first launch creates `auth.users { is_anonymous: true }`. The user can play immediately.

**Google account linking** (any time — onboarding, profile screen, after first match):
- `supabase.auth.linkIdentity({ provider: 'google' })` keeps the same `auth.users.id` and adds an entry in `auth.identities`.
- `is_anonymous` flips to `false`.
- All `room_sessions`, `game_events`, `hand_scores` rows linked by `auth_user_id` are preserved.

**Cross-device:** Google Sign-In on a second device returns the same `auth.users.id`; `room_sessions` joins to it and the user keeps display name, history, and (later) rating.

**Email/password:** offered as an alternative via `linkIdentity({ provider: 'email' })` for users who do not want Google.

**Edge Function trust model:** server reads `session_id` from the database keyed on `auth_user_id` from the verified JWT. Client-supplied `session_id` is never trusted. `is_anonymous` is irrelevant for game actions; it becomes relevant only when stake-based features land (anonymous accounts will not be allowed to place ranked stakes).

## Disconnect & Turn Timeout

**Presence:** `room_players.is_connected` and `last_seen_at` are updated when clients join or leave the Realtime Broadcast channel.

**Turn timeout (30 s):**
- Each client locally measures elapsed time since the last `current_seat` change.
- When elapsed > 30 s, ANY client posts `{ kind: 'request_timeout', hand_id, expected_seat }`.
- The Edge Function checks: if `current_seat = expected_seat`, it inserts a default action (auto-bet 0 or random valid card) and logs `game_events.kind = 'timeout'`. If `current_seat ≠ expected_seat`, no-op (someone else already advanced the game).
- This is idempotent across multiple concurrent timeout requests.

**Long disconnect (> 60 s):** out of scope for this spec; planned to be replaced by bot fallback in a later spec ("Bot AI in multiplayer", from product backlog).

## Migration

A single PR sequence with no parallel deploy and no feature flag, since there are no production users with valuable data.

1. **DB migration** creates the new tables and drops `game_states` (the JSON-blob table) in the same migration.
2. **Edge Function** `game-action` is rewritten in place (not a new endpoint).
3. **Client** removes `gameStore` peer logic, `eventHandler`, `forceRemoteState`, heartbeat, 2 s polling, seeded shuffle, optimistic updates. Adds `roomStore`, `get_room_state`, Broadcast subscription.
4. **Engine** (`src/engine/`) is refactored into a Deno-compatible module that both client and Edge Function import.
5. **One prod deploy.** Any in-progress games are cancelled; no real users are affected.

If something goes wrong on prod the rollback is `git revert` of the merge commit plus a re-deploy.

## Error Handling

| Scenario | Handling |
|---|---|
| Edge Function unreachable | UI shows "Connection error" toast, retries with exponential backoff (1 s, 2 s, 4 s). |
| Stale client action (out-of-order) | Server returns idempotent error with `state` payload; client applies snapshot, no error UI. |
| Validation failure (invalid bet, illegal card, not your turn) | Server returns `{ ok:false, error, state }`; client applies snapshot and shows a brief inline note ("not your turn") only if the user just clicked. |
| Broadcast WS disconnect | UI shows "syncing" indicator; client retries WS, then falls back to a single `get_room_state` call to confirm freshness. |
| Player disconnect mid-game | Other players continue. The disconnected player calls `get_room_state` on reconnect. If their turn timed out, the game has already auto-advanced. |
| Concurrent identical actions in the same room | Advisory lock serializes them. The first commits, the second sees current state and returns idempotent error. |

## Testing

- **Unit tests** for the engine (pure functions, already mostly covered).
- **Edge Function integration tests** using the Supabase local stack: place_bet, play_card, continue_hand, race scenarios (two clients post Continue at once → both succeed idempotently).
- **End-to-end test** is the existing Playwright `demo-4players.ts` script, run on prod after deploy. Success criteria: a full 20-hand match completes with zero `pageerror`, zero `consoleerror`, zero stuck-state events. The script's existing bug-detection categories (`pageerror`, `consoleerror`, `requestfailed`, `stuck`, `desync`) are kept and used as the regression suite.
- **Manual mobile test** on real iOS Safari and Android Chrome: foreground/background transitions, network drops, bidirectional reconnect, Google sign-in linking flow.

## Out of Scope (deferred to follow-up specs)

- Bot players in multiplayer rooms (separate backlog item).
- Score history table redesign (depends on this foundation; backlog item #1).
- Stakes / ranking / profile rating (backlog).
- Lobby chat (backlog).
- Push notifications (backlog).
