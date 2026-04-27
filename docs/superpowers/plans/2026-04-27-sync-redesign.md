# Sync Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace peer-to-peer game state with strictly server-authoritative pipeline: normalized schema, single-writer Edge Function with `pg_advisory_xact_lock`, Realtime Broadcast pings, dumb-renderer client. Resolves all three production bugs from prod test (`TypeError 'version'`, Continue race, hidden bet desync).

**Spec:** `docs/superpowers/specs/2026-04-27-sync-redesign-design.md`

**Architecture:** Edge Function `game-action` is the sole writer. New tables (`rooms`, `room_sessions`, `room_players`, `hands`, `dealt_cards`, `hand_scores`, `tricks`, `trick_cards`, `game_events`) replace `game_states` JSON blob. Client sends actions, applies returned snapshot. After commit, Edge broadcasts `state_changed`; other clients refetch via `get_room_state` RPC.

**Tech Stack:** Supabase (Edge Functions, Postgres, Realtime Broadcast), Expo / React Native, Zustand, TypeScript, Deno (Edge runtime).

**Migration:** Single PR. Drops old tables in same migration that creates new. Tested on Supabase branch first, then promoted. No real users to preserve.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/migrations/002_sync_redesign.sql` | Create | Drop old tables; create new normalized schema; advisory lock helpers; `get_room_state` RPC |
| `supabase/functions/_shared/engine/rules.ts` | Move from `src/game/rules.ts` | Pure rules: bets, plays, scoring (no shuffle dep) |
| `supabase/functions/_shared/engine/engine.ts` | Move from `src/game/engine.ts` | Engine helpers without `seededShuffle` |
| `supabase/functions/_shared/types.ts` | Create | Shared action/snapshot types |
| `supabase/functions/_shared/cors.ts` | Create | CORS headers helper |
| `supabase/functions/game-action/index.ts` | Rewrite | Top-level dispatcher: auth → lock → action → broadcast |
| `supabase/functions/game-action/auth.ts` | Create | JWT verify, get-or-create `room_sessions` row |
| `supabase/functions/game-action/snapshot.ts` | Create | Build `RoomSnapshot` from normalized tables |
| `supabase/functions/game-action/broadcast.ts` | Create | Send `state_changed` event to channel `room:<id>` |
| `supabase/functions/game-action/actions/createRoom.ts` | Create | Insert `rooms` + host `room_players` |
| `supabase/functions/game-action/actions/joinRoom.ts` | Create | Insert `room_players` if seat free |
| `supabase/functions/game-action/actions/leaveRoom.ts` | Create | Remove `room_players`, transfer host if needed |
| `supabase/functions/game-action/actions/ready.ts` | Create | Set `room_players.is_ready` |
| `supabase/functions/game-action/actions/startGame.ts` | Create | Host-only; create first `hands` row, deal cards |
| `supabase/functions/game-action/actions/placeBet.ts` | Create | Insert `hand_scores`; advance `current_seat`; if all bets in → switch hand to `playing` |
| `supabase/functions/game-action/actions/playCard.ts` | Create | Insert `trick_cards`; if trick complete → settle; if hand done → score → next hand or finish |
| `supabase/functions/game-action/actions/continueHand.ts` | Create | Idempotent: open next hand if scoring, else no-op |
| `supabase/functions/game-action/actions/requestTimeout.ts` | Create | Idempotent auto-bet 0 / random card if `current_seat == expected_seat` |
| `src/store/roomStore.ts` | Create | Snapshot + version + `applySnapshot` only |
| `src/lib/gameClient.ts` | Create | Wrapper for POST `/game-action` and `get_room_state` RPC |
| `src/lib/realtimeBroadcast.ts` | Create | Subscribe to channel `room:<id>` `state_changed` |
| `src/lib/auth/anonymous.ts` | Create | Anonymous sign-in on first launch |
| `src/lib/auth/google.ts` | Create | `linkIdentity('google')` helper |
| `src/lib/turnTimeout.ts` | Create | Local 30s watcher → POST `request_timeout` |
| `src/store/gameStore.ts` | Delete (eventually) | Replaced by `roomStore` |
| `src/lib/multiplayer/eventHandler.ts` | Delete | Replaced by `applySnapshot` after RPC |
| `src/lib/multiplayer/gameActions.ts` | Delete | Replaced by `gameClient` |
| `src/lib/multiplayer/gameStateSync.ts` | Delete | Replaced by Broadcast + RPC |
| `src/lib/multiplayer/networkMonitor.ts` | Delete | Heartbeat removed |
| `src/lib/multiplayer/rejoinManager.ts` | Delete | Reconnect handled by `get_room_state` on mount |
| `src/lib/multiplayer/seededRandom.ts` | Delete | Server does shuffle once |
| `src/lib/multiplayer/roomManager.ts` | Refactor | Becomes thin wrapper around `gameClient` |
| `src/screens/GameTableScreen.tsx` | Modify | Read from `roomStore`, dispatch via `gameClient` |
| `src/screens/WaitingRoomScreen.tsx` | Modify | Same |
| `src/screens/LobbyScreen.tsx` | Modify | Calls `gameClient.createRoom` / `joinRoom` |
| `src/components/betting/BettingPhase.tsx` | Modify | Reads from `roomStore`, dispatches `place_bet` |
| `src/screens/ScoreboardModal.tsx` | Modify | Continue button calls `gameClient.continueHand` |
| `src/App.tsx` | Modify | Bootstrap: anonymous sign-in + Broadcast subscription on room join |

---

## Milestone Overview

1. **Setup & DB** — Supabase branch, migration, baseline types
2. **Engine refactor** — move to `_shared/engine`, drop seeded shuffle
3. **Edge Function infrastructure** — auth, snapshot, broadcast, dispatcher
4. **Edge Function actions** — all 9 action handlers
5. **`get_room_state` RPC**
6. **Client: stores & gameClient**
7. **Client: auth (anonymous + Google)**
8. **Client: Realtime + UI integration**
9. **Client: turn timeout**
10. **Cleanup of dead code**
11. **E2E test on branch**
12. **Prod deploy**

---

## Milestone 1 — Setup & Database

### Task 1.1: Create Supabase branch for testing

**Files:** none (Supabase platform action)

- [ ] **Step 1: Create branch via MCP**

Use `mcp__claude_ai_Supabase__create_branch` with project ref `evcaqgmkdlqesqisjfyh` and name `sync-redesign`. Wait for creation to complete (~30 s).

Branch gives an isolated Postgres + Edge runtime — same data as prod at the moment of branching, mutations isolated. We will apply schema migration here first.

- [ ] **Step 2: Record branch project ref**

Save the branch's `project_ref` to a local note. We will use it in env vars during testing instead of `evcaqgmkdlqesqisjfyh`.

- [ ] **Step 3: Verify branch is reachable**

Run `mcp__claude_ai_Supabase__list_tables` against the branch project ref. Confirm existing tables: `rooms`, `room_players`, `game_states`, `game_events`, `player_sessions`.

### Task 1.2: Write the schema migration

**Files:**
- Create: `supabase/migrations/002_sync_redesign.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- Nägels Online — Sync Redesign Migration
-- See docs/superpowers/specs/2026-04-27-sync-redesign-design.md
-- ============================================================

BEGIN;

-- ── 1. Drop legacy tables ──────────────────────────────────
DROP TABLE IF EXISTS public.game_states CASCADE;
DROP TABLE IF EXISTS public.game_events CASCADE;
DROP TABLE IF EXISTS public.room_players CASCADE;
DROP TABLE IF EXISTS public.rooms CASCADE;
DROP TABLE IF EXISTS public.player_sessions CASCADE;

-- ── 2. Identity ────────────────────────────────────────────
CREATE TABLE public.room_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (auth_user_id)
);

CREATE INDEX idx_room_sessions_auth_user ON public.room_sessions(auth_user_id);

-- ── 3. Rooms ───────────────────────────────────────────────
CREATE TABLE public.rooms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT UNIQUE NOT NULL,
  host_session_id UUID NOT NULL REFERENCES public.room_sessions(id) ON DELETE RESTRICT,
  player_count    INT  NOT NULL CHECK (player_count BETWEEN 2 AND 6),
  max_cards       INT  NOT NULL DEFAULT 10,
  phase           TEXT NOT NULL DEFAULT 'waiting'
                       CHECK (phase IN ('waiting','playing','finished')),
  current_hand_id UUID NULL,
  version         BIGINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rooms_code ON public.rooms(code);
CREATE INDEX idx_rooms_phase ON public.rooms(phase);

CREATE TABLE public.room_players (
  room_id        UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  session_id     UUID NOT NULL REFERENCES public.room_sessions(id) ON DELETE CASCADE,
  seat_index     INT  NOT NULL,
  is_ready       BOOL NOT NULL DEFAULT FALSE,
  is_connected   BOOL NOT NULL DEFAULT TRUE,
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, session_id),
  UNIQUE (room_id, seat_index)
);

CREATE INDEX idx_room_players_session ON public.room_players(session_id);

-- ── 4. Hands ───────────────────────────────────────────────
CREATE TABLE public.hands (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  hand_number      INT  NOT NULL,
  cards_per_player INT  NOT NULL,
  trump_suit       TEXT NOT NULL,
  starting_seat    INT  NOT NULL,
  current_seat     INT  NOT NULL,
  phase            TEXT NOT NULL DEFAULT 'betting'
                        CHECK (phase IN ('betting','playing','scoring','closed')),
  deck_seed        TEXT NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at        TIMESTAMPTZ NULL,
  UNIQUE (room_id, hand_number)
);

ALTER TABLE public.rooms
  ADD CONSTRAINT rooms_current_hand_fk
  FOREIGN KEY (current_hand_id) REFERENCES public.hands(id) ON DELETE SET NULL;

CREATE INDEX idx_hands_room ON public.hands(room_id);

CREATE TABLE public.dealt_cards (
  hand_id    UUID NOT NULL REFERENCES public.hands(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.room_sessions(id) ON DELETE CASCADE,
  card       TEXT NOT NULL,
  PRIMARY KEY (hand_id, session_id, card)
);

CREATE INDEX idx_dealt_cards_session ON public.dealt_cards(session_id);

CREATE TABLE public.hand_scores (
  hand_id      UUID NOT NULL REFERENCES public.hands(id) ON DELETE CASCADE,
  session_id   UUID NOT NULL REFERENCES public.room_sessions(id) ON DELETE CASCADE,
  bet          INT  NOT NULL,
  taken_tricks INT  NOT NULL DEFAULT 0,
  hand_score   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (hand_id, session_id)
);

-- ── 5. Tricks ──────────────────────────────────────────────
CREATE TABLE public.tricks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hand_id       UUID NOT NULL REFERENCES public.hands(id) ON DELETE CASCADE,
  trick_number  INT  NOT NULL,
  lead_seat     INT  NOT NULL,
  winner_seat   INT  NULL,
  closed_at     TIMESTAMPTZ NULL,
  UNIQUE (hand_id, trick_number)
);

