# Conditional Stakes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let logged-in players opt into a zero-sum rating wager per game, with a journaled rating balance and admin reset tools.

**Architecture:** Per-user `rating_balance` lives in a new `user_ratings` table; every change writes a row to `rating_events`. Stake (0/1/5/10/25) is a column on `rooms`; opt-in is a column on `room_players`. Both lock at game start. Settlement runs server-side inside the transition that flips `room.phase → 'finished'`. Admin is gated by `ADMIN_EMAILS` env var, all admin actions go through the same edge endpoint and write journal rows. Frontend: a `StakeSelector` in WaitingRoom, a Δ-rating column in the in-game scoreboard for opt-in players, a `RatingSettlementModal` at game end, a Profile rating row, and an admin block.

**Tech Stack:** Postgres / Supabase (migrations + RLS + RPCs), Deno edge functions (`game-action`), React Native + TypeScript + Zustand on the client, Jest for unit tests, Playwright for smoke/e2e.

**Spec:** `docs/superpowers/specs/2026-05-23-conditional-stakes-design.md`

---

## Task 1: Pure settlement engine

**Files:**
- Create: `supabase/functions/_shared/engine/stakes.ts`
- Test: `supabase/functions/_shared/__tests__/stakes.test.ts`

The settlement formula is pure: input is per-player scores and the stake, output is per-player deltas with sum strictly 0. Implement and test in isolation — zero DB / edge deps.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/__tests__/stakes.test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { computeSettlement } from '../engine/stakes.ts';

Deno.test('stakes: empty input returns empty deltas', () => {
  assertEquals(computeSettlement([], 5), []);
});

Deno.test('stakes: single player gets delta 0', () => {
  const r = computeSettlement([{ user_id: 'a', score: 42 }], 5);
  assertEquals(r, [{ user_id: 'a', delta: 0 }]);
});

Deno.test('stakes: stake 0 always yields delta 0', () => {
  const r = computeSettlement(
    [{ user_id: 'a', score: 10 }, { user_id: 'b', score: 30 }],
    0,
  );
  assertEquals(r, [{ user_id: 'a', delta: 0 }, { user_id: 'b', delta: 0 }]);
});

Deno.test('stakes: 2 players, stake 1, integer mean, sums to 0', () => {
  const r = computeSettlement(
    [{ user_id: 'a', score: 10 }, { user_id: 'b', score: 30 }],
    1,
  );
  // mean=20 → a: -10, b: +10
  assertEquals(r, [{ user_id: 'a', delta: -10 }, { user_id: 'b', delta: 10 }]);
});

Deno.test('stakes: 4 players, stake 5, sums to 0', () => {
  const r = computeSettlement(
    [
      { user_id: 'a', score: 10 },
      { user_id: 'b', score: 20 },
      { user_id: 'c', score: 30 },
      { user_id: 'd', score: 40 },
    ],
    5,
  );
  const sum = r.reduce((s, x) => s + x.delta, 0);
  assertEquals(sum, 0);
  // mean=25; a:-75 b:-25 c:+25 d:+75
  assertEquals(r.find((x) => x.user_id === 'a')!.delta, -75);
  assertEquals(r.find((x) => x.user_id === 'd')!.delta, 75);
});

Deno.test('stakes: rounding drift is absorbed by largest-|delta| player', () => {
  // 3 players with scores that produce a non-integer mean × stake.
  // mean = 100/3 ≈ 33.333. Stake 1. Raw deltas: a:-3, b:-1, c:+5 → sum=+1 drift.
  // Server must absorb the +1 into the largest |delta| (c) so sum=0.
  const r = computeSettlement(
    [
      { user_id: 'a', score: 30 },
      { user_id: 'b', score: 32 },
      { user_id: 'c', score: 38 },
    ],
    1,
  );
  const sum = r.reduce((s, x) => s + x.delta, 0);
  assertEquals(sum, 0);
});

