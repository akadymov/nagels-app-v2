# Testing strategy — Phase 3 (Fixtures + POC scenario) Design

> **Revision note (2026-05-17):** First draft assumed Multiplayer-with-bots via Supabase edge functions. Code investigation revealed that (a) SP mode is entirely client-side via Zustand (no Supabase rooms involved at all) and (b) MP rooms have **no** bot support — `startGame` requires N real human sessions. The design below is revised to seed SP state by hydrating the Zustand `gameStore` directly. The earlier MP-edge-function approach is deferred to Phase 5/6 when multi-context fixtures land — those scenarios will need an MP-bot mechanism (still TBD whether that's "spawn N human contexts" or "add server-side bots") that's premature to design now.

## Context

Phases 1 (foundation) and 2 (local Supabase + isolated Expo on `:8082`) shipped on `main` 2026-05-16. The four-tier suite (`unit` / `smoke` / `scenario` / `end-to-end`) defined in `2026-05-16-testing-strategy-design.md` now has the orchestration plumbing (`globalSetup` / `globalTeardown` / `LOCAL_SUPABASE=1`) and one working spec (`tests/e2e/sp-game.spec.js`, ~22 min full Hard-bot SP game).

Phase 3 introduces the **scenario tier** as a proof-of-concept: one fixture helper and one spec that together prove the seed-state → assertion pattern works end-to-end for SP. Phase 5 will expand to more SP scenarios and start MP scenarios (which need a different seeding mechanism); Phase 6 expands `players.ts` for multi-context. Phase 3 stays deliberately small.

## Problem

The `e2e` tier (a full Hard-bot game) is slow (~22 min) and brittle for asserting specific in-game UI states like "no-trump hand 5 is dealt and shows the right badges". A spec that needs to assert mid-game UI either (a) plays through hands to reach the state — slow — or (b) seeds the state directly. The scenario tier exists for (b).

We have no fixture code today. The `sp-game.spec.js` helpers (`tryBet`, `tryPlay`, `dismissTipIfAny`) are inlined and not reusable from other specs.

## Goals

- One working `seedScenario(page, 'notrump-hand-5')` helper that reaches hand 5 (no-trump variant) by driving the SP game store programmatically.
- One working spec (`notrump-deal.spec.ts`) that uses the helper, asserts the dealt state, and runs in under 10 seconds.
- A repeatable pattern Phase 5 can extend to other SP scenarios without architectural changes.
- A `scenario` Playwright project that runs independently of `e2e`.

## Non-goals

- MP scenarios — Phase 5/6 (needs a separate seeding mechanism that doesn't exist today).
- Multi-context Playwright helpers (`players.ts`, `actions.ts` extraction) — Phase 6.
- Smoke tier — Phase 4.
- CI integration — Phase 8.
- Adding test-only fields to the Zustand store (no `__hydrateState` action). The store's existing public actions (`initGame`, `placeBet`, `playCard`, etc.) are the only entry points seedScenario uses.
- Adding bot support to MP edge functions — deferred to whenever MP scenarios actually need it.

## Architecture

```
tests/
├── fixtures/
│   └── seed.ts                — seedScenario(page, scenario)
├── scenario/
│   └── notrump-deal.spec.ts   — POC spec
├── e2e/                       — unchanged
└── playwright/                — unchanged
```

```
src/
└── debug/
    └── exposeStores.ts        — window.__nagels (test-mode only)
```

Phase 3 fixtures are smaller than the first draft because the SP path has no Supabase room, no service-role client, and no cross-test data leakage to clean up. State lives per browser context and dies when the context closes.

### Test-mode store exposure — `src/debug/exposeStores.ts`

```ts
// Gated by Expo's __DEV__ AND EXPO_PUBLIC_TEST_HOOKS=1. Production
// bundles strip __DEV__ blocks at build time, so this file
// contributes zero bytes to a release build.
import { useGameStore } from '../store/gameStore';

declare global {
  interface Window {
    __nagels?: {
      gameStore: typeof useGameStore;
    };
  }
}

export function exposeStoresForTests(): void {
  if (typeof window === 'undefined') return;
  if (!__DEV__) return;
  if (process.env.EXPO_PUBLIC_TEST_HOOKS !== '1') return;
  window.__nagels = { gameStore: useGameStore };
}
```

Called once from `App.tsx` (or the navigation root) at mount. The triple gate (`window` exists + `__DEV__` + env flag) means it only attaches when (a) running on web, (b) in a dev/test build, and (c) the test stack explicitly opts in. `globalSetup` already sets `EXPO_PUBLIC_TEST_HOOKS=1` in the Expo child env when `LOCAL_SUPABASE=1` is set.

### State seeding — `tests/fixtures/seed.ts`

```ts
import type { Page } from '@playwright/test';

export type SeedScenario = 'notrump-hand-5';

export async function seedScenario(
  page: Page,
  scenario: SeedScenario,
): Promise<void>;
```

Behaviour for `scenario: 'notrump-hand-5'`:

1. Navigate `page` to the lobby. Skip onboarding if the modal is present.
2. `page.evaluate` waits up to 5s for `window.__nagels?.gameStore` to be defined (would fail loudly if the exposeStores hook didn't fire — better than a silent broken seed).
3. `page.evaluate` calls `window.__nagels.gameStore.getState().initGame(players, 'player-0')` with 1 human + 3 bots (display names `'You'`, `'Bot A'`, `'Bot B'`, `'Bot C'`).
4. Navigate `page` to the GameTable screen (in-app router; impl plan uses the same navigation hook the lobby's Quick Match button uses).
5. `page.evaluate` runs a tight loop that for each turn either calls `placeBotBet()` / `playBotCard()` (when it's a bot's turn) or `placeBet(humanId, 0)` / `playCard(humanId, firstLegalCard)` (when it's the human's turn). Between phases it triggers `startBetting()` / `startPlaying()` as needed. Repeats until `getState().handNumber === 5 && getState().phase === 'betting'`. ~1-2s wall-clock.
6. seedScenario returns. The page is now sitting on the GameTable screen with hand 5 dealt, NT badge visible, betting UI active.

Hard 90s timeout on the loop — if hand 5 isn't reached, throw an error with the last `getState()` snapshot for debugging.

The first-legal choice is deterministic but doesn't necessarily produce interesting prior-hand outcomes — fine for `notrump-hand-5` which only asserts what's dealt. Future scenarios that care about prior hand state will pass richer parameters to `seedScenario` (Phase 5 problem).

### Scenario spec — `tests/scenario/notrump-deal.spec.ts`

```ts
import { test, expect } from '@playwright/test';
import { seedScenario } from '../fixtures/seed';

test('notrump hand 5 deals with NT badge and betting UI', async ({ page }) => {
  await seedScenario(page, 'notrump-hand-5');

  await expect(page.getByTestId('hand-counter')).toContainText('5/20');
  await expect(page.getByTestId('trump-badge')).toContainText(/NT|NO TRUMP/);
  await expect(page.getByTestId('bet-controls')).toBeVisible();
  await expect(page.getByTestId('player-tile')).toHaveCount(4);
});
```

Per-test cleanup is implicit: closing the browser context tears down the in-memory Zustand store. No DB writes happened.

The four testIDs above (`hand-counter`, `trump-badge`, `bet-controls`, `player-tile`) are added by the implementation plan if not already present.

### Playwright config changes

`playwright.config.js` adds a second project entry:

```js
projects: [
  { name: 'e2e',      testDir: './tests/e2e' },
  { name: 'scenario', testDir: './tests/scenario' },
],
```

Per-test timeout, baseURL, viewport, etc. stay as today (scenario specs share the 30-min cap; the actual ~5-10s run finishes long before).

### npm scripts

Add to `package.json`:

```json
"test:scenario:local": "LOCAL_SUPABASE=1 HEADLESS=1 DEMO_URL=http://localhost:8082 playwright test --project=scenario"
```

`LOCAL_SUPABASE=1` is kept for symmetry with `test:sp:local` — it ensures globalSetup runs and `EXPO_PUBLIC_TEST_HOOKS=1` is set in the Expo child. The local Supabase stack starts even though scenario specs don't hit it; Phase 5's MP scenarios will need it. Accepting the ~30s boot for symmetry is cheaper than maintaining two divergent flows.

(A later optimization could make the supabase boot conditional on which project is selected, but that's not a Phase 3 problem.)

### globalSetup change

`tests/playwright/global-setup.ts` adds one line to the child env:

```ts
env: {
  ...process.env,
  EXPO_PUBLIC_SUPABASE_URL: status.apiUrl,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: status.anonKey,
  EXPO_PUBLIC_APP_URL: `http://localhost:${EXPO_PORT}`,
  EXPO_PUBLIC_TEST_HOOKS: '1',   // NEW — enables exposeStoresForTests
  CI: '1',
},
```

## Rollout

Single phase, single commit chain on `main` (matches Phase 1 / Phase 2 cadence). The implementation plan has ~8 tasks:

1. `src/debug/exposeStores.ts` + wire into `App.tsx` (or root).
2. Add `EXPO_PUBLIC_TEST_HOOKS=1` to `global-setup.ts` env.
3. Add missing testIDs to GameTableScreen (hand-counter, trump-badge, bet-controls, player-tile if not present).
4. Add `scenario` project to `playwright.config.js`.
5. `tests/fixtures/seed.ts` — `seedScenario('notrump-hand-5')` with TDD against a jest unit test for any pure helpers; integration validation comes via the spec in step 6.
6. `tests/scenario/notrump-deal.spec.ts`.
7. `package.json` `test:scenario:local` script + `tests/README.md` updates.
8. End-to-end verification: `npm run test:scenario:local` passes; `npm run test:sp:local` still passes; `npx jest` still passes.

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Store shape changes break `seedScenario` silently | seedScenario only calls public actions (`initGame`, `placeBet`, etc.). Type imports from `../../src/store/gameStore` so a renamed action fails to compile, not at runtime. |
| `window.__nagels` doesn't appear (build stripped the hook) | seedScenario waits up to 5s then throws "test hooks not exposed — check EXPO_PUBLIC_TEST_HOOKS=1 and __DEV__". |
| Bot strategy is non-deterministic — `placeBotBet` might pick different bets across runs, leading to flaky prior-hand state | seedScenario uses `placeBet(botId, 0)` for bots too (not `placeBotBet`). First-legal-everything for all four seats. Bot AI is exercised by the e2e tier, not the scenario tier. |
| `EXPO_PUBLIC_TEST_HOOKS` accidentally leaks into a production build | Triple gate (`window` + `__DEV__` + env flag). `__DEV__` is `false` in `expo export --platform web` production bundles by definition. |
| GameTable screen requires navigation context that's hard to set up programmatically | seedScenario uses the same in-app navigation hook as Quick Match — exact mechanism settled in Step 4 of the plan after reading `LobbyScreen.handleQuickMatch`. |

## Open questions resolved during brainstorming + investigation

- **Scope** → strict POC: one SP scenario, one spec.
- **Mode** → SP (Zustand-seeded); MP deferred to Phase 5/6.
- **Seed mechanism** → hydrate Zustand store via `page.evaluate` against a `__DEV__`-gated `window.__nagels` exposure; call existing public store actions in a tight loop, no test-only store API.
- **Cleanup** → none needed; in-memory state dies with the browser context.
- **Speed** → ~5-10s total (vs. ~22min for e2e).

## References

- `docs/superpowers/specs/2026-05-16-testing-strategy-design.md` — overall design.
- `docs/superpowers/plans/2026-05-16-testing-phase-1-foundation.md` — Phase 1 plan (shipped).
- `docs/superpowers/plans/2026-05-16-testing-phase-2-local-supabase.md` — Phase 2 plan (shipped).
- `src/store/gameStore.ts:182` — `useGameStore` (Zustand store being seeded).
- `src/screens/GameTableScreen.tsx` — where testIDs land.
- `src/screens/LobbyScreen.tsx:166` — `handleQuickMatch` (navigation path to GameTable).
- `tests/playwright/global-setup.ts` — env injection point.