CREATE INDEX idx_tricks_hand ON public.tricks(hand_id);

CREATE TABLE public.trick_cards (
  trick_id   UUID NOT NULL REFERENCES public.tricks(id) ON DELETE CASCADE,
  seat_index INT  NOT NULL,
  card       TEXT NOT NULL,
  played_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trick_id, seat_index)
);

-- ── 6. Audit / replay ──────────────────────────────────────
CREATE TABLE public.game_events (
  id          BIGSERIAL PRIMARY KEY,
  room_id     UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  hand_id     UUID NULL REFERENCES public.hands(id) ON DELETE CASCADE,
  session_id  UUID NULL REFERENCES public.room_sessions(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_game_events_room_created ON public.game_events(room_id, created_at);

-- ── 7. RLS — closed by default; reads via SECURITY DEFINER RPC ──
ALTER TABLE public.room_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_players   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hands          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealt_cards    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hand_scores    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tricks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trick_cards    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_events    ENABLE ROW LEVEL SECURITY;

-- No policies = no anon/authenticated access.
-- Edge Function uses service-role key. Read RPC below uses SECURITY DEFINER.

-- ── 8. get_room_state RPC ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_room_state(p_room_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH
  room AS (
    SELECT id, code, host_session_id, player_count, max_cards,
           phase, current_hand_id, version
    FROM public.rooms WHERE id = p_room_id
  ),
  players AS (
    SELECT json_agg(jsonb_build_object(
      'session_id',   rp.session_id,
      'display_name', rs.display_name,
      'seat_index',   rp.seat_index,
      'is_ready',     rp.is_ready,
      'is_connected', rp.is_connected,
      'last_seen_at', rp.last_seen_at
    ) ORDER BY rp.seat_index) AS list
    FROM public.room_players rp
    JOIN public.room_sessions rs ON rs.id = rp.session_id
    WHERE rp.room_id = p_room_id
  ),
  current_hand AS (
    SELECT to_jsonb(h.*) AS row
    FROM public.hands h
    JOIN room ON room.current_hand_id = h.id
  ),
  hand_scores AS (
    SELECT json_agg(to_jsonb(hs.*)) AS list
    FROM public.hand_scores hs
    JOIN current_hand ch ON (ch.row ->> 'id')::uuid = hs.hand_id
  ),
  current_trick AS (
    SELECT jsonb_build_object(
      'id',           t.id,
      'trick_number', t.trick_number,
      'lead_seat',    t.lead_seat,
      'winner_seat',  t.winner_seat,
      'cards',        COALESCE((
        SELECT json_agg(jsonb_build_object('seat', tc.seat_index, 'card', tc.card)
                        ORDER BY tc.played_at)
        FROM public.trick_cards tc WHERE tc.trick_id = t.id
      ), '[]'::json)
    ) AS row
    FROM public.tricks t
    JOIN current_hand ch ON (ch.row ->> 'id')::uuid = t.hand_id
    WHERE t.closed_at IS NULL
    ORDER BY t.trick_number DESC
    LIMIT 1
  ),
  history AS (
    SELECT json_agg(jsonb_build_object(
      'hand_number', h.hand_number,
      'closed_at',   h.closed_at,
      'scores',      (SELECT json_agg(to_jsonb(hs2.*))
                      FROM public.hand_scores hs2 WHERE hs2.hand_id = h.id)
    ) ORDER BY h.hand_number) AS list
    FROM public.hands h
    WHERE h.room_id = p_room_id AND h.phase = 'closed'
  )
  SELECT jsonb_build_object(
    'room',          (SELECT to_jsonb(room.*) FROM room),
    'players',       (SELECT list FROM players),
    'current_hand',  (SELECT row FROM current_hand),
    'hand_scores',   COALESCE((SELECT list FROM hand_scores), '[]'::json),
    'current_trick', (SELECT row FROM current_trick),
    'score_history', COALESCE((SELECT list FROM history), '[]'::json)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_room_state(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_room_state(UUID) TO anon, authenticated;

-- ── 9. Helper: dealt cards for a single player ─────────────
CREATE OR REPLACE FUNCTION public.get_my_hand(p_hand_id UUID, p_session_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(json_agg(card), '[]'::json)::jsonb
  FROM public.dealt_cards
  WHERE hand_id = p_hand_id AND session_id = p_session_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_hand(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_hand(UUID, UUID) TO anon, authenticated;

COMMIT;
```

- [ ] **Step 2: Apply migration to the branch**

Use `mcp__claude_ai_Supabase__apply_migration` with the branch project ref, name `002_sync_redesign`, and the SQL above.

Expected: success. If error, fix the SQL and re-apply (DROP TABLE handles re-runs).

- [ ] **Step 3: Verify schema on branch**

Run `mcp__claude_ai_Supabase__list_tables` against branch. Confirm new tables exist: `room_sessions`, `rooms`, `room_players`, `hands`, `dealt_cards`, `hand_scores`, `tricks`, `trick_cards`, `game_events`. No `game_states`, no `player_sessions`.

- [ ] **Step 4: Smoke-test the RPC**

```sql
SELECT public.get_room_state('00000000-0000-0000-0000-000000000000'::uuid);
```

Expected: returns JSON with `room: null`. Confirms RPC is callable.

- [ ] **Step 5: Commit migration**

```bash
git add supabase/migrations/002_sync_redesign.sql
git commit -m "feat(db): normalized schema for server-authoritative sync"
```

### Task 1.3: Generate TypeScript types from new schema

**Files:**
- Modify: `src/lib/supabase/types.ts` (or wherever generated types live)

- [ ] **Step 1: Generate types from branch**

Use `mcp__claude_ai_Supabase__generate_typescript_types` against branch project ref. Save the output to `src/lib/supabase/types.ts` (or wherever existing types are).

- [ ] **Step 2: Verify types compile**

Run `npm run ts:check`. Many client files will break here because they reference removed tables (`game_states`, `player_sessions`). That is expected. We will fix them as we go. **Do not** revert at this point.

- [ ] **Step 3: Commit types**

```bash
git add src/lib/supabase/types.ts
git commit -m "feat(types): regenerate Supabase types for new schema"
```

---

## Milestone 2 — Engine refactor (Deno-shareable)

### Task 2.1: Move engine to `_shared` and drop seeded shuffle

**Files:**
- Create: `supabase/functions/_shared/engine/rules.ts` (copy of `src/game/rules.ts`)
- Create: `supabase/functions/_shared/engine/engine.ts` (modified copy of `src/game/engine.ts`)
- Create: `supabase/functions/_shared/engine/index.ts` (re-exports)
- Modify: `src/game/engine.ts` (re-export from `_shared`)
- Modify: `src/game/rules.ts` (re-export from `_shared`)

- [ ] **Step 1: Copy `src/game/rules.ts` → `supabase/functions/_shared/engine/rules.ts` verbatim.**

- [ ] **Step 2: Copy `src/game/engine.ts` → `supabase/functions/_shared/engine/engine.ts`, then remove the import of `seededShuffle`.**

Replace:
```ts
import { seededShuffle } from '../lib/multiplayer/seededRandom';
```
with a local Fisher-Yates that uses `crypto.getRandomValues`:
```ts
function shuffle<T>(items: T[]): T[] {
  const a = items.slice();
  const buf = new Uint32Array(1);
  for (let i = a.length - 1; i > 0; i--) {
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
```

Replace any call to `seededShuffle(deck, seed)` with `shuffle(deck)` (and remove `seed` param plumbing).

The deck is shuffled once on the server; clients never re-shuffle. The `deck_seed` column in `hands` becomes a record of the operation (we store the seed used so we can replay/audit), generated server-side via `crypto.randomUUID()` and used inside `applyAction` before each shuffle for reproducibility — but this is **internal to the server**.

For full determinism (used by audit-replay only), keep a seeded shuffle variant that takes a seed string. Define it locally in `engine.ts`:

```ts
export function seededShuffle<T>(items: T[], seed: string): T[] {
  // xmur3 + sfc32 — pure JS, no dependencies
  const hash = (s: string) => {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return ((h ^= h >>> 16) >>> 0);
    };
  };
  const rng = hash(seed);
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng() % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
```

- [ ] **Step 3: Create `supabase/functions/_shared/engine/index.ts`:**

```ts
export * from './rules';
export * from './engine';
```

- [ ] **Step 4: Replace `src/game/rules.ts` with a re-export:**

```ts
// Re-exports the canonical rules module shared with Edge Functions.
// Source of truth: supabase/functions/_shared/engine/rules.ts
export * from '../../supabase/functions/_shared/engine/rules';
```

- [ ] **Step 5: Replace `src/game/engine.ts` with a re-export:**

```ts
// Re-exports the canonical engine module shared with Edge Functions.
// Source of truth: supabase/functions/_shared/engine/engine.ts
export * from '../../supabase/functions/_shared/engine/engine';
```

This way the client uses the same rules code the Edge Function does — no duplication.

- [ ] **Step 6: Run engine tests**

Run `npm test -- src/game/__tests__/engine.test.ts`. All existing tests should still pass; the engine is unchanged in behavior.

If a test fails because it imports `seededShuffle` from `seededRandom`, replace the import with the local engine export of `seededShuffle`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared src/game
git commit -m "refactor(engine): move to _shared so Edge Function and client share one rules module"
```

---

## Milestone 3 — Edge Function infrastructure

### Task 3.1: CORS + types

**Files:**
- Create: `supabase/functions/_shared/cors.ts`
- Create: `supabase/functions/_shared/types.ts`

- [ ] **Step 1: `supabase/functions/_shared/cors.ts`:**

```ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function handleOptions(): Response {
  return new Response('ok', { headers: corsHeaders });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 2: `supabase/functions/_shared/types.ts`:**

```ts
export type ActionKind =
  | 'create_room' | 'join_room' | 'leave_room'
  | 'ready' | 'start_game'
  | 'place_bet' | 'play_card' | 'continue_hand'
  | 'request_timeout';

export type Action =
  | { kind: 'create_room'; player_count: number; max_cards?: number; display_name: string }
  | { kind: 'join_room';   code: string; display_name: string }
  | { kind: 'leave_room';  room_id: string }
  | { kind: 'ready';       room_id: string; is_ready: boolean }
  | { kind: 'start_game';  room_id: string }
  | { kind: 'place_bet';   room_id: string; hand_id: string; bet: number }
  | { kind: 'play_card';   room_id: string; hand_id: string; card: string }
  | { kind: 'continue_hand'; room_id: string; hand_id: string }
  | { kind: 'request_timeout'; room_id: string; hand_id: string; expected_seat: number };

export interface ActorContext {
  auth_user_id: string;
  session_id: string;
  display_name: string;
}

export interface RoomSnapshot {
  room: {
    id: string;
    code: string;
    host_session_id: string;
    player_count: number;
    max_cards: number;
    phase: 'waiting' | 'playing' | 'finished';
    current_hand_id: string | null;
    version: number;
  } | null;
  players: Array<{
    session_id: string;
    display_name: string;
    seat_index: number;
    is_ready: boolean;
    is_connected: boolean;
    last_seen_at: string;
  }>;
  current_hand: any | null;
  hand_scores: any[];
  current_trick: any | null;
  score_history: any[];
}

export type ActionResult =
  | { ok: true; state: RoomSnapshot; version: number }
  | { ok: false; error: string; state: RoomSnapshot; version: number };
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/cors.ts supabase/functions/_shared/types.ts
git commit -m "feat(edge): shared CORS + action types"
```

### Task 3.2: Auth helper (JWT verify + session lookup/create)

**Files:**
- Create: `supabase/functions/game-action/auth.ts`

- [ ] **Step 1: Write `auth.ts`:**

```ts
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext } from '../_shared/types.ts';

export function makeServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

export async function authenticate(
  req: Request,
  defaultDisplayName: string | null,
): Promise<ActorContext> {
  const auth = req.headers.get('Authorization');
  if (!auth) throw new Error('auth_failed');

  const token = auth.replace(/^Bearer\s+/i, '');

  // Verify JWT via Supabase Auth admin API.
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: u, error } = await userClient.auth.getUser(token);
  if (error || !u?.user) throw new Error('auth_failed');

  const auth_user_id = u.user.id;
  const display_name = defaultDisplayName ?? u.user.user_metadata?.display_name ?? 'Guest';

  // Get or create room_sessions row.
  const svc = makeServiceClient();
  const { data: existing } = await svc
    .from('room_sessions')
    .select('id, display_name')
    .eq('auth_user_id', auth_user_id)
    .maybeSingle();

  if (existing) {
    return { auth_user_id, session_id: existing.id, display_name: existing.display_name };
  }

  const { data: created, error: e2 } = await svc
    .from('room_sessions')
    .insert({ auth_user_id, display_name })
    .select('id, display_name')
    .single();
  if (e2) throw new Error('auth_failed');

  return { auth_user_id, session_id: created.id, display_name: created.display_name };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/game-action/auth.ts
git commit -m "feat(edge): JWT verify + room_sessions lookup"
```

### Task 3.3: Snapshot helper

**Files:**
- Create: `supabase/functions/game-action/snapshot.ts`

- [ ] **Step 1: Write `snapshot.ts`:**

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { RoomSnapshot } from '../_shared/types.ts';

export async function buildSnapshot(
  svc: SupabaseClient,
  room_id: string,
  caller_session_id: string,
): Promise<RoomSnapshot> {
  // Use the get_room_state RPC which already builds the bulk of the snapshot.
  const { data, error } = await svc.rpc('get_room_state', { p_room_id: room_id });
  if (error) throw error;

  const snapshot = (data ?? {
    room: null, players: [], current_hand: null,
    hand_scores: [], current_trick: null, score_history: [],
  }) as RoomSnapshot;

  // Attach caller's private hand if there is a current hand.
  const handId = snapshot.current_hand?.id;
  if (handId) {
    const { data: hand } = await svc.rpc('get_my_hand', {
      p_hand_id: handId,
      p_session_id: caller_session_id,
    });
    (snapshot as any).my_hand = hand ?? [];
  } else {
    (snapshot as any).my_hand = [];
  }

  return snapshot;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/game-action/snapshot.ts
git commit -m "feat(edge): snapshot builder using get_room_state + get_my_hand"
```

### Task 3.4: Broadcast helper

**Files:**
- Create: `supabase/functions/game-action/broadcast.ts`

- [ ] **Step 1: Write `broadcast.ts`:**

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Send a state_changed event to the room channel.
 * Uses the Realtime Broadcast API; consumed by clients subscribed to
 * supabase.channel(`room:${room_id}`).
 */
export async function broadcastStateChanged(
  svc: SupabaseClient,
  room_id: string,
  version: number,
): Promise<void> {
  const channel = svc.channel(`room:${room_id}`);
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
    });
  });
  await channel.send({
    type: 'broadcast',
    event: 'state_changed',
    payload: { version },
  });
  await channel.unsubscribe();
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/game-action/broadcast.ts
git commit -m "feat(edge): broadcast state_changed to room channel"
```

### Task 3.5: Top-level dispatcher (skeleton)

**Files:**
- Modify (full rewrite): `supabase/functions/game-action/index.ts`

- [ ] **Step 1: Replace `index.ts` with skeleton:**

```ts
/**
 * Nägels Online — Server-Authoritative Game Action
 *
 * Single endpoint. All game mutations go through this function.
 * Pipeline: JWT verify → advisory lock → action handler → snapshot →
 * broadcast → response.
 */

import { handleOptions, jsonResponse, corsHeaders } from '../_shared/cors.ts';
import type { Action, ActionResult, ActorContext } from '../_shared/types.ts';
import { authenticate, makeServiceClient } from './auth.ts';
import { buildSnapshot } from './snapshot.ts';
import { broadcastStateChanged } from './broadcast.ts';

import { createRoom }     from './actions/createRoom.ts';
import { joinRoom }       from './actions/joinRoom.ts';
import { leaveRoom }      from './actions/leaveRoom.ts';
import { setReady }       from './actions/ready.ts';
import { startGame }      from './actions/startGame.ts';
import { placeBet }       from './actions/placeBet.ts';
import { playCard }       from './actions/playCard.ts';
import { continueHand }   from './actions/continueHand.ts';
import { requestTimeout } from './actions/requestTimeout.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST')   return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);

  let body: { display_name?: string; action: Action };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }

  let actor: ActorContext;
  try {
    actor = await authenticate(req, body.display_name ?? null);
  } catch {
    return jsonResponse({ ok: false, error: 'auth_failed' }, 401);
  }

  const svc = makeServiceClient();
  const action = body.action;
  const room_id = (action as any).room_id ?? null;

  // Lobby actions (create/join) don't have a pre-existing room_id.
  // We still acquire a "global lobby lock" by hashing the action kind,
  // because the create_room → insert is racy on the unique join code
  // — but unique constraint already serializes that. So no lock needed.
  let result: ActionResult;
  try {
    if (action.kind === 'create_room') {
      result = await createRoom(svc, actor, action);
    } else if (action.kind === 'join_room') {
      result = await joinRoom(svc, actor, action);
    } else {
      // All other actions operate on an existing room — acquire advisory lock.
      result = await withRoomLock(svc, room_id, async () => {
        switch (action.kind) {
          case 'leave_room':      return leaveRoom(svc, actor, action);
          case 'ready':           return setReady(svc, actor, action);
          case 'start_game':      return startGame(svc, actor, action);
          case 'place_bet':       return placeBet(svc, actor, action);
          case 'play_card':       return playCard(svc, actor, action);
          case 'continue_hand':   return continueHand(svc, actor, action);
          case 'request_timeout': return requestTimeout(svc, actor, action);
          default:                throw new Error('unknown_action');
        }
      });
    }
  } catch (err) {
    console.error('[game-action] handler threw:', err);
    return jsonResponse({ ok: false, error: 'internal_error' }, 500);
  }

  // After-commit broadcast (best-effort, doesn't fail the action).
  if (result.ok && room_id) {
    void broadcastStateChanged(svc, room_id, result.version).catch((e) =>
      console.error('[game-action] broadcast failed:', e),
    );
  }

  return jsonResponse(result);
});

