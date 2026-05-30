# Host Freeze Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the host freeze a multiplayer game at any moment (`room.phase='paused'`), preserve all state, let players step away and return, and resume from the exact point once the full lineup is back — with a 48h TTL that abandons un-resumed pauses without a rating settle.

**Architecture:** A new `room.phase='paused'` plus a single gate in the edge dispatcher (`game-action/index.ts`) that rejects every gameplay mutation while paused. Two new host-only edge actions (`pause_game`/`resume_game`) follow the existing `setStake.ts` handler shape. `get_my_active_room` is amended so paused rooms stay returnable within TTL. The client gains a Freeze button, a paused overlay, and a lobby indicator with a TTL countdown.

**Tech Stack:** Supabase Postgres (SQL/PLpgSQL), Deno edge functions (`game-action`), Expo React Native + TypeScript, Zustand, Jest (TS units only), Playwright smoke, local Supabase (docker-exec psql — `psql` is NOT on the host).

**Spec:** `docs/superpowers/specs/2026-05-30-host-freeze-game-design.md`

**Branch:** `feat/host-freeze-game` (already created; spec committed there).

**Critical environment notes (read once):**
- `psql` is only inside the Docker container. Run SQL files via `docker exec -i supabase_db_nigels-app-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < FILE.sql` and ad-hoc SQL via the same with a heredoc. `npx supabase db reset` replays migrations locally (use it after editing an already-applied migration — `migration up` won't re-run it).
- Local `:8081` dev server points at LOCAL Supabase (`.env.local`); its edge_runtime container must be up (`curl -s -o /dev/null -w "%{http_code}" -X OPTIONS http://127.0.0.1:54321/functions/v1/game-action` → 200). Do NOT start `:8081` for the user.
- Memory-constrained 24GB Mac: cap parallel work, never run `sanity`/`demo`. `npm run test:unit` and a single `npm run smoke` are fine.
- The repo has NO SQL test harness — verify SQL with transaction-wrapped psql scripts that ROLLBACK.

---

## File Structure

- **Migration** `supabase/migrations/20260531000000_host_freeze_game.sql` — phase CHECK + `paused_at`/`paused_lineup` columns; redefine `get_my_active_room` (paused-within-TTL clause + `paused_at` in return); redefine `get_room_state` (emit `paused_at`/`paused_lineup`).
- **Verify** `supabase/tests/host_freeze_check.sql` — transactional checks.
- **Edge types** `supabase/functions/_shared/types.ts` — add `pause_game`/`resume_game` to `ActionKind` + `Action`; add `paused_at`/`paused_lineup` and `'paused'` phase to `RoomSnapshot.room`.
- **Edge handlers** `supabase/functions/game-action/actions/pauseGame.ts`, `resumeGame.ts` (new).
- **Edge dispatch + gate** `supabase/functions/game-action/index.ts` — wire 2 cases; add the pause gate before the `switch`.
- **Edge leave** `supabase/functions/game-action/actions/leaveRoom.ts` — non-host leave during pause holds the seat.
- **Edge snapshot** `supabase/functions/game-action/snapshot.ts` — carry `paused_at`/`paused_lineup` from the `get_room_state` JSON.
- **Client types** `src/lib/supabase/types.ts` (generated room type) — add columns; **client snapshot type** mirrors edge `RoomSnapshot`.
- **Client RPC** `src/lib/gameClient.ts` — `pauseGame`/`resumeGame` wrappers; **`src/lib/activeRoom.ts`** — expose `paused_at` from `get_my_active_room`.
- **UI** `src/components/PausedOverlay.tsx` (new); freeze/resume wiring in `src/screens/GameTableScreen.tsx` + `src/components/betting/BettingPhase.tsx`; lobby indicator in the lobby/Welcome surface; i18n `src/i18n/locales/{en,ru,es,fr}.json`.
- **Test** `tests/smoke/freeze-game.spec.ts` (new).

---

## Task 1: Migration — paused phase, columns, RPC amendments

**Files:**
- Create: `supabase/migrations/20260531000000_host_freeze_game.sql`
- Create: `supabase/tests/host_freeze_check.sql`

- [ ] **Step 1: Confirm local stack is up**

Run:
```bash
npx supabase status | sed -n '1,4p'
curl -s -o /dev/null -w "edge: %{http_code}\n" -X OPTIONS http://127.0.0.1:54321/functions/v1/game-action --max-time 5
```
Expected: DB listed; `edge: 200`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260531000000_host_freeze_game.sql`:
```sql
-- Host freeze game: a 'paused' room phase the host can enter at any moment.
-- State (hand/trick/scores/seats) is preserved; gameplay mutations are gated
-- in the edge dispatcher while paused. paused_lineup pins the session_ids that
-- must all be back+live before the host may resume. 48h TTL → abandon (handled
-- in the edge layer / read RPCs below), no rating settle.

ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_phase_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_phase_check
  CHECK (phase = ANY (ARRAY['waiting'::text, 'playing'::text, 'paused'::text, 'finished'::text]));

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS paused_at     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS paused_lineup uuid[]      NULL;

-- get_my_active_room: keep returning a paused room to its participants while it
-- is within the 48h TTL window (even when everyone has stepped away and
-- room_is_alive is false). Past TTL it is simply not returned (read-only).
-- Also expose paused_at so the lobby can render the countdown.
CREATE OR REPLACE FUNCTION public.get_my_active_room()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_sid  uuid;
  v_row  RECORD;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_sid FROM public.room_sessions
    WHERE auth_user_id = v_uid LIMIT 1;
  IF v_sid IS NULL THEN RETURN NULL; END IF;

  -- Player seat first; prefer playing > waiting > scoring; tie-break by
  -- updated_at DESC to pick the most recently active room.
  SELECT r.id AS room_id, r.phase, r.code, r.paused_at, 'player' AS role
    INTO v_row
  FROM public.rooms r
  JOIN public.room_players rp ON rp.room_id = r.id
  WHERE rp.session_id = v_sid
    AND r.phase <> 'finished'
    AND (public.room_is_alive(r.id)
         OR (r.phase = 'paused' AND r.paused_at > now() - INTERVAL '48 hours'))
  ORDER BY
    CASE r.phase WHEN 'playing' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END,
    r.updated_at DESC
  LIMIT 1;

  IF v_row.room_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'room_id', v_row.room_id, 'code', v_row.code,
      'phase', v_row.phase, 'role', v_row.role, 'paused_at', v_row.paused_at
    );
  END IF;

  -- Spectator fallback.
  SELECT r.id AS room_id, r.phase, r.code, r.paused_at, 'spectator' AS role
    INTO v_row
  FROM public.rooms r
  JOIN public.room_spectators rsp ON rsp.room_id = r.id
  WHERE rsp.session_id = v_sid
    AND r.phase <> 'finished'
    AND (public.room_is_alive(r.id)
         OR (r.phase = 'paused' AND r.paused_at > now() - INTERVAL '48 hours'))
  ORDER BY r.updated_at DESC
  LIMIT 1;

  IF v_row.room_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'room_id', v_row.room_id, 'code', v_row.code,
      'phase', v_row.phase, 'role', v_row.role, 'paused_at', v_row.paused_at
    );
  END IF;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_active_room() TO authenticated;