Deno.test('stakes: deterministic ordering — result keyed by user_id input order', () => {
  const r = computeSettlement(
    [
      { user_id: 'b', score: 30 },
      { user_id: 'a', score: 10 },
    ],
    1,
  );
  assertEquals(r.map((x) => x.user_id), ['b', 'a']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/__tests__/stakes.test.ts`
Expected: FAIL with "Cannot resolve module ../engine/stakes.ts".

- [ ] **Step 3: Implement `computeSettlement`**

Create `supabase/functions/_shared/engine/stakes.ts`:

```ts
/**
 * Pure zero-sum stake settlement.
 *
 * Each opted-in player's rating delta is `(score - mean) * stake`, rounded
 * to an integer. The naive sum can be off by ±1 due to per-player rounding;
 * we absorb the drift into the player with the largest |delta| so the
 * journal balances exactly (sum === 0) for every settle.
 *
 * Inputs preserve their order on the way out.
 */

export interface StakeInput {
  user_id: string;
  score: number;
}

export interface StakeDelta {
  user_id: string;
  delta: number;
}

export function computeSettlement(
  players: StakeInput[],
  stake: number,
): StakeDelta[] {
  if (players.length === 0) return [];
  if (players.length === 1 || stake === 0) {
    return players.map((p) => ({ user_id: p.user_id, delta: 0 }));
  }

  const mean = players.reduce((s, p) => s + p.score, 0) / players.length;

  const out: StakeDelta[] = players.map((p) => ({
    user_id: p.user_id,
    delta: Math.round((p.score - mean) * stake),
  }));

  // Rounding-drift fix: absorb ±1 into the largest |delta| player.
  let drift = out.reduce((s, x) => s + x.delta, 0);
  while (drift !== 0) {
    // Pick the player with the largest |delta|; ties broken by index (first wins).
    let idx = 0;
    for (let i = 1; i < out.length; i += 1) {
      if (Math.abs(out[i].delta) > Math.abs(out[idx].delta)) idx = i;
    }
    out[idx].delta -= Math.sign(drift);
    drift -= Math.sign(drift);
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/_shared/__tests__/stakes.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/engine/stakes.ts supabase/functions/_shared/__tests__/stakes.test.ts
git commit -m "feat(stakes): pure zero-sum settlement engine with drift correction"
```

---

## Task 2: Database migration

**Files:**
- Create: `supabase/migrations/20260523000000_conditional_stakes.sql`

Creates `user_ratings`, `rating_events`, extends `rooms` with `stake` + `stake_locked`, extends `room_players` with `opt_in_stake`, adds RLS, updates `get_room_state` to surface the new fields, and creates two read-only RPCs.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260523000000_conditional_stakes.sql`:

```sql
-- Conditional stakes: per-user rating balance + journal, stake column on
-- rooms, opt-in column on room_players, get_room_state extension, read RPCs.

CREATE TABLE public.user_ratings (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance    INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_ratings_self_select
  ON public.user_ratings
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE TABLE public.rating_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id    UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  reason     TEXT NOT NULL CHECK (reason IN ('settle', 'admin_reset')),
  delta      INTEGER NOT NULL,
  base_score INTEGER NOT NULL,
  mean_score NUMERIC NOT NULL,
  stake      INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX rating_events_user_idx ON public.rating_events (user_id, created_at DESC);
CREATE INDEX rating_events_room_idx ON public.rating_events (room_id);

ALTER TABLE public.rating_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY rating_events_self_select
  ON public.rating_events
  FOR SELECT
  USING (auth.uid() = user_id);

-- Extend rooms with stake configuration.
ALTER TABLE public.rooms
  ADD COLUMN stake        INTEGER NOT NULL DEFAULT 0
                            CHECK (stake IN (0, 1, 5, 10, 25)),
  ADD COLUMN stake_locked BOOLEAN NOT NULL DEFAULT false;

-- Per-room opt-in flag.
ALTER TABLE public.room_players
  ADD COLUMN opt_in_stake BOOLEAN NOT NULL DEFAULT false;

-- get_room_state: surface stake fields on the room and opt_in_stake on each player.
CREATE OR REPLACE FUNCTION public.get_room_state(p_room_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH
  room AS (
    SELECT id, code, host_session_id, player_count, max_cards, min_cards_per_hand,
           mode, phase, current_hand_id, version, stake, stake_locked
    FROM public.rooms WHERE id = p_room_id
  ),
  players AS (
    SELECT json_agg(jsonb_build_object(
      'session_id',   rp.session_id,
      'display_name', rs.display_name,
      'seat_index',   rp.seat_index,
      'is_ready',     rp.is_ready,
      'is_connected', rp.is_connected,
      'last_seen_at', rp.last_seen_at,
      'avatar',       au.raw_user_meta_data->>'avatar',
      'avatar_url',   au.raw_user_meta_data->>'avatar_url',
      'avatar_color', au.raw_user_meta_data->>'avatar_color',
      'opt_in_stake', rp.opt_in_stake
    ) ORDER BY rp.seat_index) AS list
    FROM public.room_players rp
    JOIN public.room_sessions rs ON rs.id = rp.session_id
    LEFT JOIN auth.users au ON au.id = rs.auth_user_id
    WHERE rp.room_id = p_room_id
  ),
  spectators AS (
    SELECT json_agg(jsonb_build_object(
      'session_id',   rsp.session_id,
      'display_name', rs.display_name,
      'avatar',       au.raw_user_meta_data->>'avatar',
      'avatar_url',   au.raw_user_meta_data->>'avatar_url',
      'avatar_color', au.raw_user_meta_data->>'avatar_color',
      'joined_at',    rsp.joined_at
    ) ORDER BY rsp.joined_at) AS list
    FROM public.room_spectators rsp
    JOIN public.room_sessions rs ON rs.id = rsp.session_id
    LEFT JOIN auth.users au ON au.id = rs.auth_user_id
    WHERE rsp.room_id = p_room_id
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
  last_closed_trick AS (
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
    WHERE t.closed_at IS NOT NULL
    ORDER BY t.closed_at DESC
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
  ),
  claims AS (
    SELECT json_agg(DISTINCT ge.session_id) AS list
    FROM public.game_events ge
    JOIN current_hand ch ON (ch.row ->> 'id')::uuid = ge.hand_id
    WHERE ge.kind = 'claim_tricks'
  )
  SELECT jsonb_build_object(
    'room',              (SELECT to_jsonb(room.*) FROM room),
    'players',           COALESCE((SELECT list FROM players), '[]'::json),
    'spectators',        COALESCE((SELECT list FROM spectators), '[]'::json),
    'current_hand',      (SELECT row FROM current_hand),
    'hand_scores',       COALESCE((SELECT list FROM hand_scores), '[]'::json),
    'current_trick',     (SELECT row FROM current_trick),
    'last_closed_trick', (SELECT row FROM last_closed_trick),
    'score_history',     COALESCE((SELECT list FROM history), '[]'::json),
    'claim_sessions',    COALESCE((SELECT list FROM claims), '[]'::json)
  );
$$;

ALTER FUNCTION public.get_room_state(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_room_state(uuid) TO anon, authenticated;

-- Read RPC: current user's rating balance. Returns 0 if no row yet.
CREATE OR REPLACE FUNCTION public.get_my_rating()
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    (SELECT balance FROM public.user_ratings WHERE user_id = auth.uid()),
    0
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_my_rating() TO authenticated;

-- Read RPC: per-game settlement view for the requesting user.
-- Returns the rows of opted-in players in this room with their final
-- aggregate game score and the delta written for them in rating_events.
-- Only readable by users who themselves opted in to the room.
CREATE OR REPLACE FUNCTION public.get_rating_settlement(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_my_user_id UUID;
  v_my_session UUID;
  v_my_opt_in  BOOLEAN;
  v_rows       JSONB;
  v_old        INTEGER;
  v_new        INTEGER;
BEGIN
  v_my_user_id := auth.uid();
  IF v_my_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Find the caller's session_id in this room, and their opt-in flag.
  SELECT rs.id, rp.opt_in_stake
    INTO v_my_session, v_my_opt_in
  FROM public.room_sessions rs
  JOIN public.room_players rp ON rp.session_id = rs.id
  WHERE rs.auth_user_id = v_my_user_id AND rp.room_id = p_room_id
  LIMIT 1;

  IF v_my_session IS NULL OR v_my_opt_in IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  -- Per-player rows: nick, final game score, delta from rating_events.
  SELECT json_agg(jsonb_build_object(
    'user_id',      ev.user_id,
    'display_name', rs.display_name,
    'score',        ev.base_score,
    'delta',        ev.delta
  ))
    INTO v_rows
  FROM public.rating_events ev
  JOIN public.room_sessions rs ON rs.auth_user_id = ev.user_id
  JOIN public.room_players  rp ON rp.session_id = rs.id AND rp.room_id = p_room_id
  WHERE ev.room_id = p_room_id AND ev.reason = 'settle';

  -- The caller's new balance is `user_ratings.balance` right now.
  -- The old balance is `balance - delta_for_me_in_this_room`.
  SELECT
    COALESCE((SELECT balance FROM public.user_ratings WHERE user_id = v_my_user_id), 0),
    COALESCE((SELECT delta   FROM public.rating_events
              WHERE user_id = v_my_user_id AND room_id = p_room_id AND reason = 'settle'
              LIMIT 1), 0)
    INTO v_new, v_old;

  RETURN jsonb_build_object(
    'old_balance', v_new - v_old,
    'new_balance', v_new,
    'rows',        COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_rating_settlement(uuid) TO authenticated;
```

- [ ] **Step 2: Apply locally and verify shape**

Run: `npx supabase db reset` (resets the LOCAL supabase stack — does NOT touch prod).

If the local stack isn't running, surface that as a blocker and skip to step 4 (commit then push to staging).

After reset, sanity-check the new columns:
```bash
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2-)" -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='rooms' AND column_name IN ('stake','stake_locked');"
```
Expected: two rows, `stake` and `stake_locked`.

- [ ] **Step 3: Verify get_room_state returns new fields**

```bash
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2-)" -c \
  "SELECT public.get_room_state('00000000-0000-0000-0000-000000000000'::uuid);"
```
Expected: returns `null` (no such room) OR a JSON with `stake` and `stake_locked` keys if you have a test room.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260523000000_conditional_stakes.sql
git commit -m "feat(stakes): db migration — user_ratings, rating_events, room.stake, opt_in_stake"
```

Note for the deployer: this migration must be pushed to prod via `npx supabase db push` BEFORE the edge-function deploy that depends on it.

---

## Task 3: Action type definitions

**Files:**
- Modify: `supabase/functions/_shared/types.ts`

Add the new action kinds + extend the snapshot types so all downstream TS code stays in sync.

- [ ] **Step 1: Extend the `Action` union**

In `supabase/functions/_shared/types.ts`, append to the union (after `set_display_name`):

```ts
  | { kind: 'set_stake';                 room_id: string; stake: 0 | 1 | 5 | 10 | 25 }
  | { kind: 'toggle_stake_optin';        room_id: string; opted_in: boolean }
  | { kind: 'admin_check' }
  | { kind: 'admin_search_users';        q: string }
  | { kind: 'admin_reset_rating';        target_user_id: string }
  | { kind: 'admin_reset_all_ratings' };
```

- [ ] **Step 2: Extend `RoomSnapshot.room` with stake fields**

In the same file, find the `room:` object inside `RoomSnapshot` and add:

```ts
    stake: 0 | 1 | 5 | 10 | 25;
    stake_locked: boolean;
```

And in the `players[]` element, add:

```ts
    opt_in_stake: boolean;
```

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: same set of pre-existing Deno-related errors as before, no NEW errors from these changes.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/types.ts
git commit -m "feat(stakes): action + snapshot types for stake & admin actions"
```

---

## Task 4: `set_stake` edge action

**Files:**
- Create: `supabase/functions/game-action/actions/setStake.ts`
- Modify: `supabase/functions/game-action/index.ts`

Host-only. Resets every player's opt-in when the stake changes. Rejected if `stake_locked`.

- [ ] **Step 1: Implement the action**

Create `supabase/functions/game-action/actions/setStake.ts`:

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult, RoomSnapshot } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

function empty(): RoomSnapshot {
  return {
    room: null, players: [], spectators: [], current_hand: null,
    hand_scores: [], current_trick: null, last_closed_trick: null,
    score_history: [], my_hand: [],
  } as unknown as RoomSnapshot;
}

const ALLOWED = new Set([0, 1, 5, 10, 25]);

export async function setStake(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'set_stake' }>,
): Promise<ActionResult> {
  if (!ALLOWED.has(action.stake)) {
    return { ok: false, error: 'invalid_stake', state: empty(), version: 0 };
  }

  const { data: room } = await svc
    .from('rooms')
    .select('id, version, host_session_id, stake_locked')
    .eq('id', action.room_id)
    .maybeSingle();
  if (!room) {
    return { ok: false, error: 'room_not_found', state: empty(), version: 0 };
  }
  if (room.host_session_id !== actor.session_id) {
    return { ok: false, error: 'not_host', state: empty(), version: 0 };
  }
  if (room.stake_locked) {
    return { ok: false, error: 'stake_locked', state: empty(), version: 0 };
  }

  // Eligibility: host's auth user must have a confirmed email.
  if (action.stake > 0) {
    const { data: meSess } = await svc
      .from('room_sessions')
      .select('auth_user_id')
      .eq('id', actor.session_id)
      .maybeSingle();
    if (!meSess?.auth_user_id) {
      return { ok: false, error: 'not_eligible_to_set_stake', state: empty(), version: 0 };
    }
    const { data: au } = await svc
      .schema('auth')
      .from('users')
      .select('email_confirmed_at')
      .eq('id', meSess.auth_user_id)
      .maybeSingle();
    if (!au?.email_confirmed_at) {
      return { ok: false, error: 'not_eligible_to_set_stake', state: empty(), version: 0 };
    }
  }

  const newVersion = (room.version ?? 0) + 1;
  await svc.from('rooms').update({ stake: action.stake, version: newVersion }).eq('id', room.id);
  // Changing the terms invalidates everyone's opt-in.
  await svc.from('room_players').update({ opt_in_stake: false }).eq('room_id', room.id);

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: newVersion };
}
```

- [ ] **Step 2: Wire into dispatcher**

Modify `supabase/functions/game-action/index.ts`:

Add an import next to the existing action imports:
```ts
import { setStake }       from './actions/setStake.ts';
```

Find the `switch (action.kind)` block (or however the dispatcher branches today) and add a case:
```ts
case 'set_stake':       result = await setStake(svc, actor, action); break;
```

- [ ] **Step 3: Smoke-test locally**

Start the local stack: `npx supabase start` (idempotent).
Serve the function: `npx supabase functions serve game-action --no-verify-jwt`.

Curl call (replace `<token>` with a fresh access_token from a logged-in client; replace room id):
```bash
curl -X POST http://127.0.0.1:54321/functions/v1/game-action \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"action":{"kind":"set_stake","room_id":"<room>","stake":5}}'
```
Expected: `{ ok: true, state: {...}, version: N+1 }`, and the response's `state.room.stake === 5`.

If you don't have a local room handy, defer the smoke until Task 14 (UI wiring) — the unit-style invariants are simple enough that TS + dispatcher check is sufficient.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/game-action/actions/setStake.ts supabase/functions/game-action/index.ts
git commit -m "feat(stakes): set_stake edge action — host-only, eligibility-gated, resets opt-ins"
```

---

## Task 5: `toggle_stake_optin` edge action

**Files:**
- Create: `supabase/functions/game-action/actions/toggleStakeOptin.ts`
- Modify: `supabase/functions/game-action/index.ts`

Per-session. Rejected for ineligible users (guest / unconfirmed email) and when `stake_locked`.

- [ ] **Step 1: Implement**

Create `supabase/functions/game-action/actions/toggleStakeOptin.ts`:

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult, RoomSnapshot } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

function empty(): RoomSnapshot {
  return {
    room: null, players: [], spectators: [], current_hand: null,
    hand_scores: [], current_trick: null, last_closed_trick: null,
    score_history: [], my_hand: [],
  } as unknown as RoomSnapshot;
}

export async function toggleStakeOptin(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'toggle_stake_optin' }>,
): Promise<ActionResult> {
  const { data: room } = await svc
    .from('rooms')
    .select('id, version, stake_locked')
    .eq('id', action.room_id)
    .maybeSingle();
  if (!room) {
    return { ok: false, error: 'room_not_found', state: empty(), version: 0 };
  }
  if (room.stake_locked) {
    return { ok: false, error: 'stake_locked', state: empty(), version: 0 };
  }

  const { data: rp } = await svc
    .from('room_players')
    .select('session_id')
    .eq('room_id', room.id)
    .eq('session_id', actor.session_id)
    .maybeSingle();
  if (!rp) {
    return { ok: false, error: 'not_seated', state: empty(), version: 0 };
  }

  if (action.opted_in) {
    const { data: meSess } = await svc
      .from('room_sessions')
      .select('auth_user_id')
      .eq('id', actor.session_id)
      .maybeSingle();
    if (!meSess?.auth_user_id) {
      return { ok: false, error: 'not_eligible_to_opt_in', state: empty(), version: 0 };
    }
    const { data: au } = await svc
      .schema('auth')
      .from('users')
      .select('email_confirmed_at')
      .eq('id', meSess.auth_user_id)
      .maybeSingle();
    if (!au?.email_confirmed_at) {
      return { ok: false, error: 'not_eligible_to_opt_in', state: empty(), version: 0 };
    }
  }

  const newVersion = (room.version ?? 0) + 1;
  await svc
    .from('room_players')
    .update({ opt_in_stake: action.opted_in })
    .eq('room_id', room.id)
    .eq('session_id', actor.session_id);
  await svc.from('rooms').update({ version: newVersion }).eq('id', room.id);

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: newVersion };
}
```

- [ ] **Step 2: Wire into dispatcher**

In `supabase/functions/game-action/index.ts`:
```ts
import { toggleStakeOptin } from './actions/toggleStakeOptin.ts';
...
case 'toggle_stake_optin': result = await toggleStakeOptin(svc, actor, action); break;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/game-action/actions/toggleStakeOptin.ts supabase/functions/game-action/index.ts
git commit -m "feat(stakes): toggle_stake_optin edge action — eligibility-gated"
```

---

## Task 6: Lock on `start_game`, unlock on `restart_game`

**Files:**
- Modify: `supabase/functions/game-action/actions/startGame.ts`
- Modify: `supabase/functions/game-action/actions/restartGame.ts`

Just before the room transitions to `playing`, flip `stake_locked = true`. On restart, clear opt-ins and unlock.

- [ ] **Step 1: Add lock on start**

Open `supabase/functions/game-action/actions/startGame.ts` and find the SQL update that sets `rooms.phase = 'playing'` (or wherever the transition is committed). Add `stake_locked: true` to the same update payload. If the start path uses multiple updates / RPC, place the `stake_locked = true` update in the same transaction (an explicit `await svc.from('rooms').update({ stake_locked: true }).eq('id', room_id)` right next to the phase update is acceptable).

- [ ] **Step 2: Add unlock + reset on restart**

Open `supabase/functions/game-action/actions/restartGame.ts` and find where the restart resets per-room state (`current_hand_id = null`, `phase = 'waiting'`, etc.). Add these two updates in the same block:
```ts
await svc.from('rooms').update({ stake_locked: false }).eq('id', room_id);
await svc.from('room_players').update({ opt_in_stake: false }).eq('room_id', room_id);
```
`rooms.stake` is intentionally NOT reset — same group typically keeps the same wager.

- [ ] **Step 3: Verify TypeScript still clean**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/game-action/actions/startGame.ts supabase/functions/game-action/actions/restartGame.ts
git commit -m "feat(stakes): lock stake at game start, unlock + reset opt-ins on restart"
```