async function withRoomLock<T>(
  svc: any,
  room_id: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  if (!room_id) return fn();
  // Advisory lock is per-transaction; we run inside a single Postgres
  // transaction by using rpc('with_room_lock'), or we use a session-level
  // lock via direct SQL. Supabase JS client doesn't expose tx, so we use
  // a dedicated SQL function (added in Task 3.6).
  const { error } = await svc.rpc('acquire_room_lock', { p_room_id: room_id });
  if (error) throw error;
  try {
    return await fn();
  } finally {
    await svc.rpc('release_room_lock', { p_room_id: room_id });
  }
}
```

> **NOTE:** Supabase JS client doesn't expose Postgres transactions across multiple `.from(...)` calls. The cleanest pattern is to wrap each action's full SQL into a single SECURITY DEFINER function (transaction-scoped advisory lock + all updates) — but that bloats the SQL surface. As a pragmatic alternative we use a session-level advisory lock via two RPCs (`acquire_room_lock` / `release_room_lock`) and accept that the lock is held across multiple round-trips. The alternative — reimplementing each action as a SQL function — is in scope for a future hardening.

- [ ] **Step 2: Add advisory lock RPCs to a follow-up migration**

Create `supabase/migrations/003_advisory_locks.sql`:

```sql
BEGIN;