```

Then append a redefined `get_room_state` so the snapshot carries the new room
fields. Open the CURRENT live body in
`supabase/migrations/20260530010000_connection_liveness.sql` (the
`CREATE OR REPLACE FUNCTION public.get_room_state(p_room_id uuid) … $$;` block
plus its `ALTER FUNCTION … OWNER` / `GRANT` lines), copy it verbatim, and change
ONLY the `room AS (...)` CTE's SELECT list to add the two new columns:
```sql
  room AS (
    SELECT id, code, host_session_id, player_count, max_cards, min_cards_per_hand,
           mode, phase, current_hand_id, version, stake, stake_locked,
           paused_at, paused_lineup
    FROM public.rooms WHERE id = p_room_id
  ),
```
Add a one-line comment above the appended block:
```sql
-- Redefine get_room_state to carry paused_at + paused_lineup in the room object.
```
Change nothing else in the copied body (`to_jsonb(room.*)` automatically includes the two new columns).

- [ ] **Step 3: Write the failing verification script**

Create `supabase/tests/host_freeze_check.sql`:
```sql
-- Manual verification for the host-freeze migration. Transaction-wrapped (ROLLBACK).
-- Run: docker exec -i supabase_db_nigels-app-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/host_freeze_check.sql
BEGIN;

-- 'paused' is now an accepted room phase.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000','dddddddd-dddd-dddd-dddd-dddddddddddd','authenticated','authenticated','freeze@nigels.test','',now(),now(),now());
INSERT INTO public.room_sessions (id, auth_user_id, display_name)
VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','dddddddd-dddd-dddd-dddd-dddddddddddd','Freeze');
INSERT INTO public.rooms (id, code, host_session_id, player_count, phase, paused_at, paused_lineup)
VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff','FRZ001','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',4,
        'paused', now(), ARRAY['eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee']::uuid[]);
INSERT INTO public.room_players (room_id, session_id, seat_index, last_seen_at)
VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',0, now() - INTERVAL '10 minutes');

-- get_room_state emits paused_at + paused_lineup on the room object.
DO $$
DECLARE v jsonb;
BEGIN
  v := public.get_room_state('ffffffff-ffff-ffff-ffff-ffffffffffff');
  IF NOT ((v->'room') ? 'paused_at') OR NOT ((v->'room') ? 'paused_lineup') THEN
    RAISE EXCEPTION 'FAIL: room object missing paused_at/paused_lineup';
  END IF;
  IF (v->'room'->>'phase') <> 'paused' THEN
    RAISE EXCEPTION 'FAIL: room phase should be paused';
  END IF;
END $$;

SELECT 'PASS: paused phase accepted + snapshot carries paused fields' AS result;
ROLLBACK;
```

- [ ] **Step 4: Run the script BEFORE applying — verify it FAILS**

Run:
```bash
docker exec -i supabase_db_nigels-app-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/host_freeze_check.sql
```
Expected: FAIL — the `INSERT … phase='paused'` violates `rooms_phase_check` (migration not applied yet).

- [ ] **Step 5: Apply locally (clean replay)**

Run: `npx supabase db reset`
Expected: replays all migrations including the new one, no error.

- [ ] **Step 6: Run the script — verify it PASSES**

Run:
```bash
docker exec -i supabase_db_nigels-app-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/host_freeze_check.sql
```
Expected: `PASS: paused phase accepted + snapshot carries paused fields`. If a NOT NULL on auth.users/rooms complains, add the missing column to the INSERT (don't weaken assertions).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260531000000_host_freeze_game.sql supabase/tests/host_freeze_check.sql
git commit -m "feat(db): host-freeze migration — paused phase, columns, RPC amendments"
```

