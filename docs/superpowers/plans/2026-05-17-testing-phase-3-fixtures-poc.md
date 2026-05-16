# Testing strategy — Phase 3 (Fixtures + POC scenario) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the scenario-tier mechanism end-to-end with `tests/scenario/notrump-deal.spec.ts` — UI-drives the SP game to hand 5 (no-trump), asserts the dealt state, runs in ~3-4 min. Extract reusable click helpers from `sp-game.spec.js` into `tests/fixtures/actions.ts` along the way. Zero production-code changes.

**Architecture:** UI-driven seed mirrors the same tick loop that `sp-game.spec.js` uses for a full 22-min game — just trimmed to "reach hand 5, then return". The new helper `seedScenario(page, 'notrump-hand-5')` clicks Quick Match, dismisses modals, and loops `tryBet` / `tryPlay` (which become no-ops when not the human's turn) until the hand-5 betting UI is visible. The existing e2e spec is refactored to import the extracted helpers — behavior byte-identical.

**Tech Stack:** Playwright Test, TypeScript fixtures, existing `LOCAL_SUPABASE=1` Phase 2 plumbing (no changes), no Supabase, no React Native code changes.

Reference spec: `docs/superpowers/specs/2026-05-17-testing-phase-3-fixtures-design.md`.

Phase 2 plan (shipped): `docs/superpowers/plans/2026-05-16-testing-phase-2-local-supabase.md`.

---

## File Structure

**Created:**
- `tests/fixtures/actions.ts` — extracted helpers (`sleep`, `tap`, `exists`, `dismissTipIfAny`, `dismissPwaModalIfAny`, `tryBet`, `tryPlay`). Named exports.
- `tests/fixtures/seed.ts` — `seedScenario(page, scenario)`. Calls the actions in a tick loop until the requested state is visible.
- `tests/scenario/notrump-deal.spec.ts` — POC spec.

**Modified:**
- `tests/e2e/sp-game.spec.js` — replace the inline helper block (lines ~30-179) with a single `require('../fixtures/actions')` import; update `tryBet` call sites to pass `PLAYERS` as the new second argument.
- `playwright.config.js` — add `scenario` project.
- `package.json` — add `test:scenario:local` script.
- `tests/README.md` — flip scenario row to ✅, document the new helper.

**Untouched:**
- All `src/`, `supabase/`, `tests/playwright/` (global-setup / global-teardown / local-backend).

---

## Task 1: Extract helpers into `tests/fixtures/actions.ts`

**Files:**
- Create: `tests/fixtures/actions.ts`

- [ ] **Step 1: Create the file**

Create `tests/fixtures/actions.ts` with this exact content:

```ts
'use strict';

/**
 * Reusable click / poll helpers for Playwright specs that exercise the
 * React Native Web build. Extracted from tests/e2e/sp-game.spec.js so
 * the upcoming tests/scenario/ specs can reuse them.
 *
 * Behaviour is identical to the originals — the only API change is that
 * tryBet takes a `playerCount` parameter instead of reading the spec's
 * module-scoped PLAYERS constant.
 */

import type { Page, Locator } from '@playwright/test';

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export async function tap(p: Page, testId: string, timeout = 8000): Promise<void> {
  const el: Locator = p.locator(`[data-testid="${testId}"]`).first();
  await el.waitFor({ state: 'visible', timeout });
  await el.click();
}

export async function exists(p: Page, testId: string, timeout = 1000): Promise<boolean> {
  return p
    .locator(`[data-testid="${testId}"]`)
    .first()
    .isVisible({ timeout })
    .catch(() => false);
}

// Pointer-event-aware dismiss for onboarding tips. RN-web's Pressable
// listens to PointerEvents, so plain mouse events don't trigger onPress.
export async function dismissTipIfAny(p: Page): Promise<boolean> {
  const tipBtn = p.locator('[data-testid^="onboarding-tip-"][data-testid$="-got-it"]').first();
  if (!(await tipBtn.isVisible().catch(() => false))) return false;
  try {
    await tipBtn.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const opts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    });
    await tipBtn.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    return true;
  } catch (_) {
    return false;
  }
}

// Pointer-event-aware dismiss for the PWA install modal that pops up on
// first lobby visit. Mirrors dismissTipIfAny — RN-web's Pressable needs
// synthesized PointerEvents to fire onPress. Targets the always-present
// X button (pwa-close).
export async function dismissPwaModalIfAny(p: Page): Promise<boolean> {
  const closeBtn = p.locator('[data-testid="pwa-close"]').first();
  if (!(await closeBtn.isVisible().catch(() => false))) return false;
  try {
    await closeBtn.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const opts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    });
    await closeBtn.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    return true;
  } catch (_) {
    return false;
  }
}

export async function tryBet(p: Page, playerCount: number): Promise<number | false> {
  const allBtns = p.locator('[data-testid^="bet-btn-"]');
  const totalCount = await allBtns.count().catch(() => 0);
  if (totalCount === 0) return false;
  const cardsPerPlayer = totalCount - 1;

  const enabled = p.locator(
    '[data-testid^="bet-btn-"]:not([disabled]):not([aria-disabled="true"])',
  );
  const enabledCount = await enabled.count().catch(() => 0);
  if (enabledCount === 0) return false;

  const allowed: number[] = [];
  for (let i = 0; i < enabledCount; i++) {
    const txt = ((await enabled.nth(i).textContent().catch(() => '')) || '').trim();
    const n = parseInt(txt, 10);
    if (!Number.isNaN(n)) allowed.push(n);
  }
  if (allowed.length === 0) return false;

  // Bet near cardsPerPlayer / playerCount with ±1 jitter — keeps the sum
  // realistic so the last-bidder rule rarely forces a bad fallback.
  const target = cardsPerPlayer / playerCount;
  const jitter = Math.floor(Math.random() * 3) - 1;
  const desired = Math.max(0, Math.min(cardsPerPlayer, Math.round(target + jitter)));
  allowed.sort(
    (a, b) => Math.abs(a - desired) - Math.abs(b - desired) || Math.random() - 0.5,
  );
  const choice = allowed[0];

  const chip = p.locator(`[data-testid="bet-btn-${choice}"]`);
  try {
    await chip.click({ timeout: 3000 });
  } catch (_) {
    await enabled.first().click({ timeout: 3000, force: true }).catch(() => {});
  }
  await sleep(400);
  // Bet panel hides after a successful placeBet.
  if (!(await enabled.first().isVisible({ timeout: 200 }).catch(() => false))) {
    return choice;
  }
  return false;
}

export async function tryPlay(p: Page): Promise<string | false> {
  const hand = p.locator('[data-testid="my-hand"]');
  if (!(await hand.isVisible({ timeout: 200 }).catch(() => false))) return false;
  const cards = hand.locator('[data-testid^="card-"]');
  const cnt = await cards.count();
  if (cnt === 0) return false;

  for (let i = 0; i < cnt && i < 12; i++) {
    const c = cards.nth(i);
    const tid = await c.getAttribute('data-testid').catch(() => null);
    if (!tid) continue;
    try {
      await c.click({ timeout: 800 });
      await sleep(350);
      const same = hand.locator(`[data-testid="${tid}"]`);
      if (!(await same.isVisible().catch(() => false))) return tid;
      // Card still in hand → second click confirms (select-then-confirm UI).
      await same.click({ timeout: 800 }).catch(() => {});
      await sleep(400);
      if ((await cards.count()) < cnt) return tid;
    } catch (_) {}
  }
  return false;
}
```

- [ ] **Step 2: Type-check the new file**

Run: `npx tsc --noEmit --moduleResolution node --module commonjs --target es2020 --esModuleInterop --skipLibCheck tests/fixtures/actions.ts`

Expected: no output (no errors). If TS complains about `@playwright/test` types, run `node -e "require.resolve('@playwright/test')"` to confirm the package is installed (Phase 1 added it).

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/actions.ts
git commit -m "$(cat <<'EOF'
test(fixtures): extract click helpers into actions.ts

Pulls tryBet, tryPlay, dismissTipIfAny, dismissPwaModalIfAny, tap,
exists, sleep out of tests/e2e/sp-game.spec.js so Phase 3's scenario
spec can reuse them. Behaviour is byte-identical to the originals;
only API change is tryBet takes a playerCount argument instead of
reading a module-scoped constant.

The next commit updates sp-game.spec.js to import from here.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Refactor `sp-game.spec.js` to use the extracted helpers

**Files:**
- Modify: `tests/e2e/sp-game.spec.js`

- [ ] **Step 1: Replace the helper block with an import**

Open `tests/e2e/sp-game.spec.js`. Locate lines 25-179 (from `const { test, expect } = require('@playwright/test');` down through the end of `tryPlay`). Replace the entire block from line 25 through line 179 with:

```js
const { test, expect } = require('@playwright/test');
const {
  sleep,
  tap,
  exists,
  dismissTipIfAny,
  dismissPwaModalIfAny,
  tryBet,
  tryPlay,
} = require('../fixtures/actions');

const PLAYERS = Math.max(2, Math.min(6, parseInt(process.env.SP_PLAYERS || '4', 10)));
const DIFF = 'hard';
```

(Keep `dumpDiagnostic` inline — it's only used by this spec and isn't generic enough to extract.)

- [ ] **Step 2: Update the `tryBet` call site to pass `PLAYERS`**

Still in `tests/e2e/sp-game.spec.js`, find:

```js
    const bet = await tryBet(page);
```

Replace with:

```js
    const bet = await tryBet(page, PLAYERS);
```

This is the only `tryBet` call site in the file.

- [ ] **Step 3: Verify Playwright still discovers the spec**

Run: `npx playwright test --list`

Expected output (one test listed under the `e2e` project):

```
Listing tests:
  [e2e] › tests/e2e/sp-game.spec.js:NN:1 › SP game (vs 3 Hard bots) completes without stalling
Total: 1 test in 1 file
```

The line number `NN:1` will have shifted because of the deleted helper block — that's fine. What matters is the test is still discovered and the project name is unchanged.

- [ ] **Step 4: Run a quick syntax / require sanity check**

Run: `node -e "require('./tests/fixtures/actions')" && echo OK`

Expected: prints `OK`. (Plain Node will fail to require the .ts file directly — this command will only work if a transform is registered. Skip this step if it errors; Playwright's own TS resolution handles the actual run.)

If the above errors, instead run:

`npx playwright test --list 2>&1 | grep -E "Error|Cannot find module" | head -5`

Expected: no output. Any "Cannot find module '../fixtures/actions'" surfaces here.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/sp-game.spec.js
git commit -m "$(cat <<'EOF'
test(sp-game): import helpers from tests/fixtures/actions

Behaviour-preserving refactor. tryBet now takes PLAYERS as an
explicit argument instead of closing over the module-scope constant.

Full sp-game pass-fail verification happens in Task 7 (final E2E
verification step) so we don't pay the 22-min cost twice.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Write `tests/fixtures/seed.ts` with `seedScenario`

**Files:**
- Create: `tests/fixtures/seed.ts`

- [ ] **Step 1: Create the file**

Create `tests/fixtures/seed.ts` with this exact content:

```ts
'use strict';

/**
 * Scenario seeding helpers for the scenario-tier specs. Each scenario
 * is reached by UI-driving the SP game to the relevant state —
 * deliberately slower than direct state hydration, but zero production
 * code changes required.
 *
 * Currently supports: 'notrump-hand-5' (hand 5 of 20 in a 4-player SP
 * game, no-trump variant, betting UI active).
 */

import type { Page } from '@playwright/test';
import {
  sleep,
  tap,
  dismissTipIfAny,
  dismissPwaModalIfAny,
  tryBet,
  tryPlay,
} from './actions';

export type SeedScenario = 'notrump-hand-5';

export interface SeededGame {
  playerCount: number;
  startedHand: number;
}

const POLL_MS = 600;
const STUCK_S = 60;
const STUCK_THRESHOLD = Math.ceil((STUCK_S * 1000) / POLL_MS);
const DEFAULT_DEADLINE_MS = 5 * 60 * 1000; // 5 min hard cap

/**
 * Drive the SP game from the lobby to the requested in-game state.
 * Returns once the target state's UI is visible. Throws on timeout or
 * 60s without observable progress.
 */
export async function seedScenario(
  page: Page,
  scenario: SeedScenario,
): Promise<SeededGame> {
  if (scenario !== 'notrump-hand-5') {
    throw new Error(`seedScenario: unknown scenario "${scenario}"`);
  }

  const baseURL = process.env.DEMO_URL || 'http://localhost:8081';
  const playerCount = 4;
  const targetHand = 5;

  // Pre-flight: load, skip onboarding, dismiss PWA modal.
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page
    .locator('[data-testid="btn-skip-to-lobby"]')
    .waitFor({ state: 'visible', timeout: 30_000 });
  await tap(page, 'btn-skip-to-lobby', 10_000);
  await sleep(400);

  for (let i = 0; i < 6; i++) {
    if (await dismissPwaModalIfAny(page)) break;
    await sleep(250);
  }

  // Quick Match config: 4 players, Hard.
  await tap(page, `player-count-${playerCount}`, 5_000);
  await sleep(200);
  await tap(page, 'difficulty-hard', 5_000);
  await sleep(200);
  await tap(page, 'btn-quick-match', 5_000);
  await sleep(2_000);

  // Game loop — bots auto-play, we tick the human's bets/cards. Returns
  // when (hand counter === N AND a bet button is visible AND an NT or
  // NO TRUMP label is visible) — the three conditions together prove
  // the dealt UI is mounted, not just a momentary flash.
  const deadline = Date.now() + DEFAULT_DEADLINE_MS;
  let lastHand = 0;
  let idle = 0;

  while (Date.now() < deadline) {
    await sleep(POLL_MS);

    if (await dismissPwaModalIfAny(page)) {
      idle = 0;
      continue;
    }
    if (await dismissTipIfAny(page)) {
      idle = 0;
      continue;
    }

    // Auto-continue the scoreboard between hands.
    const continueBtn = page.locator('[data-testid="btn-continue-scoreboard"]').first();
    if (await continueBtn.isVisible({ timeout: 200 }).catch(() => false)) {
      await continueBtn.click({ timeout: 3_000 }).catch(() => {});
      idle = 0;
      await sleep(800);
      continue;
    }

    // Check whether we've arrived at the target state.
    if (await isAtTargetState(page, targetHand)) {
      return { playerCount, startedHand: targetHand };
    }

    const bet = await tryBet(page, playerCount);
    if (bet !== false) {
      idle = 0;
      continue;
    }

    const card = await tryPlay(page);
    if (card !== false) {
      idle = 0;
      continue;
    }

    // Idle-progress watchdog — same shape as sp-game.spec.js.
    const handNo = await readHandNumber(page);
    if (handNo !== null && handNo !== lastHand) {
      lastHand = handNo;
      idle = 0;
    } else {
      idle++;
    }
    if (idle >= STUCK_THRESHOLD) {
      throw new Error(
        `seedScenario("${scenario}") stalled — no progress for ${STUCK_S}s on hand ${lastHand}`,
      );
    }
  }

  throw new Error(
    `seedScenario("${scenario}") timeout after ${DEFAULT_DEADLINE_MS / 1000}s (reached hand ${lastHand})`,
  );
}

async function readHandNumber(page: Page): Promise<number | null> {
  const txt = await page
    .locator('text=/Hand \\d+\\s*\\/\\s*\\d+/')
    .first()
    .textContent({ timeout: 500 })
    .catch(() => '');
  const m = txt && txt.match(/Hand (\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

async function isAtTargetState(page: Page, targetHand: number): Promise<boolean> {
  const handNo = await readHandNumber(page);
  if (handNo !== targetHand) return false;

  const ntVisible = await page
    .locator('text=/\\bNT\\b|NO TRUMP/')
    .first()
    .isVisible({ timeout: 200 })
    .catch(() => false);
  if (!ntVisible) return false;

  const betBtnVisible = await page
    .locator('[data-testid^="bet-btn-"]')
    .first()
    .isVisible({ timeout: 200 })
    .catch(() => false);
  return betBtnVisible;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit --moduleResolution node --module commonjs --target es2020 --esModuleInterop --skipLibCheck tests/fixtures/seed.ts tests/fixtures/actions.ts`

Expected: no output. If TS complains about the `text=/regex/` Playwright selector syntax (it shouldn't — those are just strings), confirm the file imports `Page` from `@playwright/test` only as a type.

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/seed.ts
git commit -m "$(cat <<'EOF'
test(fixtures): seedScenario('notrump-hand-5') via UI loop

Clicks Quick Match → 4 players → Hard, then runs the same tick loop
as sp-game.spec.js (dismiss modals + tryBet + tryPlay) until the
hand-5 betting UI is visible. Three concurrent checks (hand counter
text, NT label, bet button) before declaring success — avoids
returning on a momentary flash mid-render.

Hard cap 5 min; 60s no-progress watchdog inherited from sp-game.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add `scenario` project to `playwright.config.js`

**Files:**
- Modify: `playwright.config.js`

- [ ] **Step 1: Add the project entry**

Open `playwright.config.js`. Find the `projects:` array (currently has one entry):

```js
  projects: [
    // Phase 1 ships with just the e2e project. smoke / scenario
    // projects are added in Phase 4 / Phase 5.
    { name: 'e2e', testDir: './tests/e2e' },
  ],
```

Replace with:

```js
  projects: [
    { name: 'e2e',      testDir: './tests/e2e' },
    { name: 'scenario', testDir: './tests/scenario' },
  ],
```

- [ ] **Step 2: Sanity-check discovery**

Run: `npx playwright test --list 2>&1 | tail -10`

Expected: still lists the one e2e test (and no scenario tests yet because the directory is empty). No "globalSetup not found" / "Cannot find module" errors.

If the listing shows scenario as an "Unknown project" or similar, double-check the array syntax.

- [ ] **Step 3: Commit**

```bash
git add playwright.config.js
git commit -m "$(cat <<'EOF'
test(playwright): register scenario project

Empty for now — populated by the next commit. testDir uses the same
top-level testMatch and use settings as the e2e project.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Write `tests/scenario/notrump-deal.spec.ts`

**Files:**
- Create: `tests/scenario/notrump-deal.spec.ts`

- [ ] **Step 1: Create the directory and spec**

Run: `mkdir -p tests/scenario`

Create `tests/scenario/notrump-deal.spec.ts` with this exact content:

```ts
import { test, expect } from '@playwright/test';
import { seedScenario } from '../fixtures/seed';

/**
 * Scenario-tier POC. Proves the seed → assert pattern works end-to-end
 * against the isolated :8082 Expo + local supabase stack.
 *
 * Hand 5 in Nägels is the no-trump hand. The assertions verify that:
 *   - the hand counter shows 5/20
 *   - the trump indicator shows NT (or "NO TRUMP")
 *   - the betting UI is mounted (at least one bet-btn-* present)
 *
 * Reaching that state is delegated to seedScenario, which UI-drives
 * the SP game through hands 1-4. Wall-clock ~3-4 min.
 */

test('notrump hand 5 deals with NT badge and betting UI', async ({ page }) => {
  await seedScenario(page, 'notrump-hand-5');

  await expect(page.getByText(/Hand 5\s*\/\s*20/)).toBeVisible();
  await expect(page.getByText(/\bNT\b|NO TRUMP/)).toBeVisible();
  await expect(page.locator('[data-testid^="bet-btn-"]').first()).toBeVisible();
});
```

- [ ] **Step 2: Verify Playwright discovers it**

Run: `npx playwright test --list`

Expected output: two tests listed, one per project:

```
Listing tests:
  [e2e] › tests/e2e/sp-game.spec.js:NN:1 › SP game (vs 3 Hard bots) completes without stalling
  [scenario] › tests/scenario/notrump-deal.spec.ts:NN:1 › notrump hand 5 deals with NT badge and betting UI
Total: 2 tests in 2 files
```

- [ ] **Step 3: Commit**

```bash
git add tests/scenario/notrump-deal.spec.ts
git commit -m "$(cat <<'EOF'
test(scenario): notrump-deal — POC for the scenario tier

Calls seedScenario('notrump-hand-5') and asserts the three signals
that the dealt UI is mounted: hand counter, NT label, bet buttons.
Run with: npm run test:scenario:local (added in next commit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add npm script and update README

**Files:**
- Modify: `package.json`
- Modify: `tests/README.md`

- [ ] **Step 1: Add the script**

Open `package.json`. Find:

```json
    "test:sp:local": "LOCAL_SUPABASE=1 HEADLESS=1 DEMO_URL=http://localhost:8082 playwright test tests/e2e/sp-game.spec.js",
    "test:sp:prod": "...",
```

Insert after `test:sp:local`:

```json
    "test:scenario:local": "LOCAL_SUPABASE=1 HEADLESS=1 DEMO_URL=http://localhost:8082 playwright test --project=scenario",
```

So the block becomes:

```json
    "test:sp": "playwright test tests/e2e/sp-game.spec.js",
    "test:sp:local": "LOCAL_SUPABASE=1 HEADLESS=1 DEMO_URL=http://localhost:8082 playwright test tests/e2e/sp-game.spec.js",
    "test:scenario:local": "LOCAL_SUPABASE=1 HEADLESS=1 DEMO_URL=http://localhost:8082 playwright test --project=scenario",
    "test:sp:prod": "...",
```

- [ ] **Step 2: Validate JSON**

Run: `node -e "console.log(require('./package.json').scripts['test:scenario:local'])"`

Expected: `LOCAL_SUPABASE=1 HEADLESS=1 DEMO_URL=http://localhost:8082 playwright test --project=scenario`

- [ ] **Step 3: Update `tests/README.md`**

Open `tests/README.md`. Find the "Status" section:

```markdown
## Status (Phase 2 — Local Supabase + isolated Expo)

- ✅ `tests/e2e/sp-game.spec.js` — single-player vs Hard bots, full game
  to scoreboard.
  - Against the manual `:8081` dev server: `npm run test:sp`
  - Against an isolated `:8082` Expo + local supabase: `npm run test:sp:local`
- ✅ Edge-function unit tests: `cd supabase/functions && deno test --allow-all`
- ✅ Local backend orchestration via `tests/playwright/global-setup.ts` +
  `global-teardown.ts`. Activated by `LOCAL_SUPABASE=1`.
- ⏳ Smoke / scenario / multi-context layers — Phase 3+.
```

Replace with:

```markdown
## Status (Phase 3 — Fixtures + POC scenario)

- ✅ `tests/e2e/sp-game.spec.js` — single-player vs Hard bots, full game
  to scoreboard.
  - Against the manual `:8081` dev server: `npm run test:sp`
  - Against an isolated `:8082` Expo + local supabase: `npm run test:sp:local`
- ✅ `tests/scenario/notrump-deal.spec.ts` — POC for the scenario tier.
  UI-drives SP to hand 5 (no-trump) and asserts the dealt state.
  - `npm run test:scenario:local` (~3-4 min)
- ✅ Reusable click helpers in `tests/fixtures/actions.ts`
  (`tryBet`, `tryPlay`, `dismissTipIfAny`, `dismissPwaModalIfAny`, `tap`, …).
- ✅ Scenario seeding helper `tests/fixtures/seed.ts` (`seedScenario`).
- ✅ Edge-function unit tests: `cd supabase/functions && deno test --allow-all`
- ⏳ Smoke / additional scenarios / multi-context — Phase 4+.
```

Also find the "Running" section and append the new script. Find:

```markdown
```bash
npm run test:sp           # SP e2e against manual :8081 dev server (headed)
npm run test:sp:local     # SP e2e against isolated :8082 + local supabase (headless)
npm run test:sp:prod      # same but against $APP_URL (production)
```
```

Replace with:

```markdown
```bash
npm run test:sp              # SP e2e against manual :8081 dev server (headed)
npm run test:sp:local        # SP e2e against isolated :8082 + local supabase (headless)
npm run test:scenario:local  # Scenario tier (notrump-deal POC) against :8082 (headless)
npm run test:sp:prod         # SP e2e against $APP_URL (production)
```
```

Append a new section after "Local backend (LOCAL_SUPABASE=1)":

```markdown
## Scenario tier (`tests/scenario/`)

POC scenario: `notrump-deal.spec.ts`. UI-drives SP to a specific
in-game state via `seedScenario(page, scenario)` from
`tests/fixtures/seed.ts`, then makes assertions.

**Why UI-driven and not direct state injection?** The SP game state
lives in a module-scoped Zustand store with no exposed test handle.
Adding a `__DEV__`-gated `window` exposure was considered and
rejected — the speed win (~5s vs ~3min) didn't justify a new
production-code surface for tests. If Phase 5 produces enough
scenarios that total runtime becomes painful, revisit.

**Adding a new scenario:**
1. Add a string to the `SeedScenario` union in `tests/fixtures/seed.ts`.
2. Branch on it in `seedScenario` — what to click, when to stop.
3. Write a new `tests/scenario/<name>.spec.ts` that calls it.
4. The `scenario` project picks it up automatically.

**Shared click helpers** live in `tests/fixtures/actions.ts`. Reuse
them — don't re-extract from `sp-game.spec.js`.
```

- [ ] **Step 4: Commit**

```bash
git add package.json tests/README.md
git commit -m "$(cat <<'EOF'
test(scripts): add test:scenario:local + Phase 3 README docs

Documents the scenario tier POC, the seedScenario helper, and the
rejection of __DEV__-gated state injection.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: End-to-end verification

**Files:** none modified — pure verification.

- [ ] **Step 1: Pre-flight memory check**

Run: `vm_stat | head -10`

Confirm `Pages free` × 16 KB plus `Pages inactive` × 16 KB ≥ 2 GB reclaimable. (Free alone is rarely above 2 GB on this machine; inactive memory is what the kernel can reclaim under pressure.) If genuinely tight (under ~3 GB combined), close heavy Chrome / Slack windows before continuing.

- [ ] **Step 2: Make sure Docker is running**

Run: `docker info >/dev/null 2>&1 && echo OK || echo DOCKER_DOWN`

Expected: `OK`. If `DOCKER_DOWN`, ask the user to start Docker Desktop.

- [ ] **Step 3: Make sure :8082 is free**

Run: `lsof -i :8082 -sTCP:LISTEN -P -n 2>&1 | head -3`

Expected: no output. If something is listening, identify the process and ask the user before killing.

- [ ] **Step 4: Run the scenario spec**

Run: `npm run test:scenario:local`

Expected console output, in order:

```
[global-setup] starting local supabase…
…docker boot output (skipped images second-time)…
[global-setup] applying migrations via supabase db reset…
[global-setup] spawning expo on :8082…
[global-setup] waiting for expo to be ready…
[global-setup] expo ready.
Running 1 test using 1 worker
  ✓  1 [scenario] › tests/scenario/notrump-deal.spec.ts:NN:1 › notrump hand 5 deals with NT badge and betting UI (3-4 min)
[global-teardown] stopping expo (pid …)…
[global-teardown] stopping local supabase…
1 passed (~4-5 min including supabase boot)
```

If it fails, the most likely culprits are:
- **Text assertion misses the rendered format** — the spec uses `/Hand 5\s*\/\s*20/`; if the actual text is `Hand: 5 of 20` or similar, update the regex (or add a focused `<View testID="hand-counter">` around the existing text node in `src/screens/GameTableScreen.tsx`).
- **NT regex misses** — same logic, inspect what's rendered. Adjust `text=/\bNT\b|NO TRUMP/` to match.
- **Stalled on hand N < 5** — the in-spec watchdog throws with the last hand number. Probably means a modal isn't getting dismissed (check Bookmark-of-the-month, push permission, etc.).

Use `HEADLESS=0 LOCAL_SUPABASE=1 DEMO_URL=http://localhost:8082 npx playwright test --project=scenario` to debug visually.

- [ ] **Step 5: Confirm `npm run test:sp:local` still passes**

Run: `npm run test:sp:local`

Expected: identical behaviour to Phase 2 — the full 22-min Hard-bot SP game. `1 passed` at the end. The actions.ts refactor must not have changed timing or assertions.

If it fails, the refactor in Task 2 broke something. Diff `tests/fixtures/actions.ts` against the inline block deleted from `sp-game.spec.js` — they should be character-for-character identical except for the `export` keywords and the `playerCount` parameter on `tryBet`.

- [ ] **Step 6: Confirm `npx jest --no-coverage` still passes**

Run: `npx jest --no-coverage`

Expected: all existing tests pass (Phase 1's `local-backend.test.ts`, the original `gameLoop.test.ts`, etc.). No new jest tests added by Phase 3.

- [ ] **Step 7: Verify clean working tree**

Run: `git status`

Expected: working tree clean except the usual `supabase/.temp/*` noise. No leftover `.env.test`, no `tests/.runtime/`, no `test-results/` (or it's gitignored).

---

## Phase 3 done when

- All 6 tasks committed in order.
- `npm run test:scenario:local` passes (~3-4 min spec + ~30s supabase boot).
- `npm run test:sp:local` passes byte-identically to Phase 2 (the actions.ts refactor must not regress it).
- `npx jest --no-coverage` passes.
- `cd supabase/functions && deno test --allow-all` still passes (Phase 1 createRoom helper unaffected).
- `playwright.config.js` lists two projects (`e2e`, `scenario`).
- `tests/README.md` documents the new helper and the trade-off rationale (UI-driven, not state-injected).

Phase 4 plan (smoke tier — 8 specs covering cold-start, navigation, no-overflow) is written **after** Phase 3 ships green.

---

## Self-review notes

- **Spec coverage:** every section of `2026-05-17-testing-phase-3-fixtures-design.md` maps to a task here. The "actions extraction brought forward from Phase 6" decision lives in Tasks 1-2; the seed mechanism in Task 3; the spec in Task 5; config/scripts/docs in Tasks 4 + 6; verification in Task 7.
- **No placeholders:** every code block is the actual content to write. No TODO, no "implement appropriately", no "add validation."
- **Type consistency:** `seedScenario(page, scenario)` signature is consistent across spec, seed.ts, and notrump-deal.spec.ts. `tryBet(page, playerCount)` signature is consistent between actions.ts, the seed loop call, and the sp-game.spec.js call.
- **Untracked failure modes:** Step 4 of Task 7 enumerates the three most likely seed-time failures and the debug recipe for each. The spec's "Risks & mitigations" table covers the design-time risks.