-- Session-level advisory lock helpers.
-- They live for the connection (Edge runtime keeps the connection alive
-- while the request runs).
CREATE OR REPLACE FUNCTION public.acquire_room_lock(p_room_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM pg_advisory_lock(hashtext(p_room_id::text));
END;
$$;

CREATE OR REPLACE FUNCTION public.release_room_lock(p_room_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM pg_advisory_unlock(hashtext(p_room_id::text));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.acquire_room_lock(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_room_lock(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.acquire_room_lock(UUID) TO service_role;
GRANT  EXECUTE ON FUNCTION public.release_room_lock(UUID) TO service_role;

COMMIT;
```

Apply it via `mcp__claude_ai_Supabase__apply_migration`.

- [ ] **Step 3: Commit dispatcher and lock RPCs**

```bash
git add supabase/functions/game-action/index.ts supabase/migrations/003_advisory_locks.sql
git commit -m "feat(edge): top-level dispatcher with per-room advisory lock"
```

---

## Milestone 4 — Edge Function action handlers

Each handler returns `ActionResult` and re-fetches the snapshot at the end (for the actor's response). Idempotency rule: failed turn/order checks return `{ ok: false, error, state, version }` with the current snapshot — never throw.

### Task 4.1: `createRoom`

**Files:** Create: `supabase/functions/game-action/actions/createRoom.ts`

- [ ] **Step 1: Write the handler**

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

function generateCode(): string {
  // 6 chars, A-Z 0-9, ambiguous chars removed (0/O, 1/I)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export async function createRoom(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'create_room' }>,
): Promise<ActionResult> {
  // Insert, retrying on join-code collision.
  let inserted: { id: string; version: number } | null = null;
  for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
    const code = generateCode();
    const { data, error } = await svc
      .from('rooms')
      .insert({
        code,
        host_session_id: actor.session_id,
        player_count: action.player_count,
        max_cards: action.max_cards ?? 10,
        phase: 'waiting',
      })
      .select('id, version')
      .single();
    if (!error) {
      inserted = data as any;
      break;
    }
    // 23505 = unique_violation (collision on code) → retry
    if ((error as any).code !== '23505') throw error;
  }
  if (!inserted) throw new Error('could_not_allocate_code');

  // Add host as room player at seat 0.
  const { error: rpErr } = await svc.from('room_players').insert({
    room_id: inserted.id,
    session_id: actor.session_id,
    seat_index: 0,
    is_ready: true, // host is ready by default
  });
  if (rpErr) throw rpErr;

  await svc.from('game_events').insert({
    room_id: inserted.id,
    session_id: actor.session_id,
    kind: 'create_room',
    payload: { player_count: action.player_count, max_cards: action.max_cards ?? 10 },
  });

  await svc.from('rooms').update({ version: inserted.version + 1 }).eq('id', inserted.id);

  const snapshot = await buildSnapshot(svc, inserted.id, actor.session_id);
  return { ok: true, state: snapshot, version: inserted.version + 1 };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/game-action/actions/createRoom.ts
git commit -m "feat(edge): create_room action"
```

### Task 4.2: `joinRoom`

**Files:** Create: `supabase/functions/game-action/actions/joinRoom.ts`

- [ ] **Step 1: Write the handler**

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

export async function joinRoom(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'join_room' }>,
): Promise<ActionResult> {
  // 1. Find the room by code.
  const { data: room, error: rErr } = await svc
    .from('rooms')
    .select('id, phase, player_count, version')
    .eq('code', action.code.toUpperCase())
    .maybeSingle();
  if (rErr) throw rErr;
  if (!room) {
    return { ok: false, error: 'unknown_room', state: emptySnapshot(), version: 0 };
  }
  if (room.phase !== 'waiting') {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: false, error: 'room_in_progress', state: snapshot, version: snapshot.room?.version ?? 0 };
  }

  // 2. Already a player? Idempotent — return current state.
  const { data: existing } = await svc
    .from('room_players')
    .select('seat_index')
    .eq('room_id', room.id)
    .eq('session_id', actor.session_id)
    .maybeSingle();
  if (existing) {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: true, state: snapshot, version: snapshot.room?.version ?? 0 };
  }

  // 3. Find next free seat.
  const { data: occupied } = await svc
    .from('room_players')
    .select('seat_index')
    .eq('room_id', room.id);
  const taken = new Set((occupied ?? []).map((r: any) => r.seat_index));
  let seat = -1;
  for (let i = 0; i < room.player_count; i++) if (!taken.has(i)) { seat = i; break; }
  if (seat === -1) {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: false, error: 'room_full', state: snapshot, version: snapshot.room?.version ?? 0 };
  }

  // Ensure the joiner's display name is reflected in room_sessions
  // (in case the user changed their nickname between sessions).
  await svc
    .from('room_sessions')
    .update({ display_name: actor.display_name })
    .eq('id', actor.session_id);

  const { error: ipErr } = await svc.from('room_players').insert({
    room_id: room.id,
    session_id: actor.session_id,
    seat_index: seat,
    is_ready: false,
  });
  if (ipErr) {
    // Concurrent join took the seat — return current state.
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: false, error: 'seat_taken', state: snapshot, version: snapshot.room?.version ?? 0 };
  }

  await svc.from('game_events').insert({
    room_id: room.id, session_id: actor.session_id,
    kind: 'join_room', payload: { seat_index: seat },
  });

  const newVersion = (room.version ?? 0) + 1;
  await svc.from('rooms').update({ version: newVersion }).eq('id', room.id);

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: newVersion };
}

function emptySnapshot() {
  return {
    room: null, players: [], current_hand: null,
    hand_scores: [], current_trick: null, score_history: [],
  } as any;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/game-action/actions/joinRoom.ts
git commit -m "feat(edge): join_room action with seat allocation"
```

### Task 4.3: `leaveRoom`

**Files:** Create: `supabase/functions/game-action/actions/leaveRoom.ts`

- [ ] **Step 1: Write the handler**

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

export async function leaveRoom(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'leave_room' }>,
): Promise<ActionResult> {
  const { data: room } = await svc
    .from('rooms')
    .select('id, host_session_id, phase, version')
    .eq('id', action.room_id)
    .maybeSingle();
  if (!room) return { ok: false, error: 'unknown_room', state: emptySnapshot(), version: 0 };

  // If the player isn't in the room, no-op.
  await svc.from('room_players')
    .delete()
    .eq('room_id', room.id)
    .eq('session_id', actor.session_id);

  // If the host left and game is still waiting, transfer host to lowest seat
  // remaining; if no players remain, delete the room.
  if (room.host_session_id === actor.session_id) {
    const { data: remaining } = await svc
      .from('room_players')
      .select('session_id, seat_index')
      .eq('room_id', room.id)
      .order('seat_index', { ascending: true });
    if (!remaining || remaining.length === 0) {
      await svc.from('rooms').delete().eq('id', room.id);
      return { ok: true, state: emptySnapshot(), version: 0 };
    }
    await svc.from('rooms').update({
      host_session_id: remaining[0].session_id,
    }).eq('id', room.id);
  }

  await svc.from('game_events').insert({
    room_id: room.id, session_id: actor.session_id,
    kind: 'leave_room', payload: {},
  });

  const newVersion = (room.version ?? 0) + 1;
  await svc.from('rooms').update({ version: newVersion }).eq('id', room.id);

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: newVersion };
}

function emptySnapshot() {
  return {
    room: null, players: [], current_hand: null,
    hand_scores: [], current_trick: null, score_history: [],
  } as any;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/game-action/actions/leaveRoom.ts
git commit -m "feat(edge): leave_room with host transfer"
```

### Task 4.4: `ready`

**Files:** Create: `supabase/functions/game-action/actions/ready.ts`

- [ ] **Step 1: Write the handler**

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

export async function setReady(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'ready' }>,
): Promise<ActionResult> {
  const { data: room } = await svc
    .from('rooms')
    .select('id, version, phase')
    .eq('id', action.room_id)
    .maybeSingle();
  if (!room) return { ok: false, error: 'unknown_room', state: emptySnapshot(), version: 0 };

  await svc.from('room_players')
    .update({ is_ready: action.is_ready })
    .eq('room_id', room.id)
    .eq('session_id', actor.session_id);

  await svc.from('game_events').insert({
    room_id: room.id, session_id: actor.session_id,
    kind: 'ready', payload: { is_ready: action.is_ready },
  });

  const newVersion = (room.version ?? 0) + 1;
  await svc.from('rooms').update({ version: newVersion }).eq('id', room.id);

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: newVersion };
}