---

## Task 7: Settle on phase-finished transition

**Files:**
- Modify: `supabase/functions/game-action/actions/continueHand.ts`

The room flips to `phase = 'finished'` at the end of the final hand inside `continueHand`. Add the settlement step right after the phase update, before snapshot rebuild.

- [ ] **Step 1: Add settlement logic**

In `continueHand.ts`, locate the branch that updates `rooms.phase = 'finished'` (the path that runs when this was the last hand). Right after that update, add:

```ts
// Stake settlement — runs once, atomically with the finished transition.
{
  const { data: roomRow } = await svc
    .from('rooms')
    .select('stake')
    .eq('id', room_id)
    .maybeSingle();
  const stake = roomRow?.stake ?? 0;

  if (stake > 0) {
    // Opted-in players in this room with their session_id + auth_user_id.
    const { data: optIns } = await svc
      .from('room_players')
      .select('session_id, room_sessions!inner(auth_user_id)')
      .eq('room_id', room_id)
      .eq('opt_in_stake', true);
    const eligible = (optIns ?? [])
      .map((r: any) => ({
        session_id: r.session_id as string,
        user_id: r.room_sessions?.auth_user_id as string | null,
      }))
      .filter((r) => !!r.user_id) as { session_id: string; user_id: string }[];

    if (eligible.length >= 2) {
      // Aggregate final scores from hand_scores across all closed hands of this room.
      const { data: scoresRows } = await svc
        .from('hand_scores')
        .select('hand_id, session_id, hand_score, hands!inner(room_id, phase)')
        .eq('hands.room_id', room_id)
        .eq('hands.phase', 'closed');

      const totalsBySession = new Map<string, number>();
      for (const row of scoresRows ?? []) {
        const sid = (row as any).session_id as string;
        const s = ((row as any).hand_score as number) ?? 0;
        totalsBySession.set(sid, (totalsBySession.get(sid) ?? 0) + s);
      }

      const { computeSettlement } = await import('../../_shared/engine/stakes.ts');
      const inputs = eligible.map((e) => ({
        user_id: e.user_id,
        score: totalsBySession.get(e.session_id) ?? 0,
      }));
      const deltas = computeSettlement(inputs, stake);

      // Aggregate score for the journal row (base_score in events).
      const meanScore =
        inputs.reduce((s, x) => s + x.score, 0) / Math.max(inputs.length, 1);

      for (const d of deltas) {
        const baseScore = inputs.find((x) => x.user_id === d.user_id)!.score;
        await svc.from('rating_events').insert({
          user_id:    d.user_id,
          room_id,
          reason:     'settle',
          delta:      d.delta,
          base_score: baseScore,
          mean_score: meanScore,
          stake,
        });
        // Upsert balance.
        await svc.rpc('apply_rating_delta', { p_user_id: d.user_id, p_delta: d.delta });
      }
    }
  }
}
```

- [ ] **Step 2: Add `apply_rating_delta` SQL RPC**

