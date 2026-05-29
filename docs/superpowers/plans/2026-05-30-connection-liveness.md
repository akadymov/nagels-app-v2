# Connection Liveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `get_my_active_room` from resurrecting abandoned ("dead") rooms by introducing a single canonical "room is alive" liveness check derived from `last_seen_at`, and drop the dead `is_connected` column so the room snapshot stops lying.

**Architecture:** One new SQL migration adds a pure helper `public.room_is_alive(uuid)` (true iff any participant's `last_seen_at` is within 5 minutes), rewires `get_my_active_room` through it, then drops `room_players.is_connected` after redefining the two functions that touch it (`get_room_state`, `heartbeat`). A second wave removes the now-orphaned field from TypeScript types, one client component, one edge test fixture, and two stale comments.

**Tech Stack:** Supabase Postgres (PL/pgSQL + SQL functions), local Supabase stack (`supabase start`, psql on `127.0.0.1:54322`), TypeScript, Jest (TS units only — `testPathIgnorePatterns` excludes `/supabase/functions/`), Playwright smoke.

**Spec:** `docs/superpowers/specs/2026-05-30-connection-liveness-design.md`

**Testing note (read first):** The repo has **no** SQL/RPC test harness — Jest runs TS units only. So the SQL liveness logic is verified by a committed, transaction-wrapped `psql` script (seeds data, asserts, `ROLLBACK`s — zero side effects), not by Jest. The TS cleanup is covered by `tsc`, the existing Jest run, and a final `npm run smoke`. This is the honest fit for the toolchain; do not invent a fragile new harness.

**DB access on this host (IMPORTANT):** `psql` is NOT installed on the host — the local Postgres only exists inside the Supabase Docker container. Everywhere this plan shows `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" ...`, run it instead as:
```bash
docker exec -i supabase_db_nigels-app-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < <FILE.sql>   # for -f FILE
docker exec -i supabase_db_nigels-app-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL' ... SQL  # for heredoc
```
(The container path doesn't see host files, so use stdin `<`/heredoc, not `-f`.) Migration apply/replay uses the CLI, which works as written: `npx supabase migration up` and `npx supabase db reset`.

**Branch:** Work happens on `feat/connection-liveness` (already created; the design doc is committed there).

---

## File Structure

- **Create:** `supabase/migrations/20260530010000_connection_liveness.sql` — the whole DB change (helper + `get_my_active_room` + `get_room_state` + `heartbeat` + `DROP COLUMN`), in dependency-safe order.
- **Create:** `supabase/tests/room_is_alive_check.sql` — transactional verification script for the helper (manual, `psql`-run, `ROLLBACK`).
- **Modify:** `supabase/functions/_shared/types.ts` — drop `is_connected` from the `RoomSnapshot` player type.
- **Modify:** `src/lib/supabase/types.ts` — drop `is_connected` from `room_players` Row/Insert/Update.
- **Modify:** `src/components/betting/BettingPhase.tsx` — drop `is_connected` from the locally-built player object + its inline type.
- **Modify:** `supabase/functions/_shared/__tests__/push-transitions.test.ts` — drop `is_connected: true` from the fixture.
- **Modify (comments only):** `src/screens/GameTableScreen.tsx`, `src/lib/heartbeat.ts` — fix stale comments that describe `is_connected` as a drop-off signal.

---

## Task 1: Add `room_is_alive` helper + verification script

The canonical liveness predicate, extracted as a pure (no-auth) SQL function so it
is independently testable and reusable. 5-minute threshold per spec.

**Files:**
- Create: `supabase/migrations/20260530010000_connection_liveness.sql`
- Create: `supabase/tests/room_is_alive_check.sql`

- [ ] **Step 1: Confirm local Supabase is up (DB + edge runtime)**

Run:
```bash
npx supabase status | sed -n '1,6p'
curl -s -o /dev/null -w "edge: %{http_code}\n" -X OPTIONS http://127.0.0.1:54321/functions/v1/game-action --max-time 5
```
Expected: status lists APIs/DB (not "Stopped services: ... edge_runtime ..."), and `edge: 200`. If the DB is down, run `npx supabase start` first. (See the smoke-env gotcha: `.env.local` points `:8081` at this local stack.)

- [ ] **Step 2: Write the migration with the helper only (so far)**

Create `supabase/migrations/20260530010000_connection_liveness.sql` with exactly:
```sql
-- Connection liveness: a single source of truth for "is this room alive".
-- A room is alive iff any participant (player OR spectator) has a heartbeat
-- (last_seen_at) within the last 5 minutes. Heartbeat cadence is ~10s, so
-- 5 min ≈ 30 missed beats — well past brief blips / mobile background sleep.
-- Pure (reads only last_seen_at), SECURITY DEFINER, no auth.uid() dependency,
-- so it is callable from other RPCs and directly verifiable in psql.
CREATE OR REPLACE FUNCTION public.room_is_alive(p_room_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_players rp
     WHERE rp.room_id = p_room_id
       AND rp.last_seen_at > now() - INTERVAL '5 minutes'
    UNION ALL
    SELECT 1 FROM public.room_spectators rsp
     WHERE rsp.room_id = p_room_id
       AND rsp.last_seen_at > now() - INTERVAL '5 minutes'
  );
$$;

GRANT EXECUTE ON FUNCTION public.room_is_alive(uuid) TO anon, authenticated, service_role;
```

- [ ] **Step 3: Write the failing verification script**

Create `supabase/tests/room_is_alive_check.sql` with exactly:
```sql
-- Manual verification for public.room_is_alive. Run against local Supabase:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/room_is_alive_check.sql
-- Wrapped in a transaction that ROLLBACKs — no rows persist.
BEGIN;

-- Minimal seed: one auth user -> one room_session -> one room -> one player.
INSERT INTO auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000',
        '11111111-1111-1111-1111-111111111111',
        'authenticated', 'authenticated', 'livecheck@nigels.test',
        '', now(), now(), now());

INSERT INTO public.room_sessions (id, auth_user_id, display_name)
VALUES ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', 'LiveCheck');

INSERT INTO public.rooms (id, code, host_session_id, player_count, phase)
VALUES ('33333333-3333-3333-3333-333333333333', 'LIVE01',
        '22222222-2222-2222-2222-222222222222', 4, 'waiting');

INSERT INTO public.room_players (room_id, session_id, seat_index, last_seen_at)
VALUES ('33333333-3333-3333-3333-333333333333',
        '22222222-2222-2222-2222-222222222222', 0, now());

-- Fresh heartbeat -> alive.
DO $$
BEGIN
  IF public.room_is_alive('33333333-3333-3333-3333-333333333333') IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: fresh participant should be alive';
  END IF;
END $$;

-- Backdate heartbeat past 5 min -> dead.
UPDATE public.room_players
   SET last_seen_at = now() - INTERVAL '6 minutes'
 WHERE room_id = '33333333-3333-3333-3333-333333333333';

DO $$
BEGIN
  IF public.room_is_alive('33333333-3333-3333-3333-333333333333') IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: stale-only participant should be dead';
  END IF;
END $$;

SELECT 'PASS: room_is_alive liveness thresholds correct' AS result;

ROLLBACK;
```

- [ ] **Step 4: Run the script BEFORE applying the migration — verify it fails**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/room_is_alive_check.sql
```
Expected: FAIL — `function public.room_is_alive(uuid) does not exist` (migration not applied yet). This proves the script actually exercises the new function.

- [ ] **Step 5: Apply the migration to local**

Run:
```bash
npx supabase migration up
```
Expected: applies `20260530010000_connection_liveness.sql` with no error. (If `migration up` reports drift, use `npx supabase db push --local` per the repo's usual flow.)

- [ ] **Step 6: Run the verification script — verify it passes**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/room_is_alive_check.sql
```
Expected: prints `PASS: room_is_alive liveness thresholds correct`, then `ROLLBACK`. If a NOT NULL on `auth.users`/`rooms`/`room_sessions` complains, add the missing column to the matching INSERT (do not weaken the assertions).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260530010000_connection_liveness.sql supabase/tests/room_is_alive_check.sql
git commit -m "feat(db): add room_is_alive liveness helper + verification script"
```

---

## Task 2: Route `get_my_active_room` through `room_is_alive`

One-line guard in both selection branches so a dead room is never returned.

**Files:**
- Modify: `supabase/migrations/20260530010000_connection_liveness.sql` (append the redefinition)
- Reference (current body to preserve): `supabase/migrations/20260526010000_get_my_active_room.sql`

- [ ] **Step 1: Append the redefined `get_my_active_room` to the migration**

Append to `supabase/migrations/20260530010000_connection_liveness.sql`:
```sql
-- Liveness-aware active-room lookup: never resurrect a dead room.
-- Identical to 20260526010000_get_my_active_room.sql except each room-selection
-- branch now also requires public.room_is_alive(r.id). An abandoned waiting room
-- the caller hosted and left for >5 min is intentionally treated as dead.
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

  SELECT r.id AS room_id, r.phase, r.code, 'player' AS role
    INTO v_row
  FROM public.rooms r
  JOIN public.room_players rp ON rp.room_id = r.id
  WHERE rp.session_id = v_sid
    AND r.phase <> 'finished'
    AND public.room_is_alive(r.id)
  ORDER BY
    CASE r.phase WHEN 'playing' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END,
    r.updated_at DESC
  LIMIT 1;

  IF v_row.room_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'room_id', v_row.room_id,
      'code',    v_row.code,
      'phase',   v_row.phase,
      'role',    v_row.role
    );
  END IF;

  SELECT r.id AS room_id, r.phase, r.code, 'spectator' AS role
    INTO v_row
  FROM public.rooms r
  JOIN public.room_spectators rsp ON rsp.room_id = r.id
  WHERE rsp.session_id = v_sid
    AND r.phase <> 'finished'
    AND public.room_is_alive(r.id)
  ORDER BY r.updated_at DESC
  LIMIT 1;

  IF v_row.room_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'room_id', v_row.room_id,
      'code',    v_row.code,
      'phase',   v_row.phase,
      'role',    v_row.role
    );
  END IF;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_active_room() TO authenticated;