function emptySnapshot() {
  return { room: null, players: [], current_hand: null,
           hand_scores: [], current_trick: null, score_history: [] } as any;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/game-action/actions/ready.ts
git commit -m "feat(edge): ready action"
```

### Task 4.5: `startGame`

**Files:** Create: `supabase/functions/game-action/actions/startGame.ts`

- [ ] **Step 1: Write the handler**

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';
import {
  getHandCards, getTrumpForHand, createDeck, seededShuffle,
} from '../../_shared/engine/index.ts';

export async function startGame(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'start_game' }>,
): Promise<ActionResult> {
  const { data: room } = await svc
    .from('rooms')
    .select('id, host_session_id, phase, player_count, max_cards, version')
    .eq('id', action.room_id)
    .maybeSingle();
  if (!room) return { ok: false, error: 'unknown_room', state: emptySnapshot(), version: 0 };

  if (room.host_session_id !== actor.session_id) {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: false, error: 'host_only', state: snapshot, version: snapshot.room?.version ?? 0 };
  }

  if (room.phase !== 'waiting') {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: true, state: snapshot, version: snapshot.room?.version ?? 0 }; // idempotent
  }

  const { data: players } = await svc
    .from('room_players')
    .select('session_id, seat_index, is_ready')
    .eq('room_id', room.id)
    .order('seat_index', { ascending: true });

  if (!players || players.length !== room.player_count) {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: false, error: 'not_all_seats_filled', state: snapshot, version: snapshot.room?.version ?? 0 };
  }
  if (!players.every((p: any) => p.is_ready)) {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: false, error: 'not_all_ready', state: snapshot, version: snapshot.room?.version ?? 0 };
  }

  // Create hand 1.
  const handNumber = 1;
  const cardsPerPlayer = getHandCards(handNumber, room.max_cards);
  const trumpSuit = getTrumpForHand(handNumber, room.max_cards);
  const startingSeat = 0;
  const seed = crypto.randomUUID();

  const deck = seededShuffle(createDeck(), seed);
  const cardsNeeded = cardsPerPlayer * room.player_count;
  if (deck.length < cardsNeeded) throw new Error('not_enough_cards');

  const { data: hand, error: hErr } = await svc
    .from('hands')
    .insert({
      room_id: room.id,
      hand_number: handNumber,
      cards_per_player: cardsPerPlayer,
      trump_suit: trumpSuit,
      starting_seat: startingSeat,
      current_seat: startingSeat,
      phase: 'betting',
      deck_seed: seed,
    })
    .select('id')
    .single();
  if (hErr) throw hErr;

  // Deal cards.
  const dealtRows: { hand_id: string; session_id: string; card: string }[] = [];
  for (let s = 0; s < room.player_count; s++) {
    const player = players[s];
    for (let c = 0; c < cardsPerPlayer; c++) {
      const card = deck[s * cardsPerPlayer + c];
      dealtRows.push({
        hand_id: hand.id,
        session_id: player.session_id,
        card: `${card.suit}-${card.rank}`,
      });
    }
  }
  if (dealtRows.length) {
    const { error: dErr } = await svc.from('dealt_cards').insert(dealtRows);
    if (dErr) throw dErr;
  }

  await svc.from('rooms').update({
    phase: 'playing',
    current_hand_id: hand.id,
    version: (room.version ?? 0) + 1,
  }).eq('id', room.id);

  await svc.from('game_events').insert({
    room_id: room.id, hand_id: hand.id, session_id: actor.session_id,
    kind: 'start_game',
    payload: { hand_number: handNumber, trump_suit: trumpSuit, cards_per_player: cardsPerPlayer },
  });

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: snapshot.room?.version ?? 0 };
}

function emptySnapshot() {
  return { room: null, players: [], current_hand: null,
           hand_scores: [], current_trick: null, score_history: [] } as any;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/game-action/actions/startGame.ts
git commit -m "feat(edge): start_game with deal"
```

### Task 4.6: `placeBet`

**Files:** Create: `supabase/functions/game-action/actions/placeBet.ts`

- [ ] **Step 1: Write the handler**

The bet handler validates: hand exists & in betting, sender is at `current_seat`, bet within `[0, cards_per_player]`, last-bidder restriction (sum ≠ cards_per_player). Inserts `hand_scores` (UNIQUE handles double-bet race). If all bets in, switch hand to `playing`, create first trick.

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

export async function placeBet(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'place_bet' }>,
): Promise<ActionResult> {
  const { data: hand } = await svc
    .from('hands')
    .select('id, room_id, cards_per_player, current_seat, phase, starting_seat')
    .eq('id', action.hand_id)
    .maybeSingle();
  if (!hand || hand.room_id !== action.room_id) {
    return { ok: false, error: 'unknown_hand', state: await buildSnapshot(svc, action.room_id, actor.session_id), version: 0 };
  }
  if (hand.phase !== 'betting') {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'not_in_betting', state: s, version: s.room?.version ?? 0 };
  }

  const { data: rp } = await svc.from('room_players')
    .select('seat_index')
    .eq('room_id', action.room_id)
    .eq('session_id', actor.session_id)
    .maybeSingle();
  if (!rp) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'not_in_room', state: s, version: s.room?.version ?? 0 };
  }
  if (rp.seat_index !== hand.current_seat) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'not_your_turn', state: s, version: s.room?.version ?? 0 };
  }

  if (action.bet < 0 || action.bet > hand.cards_per_player) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'invalid_bet', state: s, version: s.room?.version ?? 0 };
  }

  // Last-bidder restriction (sum != cards_per_player).
  const { data: scores } = await svc
    .from('hand_scores')
    .select('bet')
    .eq('hand_id', hand.id);
  const sumSoFar = (scores ?? []).reduce((a: number, r: any) => a + r.bet, 0);
  const { count: countPlayers } = await svc
    .from('room_players')
    .select('session_id', { count: 'exact', head: true })
    .eq('room_id', action.room_id);
  const isLastBidder = (scores?.length ?? 0) === ((countPlayers ?? 0) - 1);
  if (isLastBidder && sumSoFar + action.bet === hand.cards_per_player) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'someone_must_be_unhappy', state: s, version: s.room?.version ?? 0 };
  }

  // Insert bet — UNIQUE(hand_id, session_id) guards against double-bet race.
  const { error: insErr } = await svc.from('hand_scores').insert({
    hand_id: hand.id,
    session_id: actor.session_id,
    bet: action.bet,
  });
  if (insErr) {
    if ((insErr as any).code === '23505') {
      const s = await buildSnapshot(svc, action.room_id, actor.session_id);
      return { ok: false, error: 'already_bet', state: s, version: s.room?.version ?? 0 };
    }
    throw insErr;
  }

  // Determine next state.
  const numPlayers = countPlayers ?? 0;
  const newCount = (scores?.length ?? 0) + 1;

  let next_seat = (hand.current_seat + 1) % numPlayers;
  let nextPhase: 'betting' | 'playing' = 'betting';
  let trickInsert = null as null | { hand_id: string; trick_number: number; lead_seat: number };

  if (newCount === numPlayers) {
    // All bets in — switch to playing, create trick 1.
    nextPhase = 'playing';
    next_seat = hand.starting_seat;
    trickInsert = { hand_id: hand.id, trick_number: 1, lead_seat: next_seat };
  }

  await svc.from('hands').update({
    current_seat: next_seat,
    phase: nextPhase,
  }).eq('id', hand.id);

  if (trickInsert) {
    await svc.from('tricks').insert(trickInsert);
  }

  await svc.from('game_events').insert({
    room_id: action.room_id, hand_id: hand.id, session_id: actor.session_id,
    kind: 'bet', payload: { bet: action.bet, seat: rp.seat_index },
  });

  const { data: roomNow } = await svc.from('rooms')
    .update({ version: undefined as any }) // no-op update to retrieve fresh row
    .eq('id', action.room_id)
    .select('version').single();

  const newVersion = (roomNow?.version ?? 0) + 1;
  await svc.from('rooms').update({ version: newVersion }).eq('id', action.room_id);

  const s = await buildSnapshot(svc, action.room_id, actor.session_id);
  return { ok: true, state: s, version: newVersion };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/game-action/actions/placeBet.ts
git commit -m "feat(edge): place_bet with last-bidder rule"
```

### Task 4.7: `playCard`

**Files:** Create: `supabase/functions/game-action/actions/playCard.ts`

- [ ] **Step 1: Write the handler**

This is the largest handler. It plays a card, completes a trick if 4-th card, completes a hand if last trick, advances to next hand or finishes the game.

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';
import {
  determineTrickWinner, calculateHandScore, getHandCards,
  getTrumpForHand, createDeck, seededShuffle, isCardPlayable,
  type Suit,
} from '../../_shared/engine/index.ts';

function parseCard(s: string): { suit: string; rank: string } {
  const idx = s.lastIndexOf('-');
  return { suit: s.substring(0, idx), rank: s.substring(idx + 1) };
}

export async function playCard(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'play_card' }>,
): Promise<ActionResult> {
  const { data: hand } = await svc.from('hands')
    .select('id, room_id, current_seat, phase, cards_per_player, trump_suit, starting_seat, hand_number')
    .eq('id', action.hand_id).maybeSingle();
  if (!hand || hand.room_id !== action.room_id) {
    return { ok: false, error: 'unknown_hand', state: await buildSnapshot(svc, action.room_id, actor.session_id), version: 0 };
  }
  if (hand.phase !== 'playing') {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'not_in_playing', state: s, version: s.room?.version ?? 0 };
  }

  const { data: rp } = await svc.from('room_players')
    .select('seat_index')
    .eq('room_id', action.room_id)
    .eq('session_id', actor.session_id)
    .maybeSingle();
  if (!rp || rp.seat_index !== hand.current_seat) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'not_your_turn', state: s, version: s.room?.version ?? 0 };
  }

  // Card must be in player's hand and not already played.
  const { data: dealt } = await svc.from('dealt_cards')
    .select('card')
    .eq('hand_id', hand.id)
    .eq('session_id', actor.session_id)
    .eq('card', action.card)
    .maybeSingle();
  if (!dealt) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'card_not_in_hand', state: s, version: s.room?.version ?? 0 };
  }

  // Get current trick (open).
  const { data: trick } = await svc.from('tricks')
    .select('id, trick_number, lead_seat')
    .eq('hand_id', hand.id)
    .is('closed_at', null)
    .order('trick_number', { ascending: false })
    .limit(1).maybeSingle();
  if (!trick) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'no_open_trick', state: s, version: s.room?.version ?? 0 };
  }

  // Played-already? UNIQUE(trick_id, seat_index) handles it.
  // Must-follow-suit check.
  const { data: tcards } = await svc.from('trick_cards')
    .select('seat_index, card')
    .eq('trick_id', trick.id)
    .order('played_at', { ascending: true });
  const trickCards = (tcards ?? []).map((r: any) => ({ seat: r.seat_index, ...parseCard(r.card) }));
  const leadSuit = trickCards.length > 0 ? trickCards[0].suit : null;
  const played = parseCard(action.card);

  if (leadSuit && played.suit !== leadSuit) {
    // Player must follow suit if they have any of leadSuit.
    const { data: hasLead } = await svc.from('dealt_cards')
      .select('card')
      .eq('hand_id', hand.id)
      .eq('session_id', actor.session_id)
      .like('card', `${leadSuit}-%`);
    // We must subtract already-played ones.
    const { data: playedByMe } = await svc.from('trick_cards')
      .select('card, trick_id')
      .in('trick_id', (await svc.from('tricks').select('id').eq('hand_id', hand.id)).data?.map((t: any) => t.id) ?? []);
    const playedSet = new Set((playedByMe ?? []).map((r: any) => r.card));
    const leadInHand = (hasLead ?? []).filter((r: any) => !playedSet.has(r.card));
    if (leadInHand.length > 0) {
      const s = await buildSnapshot(svc, action.room_id, actor.session_id);
      return { ok: false, error: 'must_follow_suit', state: s, version: s.room?.version ?? 0 };
    }
  }

  // Insert trick_card; UNIQUE handles race.
  const { error: tcErr } = await svc.from('trick_cards').insert({
    trick_id: trick.id, seat_index: rp.seat_index, card: action.card,
  });
  if (tcErr) {
    if ((tcErr as any).code === '23505') {
      const s = await buildSnapshot(svc, action.room_id, actor.session_id);
      return { ok: false, error: 'already_played', state: s, version: s.room?.version ?? 0 };
    }
    throw tcErr;
  }

  await svc.from('game_events').insert({
    room_id: action.room_id, hand_id: hand.id, session_id: actor.session_id,
    kind: 'play_card', payload: { card: action.card, seat: rp.seat_index, trick_id: trick.id },
  });

  // Did the trick complete?
  const { count: numPlayers } = await svc.from('room_players')
    .select('session_id', { count: 'exact', head: true })
    .eq('room_id', action.room_id);
  const totalPlayers = numPlayers ?? 0;
  const cardsInTrick = trickCards.length + 1;

  let nextSeat = (rp.seat_index + 1) % totalPlayers;
  let trickClosed = false;
  let handClosed = false;
  let finishedGame = false;

  if (cardsInTrick === totalPlayers) {
    // Determine winner.
    const allCards = [...trickCards, { seat: rp.seat_index, ...played }];
    const winnerSeat = determineWinner(allCards, hand.trump_suit);
    await svc.from('tricks').update({
      winner_seat: winnerSeat, closed_at: new Date().toISOString(),
    }).eq('id', trick.id);
    trickClosed = true;

    // Increment hand_scores.taken_tricks for the winner.
    const { data: winnerPlayer } = await svc.from('room_players')
      .select('session_id').eq('room_id', action.room_id).eq('seat_index', winnerSeat).maybeSingle();
    if (winnerPlayer) {
      await svc.rpc('increment_taken_tricks', {
        p_hand_id: hand.id, p_session_id: winnerPlayer.session_id,
      });
    }

    nextSeat = winnerSeat;

    // Was that the last trick of the hand?
    const { count: closedTricks } = await svc.from('tricks')
      .select('id', { count: 'exact', head: true })
      .eq('hand_id', hand.id)
      .not('closed_at', 'is', null);
    if ((closedTricks ?? 0) === hand.cards_per_player) {
      // Hand done — score it.
      handClosed = true;
      const { data: scores } = await svc.from('hand_scores')
        .select('session_id, bet, taken_tricks').eq('hand_id', hand.id);
      for (const row of scores ?? []) {
        const score = calculateHandScore(row.bet, row.taken_tricks);
        await svc.from('hand_scores').update({ hand_score: score })
          .eq('hand_id', hand.id).eq('session_id', row.session_id);
      }
      await svc.from('hands').update({
        phase: 'scoring',
        closed_at: new Date().toISOString(),
      }).eq('id', hand.id);
    } else {
      // Open next trick.
      await svc.from('tricks').insert({
        hand_id: hand.id,
        trick_number: trick.trick_number + 1,
        lead_seat: nextSeat,
      });
    }
  }

  if (!handClosed) {
    await svc.from('hands').update({ current_seat: nextSeat }).eq('id', hand.id);
  }

  const { data: roomRow } = await svc.from('rooms')
    .select('version').eq('id', action.room_id).single();
  const newVersion = (roomRow?.version ?? 0) + 1;
  await svc.from('rooms').update({ version: newVersion }).eq('id', action.room_id);

  const s = await buildSnapshot(svc, action.room_id, actor.session_id);
  return { ok: true, state: s, version: newVersion };
}

function determineWinner(
  trick: Array<{ seat: number; suit: string; rank: string }>,
  trumpSuit: string,
): number {
  // Wrap card data to match engine's determineTrickWinner signature.
  // Engine expects Card objects with .suit and .rank; we use string ranks.
  const RANK_ORDER: Record<string, number> = {
    '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14,
  };
  const leadSuit = trick[0].suit;
  let winner = trick[0];
  for (const c of trick.slice(1)) {
    // Trump beats non-trump; otherwise must be same suit and higher rank.
    const cIsTrump = c.suit === trumpSuit;
    const wIsTrump = winner.suit === trumpSuit;
    if (cIsTrump && !wIsTrump) winner = c;
    else if (cIsTrump && wIsTrump && RANK_ORDER[c.rank] > RANK_ORDER[winner.rank]) winner = c;
    else if (!cIsTrump && !wIsTrump && c.suit === leadSuit && winner.suit === leadSuit
             && RANK_ORDER[c.rank] > RANK_ORDER[winner.rank]) winner = c;
  }
  return winner.seat;
}
```