---

## Task 2: Edge types + pause_game / resume_game handlers

**Files:**
- Modify: `supabase/functions/_shared/types.ts`
- Create: `supabase/functions/game-action/actions/pauseGame.ts`, `resumeGame.ts`
- Modify: `supabase/functions/game-action/index.ts` (dispatch cases)

- [ ] **Step 1: Extend the action + snapshot types**

In `supabase/functions/_shared/types.ts`:
- Add to the `ActionKind` union (after `'restart_game'`): `| 'pause_game' | 'resume_game'`.
- Add to the `Action` union (after the `toggle_stake_optin` line):
```ts
  | { kind: 'pause_game';  room_id: string }
  | { kind: 'resume_game'; room_id: string }
```
- In `RoomSnapshot.room`, change `phase` to include paused and add the two fields:
```ts
    phase: 'waiting' | 'playing' | 'paused' | 'finished';
    current_hand_id: string | null;
    version: number;
    stake: number;
    stake_locked: boolean;
    paused_at?: string | null;
    paused_lineup?: string[] | null;
```

- [ ] **Step 2: Write `pauseGame.ts`**

Create `supabase/functions/game-action/actions/pauseGame.ts`:
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

// Host-only. Freezes an in-play game: room.phase -> 'paused', records paused_at
// (always now(), so a re-pause resets the 48h TTL) and paused_lineup (the
// session_ids that must all be back+live before resume).
export async function pauseGame(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'pause_game' }>,
): Promise<ActionResult> {
  const { data: room } = await svc
    .from('rooms')
    .select('id, version, host_session_id, phase')
    .eq('id', action.room_id)
    .maybeSingle();
  if (!room) return { ok: false, error: 'room_not_found', state: empty(), version: 0 };
  if (room.host_session_id !== actor.session_id)
    return { ok: false, error: 'not_host', state: empty(), version: 0 };
  if (room.phase !== 'playing')
    return { ok: false, error: 'not_in_play', state: empty(), version: 0 };

  const { data: rps } = await svc
    .from('room_players')
    .select('session_id')
    .eq('room_id', room.id);
  const lineup = (rps ?? []).map((r: { session_id: string }) => r.session_id);

  const newVersion = (room.version ?? 0) + 1;
  await svc.from('rooms').update({
    phase: 'paused',
    paused_at: new Date().toISOString(),
    paused_lineup: lineup,
    version: newVersion,
  }).eq('id', room.id);

  await svc.from('game_events').insert({
    room_id: room.id, session_id: actor.session_id, kind: 'game_paused', payload: {},
  });

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: newVersion };
}
```

- [ ] **Step 3: Write `resumeGame.ts`**

Create `supabase/functions/game-action/actions/resumeGame.ts`:
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

const TTL_HOURS = 48;
const LIVE_WINDOW_MS = 30_000; // a lineup member counts as present if seen <30s ago

// Host-only. Resumes a paused game once every paused_lineup member has a
// room_players row that is live (last_seen_at within 30s). An over-TTL paused
// room is converted to 'finished' (no settle) instead.
export async function resumeGame(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'resume_game' }>,
): Promise<ActionResult> {
  const { data: room } = await svc
    .from('rooms')
    .select('id, version, host_session_id, phase, paused_at, paused_lineup')
    .eq('id', action.room_id)
    .maybeSingle();
  if (!room) return { ok: false, error: 'room_not_found', state: empty(), version: 0 };
  if (room.host_session_id !== actor.session_id)
    return { ok: false, error: 'not_host', state: empty(), version: 0 };
  if (room.phase !== 'paused')
    return { ok: false, error: 'not_paused', state: empty(), version: 0 };

  // TTL: an over-48h pause is abandoned (no settle), not resumed.
  const pausedMs = room.paused_at ? Date.parse(room.paused_at as string) : 0;
  if (pausedMs && Date.now() - pausedMs > TTL_HOURS * 3600_000) {
    const v = (room.version ?? 0) + 1;
    await svc.from('rooms').update({ phase: 'finished', version: v }).eq('id', room.id);
    await svc.from('game_events').insert({
      room_id: room.id, session_id: actor.session_id, kind: 'game_abandoned', payload: { reason: 'ttl' },
    });
    return { ok: false, error: 'game_abandoned',
             state: await buildSnapshot(svc, room.id, actor.session_id), version: v };
  }

  // Every lineup member must have a live room_players row.
  const lineup = (room.paused_lineup ?? []) as string[];
  const { data: rps } = await svc
    .from('room_players')
    .select('session_id, last_seen_at')
    .eq('room_id', room.id);
  const liveSet = new Set(
    (rps ?? [])
      .filter((r: { last_seen_at: string }) => Date.now() - Date.parse(r.last_seen_at) < LIVE_WINDOW_MS)
      .map((r: { session_id: string }) => r.session_id),
  );
  const missing = lineup.filter((sid) => !liveSet.has(sid));
  if (missing.length > 0) {
    return { ok: false, error: 'lineup_incomplete',
             state: await buildSnapshot(svc, room.id, actor.session_id), version: room.version ?? 0 };
  }

  const newVersion = (room.version ?? 0) + 1;
  await svc.from('rooms').update({
    phase: 'playing', paused_at: null, paused_lineup: null, version: newVersion,
  }).eq('id', room.id);

  await svc.from('game_events').insert({
    room_id: room.id, session_id: actor.session_id, kind: 'game_resumed', payload: {},
  });

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: newVersion };
}
```

