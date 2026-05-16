# Testing strategy — Phase 3 (Fixtures + POC scenario) Design

> **Revision history (2026-05-17):**
> - Draft 1 assumed MP-with-bots via Supabase edge functions. Code reading showed MP rooms have no bot support and SP is entirely client-side via Zustand.
> - Draft 2 pivoted to direct Zustand seeding via a `__DEV__`-gated `window.__nagels` exposure. Akula pushed back on adding production-code-for-tests; the speed win (~5s vs ~3min) didn't justify the new prod surface.
> - Final design (this doc): UI-driven seed using the same click-through pattern as `sp-game.spec.js`. Zero production-code changes. ~3 min per scenario, well inside the 5-8 min scenario-tier budget.

## Context

Phases 1 (foundation) and 2 (local Supabase + isolated Expo on `:8082`) shipped on `main` 2026-05-16. The four-tier suite (`unit` / `smoke` / `scenario` / `end-to-end`) defined in `2026-05-16-testing-strategy-design.md` now has the orchestration plumbing (`globalSetup` / `globalTeardown` / `LOCAL_SUPABASE=1`) and one working spec (`tests/e2e/sp-game.spec.js`, ~22 min full Hard-bot SP game).

Phase 3 introduces the **scenario tier** as a proof-of-concept: one fixture helper and one spec that together prove the seed-state → assertion pattern works end-to-end for SP. Phase 5 will expand to more SP scenarios; Phase 6 will tackle multi-context MP scenarios (different seeding mechanism, out of scope here). Phase 3 stays deliberately small.

## Problem