```

- [ ] **Step 2: Re-apply the migration locally**

Run:
```bash
npx supabase migration up
```
Expected: no error. (If already applied, use `npx supabase db push --local`, or `npx supabase db reset` to replay cleanly from scratch — `db reset` is safe locally.)

- [ ] **Step 3: Manually verify the wrapper end-to-end (alive room still returned)**

Run this transactional check (seeds a *fresh* player, asserts the room IS returned for that user via the function's auth path is not exercised here — we assert the SQL join+liveness path returns the row):
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000','44444444-4444-4444-4444-444444444444','authenticated','authenticated','aw@nigels.test','',now(),now(),now());
INSERT INTO public.room_sessions (id, auth_user_id, display_name)
VALUES ('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','AW');
INSERT INTO public.rooms (id, code, host_session_id, player_count, phase, updated_at)
VALUES ('66666666-6666-6666-6666-666666666666','AW0001','55555555-5555-5555-5555-555555555555',4,'playing',now());
INSERT INTO public.room_players (room_id, session_id, seat_index, last_seen_at)
VALUES ('66666666-6666-6666-6666-666666666666','55555555-5555-5555-5555-555555555555',0,now());
-- alive room: join+liveness path yields the row
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rooms r JOIN public.room_players rp ON rp.room_id=r.id
                 WHERE rp.session_id='55555555-5555-5555-5555-555555555555'
                   AND r.phase<>'finished' AND public.room_is_alive(r.id))
  THEN RAISE EXCEPTION 'FAIL: alive room should be selectable'; END IF;
END $$;
-- now stale: same path yields nothing
UPDATE public.room_players SET last_seen_at = now() - INTERVAL '6 minutes'
 WHERE room_id='66666666-6666-6666-6666-666666666666';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.rooms r JOIN public.room_players rp ON rp.room_id=r.id
             WHERE rp.session_id='55555555-5555-5555-5555-555555555555'
               AND r.phase<>'finished' AND public.room_is_alive(r.id))
  THEN RAISE EXCEPTION 'FAIL: dead room must not be selectable'; END IF;
END $$;
SELECT 'PASS: get_my_active_room liveness guard correct' AS result;
ROLLBACK;
SQL
```
Expected: `PASS: get_my_active_room liveness guard correct`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260530010000_connection_liveness.sql
git commit -m "feat(db): get_my_active_room skips dead rooms via room_is_alive"
```

---

## Task 3: Drop the dead `is_connected` column

Redefine the two functions that reference it, THEN drop the column. Order matters —
the `DROP COLUMN` must come after the functions no longer name it.

**Files:**
- Modify: `supabase/migrations/20260530010000_connection_liveness.sql` (append)
- Reference (current `get_room_state` body, lines 50–167): `supabase/migrations/20260523000000_conditional_stakes.sql`
- Reference (current `heartbeat` body): `supabase/migrations/20260516185139_remote_schema_baseline.sql`

- [ ] **Step 1: Final safety grep — confirm nothing else writes is_connected**

Run:
```bash
grep -rn "is_connected" supabase/migrations/ supabase/functions/ | grep -v "migrations.legacy" | grep -viE "'is_connected', rp.is_connected|is_connected = true|is_connected boolean|is_connected: boolean|is_connected', rp.is_connected"
```
Expected: no INSERT or other write site beyond the snapshot read (`get_room_state`), the `heartbeat` SET, the column DDL, and the type. If a new write site appears, add a matching redefinition before proceeding.

- [ ] **Step 2: Append redefined `get_room_state` (current body minus one line)**

Open `supabase/migrations/20260523000000_conditional_stakes.sql`, copy the **entire** `CREATE OR REPLACE FUNCTION public.get_room_state(...)` block (lines 50–167, through its closing `$$;`) and append it to `20260530010000_connection_liveness.sql`. Then delete the single line inside the `players` CTE:
```sql
      'is_connected', rp.is_connected,