- [ ] **Step 4: Wire the dispatch**

In `supabase/functions/game-action/index.ts`: add imports near the other action imports:
```ts
import { pauseGame } from './actions/pauseGame.ts';
import { resumeGame } from './actions/resumeGame.ts';
```
Add two cases to the `switch (action.kind)` (after `toggle_stake_optin`):
```ts
        case 'pause_game':      result = await pauseGame(svc, actor, action); break;
        case 'resume_game':     result = await resumeGame(svc, actor, action); break;
```

- [ ] **Step 5: Typecheck the edge function**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -iE "pauseGame|resumeGame|game-action/index|_shared/types" || echo "OK: no errors in changed edge files"
```
Expected: `OK: no errors in changed edge files`. (Pre-existing Deno-test tsc errors elsewhere are unrelated.)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/types.ts supabase/functions/game-action/actions/pauseGame.ts supabase/functions/game-action/actions/resumeGame.ts supabase/functions/game-action/index.ts
git commit -m "feat(edge): pause_game/resume_game actions + types + dispatch"
```

---

## Task 3: Pause gate + leaveRoom-during-pause + snapshot fields

**Files:**
- Modify: `supabase/functions/game-action/index.ts` (gate)
- Modify: `supabase/functions/game-action/actions/leaveRoom.ts`
- Modify: `supabase/functions/game-action/snapshot.ts`

- [ ] **Step 1: Add the central pause gate**

In `supabase/functions/game-action/index.ts`, immediately AFTER the `prev` snapshot block (the `if (room_id && action.kind !== 'create_room' …)` that sets `prev`) and BEFORE `let result: ActionResult;`, insert:
```ts
  // Pause gate: while a room is frozen, reject every gameplay mutation. Allowed
  // during pause: resume_game, leave_room, set_display_name (+ join_room rejoin,
  // heartbeat, chat — which don't reach this switch). This one check also
  // neutralizes request_timeout auto-play of absent seats.
  const GAMEPLAY_WHILE_PAUSED_BLOCKED = new Set([
    'place_bet', 'play_card', 'continue_hand', 'record_tricks', 'request_timeout',
    'ready', 'start_game', 'restart_game', 'set_stake', 'toggle_stake_optin',
  ]);
  if (prev?.room?.phase === 'paused' && GAMEPLAY_WHILE_PAUSED_BLOCKED.has(action.kind)) {
    return jsonResponse(
      { ok: false, error: 'game_paused', state: prev, version: prev.room?.version ?? 0 },
      200,
    );
  }
```
(Confirm `jsonResponse` is the helper used for the early returns in this file — match the existing return style. If a `version` is needed, `prev.room.version` is correct.)

- [ ] **Step 2: Non-host leave during pause holds the seat**

In `supabase/functions/game-action/actions/leaveRoom.ts`, find the non-host abandon branch guarded by `room.phase === 'playing'` (it deletes the current hand and snaps to `waiting`). Add, BEFORE the host-leaving and the `playing`-abandon branches, a paused short-circuit so a non-host "leave" during pause just returns success without deleting their row or the hand:
```ts
  // During a pause, a non-host "leave" is a soft step-out: keep the seat (the
  // room_players row) and the frozen hand intact so the host can still resume
  // once everyone returns. The host leaving during pause falls through to the
  // host-leaving branch below (which abandons the game -> finished).
  if (!isHostLeaving && room.phase === 'paused') {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: true, state: snapshot, version: snapshot.room?.version ?? 0 };
  }
```
(Use the existing local variable for "is the actor the host" — in this file it is `isHostLeaving`. If the variable is computed later than this insertion point, move the insertion to just after `isHostLeaving` is defined. Read the file to place it correctly.)

- [ ] **Step 3: Carry paused fields through buildSnapshot**

In `supabase/functions/game-action/snapshot.ts`, `buildSnapshot` calls `get_room_state` and maps its JSON into `RoomSnapshot`. The `room` object is taken from the RPC's `room` key. Confirm the mapping passes the room object through (it uses `to_jsonb(room.*)`, so `paused_at`/`paused_lineup` already flow). If `snapshot.ts` explicitly white-lists room fields, add `paused_at` and `paused_lineup` to that mapping. Grep to check:
```bash
grep -n "paused_at\|to_jsonb\|room:" supabase/functions/game-action/snapshot.ts
```
If the room is spread/passed wholesale, no code change is needed — note that in the commit. If fields are enumerated, add the two.

- [ ] **Step 4: Verify the gate + leave behavior against local edge**