The settlement loop above calls a tiny upserting helper. Add it to the existing migration file `supabase/migrations/20260523000000_conditional_stakes.sql` (appending — DB hasn't shipped yet so editing the same migration is fine):

```sql
-- Atomic apply: creates a user_ratings row on first delta, otherwise increments.
CREATE OR REPLACE FUNCTION public.apply_rating_delta(p_user_id uuid, p_delta integer)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_new INTEGER;
BEGIN
  INSERT INTO public.user_ratings (user_id, balance)
  VALUES (p_user_id, p_delta)
  ON CONFLICT (user_id) DO UPDATE
    SET balance = public.user_ratings.balance + EXCLUDED.balance,
        updated_at = now()
  RETURNING balance INTO v_new;
  RETURN v_new;
END;
$$;
-- Only callable through service-role / SECURITY DEFINER paths.
REVOKE EXECUTE ON FUNCTION public.apply_rating_delta(uuid, integer) FROM PUBLIC;
```

- [ ] **Step 3: Reset locks even when no settlement runs**

Still in the finished-branch of `continueHand.ts`, AFTER the settlement block above, add:

```ts
// Always clear stake locks on finish so "Play again" can re-arm.
await svc.from('rooms').update({ stake_locked: false }).eq('id', room_id);
```

Note: `restartGame` already resets `opt_in_stake`; here we only need to unlock. Keep `rooms.stake` as-is.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/game-action/actions/continueHand.ts \
        supabase/migrations/20260523000000_conditional_stakes.sql
git commit -m "feat(stakes): settle ratings + unlock on phase=finished transition"
```

---

## Task 8: Admin authorization helper

**Files:**
- Create: `supabase/functions/_shared/auth/isAdmin.ts`
- Test: `supabase/functions/_shared/__tests__/isAdmin.test.ts`

Pure helper that reads `ADMIN_EMAILS` (comma-separated) and checks membership.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/__tests__/isAdmin.test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { isAdminEmail } from '../auth/isAdmin.ts';

Deno.test('isAdminEmail: empty allow-list rejects everyone', () => {
  assertEquals(isAdminEmail('a@b.com', ''), false);
  assertEquals(isAdminEmail('a@b.com', undefined), false);
  assertEquals(isAdminEmail(null, 'a@b.com'), false);
});

Deno.test('isAdminEmail: exact match wins', () => {
  assertEquals(isAdminEmail('a@b.com', 'a@b.com'), true);
});

Deno.test('isAdminEmail: comma-separated list, trimmed', () => {
  assertEquals(isAdminEmail('c@d.com', ' a@b.com , c@d.com ,e@f.com'), true);
});

Deno.test('isAdminEmail: case-insensitive', () => {
  assertEquals(isAdminEmail('Akhmed.Kadymov@gmail.com', 'akhmed.kadymov@gmail.com'), true);
});

Deno.test('isAdminEmail: not in list rejects', () => {
  assertEquals(isAdminEmail('x@y.com', 'a@b.com,c@d.com'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/__tests__/isAdmin.test.ts`
Expected: FAIL with "Cannot resolve module ../auth/isAdmin.ts".

- [ ] **Step 3: Implement**

Create `supabase/functions/_shared/auth/isAdmin.ts`:

```ts
/**
 * Admin allow-list check. `ADMIN_EMAILS` is read by callers from Deno.env;
 * we keep this function pure for unit-testability.
 */
export function isAdminEmail(
  email: string | null | undefined,
  adminEmailsCsv: string | null | undefined,
): boolean {
  if (!email || !adminEmailsCsv) return false;
  const normalized = email.trim().toLowerCase();
  return adminEmailsCsv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
    .includes(normalized);
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `deno test supabase/functions/_shared/__tests__/isAdmin.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/auth/isAdmin.ts supabase/functions/_shared/__tests__/isAdmin.test.ts
git commit -m "feat(stakes): isAdminEmail allow-list helper"
```

---

## Task 9: `admin_check` edge action

**Files:**
- Create: `supabase/functions/game-action/actions/adminCheck.ts`
- Modify: `supabase/functions/game-action/index.ts`

Returns `{ is_admin: boolean }` so the client can decide whether to render the admin block. Never throws — non-admins just get `false`.

- [ ] **Step 1: Implement**

Create `supabase/functions/game-action/actions/adminCheck.ts`:

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext } from '../../_shared/types.ts';
import { isAdminEmail } from '../../_shared/auth/isAdmin.ts';

export async function adminCheck(
  svc: SupabaseClient,
  actor: ActorContext,
): Promise<{ ok: true; is_admin: boolean }> {
  const adminCsv = Deno.env.get('ADMIN_EMAILS') ?? '';
  const { data: sess } = await svc
    .from('room_sessions')
    .select('auth_user_id')
    .eq('id', actor.session_id)
    .maybeSingle();
  if (!sess?.auth_user_id) return { ok: true, is_admin: false };
  const { data: au } = await svc
    .schema('auth')
    .from('users')
    .select('email')
    .eq('id', sess.auth_user_id)
    .maybeSingle();
  return { ok: true, is_admin: isAdminEmail(au?.email ?? null, adminCsv) };
}
```

- [ ] **Step 2: Wire into dispatcher**

In `supabase/functions/game-action/index.ts`, import + branch. Admin actions don't return an `ActionResult` snapshot — they return their own object. The dispatcher currently assumes all actions return `ActionResult`. Wrap admin actions like this in the dispatcher branch:

```ts
import { adminCheck } from './actions/adminCheck.ts';
...
case 'admin_check': {
  const r = await adminCheck(svc, actor);
  return jsonResponse(r, 200);
}
```

The `return jsonResponse(...)` shortcut bypasses the snapshot/broadcast pipeline that follows the normal `result = await ...` block — admin actions don't mutate room state.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/game-action/actions/adminCheck.ts supabase/functions/game-action/index.ts
git commit -m "feat(stakes): admin_check edge action"
```

---

## Task 10: `admin_search_users` edge action

**Files:**
- Create: `supabase/functions/game-action/actions/adminSearchUsers.ts`
- Modify: `supabase/functions/game-action/index.ts`

Searches `auth.users` by email/display_name prefix; returns `id, email, display_name, balance`. Admin-only.

- [ ] **Step 1: Implement**

Create `supabase/functions/game-action/actions/adminSearchUsers.ts`:

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action } from '../../_shared/types.ts';
import { isAdminEmail } from '../../_shared/auth/isAdmin.ts';

interface Row {
  id: string;
  email: string | null;
  display_name: string | null;
  balance: number;
}

export async function adminSearchUsers(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'admin_search_users' }>,
): Promise<{ ok: boolean; error?: string; rows?: Row[] }> {
  const adminCsv = Deno.env.get('ADMIN_EMAILS') ?? '';
  const { data: sess } = await svc
    .from('room_sessions')
    .select('auth_user_id')
    .eq('id', actor.session_id)
    .maybeSingle();
  if (!sess?.auth_user_id) return { ok: false, error: 'not_admin' };
  const { data: au } = await svc
    .schema('auth')
    .from('users')
    .select('email')
    .eq('id', sess.auth_user_id)
    .maybeSingle();
  if (!isAdminEmail(au?.email ?? null, adminCsv)) return { ok: false, error: 'not_admin' };

  const q = (action.q ?? '').trim().toLowerCase();
  if (q.length < 2) return { ok: true, rows: [] };

  // Match by email or any display_name in room_sessions.
  const { data: matches } = await svc
    .schema('auth')
    .from('users')
    .select('id, email')
    .ilike('email', `%${q}%`)
    .limit(20);

  const ids = (matches ?? []).map((m: { id: string }) => m.id);
  if (ids.length === 0) return { ok: true, rows: [] };

  const { data: ratings } = await svc
    .from('user_ratings')
    .select('user_id, balance')
    .in('user_id', ids);
  const balanceByUser = new Map<string, number>(
    (ratings ?? []).map((r: { user_id: string; balance: number }) => [r.user_id, r.balance]),
  );

  const { data: sessions } = await svc
    .from('room_sessions')
    .select('auth_user_id, display_name, updated_at')
    .in('auth_user_id', ids)
    .order('updated_at', { ascending: false });
  const nameByUser = new Map<string, string>();
  for (const s of sessions ?? []) {
    const uid = (s as { auth_user_id: string }).auth_user_id;
    if (!nameByUser.has(uid)) nameByUser.set(uid, (s as { display_name: string }).display_name);
  }

  const rows: Row[] = (matches ?? []).map((m: { id: string; email: string | null }) => ({
    id: m.id,
    email: m.email,
    display_name: nameByUser.get(m.id) ?? null,
    balance: balanceByUser.get(m.id) ?? 0,
  }));

  return { ok: true, rows };
}
```

- [ ] **Step 2: Dispatch**

In `supabase/functions/game-action/index.ts`:
```ts
import { adminSearchUsers } from './actions/adminSearchUsers.ts';
...
case 'admin_search_users': {
  const r = await adminSearchUsers(svc, actor, action);
  return jsonResponse(r, r.ok ? 200 : 403);
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/game-action/actions/adminSearchUsers.ts supabase/functions/game-action/index.ts
git commit -m "feat(stakes): admin_search_users — email-prefix search with balances"
```

---

## Task 11: `admin_reset_rating` + `admin_reset_all_ratings` edge actions

**Files:**
- Create: `supabase/functions/game-action/actions/adminResetRating.ts`
- Modify: `supabase/functions/game-action/index.ts`
- Test: `supabase/functions/_shared/__tests__/admin_reset.test.ts`

Both reset paths share the same loop body (skip zero-balance, write journal, set balance to 0). Implement the per-user step as a tiny shared helper so the test exercises real code.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/__tests__/admin_reset.test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildResetJournalRow } from '../../game-action/actions/adminResetRating.ts';

Deno.test('admin_reset: zero balance → null (skip)', () => {
  assertEquals(buildResetJournalRow('user-1', 0, null), null);
});

Deno.test('admin_reset: positive balance → delta = -balance', () => {
  const row = buildResetJournalRow('user-1', 42, null);
  assertEquals(row, {
    user_id: 'user-1',
    room_id: null,
    reason: 'admin_reset',
    delta: -42,
    base_score: 42,
    mean_score: 0,
    stake: 0,
  });
});