```
Add a one-line comment above the appended block:
```sql
-- Redefine get_room_state without the dropped is_connected field (snapshot honesty).
```
Do not change anything else in the copied body. Keep the trailing `GRANT EXECUTE ON FUNCTION public.get_room_state(uuid) TO anon, authenticated;` (copy it too).

- [ ] **Step 3: Append redefined `heartbeat` (drop the is_connected SET)**

Append to the migration:
```sql
-- Redefine heartbeat without writing the dropped is_connected column.
CREATE OR REPLACE FUNCTION public.heartbeat(p_room_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_session_id uuid;
BEGIN
  SELECT id INTO v_session_id
    FROM public.room_sessions
   WHERE auth_user_id = auth.uid()
   LIMIT 1;
  IF v_session_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.room_players
     SET last_seen_at = now()
   WHERE room_id    = p_room_id
     AND session_id = v_session_id;

  UPDATE public.room_spectators
     SET last_seen_at = now()
   WHERE room_id    = p_room_id
     AND session_id = v_session_id;

  RETURN v_session_id;
END;
$$;
```

- [ ] **Step 4: Append the column drop (last)**

Append to the migration:
```sql
-- Drop the dead column: always true, set by heartbeat, never read by any
-- consumer, never set false. Functions above no longer reference it.
ALTER TABLE public.room_players DROP COLUMN is_connected;
```

- [ ] **Step 5: Replay migrations cleanly and re-run all verification**

Run:
```bash
npx supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/room_is_alive_check.sql
```
Expected: `db reset` replays every migration (including the new one) with no error, and the verification script still prints `PASS`. A clean `db reset` proves the migration applies on top of the full chain and that `DROP COLUMN` doesn't break `get_room_state`/`heartbeat`.

- [ ] **Step 6: Sanity-call get_room_state shape (no is_connected key)**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000','77777777-7777-7777-7777-777777777777','authenticated','authenticated','gs@nigels.test','',now(),now(),now());
INSERT INTO public.room_sessions (id, auth_user_id, display_name)
VALUES ('88888888-8888-8888-8888-888888888888','77777777-7777-7777-7777-777777777777','GS');
INSERT INTO public.rooms (id, code, host_session_id, player_count, phase)
VALUES ('99999999-9999-9999-9999-999999999999','GS0001','88888888-8888-8888-8888-888888888888',4,'waiting');
INSERT INTO public.room_players (room_id, session_id, seat_index, last_seen_at)
VALUES ('99999999-9999-9999-9999-999999999999','88888888-8888-8888-8888-888888888888',0,now());
DO $$
DECLARE v jsonb;
BEGIN
  v := public.get_room_state('99999999-9999-9999-9999-999999999999');
  IF (v->'players'->0) ? 'is_connected' THEN
    RAISE EXCEPTION 'FAIL: snapshot still carries is_connected';
  END IF;
  IF NOT ((v->'players'->0) ? 'last_seen_at') THEN
    RAISE EXCEPTION 'FAIL: snapshot lost last_seen_at';
  END IF;
END $$;
SELECT 'PASS: get_room_state shape clean' AS result;
ROLLBACK;
SQL
```
Expected: `PASS: get_room_state shape clean`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260530010000_connection_liveness.sql
git commit -m "feat(db): drop dead is_connected column; redefine get_room_state + heartbeat"
```

---

## Task 4: Remove `is_connected` from TypeScript + edge fixture

Now that the snapshot no longer carries the field, delete it everywhere it is named so `tsc` and Jest stay honest.

**Files:**
- Modify: `supabase/functions/_shared/types.ts:77`
- Modify: `src/lib/supabase/types.ts` (room_players Row/Insert/Update — lines ~199, 207, 215)
- Modify: `src/components/betting/BettingPhase.tsx:111,156`
- Modify: `supabase/functions/_shared/__tests__/push-transitions.test.ts:19`
- Modify (comments): `src/screens/GameTableScreen.tsx:154`, `src/lib/heartbeat.ts:3`

- [ ] **Step 1: Delete the field from the snapshot player type**

In `supabase/functions/_shared/types.ts`, remove the line:
```ts
    is_connected: boolean;
```
(from the `RoomSnapshot` players array element type, ~line 77).

- [ ] **Step 2: Delete from generated DB types**

In `src/lib/supabase/types.ts`, remove the three `is_connected` lines from the `room_players` table type:
```ts
          is_connected: boolean
```
(Row, ~line 199) and:
```ts
          is_connected?: boolean
```
(Insert ~line 207 and Update ~line 215).

- [ ] **Step 3: Delete from the BettingPhase local player object + inline type**

In `src/components/betting/BettingPhase.tsx`, remove `is_connected: true,` from the locally-constructed player object (~line 111) and `is_connected: boolean;` from the inline type (~line 156). Leave the surrounding `is_ready` / `last_seen_at` fields untouched.

- [ ] **Step 4: Delete from the edge test fixture**

In `supabase/functions/_shared/__tests__/push-transitions.test.ts`, remove `is_connected: true,` from the fixture object (~line 19), keeping `is_ready: true` and `last_seen_at` intact.

- [ ] **Step 5: Fix the two stale comments**

In `src/screens/GameTableScreen.tsx` (~line 153-154), change the heartbeat comment so it no longer claims is_connected is read:
```ts
  // Mark this player online (last_seen_at = now()) every 10s. Other clients
  // derive drop-offs from room_players.last_seen_at via the snapshot.
```
In `src/lib/heartbeat.ts` (~line 3), change:
```ts
 * so room_players.last_seen_at stays fresh.
```

- [ ] **Step 6: Typecheck the changed TS (no is_connected errors)**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -iE "is_connected|BettingPhase|supabase/types|_shared/types" || echo "OK: no is_connected type errors"
```
Expected: `OK: no is_connected type errors`. (Pre-existing Deno-function tsc errors are unrelated — do not chase them.)

- [ ] **Step 7: Run the Jest unit suite (covers the edge fixture)**

Run:
```bash
npm run test:unit 2>&1 | tail -5
```
Expected: all suites pass (the `push-transitions` fixture edit must not break its assertions).

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/types.ts src/lib/supabase/types.ts src/components/betting/BettingPhase.tsx supabase/functions/_shared/__tests__/push-transitions.test.ts src/screens/GameTableScreen.tsx src/lib/heartbeat.ts
git commit -m "refactor: remove is_connected from types, betting view, fixture, comments"
```

---

## Task 5: Full smoke gate + wrap-up

**Files:** none (verification only)

- [ ] **Step 1: Confirm `:8081` dev server + local edge runtime are up**

Run:
```bash
lsof -i :8081 >/dev/null 2>&1 && echo "8081 up" || echo "8081 DOWN — ask the user to start it"
curl -s -o /dev/null -w "edge: %{http_code}\n" -X OPTIONS http://127.0.0.1:54321/functions/v1/game-action --max-time 5
```
Expected: `8081 up` and `edge: 200`. If `:8081` is down, surface it to the user — do not start it for them (per CLAUDE.md). The dev server must have re-bundled the `is_connected`-free client; if it was running before Task 4, ask the user to confirm Metro picked up the changes (Expo hot-reloads, but a restart is the safe call).

- [ ] **Step 2: Run the full smoke suite**

Run:
```bash
npm run smoke 2>&1 | grep -E "passed|failed|Tests:|Test Suites:" | tail -20
```
Expected: jest 68+ pass, 12 smoke pass, 2 desktop pass, `test:lint` no orphans. The room-creating specs (`chat-tooltip`, `stakes-waitingroom`) exercise `get_room_state` end-to-end — they passing confirms the snapshot shape change is safe.

- [ ] **Step 3: Update memory with the dropped-column fact (if it surfaces confusion later)**

No action unless smoke surfaces a regression. If green, note in the final user message that the migration `20260530010000_connection_liveness.sql` plus the earlier `20260530000000_revoke_switch_role_anon.sql` both need applying to prod (`supabase db push` / CI).

- [ ] **Step 4: Finish the branch**

Invoke the `superpowers:finishing-a-development-branch` skill to decide merge/PR/cleanup with the user. Do not fast-forward to `main` without explicit user direction (per the no-force-push / integration memory).

---

## Self-Review

- **Spec §1 (liveness definition)** → Task 1 (`room_is_alive`, 5-min). ✅
- **Spec §2 (get_my_active_room guard)** → Task 2. ✅
- **Spec §3 (drop is_connected: get_room_state, heartbeat, ALTER)** → Task 3. ✅
- **Spec §3 client cleanup (types, BettingPhase, fixture, comments)** → Task 4. ✅
- **Spec §4 testing (local SQL verify + smoke green)** → Tasks 1/2/3 (psql scripts) + Task 5 (smoke). ✅
- **Spec deploy notes (two migrations to prod, no edge deploy)** → Task 5 Step 3. ✅
- **Out-of-scope items (ghosts, auto-close, threshold unification)** → not present in any task. ✅
- **Type consistency:** `room_is_alive(uuid)` defined Task 1, called identically Tasks 2 & 3. `get_room_state(uuid)`, `heartbeat(uuid)`, `get_my_active_room()` signatures unchanged. ✅
- **Placeholder scan:** no TBD/TODO; every code step shows full content; the one "copy the current body" step (Task 3 Step 2) names an exact file + line range + the single line to delete, which is concrete, not a placeholder. ✅