Re-apply edge changes are picked up by the local edge runtime automatically (it serves from disk). Run a transactional + HTTP check: first reset so the migration is present, then exercise the gate via psql-level state + an edge call. Minimal HTTP smoke of the gate:
```bash
npx supabase db reset >/dev/null 2>&1
# Pause gate: craft a paused room, then confirm a place_bet is rejected with game_paused.
# (Full HTTP exercise happens in Task 9 smoke. Here, assert the gate predicate via SQL state.)
docker exec -i supabase_db_nigels-app-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000','d1111111-1111-1111-1111-111111111111','authenticated','authenticated','g1@nigels.test','',now(),now(),now());
INSERT INTO public.room_sessions (id, auth_user_id, display_name)
VALUES ('e1111111-1111-1111-1111-111111111111','d1111111-1111-1111-1111-111111111111','G1');
INSERT INTO public.rooms (id, code, host_session_id, player_count, phase, paused_at, paused_lineup)
VALUES ('f1111111-1111-1111-1111-111111111111','PG0001','e1111111-1111-1111-1111-111111111111',4,'paused',now(),ARRAY['e1111111-1111-1111-1111-111111111111']::uuid[]);
DO $$
DECLARE v jsonb;
BEGIN
  v := public.get_room_state('f1111111-1111-1111-1111-111111111111');
  IF (v->'room'->>'phase') <> 'paused' THEN RAISE EXCEPTION 'FAIL: not paused'; END IF;
END $$;
SELECT 'PASS: paused room snapshot drives the gate predicate' AS result;
ROLLBACK;
SQL
```
Expected: `PASS: paused room snapshot drives the gate predicate`. (The gate itself is pure TS on `prev.room.phase`; the end-to-end rejection is asserted in Task 9 smoke.)

- [ ] **Step 5: Typecheck**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -iE "leaveRoom|index.ts|snapshot.ts" | grep -i "game-action" || echo "OK"
```
Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/game-action/index.ts supabase/functions/game-action/actions/leaveRoom.ts supabase/functions/game-action/snapshot.ts
git commit -m "feat(edge): pause gate + non-host leave holds seat during pause"
```

---

## Task 4: Client plumbing — types, gameClient, activeRoom

**Files:**
- Modify: `src/lib/supabase/types.ts` (room row type)
- Modify: client `RoomSnapshot` type (find where the client mirrors the edge snapshot)
- Modify: `src/lib/gameClient.ts`
- Modify: `src/lib/activeRoom.ts`

- [ ] **Step 1: Add columns to the generated room type**

In `src/lib/supabase/types.ts`, add to the `rooms` Row type (and `?` variants in Insert/Update):
```ts
          paused_at: string | null
          paused_lineup: string[] | null
```
Grep first for the rooms block: `grep -n "stake_locked" src/lib/supabase/types.ts`.

- [ ] **Step 2: Mirror the snapshot room type on the client**

Find the client-side `RoomSnapshot`/room type (the client imports edge `_shared/types.ts` in some places, or re-declares). Grep:
```bash
grep -rn "host_session_id" src/ | grep -iE "type|interface|phase" | head
```
Wherever the room snapshot type declares `phase: 'waiting' | 'playing' | 'finished'`, change it to include `'paused'` and add `paused_at?: string | null; paused_lineup?: string[] | null;`. If the client imports the edge type directly, no change is needed here.

- [ ] **Step 3: Add gameClient wrappers**

In `src/lib/gameClient.ts`, near `startGame`, add:
```ts
  pauseGame: (room_id: string) =>
    postAction(null, { kind: 'pause_game', room_id }),

  resumeGame: (room_id: string) =>
    postAction(null, { kind: 'resume_game', room_id }),
```

- [ ] **Step 4: Expose paused_at from get_my_active_room**