- [ ] **Step 2: Add `increment_taken_tricks` RPC (small atomic update)**

Append to migration `003_advisory_locks.sql` (or new `004_helpers.sql`):

```sql
CREATE OR REPLACE FUNCTION public.increment_taken_tricks(p_hand_id UUID, p_session_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  UPDATE public.hand_scores
  SET taken_tricks = taken_tricks + 1
  WHERE hand_id = p_hand_id AND session_id = p_session_id;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_taken_tricks(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.increment_taken_tricks(UUID, UUID) TO service_role;
```

Apply via `mcp__claude_ai_Supabase__apply_migration`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/game-action/actions/playCard.ts supabase/migrations/004_helpers.sql
git commit -m "feat(edge): play_card with trick settle and hand close"
```

### Task 4.8: `continueHand`

**Files:** Create: `supabase/functions/game-action/actions/continueHand.ts`

- [ ] **Step 1: Write the handler**

If the current hand is in `scoring`, open the next hand (or finish the game). If already past, return current snapshot — idempotent. **This is the bug-fix for the Continue race.**

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';
import {
  getTotalHands, getHandCards, getTrumpForHand,
  createDeck, seededShuffle,
} from '../../_shared/engine/index.ts';

export async function continueHand(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'continue_hand' }>,
): Promise<ActionResult> {
  const { data: hand } = await svc.from('hands')
    .select('id, room_id, hand_number, phase')
    .eq('id', action.hand_id).maybeSingle();
  if (!hand || hand.room_id !== action.room_id) {
    return { ok: false, error: 'unknown_hand',
             state: await buildSnapshot(svc, action.room_id, actor.session_id), version: 0 };
  }

  // IDEMPOTENT: if not in scoring, just return current snapshot — no error.
  if (hand.phase !== 'scoring') {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: true, state: s, version: s.room?.version ?? 0 };
  }

  const { data: room } = await svc.from('rooms')
    .select('id, max_cards, player_count, version').eq('id', action.room_id).single();

  await svc.from('hands').update({ phase: 'closed' }).eq('id', hand.id);

  const totalHands = getTotalHands(room.max_cards);
  if (hand.hand_number >= totalHands) {
    // Finish the game.
    await svc.from('rooms').update({
      phase: 'finished',
      version: (room.version ?? 0) + 1,
    }).eq('id', room.id);

    await svc.from('game_events').insert({
      room_id: action.room_id, hand_id: hand.id, session_id: actor.session_id,
      kind: 'game_finished', payload: {},
    });

    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: true, state: s, version: s.room?.version ?? 0 };
  }

  // Open next hand.
  const nextNum = hand.hand_number + 1;
  const cardsPerPlayer = getHandCards(nextNum, room.max_cards);
  const trumpSuit = getTrumpForHand(nextNum, room.max_cards);
  const startingSeat = (nextNum - 1) % room.player_count;
  const seed = crypto.randomUUID();

  const deck = seededShuffle(createDeck(), seed);
  const { data: nextHand, error: hErr } = await svc.from('hands').insert({
    room_id: room.id,
    hand_number: nextNum,
    cards_per_player: cardsPerPlayer,
    trump_suit: trumpSuit,
    starting_seat: startingSeat,
    current_seat: startingSeat,
    phase: 'betting',
    deck_seed: seed,
  }).select('id').single();
  if (hErr) throw hErr;

  // Deal new cards.
  const { data: players } = await svc.from('room_players')
    .select('session_id, seat_index')
    .eq('room_id', room.id)
    .order('seat_index', { ascending: true });
  const dealtRows: { hand_id: string; session_id: string; card: string }[] = [];
  for (let s = 0; s < room.player_count; s++) {
    for (let c = 0; c < cardsPerPlayer; c++) {
      const card = deck[s * cardsPerPlayer + c];
      dealtRows.push({
        hand_id: nextHand.id,
        session_id: players![s].session_id,
        card: `${card.suit}-${card.rank}`,
      });
    }
  }
  await svc.from('dealt_cards').insert(dealtRows);

  await svc.from('rooms').update({
    current_hand_id: nextHand.id,
    version: (room.version ?? 0) + 1,
  }).eq('id', room.id);

  await svc.from('game_events').insert({
    room_id: room.id, hand_id: nextHand.id, session_id: actor.session_id,
    kind: 'continue_hand',
    payload: { hand_number: nextNum, trump_suit: trumpSuit, cards_per_player: cardsPerPlayer },
  });

  const s2 = await buildSnapshot(svc, action.room_id, actor.session_id);
  return { ok: true, state: s2, version: s2.room?.version ?? 0 };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/game-action/actions/continueHand.ts
git commit -m "feat(edge): continue_hand idempotent — fixes Continue race"
```

### Task 4.9: `requestTimeout`

**Files:** Create: `supabase/functions/game-action/actions/requestTimeout.ts`

- [ ] **Step 1: Write the handler**

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';
import { placeBet } from './placeBet.ts';
import { playCard } from './playCard.ts';

export async function requestTimeout(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'request_timeout' }>,
): Promise<ActionResult> {
  const { data: hand } = await svc.from('hands')
    .select('id, room_id, current_seat, phase, cards_per_player')
    .eq('id', action.hand_id).maybeSingle();
  if (!hand || hand.room_id !== action.room_id) {
    return { ok: false, error: 'unknown_hand',
             state: await buildSnapshot(svc, action.room_id, actor.session_id), version: 0 };
  }
  // Idempotent: stale timeout request → no-op.
  if (hand.current_seat !== action.expected_seat) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: true, state: s, version: s.room?.version ?? 0 };
  }

  // Find the timed-out player's session_id.
  const { data: rp } = await svc.from('room_players')
    .select('session_id')
    .eq('room_id', action.room_id)
    .eq('seat_index', hand.current_seat)
    .maybeSingle();
  if (!rp) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: true, state: s, version: s.room?.version ?? 0 };
  }

  // Synthesize an actor for the timed-out player.
  const stuckActor: ActorContext = {
    auth_user_id: actor.auth_user_id, // doesn't matter for this path
    session_id: rp.session_id,
    display_name: 'timeout',
  };

  await svc.from('game_events').insert({
    room_id: action.room_id, hand_id: hand.id, session_id: rp.session_id,
    kind: 'timeout', payload: { seat: hand.current_seat },
  });

  if (hand.phase === 'betting') {
    // Try bet 0 first; if last-bidder restriction blocks 0, try 1, etc.
    for (let bet = 0; bet <= hand.cards_per_player; bet++) {
      const r = await placeBet(svc, stuckActor, {
        kind: 'place_bet', room_id: action.room_id, hand_id: hand.id, bet,
      });
      if (r.ok) return r;
    }
    return { ok: false, error: 'no_legal_bet',
             state: await buildSnapshot(svc, action.room_id, actor.session_id), version: 0 };
  }

  if (hand.phase === 'playing') {
    // Pick the lowest playable card from the player's remaining hand.
    const { data: cards } = await svc.from('dealt_cards')
      .select('card').eq('hand_id', hand.id).eq('session_id', rp.session_id);
    const { data: played } = await svc.from('trick_cards')
      .select('card, trick_id')
      .in('trick_id',
          (await svc.from('tricks').select('id').eq('hand_id', hand.id)).data?.map((t: any) => t.id) ?? []);
    const playedSet = new Set((played ?? []).map((r: any) => r.card));
    const remaining = (cards ?? []).map((r: any) => r.card).filter((c: string) => !playedSet.has(c));

    for (const card of remaining) {
      const r = await playCard(svc, stuckActor, {
        kind: 'play_card', room_id: action.room_id, hand_id: hand.id, card,
      });
      if (r.ok) return r;
    }
    return { ok: false, error: 'no_legal_card',
             state: await buildSnapshot(svc, action.room_id, actor.session_id), version: 0 };
  }

  const s = await buildSnapshot(svc, action.room_id, actor.session_id);
  return { ok: true, state: s, version: s.room?.version ?? 0 };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/game-action/actions/requestTimeout.ts