The `e2e` tier (a full Hard-bot game) is slow (~22 min) and brittle for asserting specific in-game UI states like "no-trump hand 5 is dealt and shows the right badges". A spec that needs to assert mid-game UI either (a) plays through hands to reach the state — slow — or (b) seeds the state directly. Direct seeding is faster but requires either an MP-with-bots mechanism (doesn't exist) or a test-only hook into the SP Zustand store (rejected as prod-code-for-tests). **UI-driven fast-forward** uses the same code paths the e2e test already uses, just trimmed to "reach hand N, then assert". No new production surface.

Helpers `tryBet`, `tryPlay`, `dismissTipIfAny`, `dismissPwaModalIfAny`, `tap`, `exists`, `sleep` live inline in `tests/e2e/sp-game.spec.js`. They are about to have a second caller. Extracting them to `tests/fixtures/actions.ts` now is on the natural path for Phase 3 — originally scheduled for Phase 6, brought forward because Phase 3 needs them.

## Goals

- One working `seedScenario(page, 'notrump-hand-5')` helper that UI-drives the SP game to hand 5 (no-trump) and returns when the betting UI for that hand is visible.
- One working spec (`notrump-deal.spec.ts`) that uses the helper, asserts the dealt state, runs in ~3-4 min.
- Reusable `tests/fixtures/actions.ts` — `tryBet` / `tryPlay` / `dismissTipIfAny` / `dismissPwaModalIfAny` / `tap` / `exists` / `sleep` extracted from `sp-game.spec.js`. The existing e2e spec is refactored to import from there — behavior byte-identical.
- A `scenario` Playwright project that runs independently of `e2e`.

## Non-goals

- MP scenarios — Phase 6 (needs a multi-context seeding mechanism that doesn't exist today).
- Multi-context Playwright helpers (`players.ts`) — Phase 6.
- Smoke tier — Phase 4.
- CI integration — Phase 8.
- **Any production-code change.** No test hooks on `window`, no `EXPO_PUBLIC_TEST_HOOKS`, no test-only store actions. The only production touches considered are adding 1-2 testIDs to existing components if the assertions need stability beyond text matching — and only if text-based assertions prove flaky during implementation.
- Optimizing scenario runtime below ~3 min. If Phase 5 produces 5+ scenarios and total scenario-tier time becomes painful, that's the trigger to revisit (e.g., add the store exposure then). Premature now.

## Architecture

```
tests/
├── fixtures/
│   ├── actions.ts             — tryBet / tryPlay / dismiss* / tap / exists / sleep (extracted)
│   └── seed.ts                — seedScenario(page, scenario)
├── scenario/
│   └── notrump-deal.spec.ts   — POC spec
├── e2e/
│   └── sp-game.spec.js        — refactored to import from ../fixtures/actions
└── playwright/                — unchanged
```

No `src/` changes. No `supabase/` changes. No `playwright.config.js` changes except one added project entry.

### Action helpers — `tests/fixtures/actions.ts`

Copy verbatim from `sp-game.spec.js` (lines 30-179): `sleep`, `tap`, `exists`, `dismissTipIfAny`, `dismissPwaModalIfAny`, `tryBet`, `tryPlay`. Each becomes a named export. Type annotations stay JSDoc-style for now (file is `.ts` but used by both `.ts` and `.js` callers; ts-jest / Playwright's TS support handles both).

One adjustment: `tryBet` currently reads a module-scoped `PLAYERS` constant. Extract that as a function parameter: `tryBet(page, playerCount)`.

Nothing else changes in behaviour.

### State seeding — `tests/fixtures/seed.ts`

```ts
import type { Page } from '@playwright/test';

export type SeedScenario = 'notrump-hand-5';

export interface SeededGame {
  playerCount: number;        // 4 (POC default)
  startedHand: number;        // 5
}

export async function seedScenario(
  page: Page,
  scenario: SeedScenario,
): Promise<SeededGame>;
```

Behaviour for `scenario: 'notrump-hand-5'`:

1. `page.goto(baseURL)` and wait for the lobby `[data-testid="btn-skip-to-lobby"]` (mirroring `sp-game.spec.js`'s pre-flight).
2. Dismiss PWA modal + onboarding tips if present.
3. `tap('player-count-4')`, `tap('difficulty-hard')`, `tap('btn-quick-match')`. Game starts on hand 1.
4. Game-loop:
   - Each tick (every ~600ms): `dismissTipIfAny`, then try `tryBet(page, 4)`, then try `tryPlay(page)`. Either is a no-op when not its turn; one of them ticks the game forward.
   - Check the visible hand counter text against `Hand N/20`. When `N === 5` AND a betting button is visible AND an NT/no-trump indicator is visible, the seed has reached the target.
   - Hard timeout: 5 min (rounded up from observed 22min/20hands = ~1.1min/hand × 4 hands ≈ 4.4 min, with headroom). Throws on timeout with a snapshot of visible testIDs for debugging.
5. Returns `{ playerCount: 4, startedHand: 5 }`.

The 60-second in-spec watchdog from `sp-game.spec.js` ports over verbatim — if no progress (no testID change in `STUCK_S = 60` seconds), seed fails fast.

### Scenario spec — `tests/scenario/notrump-deal.spec.ts`

```ts
import { test, expect } from '@playwright/test';
import { seedScenario } from '../fixtures/seed';

test('notrump hand 5 deals with NT badge and betting UI', async ({ page }) => {
  await seedScenario(page, 'notrump-hand-5');

  // Hand counter shows hand 5 of 20.
  await expect(page.getByText(/Hand 5\s*\/\s*20/)).toBeVisible();

  // Trump indicator shows no-trump for hand 5.
  await expect(page.getByText(/NT|NO TRUMP/)).toBeVisible();

  // Betting UI is active — at least one bet button rendered.
  await expect(page.locator('[data-testid^="bet-btn-"]')).not.toHaveCount(0);
});
```

Assertions are text-based to avoid adding production testIDs. The implementation plan checks during step "verify assertions" whether the assertions are stable; only if a text-based assertion is flaky does the plan add a focused testID (e.g., `<View testID="hand-counter">` around the existing "Hand N/M" text node).

### Playwright config changes

`playwright.config.js` — one project added:

```js
projects: [
  { name: 'e2e',      testDir: './tests/e2e' },
  { name: 'scenario', testDir: './tests/scenario' },
],
```

Per-test timeout, baseURL, viewport, all use settings — unchanged.

### npm scripts

Add to `package.json`:

```json
"test:scenario:local": "LOCAL_SUPABASE=1 HEADLESS=1 DEMO_URL=http://localhost:8082 playwright test --project=scenario"
```

`LOCAL_SUPABASE=1` is required because the scenario spec runs against the isolated `:8082` Expo (which globalSetup starts). The local Supabase stack itself isn't touched by the SP path, but it's part of the same boot sequence — accepting that boot cost for now is cheaper than maintaining a divergent code path. (Optimization deferred per Non-goals.)

## Rollout

Single phase, single commit chain on `main`. Implementation plan has ~7 tasks:

1. Extract helpers from `sp-game.spec.js` into `tests/fixtures/actions.ts`. Re-point `sp-game.spec.js` imports. Run `npm run test:sp:local` to confirm e2e still passes (or skip and verify in step 7).
2. Write `tests/fixtures/seed.ts` with `seedScenario('notrump-hand-5')`.
3. Add `scenario` project to `playwright.config.js`.
4. Write `tests/scenario/notrump-deal.spec.ts`.
5. Add `test:scenario:local` script to `package.json`.
6. Update `tests/README.md` (flip scenario row to ✅, document the helper).
7. End-to-end verification: `npm run test:scenario:local` passes (~3-4 min); `npm run test:sp:local` still passes (~22 min); `npx jest --no-coverage` still passes.

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Refactor of `sp-game.spec.js` breaks the e2e run | Helpers extracted are pure functions with no behavioural changes. Step 1 ends with `npm run test:sp:local` smoke before continuing. |
| Text-based assertion `/Hand 5\s*\/\s*20/` fails because the actual rendered text differs | Step 4 includes a manual visual check during implementation (`HEADLESS=0` once). If the text is rendered split across React nodes that text-match can't span, add one testID. |
| 4 hands take > 5min on a memory-pressured machine, seed times out | Hard cap is configurable via env. Default 300s. Phase 2 timeout study showed bots play ~1min/hand on the local stack — well under cap. |
| `tryBet` jitter occasionally picks an illegal bet that the UI rejects without surfacing why | Inherited from `sp-game.spec.js` which passes today. If observed in scenario context, the in-spec watchdog catches it as a 60s stall. |
| The "wait for hand 5" check fires on a brief flash of `Hand 5/20` before betting UI mounts | Seed checks all three conditions (counter AND bet button AND NT indicator) before declaring success. Adds <300ms to the happy path. |

## Open questions resolved during brainstorming + investigation

- **Scope** → strict POC: one SP scenario, one spec.
- **Mode** → SP only (no Supabase touch). MP deferred to Phase 6.
- **Seed mechanism** → UI-driven via existing action helpers. No prod surface added.
- **Cleanup** → none needed; SP state is in-memory and dies with the browser context.
- **Speed** → ~3-4 min total. Acceptable within scenario-tier budget. Optimization deferred until proven necessary.
- **Helper extraction timing** → brought forward from Phase 6 to Phase 3 because Phase 3 is the second caller.

## References

- `docs/superpowers/specs/2026-05-16-testing-strategy-design.md` — overall design.
- `docs/superpowers/plans/2026-05-16-testing-phase-1-foundation.md` — Phase 1 plan (shipped).
- `docs/superpowers/plans/2026-05-16-testing-phase-2-local-supabase.md` — Phase 2 plan (shipped).
- `tests/e2e/sp-game.spec.js:30-179` — helpers being extracted.
- `tests/e2e/sp-game.spec.js:214-330` — game-loop pattern seedScenario mirrors.
- `tests/playwright/global-setup.ts` — runs unchanged; seed doesn't need any new env vars.