In `src/lib/activeRoom.ts`, the result of `get_my_active_room` is parsed into an object with `room_id/code/phase/role`. Add `paused_at` to that parsed shape so callers (lobby indicator) can read it. Grep:
```bash
grep -n "phase\|room_id\|role\|get_my_active_room" src/lib/activeRoom.ts
```
Add `paused_at: (data as any).paused_at ?? null` (matching the file's existing parse style) to the returned object and its type.

- [ ] **Step 5: Typecheck**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -iE "gameClient|activeRoom|supabase/types" || echo "OK: client plumbing typechecks"
```
Expected: `OK: client plumbing typechecks`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase/types.ts src/lib/gameClient.ts src/lib/activeRoom.ts
git commit -m "feat(client): pauseGame/resumeGame wrappers + paused_at plumbing"
```

---

## Task 5: i18n strings

**Files:**
- Modify: `src/i18n/locales/en.json`, `ru.json`, `es.json`, `fr.json`

- [ ] **Step 1: Add a `freeze` namespace to each locale**

Add to each of the four locale JSON files (translate values per locale; keys identical). EN:
```json
"freeze": {
  "button": "Freeze game",
  "resume": "Resume game",
  "kill": "End game",
  "toLobby": "To lobby",
  "pausedTitle": "Game frozen by host",
  "pausedBody": "Step away and come back any time. The host resumes when everyone is back.",
  "waitingFor": "Waiting for: {{names}}",
  "lobbyCard": "Frozen game {{code}}",
  "autoCancelIn": "Auto-cancels in {{time}}",
  "resumeDisabled": "Everyone must be back to resume"
}
```
RU:
```json
"freeze": {
  "button": "Заморозить партию",
  "resume": "Продолжить партию",
  "kill": "Завершить партию",
  "toLobby": "В лобби",
  "pausedTitle": "Партия заморожена хостом",
  "pausedBody": "Можно отойти и вернуться в любой момент. Хост продолжит, когда соберётся весь состав.",
  "waitingFor": "Ждём: {{names}}",
  "lobbyCard": "Замороженная партия {{code}}",
  "autoCancelIn": "Авто-отмена через {{time}}",
  "resumeDisabled": "Для продолжения нужен весь состав"
}
```
ES:
```json
"freeze": {
  "button": "Congelar partida",
  "resume": "Reanudar partida",
  "kill": "Finalizar partida",
  "toLobby": "Al vestíbulo",
  "pausedTitle": "Partida congelada por el anfitrión",
  "pausedBody": "Aléjate y vuelve cuando quieras. El anfitrión reanuda cuando estén todos.",
  "waitingFor": "Esperando a: {{names}}",
  "lobbyCard": "Partida congelada {{code}}",
  "autoCancelIn": "Se cancela en {{time}}",
  "resumeDisabled": "Deben estar todos para reanudar"
}
```
FR:
```json
"freeze": {
  "button": "Geler la partie",
  "resume": "Reprendre la partie",
  "kill": "Terminer la partie",
  "toLobby": "Au salon",
  "pausedTitle": "Partie gelée par l'hôte",
  "pausedBody": "Éloignez-vous et revenez quand vous voulez. L'hôte reprend quand tout le monde est là.",
  "waitingFor": "En attente de : {{names}}",
  "lobbyCard": "Partie gelée {{code}}",
  "autoCancelIn": "Annulation auto dans {{time}}",
  "resumeDisabled": "Tout le monde doit être là pour reprendre"
}
```
Place the namespace consistently (same nesting level as existing top-level namespaces like `lobby`/`auth`). Match each file's existing key ordering/style.

- [ ] **Step 2: Verify JSON validity + i18n smoke**

Run:
```bash
node -e "['en','ru','es','fr'].forEach(l=>{const j=require('./src/i18n/locales/'+l+'.json'); if(!j.freeze||!j.freeze.button) throw new Error('missing freeze in '+l); }); console.log('OK: freeze namespace present in all 4 locales')"
```
Expected: `OK: freeze namespace present in all 4 locales`.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/ru.json src/i18n/locales/es.json src/i18n/locales/fr.json
git commit -m "feat(i18n): freeze-game strings (EN/RU/ES/FR)"
```

---

## Task 6: PausedOverlay component + GameTable/BettingPhase wiring

**Files:**
- Create: `src/components/PausedOverlay.tsx`
- Modify: `src/screens/GameTableScreen.tsx`, `src/components/betting/BettingPhase.tsx`

This mirrors how the host-left banner is already wired into these screens
(`isHostAbsent` → `showHostLeftBanner`). Read those wiring points first:
`grep -n "showHostLeftBanner\|isHostAbsent\|HostLeftBanner" src/screens/GameTableScreen.tsx src/components/betting/BettingPhase.tsx`.

- [ ] **Step 1: Build the overlay component**

Create `src/components/PausedOverlay.tsx`:
```tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { Spacing, Radius, TextStyles } from '../constants';

export interface PausedOverlayProps {
  isHost: boolean;
  /** Lineup members not currently live — show "waiting for". */
  missingNames: string[];
  onResume: () => void;
  onKill: () => void;
  onToLobby: () => void;
}

export const PausedOverlay: React.FC<PausedOverlayProps> = ({
  isHost, missingNames, onResume, onKill, onToLobby,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const canResume = missingNames.length === 0;

  return (
    <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.78)' }]} testID="paused-overlay">
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
        <Text style={[styles.title, { color: colors.accent }]}>{t('freeze.pausedTitle')}</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{t('freeze.pausedBody')}</Text>
        {!canResume && (
          <Text style={[styles.waiting, { color: colors.textMuted }]}>
            {t('freeze.waitingFor', { names: missingNames.join(', ') })}
          </Text>
        )}
        {isHost && (
          <>
            <Pressable
              testID="btn-resume-game"
              disabled={!canResume}
              onPress={onResume}
              style={[styles.btnPrimary, { backgroundColor: canResume ? colors.accent : colors.surfaceSecondary }]}
            >
              <Text style={[styles.btnPrimaryText, { color: canResume ? '#fff' : colors.textMuted }]}>
                {canResume ? t('freeze.resume') : t('freeze.resumeDisabled')}
              </Text>
            </Pressable>
            <Pressable testID="btn-kill-game" onPress={onKill} style={styles.btnGhost}>
              <Text style={[styles.btnGhostText, { color: colors.error }]}>{t('freeze.kill')}</Text>
            </Pressable>
          </>
        )}
        <Pressable testID="btn-paused-to-lobby" onPress={onToLobby} style={styles.btnGhost}>
          <Text style={[styles.btnGhostText, { color: colors.textSecondary }]}>{t('freeze.toLobby')}</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: Spacing.lg },
  card: { width: '100%', maxWidth: 420, borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm },
  title: { ...TextStyles.h2, textAlign: 'center' },
  body: { ...TextStyles.body, textAlign: 'center' },
  waiting: { ...TextStyles.caption, textAlign: 'center', marginTop: Spacing.xs },
  btnPrimary: { paddingVertical: Spacing.sm, borderRadius: Radius.md, alignItems: 'center', marginTop: Spacing.sm },
  btnPrimaryText: { ...TextStyles.button },
  btnGhost: { paddingVertical: Spacing.sm, alignItems: 'center' },
  btnGhostText: { ...TextStyles.button },
});

