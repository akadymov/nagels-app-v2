# Testing strategy — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `silent` flag to room creation (suppresses Telegram broadcast) and reorganize the existing Playwright test into the new `tests/e2e/` layout — without changing production behavior or breaking the current `npm run test:sp` run.

**Architecture:** Two strictly-isolated changes. (1) Edge-function side: extend the `create_room` action type with `silent?: boolean`, gate `notifyNewRoom` through a tiny pure helper that has Deno unit tests. (2) Test-suite side: move `tests/sp-game.spec.js` to `tests/e2e/sp-game.spec.js` (no TS conversion in this phase to keep diff minimal), update `playwright.config.js` and the `test:sp` npm script accordingly. Adds a `tests/README.md` to anchor the directory layout for upcoming phases.

**Tech Stack:** Supabase Edge Functions (Deno), Playwright (Node), TypeScript on the edge side, JS on the existing Playwright spec.

Reference spec: `docs/superpowers/specs/2026-05-16-testing-strategy-design.md` (the section "silent: true flag — production change" and the "Rollout phases — Phase 1").

---

## File Structure

**Created:**
- `supabase/functions/_shared/__tests__/createRoom.test.ts` — Deno tests for the new helper
- `tests/e2e/sp-game.spec.js` — moved from `tests/sp-game.spec.js`, no content change
- `tests/README.md` — anchor doc explaining the four-tier layout (rest of dirs come in later phases)

**Modified:**
- `supabase/functions/_shared/types.ts` — add `silent?: boolean` to `create_room` action variant
- `supabase/functions/game-action/actions/createRoom.ts` — export `shouldSendRoomNotification` helper, gate `notifyNewRoom` through it
- `playwright.config.js` — `testDir: './tests/e2e'`, `testMatch: '**/*.spec.{js,ts}'`
- `package.json` — `test:sp` and `test:sp:prod` scripts point at the new path

**Deleted:**
- `tests/sp-game.spec.js` (moved, not deleted in content sense — `git mv` preserves history)

---

## Task 1: Add `silent` to the `create_room` Action type

**Files:**
- Modify: `supabase/functions/_shared/types.ts:9`

- [ ] **Step 1: Open the types file and locate the `create_room` variant**

The current line 9 reads:
```ts
  | { kind: 'create_room'; player_count: number; max_cards?: number; display_name: string }
```

- [ ] **Step 2: Add `silent?: boolean` after `display_name: string`**

Replace line 9 with:
```ts
  | { kind: 'create_room'; player_count: number; max_cards?: number; display_name: string; silent?: boolean }
```

- [ ] **Step 3: Type-check the edge functions**

Run: `cd supabase/functions && deno check _shared/types.ts game-action/actions/createRoom.ts`

Expected: no errors (the new field is optional, so existing callers stay valid).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/types.ts
git commit -m "feat(types): add optional silent flag to create_room action

Used by tests (and future silent-room features) to suppress the
Telegram broadcast. Optional — production callers unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: TDD — `shouldSendRoomNotification` helper

**Files:**
- Create: `supabase/functions/_shared/__tests__/createRoom.test.ts`
- Modify: `supabase/functions/game-action/actions/createRoom.ts` (add export)

- [ ] **Step 1: Write the failing test file**

Create `supabase/functions/_shared/__tests__/createRoom.test.ts` with this exact content:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { shouldSendRoomNotification } from '../../game-action/actions/createRoom.ts';

const base = {
  kind: 'create_room' as const,
  player_count: 4,
  display_name: 'Akula',
};

Deno.test('shouldSendRoomNotification returns true when silent is omitted', () => {
  assertEquals(shouldSendRoomNotification(base), true);
});

Deno.test('shouldSendRoomNotification returns true when silent is false', () => {
  assertEquals(shouldSendRoomNotification({ ...base, silent: false }), true);
});