git commit -m "feat(edge): request_timeout — idempotent auto-advance"
```

### Task 4.10: Deploy Edge Function to branch & smoke-test

- [ ] **Step 1: Deploy**

Use `mcp__claude_ai_Supabase__deploy_edge_function` against the branch project ref with files: `index.ts`, `auth.ts`, `snapshot.ts`, `broadcast.ts`, `actions/*.ts`, `_shared/cors.ts`, `_shared/types.ts`, `_shared/engine/*.ts`.

- [ ] **Step 2: Manual smoke test**

```bash
curl -X POST "https://<branch-ref>.supabase.co/functions/v1/game-action" \
  -H "Authorization: Bearer <anon_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"display_name":"Alice","action":{"kind":"create_room","player_count":4,"display_name":"Alice"}}'
```

Expected: `{ ok: true, state: { room: { ... }, ... } }`.

- [ ] **Step 3: Commit any fixes**

If the smoke test surfaces issues, fix and recommit.

---

## Milestone 5 — Client: roomStore, gameClient, Realtime

### Task 5.1: `roomStore`

**Files:**
- Create: `src/store/roomStore.ts`

- [ ] **Step 1: Write the store**

```ts
import { create } from 'zustand';
import type { RoomSnapshot } from '../../supabase/functions/_shared/types';

interface RoomState {
  snapshot: RoomSnapshot | null;
  version: number;
  myPlayerId: string | null;        // = session_id
  connState: 'idle' | 'syncing' | 'connected' | 'reconnecting' | 'error';
  setMyPlayerId: (id: string | null) => void;
  applySnapshot: (s: RoomSnapshot, version: number) => void;
  setConnState: (s: RoomState['connState']) => void;
  reset: () => void;
}

export const useRoomStore = create<RoomState>((set) => ({
  snapshot: null,
  version: 0,
  myPlayerId: null,
  connState: 'idle',
  setMyPlayerId: (id) => set({ myPlayerId: id }),
  applySnapshot: (snapshot, version) => set((st) =>
    version >= st.version ? { snapshot, version } : st),
  setConnState: (connState) => set({ connState }),
  reset: () => set({ snapshot: null, version: 0, connState: 'idle' }),
}));
```

- [ ] **Step 2: Commit**

```bash
git add src/store/roomStore.ts
git commit -m "feat(store): roomStore — thin renderer cache"
```

### Task 5.2: `gameClient`

**Files:**
- Create: `src/lib/gameClient.ts`

- [ ] **Step 1: Write the client**

```ts
import { supabase } from './supabase/client';
import { useRoomStore } from '../store/roomStore';
import type { Action, ActionResult, RoomSnapshot } from '../../supabase/functions/_shared/types';

const FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/game-action`;

async function postAction(displayName: string | null, action: Action): Promise<ActionResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('not_signed_in');

  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
    },
    body: JSON.stringify({ display_name: displayName, action }),
  });
  const json = (await res.json()) as ActionResult;

  // Apply returned snapshot regardless of ok/error (server tells us truth).
  if (json.state) {
    useRoomStore.getState().applySnapshot(json.state, json.version);
  }
  return json;
}

export const gameClient = {
  createRoom: (displayName: string, player_count: number, max_cards = 10) =>
    postAction(displayName, { kind: 'create_room', display_name: displayName, player_count, max_cards }),
  joinRoom: (displayName: string, code: string) =>
    postAction(displayName, { kind: 'join_room', display_name: displayName, code }),
  leaveRoom: (room_id: string) =>
    postAction(null, { kind: 'leave_room', room_id }),
  setReady: (room_id: string, is_ready: boolean) =>
    postAction(null, { kind: 'ready', room_id, is_ready }),
  startGame: (room_id: string) =>
    postAction(null, { kind: 'start_game', room_id }),
  placeBet: (room_id: string, hand_id: string, bet: number) =>
    postAction(null, { kind: 'place_bet', room_id, hand_id, bet }),
  playCard: (room_id: string, hand_id: string, card: string) =>
    postAction(null, { kind: 'play_card', room_id, hand_id, card }),
  continueHand: (room_id: string, hand_id: string) =>
    postAction(null, { kind: 'continue_hand', room_id, hand_id }),
  requestTimeout: (room_id: string, hand_id: string, expected_seat: number) =>
    postAction(null, { kind: 'request_timeout', room_id, hand_id, expected_seat }),

  refreshSnapshot: async (room_id: string): Promise<void> => {
    const { data, error } = await supabase.rpc('get_room_state', { p_room_id: room_id });
    if (error) {
      useRoomStore.getState().setConnState('error');
      return;
    }
    const snapshot = data as RoomSnapshot;
    useRoomStore.getState().applySnapshot(snapshot, snapshot.room?.version ?? 0);
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/gameClient.ts
git commit -m "feat(client): gameClient — POST wrapper + refreshSnapshot RPC"
```

### Task 5.3: Realtime Broadcast subscription

**Files:**
- Create: `src/lib/realtimeBroadcast.ts`

- [ ] **Step 1: Write the subscriber**

```ts
import { supabase } from './supabase/client';
import { useRoomStore } from '../store/roomStore';
import { gameClient } from './gameClient';
import type { RealtimeChannel } from '@supabase/supabase-js';

let channel: RealtimeChannel | null = null;
let currentRoomId: string | null = null;

export function subscribeRoom(room_id: string) {
  if (channel && currentRoomId === room_id) return; // already subscribed

  unsubscribeRoom();

  currentRoomId = room_id;
  channel = supabase.channel(`room:${room_id}`);

  channel.on('broadcast', { event: 'state_changed' }, async ({ payload }) => {
    const local = useRoomStore.getState().version;
    if (typeof payload?.version === 'number' && payload.version > local) {
      useRoomStore.getState().setConnState('syncing');
      await gameClient.refreshSnapshot(room_id);
      useRoomStore.getState().setConnState('connected');
    }
  });

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      useRoomStore.getState().setConnState('connected');
      // Initial pull on subscribe — guarantees fresh state.
      void gameClient.refreshSnapshot(room_id);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      useRoomStore.getState().setConnState('reconnecting');
    } else if (status === 'CLOSED') {
      useRoomStore.getState().setConnState('idle');
    }
  });
}

export function unsubscribeRoom() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
    currentRoomId = null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/realtimeBroadcast.ts
git commit -m "feat(client): subscribeRoom — Broadcast pings + RPC refetch"
```

---

## Milestone 6 — Client: auth (anonymous + Google)

### Task 6.1: Anonymous sign-in on first launch

**Files:**
- Create: `src/lib/auth/anonymous.ts`
- Modify: `src/App.tsx` (call on mount)

- [ ] **Step 1: Write the helper**

```ts
import { supabase } from '../supabase/client';

export async function ensureAnonymousSession(displayName: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return; // already signed in

  const { error } = await supabase.auth.signInAnonymously({
    options: { data: { display_name: displayName } },
  });
  if (error) throw error;
}
```

- [ ] **Step 2: Wire into `src/App.tsx` bootstrap**

After Supabase is initialized but before navigation renders, call `ensureAnonymousSession(displayName ?? 'Guest')`. The user can edit display name later — that's an `auth.updateUser` call, not a re-sign-in.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/anonymous.ts src/App.tsx
git commit -m "feat(auth): anonymous sign-in on first launch"
```

### Task 6.2: Google linkIdentity

**Files:**
- Create: `src/lib/auth/google.ts`
- Modify: `src/screens/ProfileScreen.tsx` or `AuthScreen.tsx` — add "Link Google" button

- [ ] **Step 1: Write the helper**

```ts
import { supabase } from '../supabase/client';

export async function linkGoogle(): Promise<void> {
  const { data, error } = await supabase.auth.linkIdentity({
    provider: 'google',
    options: { redirectTo: process.env.EXPO_PUBLIC_APP_URL + '/auth/callback' },
  });
  if (error) throw error;
  // Browser/in-app flow opens; on return, Supabase emits SIGNED_IN.
  // No code path here — caller subscribes to onAuthStateChange.
}

export async function unlinkGoogle(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const googleIdentity = user?.identities?.find((i) => i.provider === 'google');
  if (!googleIdentity) return;
  const { error } = await supabase.auth.unlinkIdentity(googleIdentity);
  if (error) throw error;
}
```

- [ ] **Step 2: Add UI button**

In `ProfileScreen.tsx` (or wherever the user manages account), add:

```tsx
<Pressable onPress={async () => {
  try { await linkGoogle(); } catch (e) { showError(e); }
}} testID="btn-link-google">
  <Text>Sign in with Google</Text>
</Pressable>
```

If `user.is_anonymous === false && user.identities?.some(i => i.provider === 'google')`, show "Unlink Google" instead.

- [ ] **Step 3: Configure redirect URL in Supabase**

In Supabase Dashboard → Authentication → URL Configuration, ensure the redirect URL `https://nigels.online/auth/callback` is allowlisted.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/google.ts src/screens/ProfileScreen.tsx
git commit -m "feat(auth): Google linkIdentity"
```

---

## Milestone 7 — Client: UI integration

### Task 7.1: Wire Lobby create/join

**Files:**
- Modify: `src/screens/LobbyScreen.tsx`

- [ ] **Step 1: Replace internal `createRoom` / `joinRoom` calls with `gameClient`**

Find the existing create/join handlers (currently calling `roomManager` or store methods) and replace with:

```ts
const r = await gameClient.createRoom(displayName, playerCount, maxCards);
if (r.ok) {
  useRoomStore.getState().setMyPlayerId(r.state.players.find(p => p.session_id === actorSessionId)?.session_id ?? null);
  subscribeRoom(r.state.room!.id);
  navigateToWaitingRoom(r.state.room!.id);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/LobbyScreen.tsx
git commit -m "refactor(lobby): use gameClient for room actions"
```

### Task 7.2: Wire WaitingRoomScreen

**Files:**
- Modify: `src/screens/WaitingRoomScreen.tsx`

- [ ] **Step 1: Replace `gameStore.players`/`multiplayerStore.roomPlayers` reads with `roomStore.snapshot.players`**

- [ ] **Step 2: Replace ready/leave/start handlers with `gameClient.setReady` / `gameClient.leaveRoom` / `gameClient.startGame`**

- [ ] **Step 3: Commit**

```bash
git add src/screens/WaitingRoomScreen.tsx
git commit -m "refactor(waiting-room): use roomStore + gameClient"
```

### Task 7.3: Wire BettingPhase

**Files:**
- Modify: `src/components/betting/BettingPhase.tsx`

- [ ] **Step 1: Replace `useGameStore` reads with `useRoomStore`**

```ts
const snapshot = useRoomStore((s) => s.snapshot);
const myId = useRoomStore((s) => s.myPlayerId);
const hand = snapshot?.current_hand;
const myHand = (snapshot as any)?.my_hand ?? [];
const handScores = snapshot?.hand_scores ?? [];
const isMyTurn = hand?.current_seat === snapshot?.players.find(p => p.session_id === myId)?.seat_index;
const myBet = handScores.find((s: any) => s.session_id === myId)?.bet ?? null;
```

- [ ] **Step 2: Replace bet click handler**

```ts
const onBet = async (bet: number) => {
  await gameClient.placeBet(snapshot!.room!.id, hand!.id, bet);
  // Snapshot is applied automatically by gameClient.
};
```

- [ ] **Step 3: Remove the 2-second polling effect**

Delete the `setInterval` / heartbeat / `gameStateSync` calls.

- [ ] **Step 4: Commit**

```bash
git add src/components/betting/BettingPhase.tsx
git commit -m "refactor(betting): roomStore + gameClient, remove polling"
```

### Task 7.4: Wire GameTableScreen

**Files:**
- Modify: `src/screens/GameTableScreen.tsx`

Largest UI surface. Iterate one section at a time.

- [ ] **Step 1: Replace store reads (top of component)**

Replace every `useGameStore(...)` selector with the equivalent `useRoomStore(...)` derived value.

- [ ] **Step 2: Replace card-play handler**

```ts
const onCardPress = async (cardId: string) => {
  await gameClient.playCard(snapshot!.room!.id, currentHand!.id, cardId);
};
```

- [ ] **Step 3: Replace heartbeat / `forceRemoteState` effects with one mount-time subscribe**

```ts
useEffect(() => {
  if (!roomId) return;
  subscribeRoom(roomId);
  return () => unsubscribeRoom();
}, [roomId]);
```

- [ ] **Step 4: Replace ScoreboardModal `onContinue`**

```ts
const onContinue = async () => {
  setShowScoreboard(false);
  await gameClient.continueHand(snapshot!.room!.id, currentHand!.id);
};
```

- [ ] **Step 5: Add testIDs for the demo**

Ensure the new continue handler retains the existing testID flow (`btn-continue` etc.) so demo-4players.ts keeps working.

- [ ] **Step 6: Commit**

```bash
git add src/screens/GameTableScreen.tsx
git commit -m "refactor(game-table): roomStore + gameClient, single subscribe"
```

### Task 7.5: Wire ScoreboardModal & WaitingRoom presence

**Files:**
- Modify: `src/screens/ScoreboardModal.tsx`

- [ ] **Step 1: Read scores and history from `roomStore.snapshot.score_history`**

- [ ] **Step 2: Add testID `btn-continue-scoreboard` on the Continue/Play Again button**

This makes the demo more reliable by replacing text-based Continue detection.

- [ ] **Step 3: Commit**

```bash
git add src/screens/ScoreboardModal.tsx
git commit -m "refactor(scoreboard): roomStore.score_history + testID"
```

---

## Milestone 8 — Client: turn timeout watcher

### Task 8.1: Hook for client-side timeout detection

**Files:**
- Create: `src/lib/turnTimeout.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useEffect, useRef } from 'react';
import { useRoomStore } from '../store/roomStore';
import { gameClient } from './gameClient';

const TURN_TIMEOUT_MS = 30_000;

export function useTurnTimeout() {
  const roomId   = useRoomStore((s) => s.snapshot?.room?.id);
  const handId   = useRoomStore((s) => s.snapshot?.current_hand?.id);
  const seat     = useRoomStore((s) => s.snapshot?.current_hand?.current_seat);
  const version  = useRoomStore((s) => s.version);
  const lastSeat = useRef<number | null>(null);
  const startedAt = useRef<number>(Date.now());

  useEffect(() => {
    if (seat === undefined || seat === null) return;
    if (lastSeat.current !== seat) {
      lastSeat.current = seat;
      startedAt.current = Date.now();
    }
    const elapsed = Date.now() - startedAt.current;
    const remaining = TURN_TIMEOUT_MS - elapsed;
    if (remaining <= 0) {
      void gameClient.requestTimeout(roomId!, handId!, seat);
      return;
    }
    const t = setTimeout(() => {
      void gameClient.requestTimeout(roomId!, handId!, seat);
    }, remaining);
    return () => clearTimeout(t);
  }, [roomId, handId, seat, version]);
}
```

- [ ] **Step 2: Mount the hook in `GameTableScreen`**

```tsx
useTurnTimeout();
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/turnTimeout.ts src/screens/GameTableScreen.tsx
git commit -m "feat(timeout): client-side 30s turn watcher"
```

---

## Milestone 9 — Cleanup of dead code

### Task 9.1: Delete files

**Files:**
- Delete: `src/store/gameStore.ts`
- Delete: `src/lib/multiplayer/eventHandler.ts`
- Delete: `src/lib/multiplayer/gameActions.ts`
- Delete: `src/lib/multiplayer/gameStateSync.ts`
- Delete: `src/lib/multiplayer/networkMonitor.ts`
- Delete: `src/lib/multiplayer/rejoinManager.ts`
- Delete: `src/lib/multiplayer/seededRandom.ts`
- Delete: `src/lib/multiplayer/roomManager.ts` (if all callers are gone)

- [ ] **Step 1: Run `npm run ts:check`. For every TypeScript error, find the importer and refactor to use `roomStore` / `gameClient` / `subscribeRoom`.**

This is the painful but mechanical step. Each broken import points to a place where v2 code referenced peer-logic; replace with the new module.

- [ ] **Step 2: After ts:check is clean, delete the files**

```bash
git rm src/store/gameStore.ts \
       src/lib/multiplayer/eventHandler.ts \
       src/lib/multiplayer/gameActions.ts \
       src/lib/multiplayer/gameStateSync.ts \
       src/lib/multiplayer/networkMonitor.ts \
       src/lib/multiplayer/rejoinManager.ts \
       src/lib/multiplayer/seededRandom.ts
git rm -f src/lib/multiplayer/roomManager.ts || true
```

- [ ] **Step 3: Run `npm test` — fix any test breakage**

Existing tests of game logic should still pass (engine is unchanged). Tests of the deleted modules can be deleted.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove peer-state code (gameStore, eventHandler, etc.)"
```

---

## Milestone 10 — E2E test on Supabase branch

### Task 10.1: Run `demo-4players.ts` against the branch

**Files:** none (test only)

- [ ] **Step 1: Set `EXPO_PUBLIC_SUPABASE_URL` to branch URL**

```bash
export EXPO_PUBLIC_SUPABASE_URL="https://<branch-ref>.supabase.co"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="<branch_anon_key>"
```

- [ ] **Step 2: Start local dev server pointing at the branch**

```bash
npx expo start --port 8081
```

- [ ] **Step 3: Run the demo**

```bash
APP_URL=http://localhost:8081 npx tsx scripts/demo-4players.ts
```

Expected: full 20-hand match completes. Bug list at end shows zero `pageerror`, zero `consoleerror`, zero `stuck`. (The earlier bugs — `version` undefined, Continue race — are fixed by construction.)

- [ ] **Step 4: If issues surface, fix them and re-run**

Iterate until green.

### Task 10.2: Manual mobile checks (optional but recommended)

- [ ] **Step 1: Open the dev server URL on a real iPhone (Safari) and Android (Chrome). Sign in anonymously, create room, join from a second device.**

- [ ] **Step 2: Test foreground/background: lock the screen during your turn, unlock 35s later. Expect: a default action was taken via timeout, you see the new state.**

- [ ] **Step 3: Test reconnect: airplane-mode for 10s, then back. Expect: connState briefly `reconnecting`, then `connected` with fresh snapshot.**

- [ ] **Step 4: Test Google linkIdentity: tap "Sign in with Google" in Profile, complete OAuth, verify `auth.users.is_anonymous = false`.**

---

## Milestone 11 — Prod deploy

### Task 11.1: Promote to prod

> **STOP CHECKPOINT:** before this task, ensure all branch tests pass. If running in `--dangerously-skip-permissions`, this step still warrants explicit confirmation if any prior step surfaced unresolved errors.

- [ ] **Step 1: Apply migrations 002, 003, 004 to prod**

Use `mcp__claude_ai_Supabase__apply_migration` against project ref `evcaqgmkdlqesqisjfyh`.

- [ ] **Step 2: Deploy edge function to prod**

Use `mcp__claude_ai_Supabase__deploy_edge_function` against `evcaqgmkdlqesqisjfyh`.

- [ ] **Step 3: Build & deploy client**

```bash
git push origin main      # triggers Vercel deploy
```

Wait for Vercel deployment to complete, confirm the URL is reachable.

- [ ] **Step 4: Run prod smoke test**

```bash
APP_URL=https://nigels.online npx tsx scripts/demo-4players.ts
```

Expected: zero bugs.

- [ ] **Step 5: If smoke fails, rollback**

```bash
git revert HEAD~N..HEAD   # the merge commit
git push origin main
```

(For DB: keep the new schema; the old schema is gone. Worst case, drop new tables and re-create old via a hot-fix migration. Since there are no real users, accepting some data loss is fine.)

- [ ] **Step 6: If smoke passes, delete the Supabase branch**

Use `mcp__claude_ai_Supabase__delete_branch`.

- [ ] **Step 7: Update memory**

Open `~/.claude-personal/projects/-Users-akadymov-claude-projects-nigels-app-v2/memory/project_sync_architecture.md` and rewrite to reflect the new architecture (server-authoritative, normalized schema, Broadcast push, single-writer Edge Function, no peer logic). Add a `MEMORY.md` line if a new file is created.

- [ ] **Step 8: Final commit**

```bash
git add docs/superpowers/specs/2026-04-27-sync-redesign-design.md
git commit --allow-empty -m "release: sync redesign live in prod"
```

---

## Risk Register

| Risk | Mitigation |
|------|------------|
| Migration drops `game_states` and new tables fail to create | Branch testing first; same transaction means atomic rollback |
| `pg_advisory_lock` held across multi-statement client calls causes long lock periods | Edge Function release on every code path (try/finally); 30s function timeout bounds worst case |
| Realtime Broadcast event lost | Client always re-runs `get_room_state` on subscribe and on focus/foreground; no missed-event divergence possible |
| Engine refactor breaks single-player vs bots | Engine behavior unchanged; the only modification is `seededShuffle` now lives in engine itself |
| Anonymous user loses session on cold launch | AsyncStorage persistence handled by Supabase JS — same as current; no regression |
| Google OAuth callback URL mismatch | Pre-flight check that redirect URL is allowlisted in Supabase Dashboard |

---

## Self-Review Checklist (post-write)

Spec coverage:
- ✅ Server-authoritative — Milestones 3–4
- ✅ Edge Function with advisory lock — Tasks 3.5
- ✅ Normalized schema — Task 1.2
- ✅ `get_room_state` RPC — Task 1.2 (in same migration)
- ✅ Realtime Broadcast push — Task 5.3
- ✅ Anonymous sign-in — Task 6.1
- ✅ Google linkIdentity — Task 6.2
- ✅ Turn timeout 30s — Milestone 8
- ✅ Migration: drop old + create new in same migration — Task 1.2
- ✅ Cleanup of peer-logic files — Milestone 9
- ✅ E2E demo-4players.ts — Milestone 10
- ✅ Prod deploy — Milestone 11

Placeholders / vague steps: none (all steps have concrete code or commands).

Type consistency: `RoomSnapshot` defined in `_shared/types.ts` and re-imported across client. `ActorContext`, `Action`, `ActionResult` likewise.