export default PausedOverlay;
```
(If `TextStyles.h2`/`button` or `Radius.xl` don't exist, grep `src/constants` for the actual names and substitute — match what `PausedOverlay`'s sibling components use, e.g. `GlassCard`/`BrandSwitch`.)

- [ ] **Step 2: Add the Freeze button + overlay to GameTableScreen**

In `src/screens/GameTableScreen.tsx`:
- Import `PausedOverlay` and compute, alongside the existing `isHostAbsent` wiring:
```ts
const isPaused = room?.phase === 'paused';
const isHostViewer = !!room && !!myPlayerId && room.host_session_id === myPlayerId;
const pausedLineup = (room as any)?.paused_lineup as string[] | null | undefined;
const LIVE_MS = 30_000;
const missingNames = (pausedLineup ?? [])
  .filter((sid) => {
    const p = mpPlayers.find((x) => x.session_id === sid);
    return !p || (Date.now() - Date.parse(p.last_seen_at)) >= LIVE_MS;
  })
  .map((sid) => mpPlayers.find((x) => x.session_id === sid)?.display_name ?? '—');
```
- Render a **Freeze** control in the top bar when `isHostViewer && room?.phase === 'playing'` (place it beside the existing top-bar icon buttons; testID `btn-freeze-game`) that calls `await gameClient.pauseGame(room.id)`.
- When `isPaused`, render `<PausedOverlay isHost={isHostViewer} missingNames={missingNames} onResume={() => gameClient.resumeGame(room!.id)} onKill={() => gameClient.leaveRoom(room!.id)} onToLobby={onLeaveToLobby} />` above the table (the overlay is absolute-fill). `onLeaveToLobby` = the existing navigation that returns to the lobby/menu WITHOUT calling leave_room (reuse the screen's existing "go to lobby" navigation; the paused room is preserved server-side).

- [ ] **Step 3: Add the same to BettingPhase**

In `src/components/betting/BettingPhase.tsx`, mirror Step 2 using that file's room/players variables (`mpRoom`, `mpRoomPlayers`, `isViewerHost` already exist per the hostAbsent wiring). Render the Freeze control when host + `mpRoom.phase==='playing'`, and the `PausedOverlay` when `mpRoom.phase==='paused'`.

- [ ] **Step 4: Typecheck + lint testIDs**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -iE "PausedOverlay|GameTableScreen|BettingPhase" || echo "OK"
npm run test:lint -- --update-todo 2>&1 | tail -8
```
Expected: `OK`; test:lint lists the new testIDs (`btn-freeze-game`, `btn-resume-game`, `btn-kill-game`, `paused-overlay`, `btn-paused-to-lobby`) as uncovered (appended to TEST_TODO.md). Surface that to the user.

- [ ] **Step 5: Commit**

```bash
git add src/components/PausedOverlay.tsx src/screens/GameTableScreen.tsx src/components/betting/BettingPhase.tsx tests/TEST_TODO.md
git commit -m "feat(ui): freeze button + paused overlay on GameTable & BettingPhase"
```

---

## Task 7: Lobby paused indicator

**Files:**
- Modify: the lobby surface that already consumes `get_my_active_room` rejoin (grep to locate)

- [ ] **Step 1: Locate the active-room consumer**

Run:
```bash
grep -rn "get_my_active_room\|getMyActiveRoom\|activeRoom\|rejoin" src/screens src/components | grep -iv test | head
```
Identify the component that, on mount, reads the active room (the cross-device rejoin entry point). The lobby indicator lives there.

- [ ] **Step 2: Render the paused card**

When the active-room lookup returns `phase === 'paused'` with a `paused_at`, render a persistent card in the lobby:
```tsx
// time-left helper
const ttlMs = paused_at ? (Date.parse(paused_at) + 48 * 3600_000 - Date.now()) : 0;
const hh = Math.max(0, Math.floor(ttlMs / 3600_000));
const mm = Math.max(0, Math.floor((ttlMs % 3600_000) / 60_000));
// card
<Pressable testID="lobby-paused-card" onPress={() => /* navigate into the room */}>
  <Text>{t('freeze.lobbyCard', { code })}</Text>
  <Text>{t('freeze.autoCancelIn', { time: `${hh}ч ${mm}м` })}</Text>
</Pressable>
```
Wire `onPress` to the same navigation the rejoin flow uses to enter a room (reuse it). Do NOT block the Create/Join buttons — this card is purely informational. Use a 30–60s `setInterval` to refresh the countdown while mounted (clear on unmount).

- [ ] **Step 3: Typecheck + lint**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -i "lobby" || echo "OK"
npm run test:lint -- --update-todo 2>&1 | tail -4
```
Expected: `OK`; `lobby-paused-card` appended to TEST_TODO.md.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): lobby paused-room indicator with TTL countdown"
```

---

## Task 8: Smoke spec + full gate

**Files:**
- Create: `tests/smoke/freeze-game.spec.ts`

- [ ] **Step 1: Write the smoke spec**