Deno.test('shouldSendRoomNotification returns false when silent is true', () => {
  assertEquals(shouldSendRoomNotification({ ...base, silent: true }), false);
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `cd supabase/functions && deno test _shared/__tests__/createRoom.test.ts --allow-all`

Expected: import error or "shouldSendRoomNotification is not defined / not exported".

- [ ] **Step 3: Add the helper to `createRoom.ts`**

Open `supabase/functions/game-action/actions/createRoom.ts`. After the `emptySnapshot()` function (around line 24) and before `export async function createRoom`, add this exported helper:

```ts
/**
 * Decide whether room creation should fire the Telegram new-room
 * notification. Off when the caller passes silent: true (tests, future
 * silent-room features). Off-by-default for new callers; default
 * behavior (no flag set) stays the same as before — notification on.
 */
export function shouldSendRoomNotification(
  action: Extract<Action, { kind: 'create_room' }>,
): boolean {
  return action.silent !== true;
}
```

- [ ] **Step 4: Re-run the test, expect pass**

Run: `cd supabase/functions && deno test _shared/__tests__/createRoom.test.ts --allow-all`

Expected output (all three tests pass):
```
running 3 tests from ./_shared/__tests__/createRoom.test.ts
shouldSendRoomNotification returns true when silent is omitted ... ok
shouldSendRoomNotification returns true when silent is false ... ok
shouldSendRoomNotification returns false when silent is true ... ok

ok | 3 passed | 0 failed
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/__tests__/createRoom.test.ts \
        supabase/functions/game-action/actions/createRoom.ts
git commit -m "test(createRoom): pin shouldSendRoomNotification helper

Tiny pure helper that decides whether to emit the Telegram broadcast.
Three Deno tests cover omitted / false / true. Wiring into createRoom
itself lands in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Gate `notifyNewRoom` through the helper

**Files:**
- Modify: `supabase/functions/game-action/actions/createRoom.ts:94-102`

- [ ] **Step 1: Replace the unconditional notify call with the gated version**

Locate this block (around lines 94–102):

```ts
  // Fire-and-forget Telegram notification. notifyNewRoom never throws —
  // a bad token, missing chat id, or TG outage cannot block room creation.
  // Awaited only so the AbortController inside sendTelegram has time to
  // run before the edge-function request context is torn down.
  await notifyNewRoom({
    hostName: actor.display_name,
    roomCode: inserted.code,
    appOrigin: Deno.env.get('PUBLIC_APP_ORIGIN') ?? 'https://nigels.online',
  });
```

Replace with:

```ts
  // Fire-and-forget Telegram notification. notifyNewRoom never throws —
  // a bad token, missing chat id, or TG outage cannot block room creation.
  // Awaited only so the AbortController inside sendTelegram has time to
  // run before the edge-function request context is torn down. Tests
  // (and future silent-room features) pass silent: true to bypass.
  if (shouldSendRoomNotification(action)) {
    await notifyNewRoom({
      hostName: actor.display_name,
      roomCode: inserted.code,
      appOrigin: Deno.env.get('PUBLIC_APP_ORIGIN') ?? 'https://nigels.online',
    });
  }
```

- [ ] **Step 2: Type-check the file**

Run: `cd supabase/functions && deno check game-action/actions/createRoom.ts`

Expected: no errors.

- [ ] **Step 3: Re-run the unit tests to confirm nothing broke**

Run: `cd supabase/functions && deno test _shared/__tests__/createRoom.test.ts --allow-all`

Expected: 3 passed, 0 failed (unchanged from Task 2).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/game-action/actions/createRoom.ts
git commit -m "feat(createRoom): gate Telegram notify through silent flag

Production callers (no flag set) keep getting the broadcast.
Test fixtures and future silent-room features pass silent: true.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Create the `tests/e2e/` layout and move the SP spec

**Files:**
- Create: `tests/e2e/` (directory)
- Move: `tests/sp-game.spec.js` → `tests/e2e/sp-game.spec.js`

- [ ] **Step 1: Create the new directory**

Run:
```bash
mkdir -p tests/e2e tests/smoke tests/scenario tests/fixtures tests/playwright
```

(Empty `smoke/`, `scenario/`, `fixtures/`, `playwright/` are placeholders — populated in later phases. We create them now so the README in Task 7 has real paths to point at.)

- [ ] **Step 2: Move the spec via `git mv` to preserve history**

Run:
```bash
git mv tests/sp-game.spec.js tests/e2e/sp-game.spec.js
```

- [ ] **Step 3: Verify the file is at the new path**

Run: `ls tests/e2e/sp-game.spec.js && test ! -f tests/sp-game.spec.js && echo OK`

Expected: prints the file path followed by `OK`.

- [ ] **Step 4: Commit the move (no other changes yet)**

```bash
git commit -m "test: move sp-game.spec.js into tests/e2e/

Step 1 of the four-tier test reorganization (unit / smoke / scenario /
end-to-end). Config + npm script paths follow in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Update `playwright.config.js` — narrow testDir, scaffold projects

**Files:**
- Modify: `playwright.config.js`

- [ ] **Step 1: Update `testDir`, `testMatch`, add `projects` scaffold**

Open `playwright.config.js`. Locate this block (around line 27):

```js
module.exports = {
  testDir: './tests',
  testMatch: '**/*.spec.js',
  // A full Hard-bot game can take ~3-6 minutes per hand × 20 hands.
  // We cap each test at 12 minutes so a stuck game fails fast rather
  // than blocking CI.
  timeout: 12 * 60 * 1000,
```

Replace with:

```js
module.exports = {
  // Per-project `testDir` lives below. The top-level `testMatch`
  // applies to every project. `testMatch` widens to .ts so future
  // phase specs need no further config.
  testMatch: '**/*.spec.{js,ts}',
  // A full Hard-bot game can take ~3-6 minutes per hand × 20 hands.
  // We cap each test at 12 minutes so a stuck game fails fast rather
  // than blocking CI.
  timeout: 12 * 60 * 1000,
```

Then locate the `use:` block (around line 40). Just before the final `};` closing the module.exports object, add a `projects` array. Find:

```js
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
};
```

Replace with:

```js
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // Phase 1 ships with just the e2e project. smoke / scenario
    // projects are added in Phase 4 / Phase 5.
    { name: 'e2e', testDir: './tests/e2e' },
  ],
};
```

- [ ] **Step 2: Sanity-check the config parses and lists the project**

Run: `node -e "const c = require('./playwright.config.js'); console.log(c.projects.map(p => p.name + ':' + p.testDir).join(' '));"`

Expected output: `e2e:./tests/e2e`

- [ ] **Step 3: Confirm Playwright finds the test under the new layout**

Run: `npx playwright test --list`

Expected: the listing shows one test, located in `tests/e2e/sp-game.spec.js`, under project `e2e`. No "no tests found" error.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.js
git commit -m "test(playwright): scaffold projects array with single e2e entry

Top-level testDir removed; each project owns its testDir. Phase 4 +
Phase 5 will add smoke / scenario projects without touching the rest
of the config. testMatch widened to .spec.{js,ts}.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Update `package.json` test scripts

**Files:**
- Modify: `package.json` (the `scripts` block — `test:sp` and `test:sp:prod`)

- [ ] **Step 1: Update the two `test:sp*` entries**

Open `package.json`. Locate these two lines:

```json
    "test:sp": "playwright test tests/sp-game.spec.js",
    "test:sp:prod": "DEMO_URL=$APP_URL playwright test tests/sp-game.spec.js"
```

Replace with:

```json
    "test:sp": "playwright test tests/e2e/sp-game.spec.js",
    "test:sp:prod": "DEMO_URL=$APP_URL playwright test tests/e2e/sp-game.spec.js"
```

- [ ] **Step 2: Validate JSON parses**

Run: `node -e "console.log(require('./package.json').scripts['test:sp'])"`

Expected: `playwright test tests/e2e/sp-game.spec.js`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "test(scripts): update test:sp paths to tests/e2e/

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Add `tests/README.md` describing the layout

**Files:**
- Create: `tests/README.md`

- [ ] **Step 1: Write the README**

Create `tests/README.md` with this exact content:

```markdown
# Tests

Four-tier test suite for Nägels Online. Each tier targets a different
class of regression. See the design spec for full rationale:
`docs/superpowers/specs/2026-05-16-testing-strategy-design.md`.

## Layout

```
tests/
├── playwright/   — global-setup / global-teardown (Phase 2)
├── fixtures/     — seedGame, players, action helpers  (Phase 3+)
├── smoke/        — cold-start UI checks               (Phase 4)
├── scenario/     — state-seeded mid/end-game UI       (Phase 5)
└── e2e/          — full playthroughs, multi-context   (Phase 6)
```

Plus:

- `src/__tests__/`                          — frontend unit (Jest)
- `supabase/functions/_shared/__tests__/`   — edge-function unit (Deno)

## Status (Phase 1 — Foundation)

- ✅ `tests/e2e/sp-game.spec.js` — single-player vs Hard bots, full game
  to scoreboard. Run: `npm run test:sp`.
- ✅ Edge-function unit tests: `cd supabase/functions && deno test --allow-all`
- ⏳ Smoke / scenario / multi-context layers — upcoming phases.

## Running

```bash
npm run test:sp           # SP e2e, mobile viewport, headed by default
npm run test:sp:prod      # same but against $APP_URL (production)
```

Edge-function tests (run separately for now — orchestrator in Phase 7):

```bash
cd supabase/functions && deno test --allow-all
```

## Conventions

- All test fixtures create rooms with `silent: true` so the Telegram
  channel is not spammed during runs. See `createRoom` action type
  (`silent?: boolean`).
- Test artifacts are tagged `test_<runId>_*` to allow easy cleanup and
  manual debug after failures.
```

- [ ] **Step 2: Commit**

```bash
git add tests/README.md
git commit -m "docs(tests): describe the four-tier layout

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: End-to-end verification

**Files:** none modified — pure verification step.

- [ ] **Step 1: Start the existing dev server in another terminal**

In a separate terminal (so it stays alive for the test), run:
```bash
npx expo start --port 8081
```

Wait until the bundler prints "Waiting on http://localhost:8081".

(If the user already has the dev server running, skip this step.)

- [ ] **Step 2: Run the moved SP test**

In this terminal:
```bash
npm run test:sp
```

Expected: the test launches a headed Chromium window, plays a full
SP game vs Hard bots (4 players default), and ends with
`scoreboard-winner-banner` visible. Console reports "1 passed".

If the test fails:
- Confirm dev server is reachable: `curl -I http://localhost:8081`
- Confirm `testDir` resolves correctly: `node -e "console.log(require('./playwright.config.js').testDir)"`
- The test itself has a 12-minute timeout. If it stalls earlier, the
  watchdog in the spec dumps visible testIDs to the console.

- [ ] **Step 3: Run the edge-function unit tests**

```bash
cd supabase/functions && deno test --allow-all
```

Expected: includes the 3 `createRoom.test.ts` tests plus the existing
`telegram.test.ts`, `push-i18n.test.ts`, `push-transitions.test.ts` —
total ≥ 14 tests, all green.

- [ ] **Step 4: Kill the dev server**

In the dev-server terminal: `Ctrl+C`. (CLAUDE.md memory rule —
no stale background processes.)

- [ ] **Step 5: Verify no leaked state**

Run: `git status`

Expected: clean working tree apart from the usual `supabase/.temp/*`
and `test-results/` ignores. No unexpected modified files.

---

## Phase 1 done when

- All 8 tasks committed.
- `npm run test:sp` passes against `tests/e2e/sp-game.spec.js`.
- `cd supabase/functions && deno test --allow-all` passes including the
  3 new `createRoom.test.ts` cases.
- Production rooms still emit the Telegram broadcast (no client code
  passes `silent: true` yet — verified by inspection of the UI room
  creation flow if needed).
- The `tests/{smoke,scenario,fixtures,playwright}/` directories exist
  and are empty, ready for Phase 2.

Phase 2 plan (Local Supabase + isolated Expo on :8082) is written
**after** Phase 1 ships green.