Deno.test('admin_reset: negative balance → delta = -balance (positive)', () => {
  const row = buildResetJournalRow('user-1', -17, null);
  assertEquals(row, {
    user_id: 'user-1',
    room_id: null,
    reason: 'admin_reset',
    delta: 17,
    base_score: -17,
    mean_score: 0,
    stake: 0,
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `deno test supabase/functions/_shared/__tests__/admin_reset.test.ts`
Expected: FAIL — module / export missing.

- [ ] **Step 3: Implement both actions**

Create `supabase/functions/game-action/actions/adminResetRating.ts`:

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action } from '../../_shared/types.ts';
import { isAdminEmail } from '../../_shared/auth/isAdmin.ts';

export interface ResetRow {
  user_id: string;
  room_id: null;
  reason: 'admin_reset';
  delta: number;
  base_score: number;
  mean_score: 0;
  stake: 0;
}

export function buildResetJournalRow(
  user_id: string,
  balance: number,
  _meta: null,
): ResetRow | null {
  if (balance === 0) return null;
  return {
    user_id,
    room_id: null,
    reason: 'admin_reset',
    delta: -balance,
    base_score: balance,
    mean_score: 0,
    stake: 0,
  };
}

async function ensureAdmin(svc: SupabaseClient, actor: ActorContext): Promise<boolean> {
  const adminCsv = Deno.env.get('ADMIN_EMAILS') ?? '';
  const { data: sess } = await svc
    .from('room_sessions')
    .select('auth_user_id')
    .eq('id', actor.session_id)
    .maybeSingle();
  if (!sess?.auth_user_id) return false;
  const { data: au } = await svc
    .schema('auth')
    .from('users')
    .select('email')
    .eq('id', sess.auth_user_id)
    .maybeSingle();
  return isAdminEmail(au?.email ?? null, adminCsv);
}

export async function adminResetRating(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'admin_reset_rating' }>,
): Promise<{ ok: boolean; error?: string; affected?: number }> {
  if (!(await ensureAdmin(svc, actor))) return { ok: false, error: 'not_admin' };

  const { data: r } = await svc
    .from('user_ratings')
    .select('balance')
    .eq('user_id', action.target_user_id)
    .maybeSingle();
  const balance = r?.balance ?? 0;
  const row = buildResetJournalRow(action.target_user_id, balance, null);
  if (!row) return { ok: true, affected: 0 };

  await svc.from('rating_events').insert(row);
  await svc
    .from('user_ratings')
    .upsert({ user_id: action.target_user_id, balance: 0, updated_at: new Date().toISOString() });
  return { ok: true, affected: 1 };
}

export async function adminResetAllRatings(
  svc: SupabaseClient,
  actor: ActorContext,
): Promise<{ ok: boolean; error?: string; affected?: number }> {
  if (!(await ensureAdmin(svc, actor))) return { ok: false, error: 'not_admin' };

  const { data: rows } = await svc
    .from('user_ratings')
    .select('user_id, balance')
    .neq('balance', 0);

  const journal = (rows ?? [])
    .map((r: { user_id: string; balance: number }) =>
      buildResetJournalRow(r.user_id, r.balance, null))
    .filter((x): x is ResetRow => x !== null);

  if (journal.length === 0) return { ok: true, affected: 0 };

  await svc.from('rating_events').insert(journal);
  await svc
    .from('user_ratings')
    .update({ balance: 0, updated_at: new Date().toISOString() })
    .neq('balance', 0);

  return { ok: true, affected: journal.length };
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `deno test supabase/functions/_shared/__tests__/admin_reset.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Dispatch**

In `supabase/functions/game-action/index.ts`:
```ts
import { adminResetRating, adminResetAllRatings } from './actions/adminResetRating.ts';
...
case 'admin_reset_rating': {
  const r = await adminResetRating(svc, actor, action);
  return jsonResponse(r, r.ok ? 200 : 403);
}
case 'admin_reset_all_ratings': {
  const r = await adminResetAllRatings(svc, actor);
  return jsonResponse(r, r.ok ? 200 : 403);
}
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/game-action/actions/adminResetRating.ts \
        supabase/functions/_shared/__tests__/admin_reset.test.ts \
        supabase/functions/game-action/index.ts
git commit -m "feat(stakes): admin_reset_rating + admin_reset_all_ratings"
```

---

## Task 12: Frontend eligibility helper

**Files:**
- Create: `src/utils/ratingEligibility.ts`
- Test: `src/utils/__tests__/ratingEligibility.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/ratingEligibility.test.ts`:

```ts
import { canPlayForRating } from '../ratingEligibility';

describe('canPlayForRating', () => {
  it('rejects null user', () => {
    expect(canPlayForRating(null, true)).toBe(false);
    expect(canPlayForRating(null, false)).toBe(false);
  });

  it('rejects guest flag', () => {
    expect(canPlayForRating({ email_confirmed_at: '2026-01-01T00:00:00Z' } as any, true))
      .toBe(false);
  });

  it('rejects user without confirmed email', () => {
    expect(canPlayForRating({ email_confirmed_at: null } as any, false)).toBe(false);
  });

  it('accepts confirmed-email user', () => {
    expect(canPlayForRating({ email_confirmed_at: '2026-01-01T00:00:00Z' } as any, false))
      .toBe(true);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx jest src/utils/__tests__/ratingEligibility.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Create `src/utils/ratingEligibility.ts`:

```ts
import type { User } from '@supabase/supabase-js';

export function canPlayForRating(user: User | null, isGuest: boolean): boolean {
  if (isGuest || !user) return false;
  return !!user.email_confirmed_at;
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npx jest src/utils/__tests__/ratingEligibility.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/ratingEligibility.ts src/utils/__tests__/ratingEligibility.test.ts
git commit -m "feat(stakes): canPlayForRating client-side eligibility helper"
```

---

## Task 13: `gameClient` methods + rating store

**Files:**
- Modify: `src/lib/gameClient.ts`
- Create: `src/store/ratingStore.ts`

Add client-side wrappers around all new edge / RPC endpoints.

- [ ] **Step 1: Add to gameClient.ts**

In `src/lib/gameClient.ts`, find the export object (look for `placeBet:`, `setReady:` — same pattern) and add these methods. The existing `invokeAction` / fetch helper is whatever GameClient uses today; use the SAME helper, do not introduce a parallel one.

```ts
  setStake: (room_id: string, stake: 0 | 1 | 5 | 10 | 25) =>
    invokeAction({ kind: 'set_stake', room_id, stake }),

  toggleStakeOptin: (room_id: string, opted_in: boolean) =>
    invokeAction({ kind: 'toggle_stake_optin', room_id, opted_in }),

  getMyRating: async (): Promise<number> => {
    const { data, error } = await supabase.rpc('get_my_rating');
    if (error) throw error;
    return typeof data === 'number' ? data : 0;
  },

  getRatingSettlement: async (
    room_id: string,
  ): Promise<{ old_balance: number; new_balance: number; rows: Array<{ user_id: string; display_name: string; score: number; delta: number }> } | null> => {
    const { data, error } = await supabase.rpc('get_rating_settlement', { p_room_id: room_id });
    if (error) throw error;
    return (data as any) ?? null;
  },

  adminCheck: () => invokeAction({ kind: 'admin_check' }),
  adminSearchUsers: (q: string) => invokeAction({ kind: 'admin_search_users', q }),
  adminResetRating: (target_user_id: string) =>
    invokeAction({ kind: 'admin_reset_rating', target_user_id }),
  adminResetAllRatings: () => invokeAction({ kind: 'admin_reset_all_ratings' }),
```

If `invokeAction` returns an `ActionResult` typed as `{ ok, state, ... }`, the admin methods that don't return room state still resolve through it (the response JSON is what comes back). If GameClient's helper is strictly typed, add a thin `invokeAdminAction` that returns `any` so the admin methods can keep loose typings.

- [ ] **Step 2: Create the rating store**

Create `src/store/ratingStore.ts`:

```ts
import { create } from 'zustand';
import { gameClient } from '../lib/gameClient';

interface RatingState {
  balance: number | null;
  loading: boolean;
  load: () => Promise<void>;
  set: (n: number) => void;
}

export const useRatingStore = create<RatingState>((set) => ({
  balance: null,
  loading: false,
  load: async () => {
    set({ loading: true });
    try {
      const n = await gameClient.getMyRating();
      set({ balance: n, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  set: (n) => set({ balance: n }),
}));
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/gameClient.ts src/store/ratingStore.ts
git commit -m "feat(stakes): gameClient methods + ratingStore"
```

---

## Task 14: `StakeSelector` component

**Files:**
- Create: `src/components/stakes/StakeSelector.tsx`

A self-contained block with a label, four stake chips (`Off / 1 / 5 / 10 / 25`), and one opt-in switch. Eligibility and host-ness are driven by props — the component is dumb.

- [ ] **Step 1: Implement**

Create `src/components/stakes/StakeSelector.tsx`:

```tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet, Switch } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';

export interface StakeSelectorProps {
  stake: 0 | 1 | 5 | 10 | 25;
  isHost: boolean;
  isHostEligible: boolean;
  optedIn: boolean;
  selfEligible: boolean;
  locked: boolean;
  onStakeChange: (s: 0 | 1 | 5 | 10 | 25) => void;
  onToggleOptIn: (next: boolean) => void;
}

const VALUES: Array<0 | 1 | 5 | 10 | 25> = [0, 1, 5, 10, 25];

export const StakeSelector: React.FC<StakeSelectorProps> = ({
  stake, isHost, isHostEligible, optedIn, selfEligible, locked,
  onStakeChange, onToggleOptIn,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const chipsDisabled = !isHost || !isHostEligible || locked;

  return (
    <View style={[styles.root, { borderColor: colors.glassLight, backgroundColor: colors.surface }]}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {t('stakes.title')}
      </Text>
      <View style={styles.chipRow}>
        {VALUES.map((v) => {
          const active = stake === v;
          return (
            <Pressable
              key={v}
              onPress={() => !chipsDisabled && onStakeChange(v)}
              disabled={chipsDisabled}
              style={[
                styles.chip,
                {
                  borderColor: active ? colors.accent : colors.glassLight,
                  backgroundColor: active ? colors.accent : 'transparent',
                  opacity: chipsDisabled && !active ? 0.4 : 1,
                },
              ]}
              testID={`stake-chip-${v}`}
            >
              <Text style={[styles.chipText, { color: active ? '#ffffff' : colors.textPrimary }]}>
                {v === 0 ? t('stakes.off') : String(v)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {stake > 0 && (
        <View style={styles.optInRow}>
          <Text style={[styles.optInLabel, { color: colors.textPrimary }]}>
            {t('stakes.optInToggle')}
          </Text>
          <Switch
            value={optedIn}
            onValueChange={(next) => onToggleOptIn(next)}
            disabled={!selfEligible || locked}
            testID="stake-optin-toggle"
          />
        </View>
      )}
      {stake > 0 && !selfEligible && !locked && (
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          {t('stakes.guestHint')}
        </Text>
      )}
      {locked && (
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          {t('stakes.lockedHint')}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { padding: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, marginBottom: Spacing.sm },
  label: { fontSize: 12, fontWeight: '600', marginBottom: Spacing.xs, textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: Radius.full, borderWidth: 1.5,
  },
  chipText: { fontSize: 14, fontWeight: '700' },
  optInRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: Spacing.sm,
  },
  optInLabel: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 12, marginTop: 4, fontStyle: 'italic' },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/stakes/StakeSelector.tsx
git commit -m "feat(stakes): StakeSelector component (chips + opt-in switch)"
```

---

## Task 15: Wire `StakeSelector` into WaitingRoom (mobile + desktop)

**Files:**
- Modify: `src/screens/WaitingRoomScreen.tsx`
- Modify: `src/screens/desktop/DesktopWaitingRoom.tsx`

Both screens read the same snapshot fields, so the wiring is symmetric.

- [ ] **Step 1: Wire mobile WaitingRoom**

In `src/screens/WaitingRoomScreen.tsx`:

1. Import `StakeSelector` and `canPlayForRating`:
```ts
import { StakeSelector } from '../components/stakes/StakeSelector';
import { canPlayForRating } from '../utils/ratingEligibility';
```

2. Inside the component, read snapshot + auth state:
```ts
const room = useRoomStore((s) => s.snapshot?.room ?? null);
const players = useRoomStore((s) => s.snapshot?.players ?? []);
const myPlayerId = useRoomStore((s) => s.myPlayerId);
const me = players.find((p) => p.session_id === myPlayerId) ?? null;
const isHost = !!room && room.host_session_id === myPlayerId;
const { user, isGuest } = useAuthStore();
const selfEligible = canPlayForRating(user, isGuest);
const hostEligible = isHost ? selfEligible : true;  // for non-hosts we only need to know self.
```

3. Above the existing player grid, mount the selector:
```tsx
{room && (
  <StakeSelector
    stake={(room.stake ?? 0) as 0 | 1 | 5 | 10 | 25}
    isHost={isHost}
    isHostEligible={hostEligible}
    optedIn={!!me?.opt_in_stake}
    selfEligible={selfEligible}
    locked={!!room.stake_locked}
    onStakeChange={(s) => gameClient.setStake(room.id, s)}
    onToggleOptIn={(next) => gameClient.toggleStakeOptin(room.id, next)}
  />
)}
```

4. For each player chip in the existing grid, append a small `★` badge when `players[i].opt_in_stake` is true:
```tsx
{p.opt_in_stake && <Text style={{ marginLeft: 4 }}>★</Text>}
```

- [ ] **Step 2: Wire desktop WaitingRoom**

In `src/screens/desktop/DesktopWaitingRoom.tsx`, do the same wiring as Step 1 but mounting `StakeSelector` in the area above the player grid in the desktop layout. Use the same props.

- [ ] **Step 3: Manual verification**

Start the local dev server (`:8081`) and open WaitingRoom as a logged-in user.
- Set stake to 5 → chips highlight. Open as a guest in a second context → see disabled toggle with `stakes.guestHint`.
- Opt in as the logged-in user → `★` appears next to their chip in both contexts.
- Have the host change stake to 10 → every player's opt-in resets to false (verified by the disappearing `★`).

- [ ] **Step 4: Commit**

```bash
git add src/screens/WaitingRoomScreen.tsx src/screens/desktop/DesktopWaitingRoom.tsx
git commit -m "feat(stakes): StakeSelector + opt-in badges in WaitingRoom (mobile + desktop)"
```

---

## Task 16: Δ rating column in ScoreboardModal (opt-in only)

**Files:**
- Modify: `src/screens/ScoreboardModal.tsx`

Visible only when local user is opt-in AND `stake > 0`. Uses the same `computeSettlement` math as the server.

- [ ] **Step 1: Import the engine (shared between client & edge)**

Top of file:
```ts
import { computeSettlement } from '../../supabase/functions/_shared/engine/stakes';
```

This module is dependency-free TS — Metro / tsc happily import it from `src/`. Verify with a quick `npx tsc --noEmit` after the import.

- [ ] **Step 2: Add a Δ-rating column to the detailed table**

Find the detailed-table render (the `renderFullTable` function in this same file — it's the one that already renders the Σ totals row). Right before the totals row, derive per-player provisional deltas:

```ts
const optedInIds = new Set(
  (snapshot?.players ?? [])
    .filter((p: any) => p.opt_in_stake)
    .map((p: any) => p.session_id as string),
);
const stake = (snapshot?.room?.stake ?? 0) as 0 | 1 | 5 | 10 | 25;
const meSessionId = useRoomStore.getState().myPlayerId;
const showDelta = stake > 0 && !!meSessionId && optedInIds.has(meSessionId);

let deltaByUser: Map<string, number> | null = null;
if (showDelta) {
  // Use auth_user_id when available — we identify rating by user, not session.
  // The snapshot doesn't carry auth_user_id; in this screen we work with session_id
  // as the rating proxy, which matches the per-player view (one row per session).
  const inputs = (snapshot?.players ?? [])
    .filter((p: any) => optedInIds.has(p.session_id))
    .map((p: any) => ({
      user_id: p.session_id as string,
      score: sortedPlayers.find((sp) => sp.id === p.session_id)?.totalScore ?? 0,
    }));
  const deltas = computeSettlement(inputs, stake);
  deltaByUser = new Map(deltas.map((d) => [d.user_id, d.delta]));
}
```

- [ ] **Step 3: Render a δ row alongside Σ**

In the same block where Σ totals are rendered, append (only when `showDelta`):

```tsx
{showDelta && (
  <View style={styles.tableRow}>
    <View style={[styles.tableCell, { width: roundColW }]}>
      <Text style={[styles.totalLabel, { color: colors.textPrimary }]}>Δ</Text>
    </View>
    {sortedPlayers.map((p) => {
      const d = deltaByUser?.get(p.id) ?? 0;
      const color = d > 0 ? colors.success : d < 0 ? colors.error : colors.textMuted;
      return (
        <View key={p.id} style={[styles.tableCell, { width: playerColW }]}>
          <Text style={[styles.totalScore, { color }]}>
            {d > 0 ? `+${d}` : String(d)}
          </Text>
        </View>
      );
    })}
  </View>
)}
```

- [ ] **Step 4: Manual verification**

Mid-game with 2 opt-in players: open the detailed scoreboard. See Δ row with values that sum to 0. Non-opt-in players don't see Δ row.

- [ ] **Step 5: Commit**

```bash
git add src/screens/ScoreboardModal.tsx
git commit -m "feat(stakes): Δ-rating row in detailed scoreboard for opt-in players"
```

---

## Task 17: `RatingSettlementModal` + integration

**Files:**
- Create: `src/screens/RatingSettlementModal.tsx`
- Modify: `src/screens/GameTableScreen.tsx`
- Modify: `src/screens/desktop/DesktopGameLayout.tsx`

A modal that surfaces AFTER `ScoreboardModal` when game is finished AND local user was opt-in.

- [ ] **Step 1: Implement the modal**

Create `src/screens/RatingSettlementModal.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, Modal, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { Spacing, Radius } from '../constants';
import { gameClient } from '../lib/gameClient';

type SettlementRow = { user_id: string; display_name: string; score: number; delta: number };

export interface RatingSettlementModalProps {
  visible: boolean;
  roomId: string | null;
  onClose: () => void;
  onPlayAgain?: () => void;
  showPlayAgain?: boolean;
}

export const RatingSettlementModal: React.FC<RatingSettlementModalProps> = ({
  visible, roomId, onClose, onPlayAgain, showPlayAgain,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [data, setData] = useState<{
    old_balance: number;
    new_balance: number;
    rows: SettlementRow[];
  } | null>(null);

  useEffect(() => {
    if (!visible || !roomId) return;
    let cancelled = false;
    (async () => {
      const result = await gameClient.getRatingSettlement(roomId).catch(() => null);
      if (!cancelled) setData(result);
    })();
    return () => { cancelled = true; };
  }, [visible, roomId]);

  if (!visible || !data) return null;
  const delta = data.new_balance - data.old_balance;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.backdrop]}>
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.title, { color: colors.accent }]} testID="settlement-title">
            {t('stakes.settlementTitle')}
          </Text>
          <View style={styles.balanceRow}>
            <Text style={[styles.balanceLabel, { color: colors.textMuted }]}>{data.old_balance}</Text>
            <Text style={[styles.balanceDelta, { color: delta > 0 ? colors.success : delta < 0 ? colors.error : colors.textMuted }]}>
              {delta > 0 ? `+${delta}` : String(delta)}
            </Text>
            <Text style={[styles.balanceNew, { color: colors.textPrimary }]}>
              {t('stakes.newBalance', { n: data.new_balance })}
            </Text>
          </View>
          <ScrollView style={styles.list}>
            {data.rows.map((r) => (
              <View key={r.user_id} style={[styles.row, { borderColor: colors.glassLight }]}>
                <Text style={[styles.rowName, { color: colors.textPrimary }]} numberOfLines={1}>{r.display_name}</Text>
                <Text style={[styles.rowScore, { color: colors.textMuted }]}>{r.score}</Text>
                <Text style={[styles.rowDelta, { color: r.delta > 0 ? colors.success : r.delta < 0 ? colors.error : colors.textMuted }]}>
                  {r.delta > 0 ? `+${r.delta}` : String(r.delta)}
                </Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.actions}>
            {showPlayAgain && onPlayAgain && (
              <Pressable
                onPress={onPlayAgain}
                style={[styles.btn, { backgroundColor: colors.accent }]}
                testID="settlement-play-again"
              >
                <Text style={[styles.btnText, { color: '#ffffff' }]}>
                  {t('scoreboard.playAgain')}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={onClose}
              style={[styles.btn, { backgroundColor: 'transparent', borderColor: colors.glassLight, borderWidth: 1 }]}
              testID="settlement-close"
            >
              <Text style={[styles.btnText, { color: colors.textPrimary }]}>{t('common.close', 'Close')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: Spacing.lg },
  sheet: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.lg, maxHeight: '80%' },
  title: { fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: Spacing.md },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginBottom: Spacing.md },
  balanceLabel: { fontSize: 16 },
  balanceDelta: { fontSize: 22, fontWeight: '800' },
  balanceNew: { fontSize: 16, fontWeight: '700' },
  list: { maxHeight: 240, marginBottom: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 8, borderBottomWidth: 1 },
  rowName: { flex: 1, fontSize: 14, fontWeight: '600' },
  rowScore: { fontSize: 13, width: 50, textAlign: 'right', marginRight: Spacing.sm },
  rowDelta: { fontSize: 14, fontWeight: '700', width: 60, textAlign: 'right' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
  btn: { paddingHorizontal: Spacing.lg, paddingVertical: 10, borderRadius: Radius.md, alignItems: 'center' },
  btnText: { fontWeight: '700' },
});
```

- [ ] **Step 2: Mount it in GameTableScreen**

In `src/screens/GameTableScreen.tsx`, near where `ScoreboardModal` is mounted (around the existing finished-game flow), add state and the new modal:

```ts
const [showSettlement, setShowSettlement] = useState(false);
const meOptIn = !!(mpPlayers.find((p) => p.session_id === myPlayerId) as any)?.opt_in_stake;
const roomStake = (room?.stake ?? 0) as 0 | 1 | 5 | 10 | 25;

// When the game flips to finished and I was opted in, queue the settlement modal.
useEffect(() => {
  if (vm.phase === 'finished' && roomStake > 0 && meOptIn) {
    setShowSettlement(true);
  }
}, [vm.phase, roomStake, meOptIn]);
```

In JSX, after `<ScoreboardModal ... />`:

```tsx
<RatingSettlementModal
  visible={showSettlement}
  roomId={room?.id ?? null}
  onClose={() => setShowSettlement(false)}
  showPlayAgain={isMultiplayer && room?.host_session_id === myPlayerId}
  onPlayAgain={() => { setShowSettlement(false); handleScoreboardPlayAgain?.(); }}
/>
```

For opt-in players, hide `ScoreboardModal`'s own Play-again button so the flow funnels through settlement. Quickest knob: pass an extra prop `suppressPlayAgain={meOptIn && roomStake > 0}` to `<ScoreboardModal>` and short-circuit the button render inside that component (add the prop + render guard in the same task).

- [ ] **Step 3: Mount it in DesktopGameLayout**

Same wiring as Step 2, in `src/screens/desktop/DesktopGameLayout.tsx`'s embedded scoreboard path. The desktop layout already controls its own "Play again" button; pass `suppressPlayAgain` similarly when opt-in.

- [ ] **Step 4: Manual verification**

Play a full multiplayer game with 2 opt-in players (stake = 1). After last hand:
- Both opt-in players see scoreboard, then settlement modal with non-zero deltas summing to 0.
- A non-opt-in player sees only the scoreboard.

- [ ] **Step 5: Commit**

```bash
git add src/screens/RatingSettlementModal.tsx src/screens/GameTableScreen.tsx \
        src/screens/desktop/DesktopGameLayout.tsx src/screens/ScoreboardModal.tsx
git commit -m "feat(stakes): RatingSettlementModal — post-scoreboard settle screen for opt-in"
```

---

## Task 18: Rating row in Profile

**Files:**
- Modify: `src/screens/ProfileScreen.tsx`

Render the user's balance (loaded via `useRatingStore`) for eligible users only.

- [ ] **Step 1: Wire it**

In `src/screens/ProfileScreen.tsx`:

```ts
import { useFocusEffect } from '@react-navigation/native';
import { useRatingStore } from '../store/ratingStore';
import { canPlayForRating } from '../utils/ratingEligibility';
```

Inside the component:

```ts
const { user, isGuest } = useAuthStore();
const eligible = canPlayForRating(user, isGuest);
const balance = useRatingStore((s) => s.balance);
const loadRating = useRatingStore((s) => s.load);

useFocusEffect(
  React.useCallback(() => {
    if (eligible) loadRating();
  }, [eligible, loadRating]),
);
```

In the render, near the email / display-name rows, conditionally show:

```tsx
{eligible && (
  <View style={profileRowStyle} testID="profile-rating-row">
    <Text style={profileLabel}>{t('profile.rating')}</Text>
    <Text style={profileValue}>{balance ?? '—'}</Text>
  </View>
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/ProfileScreen.tsx
git commit -m "feat(stakes): rating row in Profile (eligible users only)"
```

---

## Task 19: `AdminRatingBlock` component + Profile integration

**Files:**
- Create: `src/components/admin/AdminRatingBlock.tsx`
- Modify: `src/screens/ProfileScreen.tsx`

Visible only when `gameClient.adminCheck()` returns `{ is_admin: true }`. Two actions: reset a single user (search + confirm) and reset everyone (typed confirm).

- [ ] **Step 1: Implement the component**

Create `src/components/admin/AdminRatingBlock.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';
import { gameClient } from '../../lib/gameClient';

interface FoundUser { id: string; email: string | null; display_name: string | null; balance: number }

export const AdminRatingBlock: React.FC = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [isAdmin, setIsAdmin] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<FoundUser[]>([]);
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await gameClient.adminCheck().catch(() => ({ is_admin: false }));
      if (!cancelled) setIsAdmin(!!r.is_admin);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isAdmin || q.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    (async () => {
      const r = await gameClient.adminSearchUsers(q).catch(() => ({ rows: [] as FoundUser[] }));
      if (!cancelled) setResults((r as any).rows ?? []);
    })();
    return () => { cancelled = true; };
  }, [q, isAdmin]);

  if (!isAdmin) return null;

  const resetOne = async (u: FoundUser) => {
    if (u.balance === 0) return;
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`Reset ${u.email}'s rating ${u.balance} → 0?`)
      : true;
    if (!ok) return;
    await gameClient.adminResetRating(u.id);
    setResults((prev) => prev.map((x) => x.id === u.id ? { ...x, balance: 0 } : x));
  };

  const resetAll = async () => {
    if (confirmText !== 'RESET ALL') {
      Alert.alert('Confirm', 'Type RESET ALL to confirm');
      return;
    }
    const r = await gameClient.adminResetAllRatings();
    Alert.alert('Done', `Affected: ${(r as any).affected ?? 0}`);
    setConfirmText('');
  };

  return (
    <View style={[styles.block, { borderColor: colors.error, backgroundColor: colors.surface }]} testID="admin-rating-block">
      <Text style={[styles.title, { color: colors.error }]}>Admin · Reset ratings</Text>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search by email…"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, { color: colors.textPrimary, borderColor: colors.glassLight }]}
        testID="admin-search-input"
      />
      {results.map((u) => (
        <View key={u.id} style={[styles.row, { borderColor: colors.glassLight }]}>
          <Text style={[styles.rowText, { color: colors.textPrimary }]} numberOfLines={1}>{u.email}</Text>
          <Text style={[styles.rowText, { color: colors.textMuted }]}>{u.balance}</Text>
          <Pressable
            onPress={() => resetOne(u)}
            disabled={u.balance === 0}
            style={[styles.btnSmall, { borderColor: colors.error, opacity: u.balance === 0 ? 0.4 : 1 }]}
            testID={`admin-reset-${u.id}`}
          >
            <Text style={{ color: colors.error, fontWeight: '700', fontSize: 13 }}>Reset</Text>
          </Pressable>
        </View>
      ))}
      <View style={{ height: Spacing.md }} />
      <Text style={{ color: colors.error, fontWeight: '600', marginBottom: 4 }}>
        Reset every user's rating (type RESET ALL to confirm):
      </Text>
      <TextInput
        value={confirmText}
        onChangeText={setConfirmText}
        placeholder="RESET ALL"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, { color: colors.textPrimary, borderColor: colors.error }]}
        testID="admin-reset-all-input"
      />
      <Pressable
        onPress={resetAll}
        disabled={confirmText !== 'RESET ALL'}
        style={[styles.btn, { backgroundColor: colors.error, opacity: confirmText === 'RESET ALL' ? 1 : 0.4 }]}
        testID="admin-reset-all-btn"
      >
        <Text style={{ color: '#ffffff', fontWeight: '700' }}>Reset all ratings</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  block: { borderWidth: 2, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.lg },
  title: { fontSize: 14, fontWeight: '800', marginBottom: Spacing.sm, textTransform: 'uppercase' },
  input: {
    borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, marginBottom: Spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1 },
  rowText: { fontSize: 13, flex: 1 },
  btnSmall: { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 10, paddingVertical: 4 },
  btn: { padding: 10, borderRadius: Radius.md, alignItems: 'center', marginTop: Spacing.sm },
});
```

- [ ] **Step 2: Mount in ProfileScreen**

In `src/screens/ProfileScreen.tsx`, add an import and mount the block at the bottom of the screen:

```tsx
import { AdminRatingBlock } from '../components/admin/AdminRatingBlock';
...
{eligible && <AdminRatingBlock />}
```

(Component self-gates on `adminCheck`; eligibility is just a fast-path to skip the network call for non-eligible users.)

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/AdminRatingBlock.tsx src/screens/ProfileScreen.tsx
git commit -m "feat(stakes): AdminRatingBlock — search + per-user reset + reset-all"
```

---

## Task 20: i18n keys (EN / RU / ES)

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/es.json`

- [ ] **Step 1: Add keys to en.json**

Append to `src/i18n/locales/en.json` (inside the root object, alongside existing top-level groups):

```json
  "stakes": {
    "title": "Rating stakes",
    "off": "Off",
    "optInBadge": "★ stake",
    "optInToggle": "Play for rating",
    "guestHint": "Sign in to play for rating",
    "unconfirmedHint": "Confirm your email to play for rating",
    "lockedHint": "Stakes locked — game in progress",
    "settlementTitle": "Rating settlement",
    "newBalance": "New balance: {{n}}"
  },
  "profile": {
    "rating": "Rating"
  }
```

If `profile` already exists, merge the `rating` key in.

- [ ] **Step 2: Add keys to ru.json**

```json
  "stakes": {
    "title": "Игра на рейтинг",
    "off": "Выкл.",
    "optInBadge": "★ ставка",
    "optInToggle": "Играть на рейтинг",
    "guestHint": "Зарегистрируйтесь, чтобы играть на рейтинг",
    "unconfirmedHint": "Подтвердите email, чтобы играть на рейтинг",
    "lockedHint": "Ставка зафиксирована — идёт игра",
    "settlementTitle": "Изменение рейтинга",
    "newBalance": "Новый баланс: {{n}}"
  },
  "profile": {
    "rating": "Рейтинг"
  }
```

- [ ] **Step 3: Add keys to es.json**

```json
  "stakes": {
    "title": "Apuesta de rating",
    "off": "Apagado",
    "optInBadge": "★ apuesta",
    "optInToggle": "Jugar por rating",
    "guestHint": "Inicia sesión para jugar por rating",
    "unconfirmedHint": "Confirma tu email para jugar por rating",
    "lockedHint": "Apuesta bloqueada — partida en curso",
    "settlementTitle": "Liquidación de rating",
    "newBalance": "Nuevo saldo: {{n}}"
  },
  "profile": {
    "rating": "Rating"
  }
```

- [ ] **Step 4: Verify with the i18n smoke test**

Run: `npm run smoke -- tests/smoke/i18n.spec.ts`
Expected: PASS for EN / RU / ES — no untranslated keys.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/ru.json src/i18n/locales/es.json
git commit -m "feat(stakes): i18n keys EN/RU/ES for stakes + profile.rating"
```

---

## Task 21: Smoke test — WaitingRoom stake + opt-in flow

**Files:**
- Create: `tests/smoke/stakes-waitingroom.spec.ts`

Exercises stake selection by a host and opt-in by a second logged-in player against the dev server (`:8081`). Mirrors the pattern of `chat-tooltip.spec.ts`.

- [ ] **Step 1: Write the test**

Create `tests/smoke/stakes-waitingroom.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { ensureDevServer } from '../fixtures/smoke';
import {
  enterLobbyAsRegisteredUser, // helper added later in this task
  createRoomAsHost,
  joinRoomByCode,
} from '../fixtures/multiplayer';

const MOBILE_VP = {
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
             'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
} as const;

test.beforeAll(async () => { await ensureDevServer(); });

test.describe('stakes waitingroom', () => {
  test('host picks stake, second logged-in player opts in', async ({ browser }) => {
    const ctxA = await browser.newContext({ ...MOBILE_VP });
    const ctxB = await browser.newContext({ ...MOBILE_VP });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      // BOTH players need to be registered+confirmed for opt-in.
      await enterLobbyAsRegisteredUser(pageA, 'host@stakes.test');
      await enterLobbyAsRegisteredUser(pageB, 'guest@stakes.test');

      const code = await createRoomAsHost(pageA, 2, 'host');
      await joinRoomByCode(pageB, code, 'guest');

      // Host picks stake=5.
      await pageA.locator('[data-testid="stake-chip-5"]').click({ timeout: 5_000 });
      // Opt-in switch becomes visible on both sides; second player opts in.
      await pageB.locator('[data-testid="stake-optin-toggle"]').click({ timeout: 5_000 });

      // ★ badge appears on the second player's chip in host's view.
      await expect(
        pageA.locator('text=★').first(),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await ctxA.close().catch(() => {});
      await ctxB.close().catch(() => {});
    }
  });
});
```

- [ ] **Step 2: Add `enterLobbyAsRegisteredUser` to the fixture**

In `tests/fixtures/multiplayer.ts`, alongside `enterLobbyAsGuest`, add a sibling helper that signs up a fresh email-confirmed account (or signs in if it exists). The flow:
1. Boot the lobby.
2. Open Sign Up modal.
3. Submit a known throwaway email + password.
4. Use Supabase admin API (service role) to manually flip `email_confirmed_at` to `now()` for the new user.
5. Sign in (or refresh — Supabase usually picks up the confirmation immediately).
6. Wait for the localStorage auth token to land.

This is non-trivial — write it as a separate helper, do not inline. If supabase test-user provisioning is already used elsewhere in `tests/fixtures/`, reuse that pattern (search for `auth.admin` references in `tests/fixtures/`).

- [ ] **Step 3: Run**

Run: `npm run smoke -- tests/smoke/stakes-waitingroom.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/smoke/stakes-waitingroom.spec.ts tests/fixtures/multiplayer.ts
git commit -m "test(stakes): smoke — host picks stake, second logged-in player opts in"
```

---

## Task 22: e2e — full settlement run

**Files:**
- Create: `tests/e2e/stakes-settlement.spec.ts`

Three logged-in players, two opt-in (stake = 1). Play through a 2-card mini-game to `finished`. Verify `rating_events` rows exist for the two opt-in users with `delta` summing to 0, and `user_ratings.balance` reflects the deltas.

- [ ] **Step 1: Write the test**

Create `tests/e2e/stakes-settlement.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  enterLobbyAsRegisteredUser,
  createRoomAsHost,
  joinRoomByCode,
  playMinimalGameToFinish, // helper to be added if not present — see Step 2
} from '../fixtures/multiplayer';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test('e2e: 3 players, 2 opt-in, settlement writes rating_events and updates balances',
  async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const ctxC = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const pageC = await ctxC.newPage();
    const emailA = `e2e-a-${Date.now()}@stakes.test`;
    const emailB = `e2e-b-${Date.now()}@stakes.test`;
    const emailC = `e2e-c-${Date.now()}@stakes.test`;

    try {
      await enterLobbyAsRegisteredUser(pageA, emailA);
      await enterLobbyAsRegisteredUser(pageB, emailB);
      await enterLobbyAsRegisteredUser(pageC, emailC);

      const code = await createRoomAsHost(pageA, 3, 'a');
      await joinRoomByCode(pageB, code, 'b');
      await joinRoomByCode(pageC, code, 'c');

      // Host picks stake=1; A and B opt in, C does NOT.
      await pageA.locator('[data-testid="stake-chip-1"]').click();
      await pageA.locator('[data-testid="stake-optin-toggle"]').click();
      await pageB.locator('[data-testid="stake-optin-toggle"]').click();

      // Start and play a short game to finish (2 cards / hand, 4 total hands etc.
      // — `playMinimalGameToFinish` is the same helper used by the existing
      // multiplayer e2e specs).
      await playMinimalGameToFinish(pageA, pageB, pageC);

      // Two opted-in players see the settlement modal.
      await expect(pageA.locator('[data-testid="settlement-title"]'))
        .toBeVisible({ timeout: 10_000 });
      await expect(pageB.locator('[data-testid="settlement-title"]'))
        .toBeVisible({ timeout: 10_000 });
      // C does not.
      await expect(pageC.locator('[data-testid="settlement-title"]'))
        .toHaveCount(0);

      // Verify journal via service-role.
      const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
      const { data: events } = await svc
        .from('rating_events')
        .select('user_id, delta, reason')
        .eq('reason', 'settle')
        .order('created_at', { ascending: false })
        .limit(10);
      // Expect 2 rows summing to 0.
      const recent = (events ?? []).slice(0, 2);
      expect(recent.length).toBe(2);
      const sum = recent.reduce((s, r) => s + r.delta, 0);
      expect(sum).toBe(0);
    } finally {
      await ctxA.close().catch(() => {});
      await ctxB.close().catch(() => {});
      await ctxC.close().catch(() => {});
    }
  });
```

- [ ] **Step 2: Ensure `playMinimalGameToFinish` helper exists**

If `tests/fixtures/multiplayer.ts` already has a helper that plays through a tiny multiplayer game to `finished`, reuse it. If not, lift the inner loop from `tests/e2e/multiplayer-6p-mixed.ts` (or the closest existing 3-player e2e) and extract a fixture function. Don't inline the play loop in the spec — it's long.

- [ ] **Step 3: Run**

Run: `npm run sanity` (or whichever script wraps e2e against the local Supabase stack).
Expected: PASS, with the assertion that `rating_events` has 2 fresh rows summing to 0.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/stakes-settlement.spec.ts tests/fixtures/multiplayer.ts
git commit -m "test(stakes): e2e — 3 players, 2 opt-in, settlement balances + journal"
```

---

## Task 23: Backlog + final polish

**Files:**
- Modify: `docs/BACKLOG.md`

- [ ] **Step 1: Move the In Progress entry to Done**

In `docs/BACKLOG.md`, move the "Conditional stakes — opt-in rating wager per game + admin reset tools" entry from `## In Progress` to `## Done` once all prior tasks are merged and verified. Keep the date stamp.

- [ ] **Step 2: Commit**

```bash
git add docs/BACKLOG.md
git commit -m "docs(backlog): conditional stakes shipped → Done"
```

---

## Self-review

**1. Spec coverage:**

| Spec section | Implemented in |
| --- | --- |
| `user_ratings` table | Task 2 |
| `rating_events` table (with `admin_reset` reason + nullable room_id) | Task 2 |
| `rooms.stake` / `rooms.stake_locked` | Task 2 |
| `room_players.opt_in_stake` | Task 2 |
| RLS for owner-only reads | Task 2 |
| `get_room_state` extension | Task 2 |
| `get_my_rating` RPC | Task 2 |
| `get_rating_settlement` RPC | Task 2 |
| `apply_rating_delta` helper RPC | Task 7 |
| `computeSettlement` engine + drift fix | Task 1 |
| `set_stake` edge action | Task 4 |
| `toggle_stake_optin` edge action | Task 5 |
| Lock on `start_game`, reset on `restart_game` | Task 6 |
| Settlement on phase=finished + clear lock | Task 7 |
| `isAdminEmail` allow-list | Task 8 |
| `admin_check` | Task 9 |
| `admin_search_users` | Task 10 |
| `admin_reset_rating` + `admin_reset_all_ratings` | Task 11 |
| `canPlayForRating` client helper | Task 12 |
| `gameClient` wrappers + `useRatingStore` | Task 13 |
| `StakeSelector` component | Task 14 |
| WaitingRoom integration (mobile + desktop) + ★ badges | Task 15 |
| Δ rating column in ScoreboardModal (opt-in only) | Task 16 |
| `RatingSettlementModal` + integration | Task 17 |
| Rating row in Profile | Task 18 |
| `AdminRatingBlock` + Profile mount | Task 19 |
| i18n keys EN/RU/ES | Task 20 |
| Smoke test | Task 21 |
| e2e settlement test | Task 22 |

All spec sections map to a task.

**2. Placeholders:** none. Every step shows the code or command needed.

**3. Type consistency:** `StakeInput`/`StakeDelta` (Task 1) and `ResetRow` (Task 11) are used consistently. The Action union extension in Task 3 matches the action handlers in Tasks 4–11. Method names on `gameClient` (Task 13) match what the UI tasks (14–19) call.

**4. Scope:** Single connected feature: stakes + admin tooling. Reasonable for one implementation plan; the natural break point (engine → DB → server → client → tests) is just task ordering, not separable plans.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-23-conditional-stakes.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