Create `tests/smoke/freeze-game.spec.ts` modeled on `tests/smoke/chat-tooltip.spec.ts` (two guest contexts, a private room). Flow: host creates a 2-player room, guest joins, host starts the game, host taps `btn-freeze-game`, assert `paused-overlay` appears for both, assert a gameplay action is blocked (the play/bet controls are not actionable — e.g. tapping a card does nothing / the snapshot stays paused), then host taps `btn-resume-game` (both present) and assert the overlay disappears and play resumes. Use the `tests/fixtures/multiplayer.ts` helpers (`enterLobbyAsGuest`, `createRoomAsHost`, `joinRoomByCode`, `tap`, `exists`).
```ts
import { test, expect } from '@playwright/test';
import { ensureDevServer } from '../fixtures/smoke';
import { enterLobbyAsGuest, createRoomAsHost, joinRoomByCode, tap, exists } from '../fixtures/multiplayer';

const MOBILE_VP = {
  viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
} as const;

test.beforeAll(async () => { await ensureDevServer(); });

test.describe('freeze game', () => {
  test('host freezes -> overlay shown + play gated -> host resumes', async ({ browser }) => {
    const ctxA = await browser.newContext({ ...MOBILE_VP });
    const ctxB = await browser.newContext({ ...MOBILE_VP });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    try {
      await enterLobbyAsGuest(pageA);
      await enterLobbyAsGuest(pageB);
      const code = await createRoomAsHost(pageA, 2, 'alpha');
      await joinRoomByCode(pageB, code, 'bravo');
      // both ready + start (reuse the same helpers the other gameplay specs use;
      // if a startGame helper exists in fixtures, call it — otherwise tap ready
      // on both then the host's start control).
      // ... start the game ...
      await tap(pageA, 'btn-freeze-game', 10_000);
      expect(await exists(pageA, 'paused-overlay')).toBeTruthy();
      expect(await exists(pageB, 'paused-overlay')).toBeTruthy();
      // resume (both contexts are live)
      await tap(pageA, 'btn-resume-game', 10_000);
      expect(await exists(pageA, 'paused-overlay')).toBeFalsy();
    } finally {
      await ctxA.close(); await ctxB.close();
    }
  });
});
```
(Fill the "start the game" section using the existing fixtures — read `tests/fixtures/multiplayer.ts` for the start/ready helpers the other specs use; do not invent helper names.)

- [ ] **Step 2: Run the new spec (needs :8081 + local edge up)**

Run:
```bash
lsof -i :8081 >/dev/null 2>&1 && echo "8081 up" || echo "8081 DOWN — ask the user to start it"
HEADLESS=1 npx playwright test tests/smoke/freeze-game.spec.ts 2>&1 | tail -12
```
Expected: 1 passed. If `:8081` is down, surface to the user (don't start it).

- [ ] **Step 3: Full smoke gate**

Run:
```bash
npm run smoke 2>&1 | grep -E "passed|failed|Tests:|Test Suites:|orphan" | tail -15
```
Expected: jest + all smoke + desktop green; test:lint reports the new testIDs as uncovered (counter only, exit 0).

- [ ] **Step 4: Commit**

```bash
git add tests/smoke/freeze-game.spec.ts
git commit -m "test(smoke): host freeze -> overlay + gated play -> resume"
```

---

## Task 9: Finish the branch

- [ ] **Step 1: Surface testID coverage**

Mention to the user the new uncovered testIDs in `tests/TEST_TODO.md` (freeze/resume/kill buttons, paused overlay, lobby card) and that the smoke spec covers freeze→resume but not kill/TTL (manual/sanity).

- [ ] **Step 2: Invoke `superpowers:finishing-a-development-branch`**

Decide merge/PR with the user. Deploy notes to relay: the migration `20260531000000_host_freeze_game.sql` must reach prod via `supabase db push` (history is reconciled, push works), AND the `game-action` edge function must be redeployed (new actions + gate).

---

## Self-Review

- **Spec §1 (data model: paused phase, columns, get_my_active_room TTL clause + paused_at, get_room_state fields)** → Task 1. ✅
- **Spec §2 (pause_game/resume_game host-only, lineup-live resume, repeat-pause TTL reset)** → Task 2 (pause stamps `paused_at=now()` every call → TTL reset; resume checks 30s liveness for all lineup). ✅
- **Spec §3 (central pause gate)** → Task 3 Step 1. ✅
- **Spec §4 (leave/return: non-host holds seat, host abandons)** → Task 3 Step 2 (non-host paused short-circuit) + existing host-leave branch. ✅
- **Spec §5 (48h TTL: read side stops returning, resume converts to finished)** → Task 1 (get_my_active_room clause) + Task 2 resumeGame TTL branch. ✅
- **Spec §6 (snapshot carries paused_at/paused_lineup)** → Task 1 (get_room_state) + Task 3 Step 3 + Task 2 Step 1 (type). ✅
- **Spec §7 (Freeze button, paused overlay, lobby indicator, i18n, testIDs)** → Tasks 5–7. ✅
- **Spec §8 (testing: SQL verify, smoke freeze→gated→resume)** → Tasks 1/3 (psql) + Task 8 (smoke). ✅
- **Deploy notes (migration + edge redeploy)** → Task 9. ✅
- **v2 deferrals (bots/voting, seat restoration, host auto-promote)** → not in any task. ✅
- **Type consistency:** `pause_game`/`resume_game` kinds added to both `ActionKind` and `Action` (Task 2 Step 1), used identically in dispatch (Task 2 Step 4), gate set (Task 3), and gameClient (Task 4). `paused_at`/`paused_lineup` names identical across migration, types, snapshot, UI. `btn-freeze-game`/`btn-resume-game`/`btn-kill-game`/`paused-overlay`/`btn-paused-to-lobby`/`lobby-paused-card` testIDs consistent between Tasks 6/7 and Task 8. ✅
- **Placeholder note:** Tasks 6/7/8 contain a few "grep to locate the exact wiring point / reuse the existing navigation / read fixtures for the start helper" instructions. These are concrete, bounded lookups against named files (not vague "handle it") because the exact line depends on current file state; each names the file and the pattern to find. Implementers must read those files — flagged so reviewers verify the wiring matches the existing hostAbsent pattern.
