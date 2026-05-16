# Testing strategy — tiered suite with local Supabase

**Date:** 2026-05-16
**Status:** Design — pending implementation plan
**Owner:** Akula

## Problem

Today the project ships with a single Playwright spec (`tests/sp-game.spec.js`,
single-player vs Hard bots, mobile viewport) and five Jest unit files (one in
`src/__tests__/` covering `rules.ts`, three in `supabase/functions/_shared/__tests__/`).
The two demo scripts in `demo/` are **visual demos**, not asserted tests —
multiplayer has zero automated regression coverage. There is no CI; tests run
locally on demand.

This makes release-time validation expensive: every release requires manual
smoke-testing across player counts, auth methods, languages, and viewports.
Two specific bug classes have proven most expensive when they reach prod:

1. **Realtime / sync regressions** — clients drift, reconnect loses state, bot
   takeover fails, host-exit leaves players stranded.
2. **UI regressions** — layouts break across viewports, i18n strings overflow,
   desktop split-panes occlude game state.

The goal is a test suite that catches regressions in these classes without
requiring much hands-on time per release.

## Goals

- Manual one-command run (`npm run test:all`) for now; integration into a
  release pipeline later. Today's CI budget is unbounded.
- Full per-test control: any spec can be disabled before a release without
  editing code, and the disabled state is visible in the run report.
- Backend isolation: tests must never touch production Supabase data; never
  fire Telegram notifications.
- Existing `sp-game.spec.js` keeps passing throughout the rollout — every
  phase ships green.

## Non-goals

- Visual regression (no pixel-diff screenshot baselines). DOM smoke +
  invariant checks only. Pixel issues stay on manual review.
- CI infrastructure in this scope. We design so a later CI hook is trivial,
  but we don't build the workflow file now.
- Mock-based Supabase. Real local Postgres + Realtime via `supabase` CLI.

## Architecture

Four tiers, one orchestrator, single local Supabase instance per run.

```
                       npm run test:all
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         globalSetup     test runners    globalTeardown
              │               │               │
   supabase start       Jest (unit)       supabase stop
   db reset             Playwright smoke  reset volumes
   expo on :8082        Playwright scenario
   write .env.test      Playwright e2e
```

### Tiers

| Tier         | What it proves                                                  | Tool        | Budget       |
| ------------ | --------------------------------------------------------------- | ----------- | ------------ |
| `unit`       | Game rules invariants (rules.ts, edge fn helpers)               | Jest        | ~10 s        |
| `smoke`      | App boots, screens render, navigation works, no overflow        | Playwright  | ~3 min       |
| `scenario`   | Specific in-game UI states (notrump, winner, scoreboard, etc.)  | Playwright  | ~5–8 min     |
| `end-to-end` | Full playthroughs, multiplayer disconnect/reconnect, bot takeover | Playwright | ~15–20 min   |

Total full run ≈ 25 minutes on the dev machine, sequential.

### Test backend — local Supabase via CLI

`supabase start` boots Postgres + Auth + Realtime in Docker for the run.
`globalSetup` runs once: parses URL/keys, applies all migrations via
`supabase db reset`, then spawns `expo start --port 8082` with `.env.test`
active. The dev server on :8081 is not touched. `globalTeardown` kills the
Expo process and runs `supabase stop --no-backup`. `KEEP_SUPABASE=1` skips
teardown for fast iteration.

Memory budget: a `supabase start` instance is ~1 GB. The machine's
memory-guard hook (`~/.claude/hooks/memory-guard.sh`) will deny launches if
free RAM < 2 GB. Tests are advised to be run after closing heavy Chrome
windows.

### State seeding — `tests/fixtures/seed.ts`

The `scenario` tier reaches mid- and end-game states without playing through
a full game. A single helper builds arbitrary state via the Supabase admin
client (service-role key from `supabase status`):

```ts
const { roomCode, players } = await seedGame({
  runId,
  playerCount: 4,
  handNumber: 5,                // → notrump
  bets: [2, 1, 2, 1],
  tricksWon: [1, 0, 1, 0],
  leadPlayerIndex: 2,
  phase: 'playing',             // 'betting' | 'playing' | 'finished'
});
```

Internally: direct INSERT into `rooms` (bypassing the `createRoom` edge
function so no Telegram notify fires), `players`, `hands`, `bets`, `tricks`.
Returns the room code plus an array of `{ page, context, userId }` pre-bound
to each player's anonymous Supabase session.

Supported states are dictated by which scenario specs reference them:
`notrump-hand-5`, `last-hand-mid-play`, `game-finished`, `mid-hand-disconnect-ready`,
`with-spectator`, `host-still-in-game`.

### Multi-context Playwright — `tests/fixtures/players.ts`

The `end-to-end` tier drives 2–6 player contexts in one test:

```ts
const ps = await players(browser, 4);
await ps[0].createRoom({ silent: true });
const code = await ps[0].roomCode();
await Promise.all(ps.slice(1).map(p => p.joinRoom(code)));
await ps[0].startGame();

await ps[2].disconnect();
// A and B continue ...
await ps[2].reconnect();
```

Each context is `browser.newContext()` with its own anonymous Supabase
session. The existing helpers from `sp-game.spec.js` (`tryBet`, `tryPlay`,
`dismissTipIfAny`) move to `tests/fixtures/actions.ts` for reuse.

### Cleanup between tests

Every test generates a unique `runId` (short UUID). All seeded rows are
tagged with this ID (either dedicated column or `test_${runId}_*` prefix on
`room_code` / `display_name`). `afterEach` deletes by `runId`. Failed tests
leak data on purpose — the prefix makes it discoverable for manual debug.

### `silent: true` flag — production change

The only production-code change in this design is in
`supabase/functions/game-action/actions/createRoom.ts`:

```ts
const { hostName, gameMode, silent = false } = payload;
// ... existing room creation ...
if (!silent) {
  await notifyNewRoom({ ... });
}
```

Unit test in `supabase/functions/_shared/__tests__/createRoom.test.ts` asserts
both branches. The UI client does **not** wire up the flag — production
behavior is byte-identical for now. Future use cases (private invitational
games, silent rooms) can flip it on the client when needed.

### Auth strategy

All test players use Supabase anonymous auth (`auth.signInAnonymously()`) —
no emails, no Google. Display name = `test_${runId}_p${n}` for traceability.
The production guest-auth flow already exercises this path, so we lose no
coverage by skipping email/Google in scenarios that don't specifically test
those flows.

## Per-test control

Three layers, from coarse to fine.

### 1. Tier selection via npm scripts

```bash
npm run test:unit
npm run test:smoke
npm run test:scenario
npm run test:e2e
npm run test:fast       # unit + smoke (~3 min)
npm run test:full       # scenario + e2e (~25 min)
npm run test:all        # everything
```

Implemented via Playwright `projects` config + Jest path patterns.

### 2. Registry — `tests/tests.config.json`

Committed file, single source of truth for what's enabled:

```json
{
  "specs": [
    { "name": "boot",                 "tier": "smoke",      "enabled": true  },
    { "name": "notrump-deal",         "tier": "scenario",   "enabled": true  },
    { "name": "play-again",           "tier": "scenario",   "enabled": false, "note": "waits on backlog item" },
    { "name": "disconnect-reconnect", "tier": "end-to-end", "enabled": false, "note": "flaky 2026-05-16, investigate" }
  ]
}
```

The orchestrator reads this, builds Playwright `--grep` and Jest path
patterns, and prints skipped specs with their notes in the final report so
no disabled test is forgotten.

### 3. CLI overrides — one-shot, no commit

```bash
npm run test:all -- --skip notrump-deal,host-exit
npm run test:all -- --only mp-2player,boot
npm run test:all -- --tag '!flaky'                  # exclude @flaky-tagged tests
```

Specs may self-tag with annotations: `test('@flaky reconnect under load', ...)`.

## Scenario inventory

### `unit` tier (Jest)

Existing files stay; one new file added.

- `src/__tests__/gameLoop.test.ts` — full game simulation 2–7 players,
  last-bidder rule, hand 4→5 notrump transition. **No changes.**
- `supabase/functions/_shared/__tests__/push-transitions.test.ts` — **no changes.**
- `supabase/functions/_shared/__tests__/push-i18n.test.ts` — **no changes.**
- `supabase/functions/_shared/__tests__/telegram.test.ts` — **no changes.**
- `supabase/functions/_shared/__tests__/createRoom.test.ts` — **NEW.**
  Asserts `silent: true` → `notifyNewRoom` not called; `silent: false` /
  omitted → called.

### `smoke` tier (8 specs, mobile + desktop)

1. `boot.spec.ts` — Welcome renders, Skip-to-Lobby reaches Lobby.
2. `lobby.spec.ts` — tabs switch, Quick Match / Create Room / Join visible.
3. `auth.spec.ts` — Sign In / Create Account / Reset Password modals open
   and close. No actual auth submission.
4. `settings.spec.ts` — theme toggle (light↔dark), language switch
   (EN→RU→ES), strings don't overflow on mobile viewport.
5. `quickmatch-entry.spec.ts` — Quick Match → SP game table appears, first
   deal renders, `my-hand` visible, `bet-btn-*` visible. **Does not play.**
6. `private-room.spec.ts` — create room (`silent: true`), code visible,
   copy-to-clipboard works; join with bad code → error.
7. `desktop-layout.spec.ts` — viewport 1440×900, all five split-pane screens
   render without horizontal scroll or panel overlap.
8. `i18n.spec.ts` — re-run boot + settings in RU + ES; assert no untranslated
   keys (`/^[a-z]+(\.[a-z]+)+$/` pattern) in DOM.

### `scenario` tier (6 specs, all state-seeded)

1. `notrump-deal.spec.ts` — seed hand 5; assert no-trump indicator, cards
   render in default suit order.
2. `winner-banner.spec.ts` — seed `game-finished`; assert
   `scoreboard-winner-banner` visible with correct winner.
3. `play-again.spec.ts` — seed `game-finished`; assert "Play again" CTA
   visible, click returns to Lobby. **Currently broken — TDD-style spec,
   `enabled: false` in registry until backlog item lands.**
4. `host-exit.spec.ts` — seed mid-game with 4 players; host calls leave;
   other 3 land on final scoreboard (not Welcome).
5. `spectator-mid-game.spec.ts` — seed running game; open
   `/join/CODE?as=spectator`; assert cards visible without `my-hand`, 👁
   tag in chat.
6. `reconnect-mid-hand.spec.ts` — seed mid-hand; close player context;
   reopen with same session; assert state restored (hand, bet, current
   trick).

### `end-to-end` tier (5 specs)

1. `sp-game.spec.ts` — current SP test, moved from `tests/`. Hard bots,
   4 players default, full game. **No content changes.**
2. `multi-2player.spec.ts` — 2 contexts, full multiplayer game to scoreboard.
3. `multi-4player.spec.ts` — 4 contexts, full multiplayer game to scoreboard.
4. `disconnect-reconnect.spec.ts` — 3 contexts; C disconnects mid-hand;
   A and B continue; C reconnects with same session; game completes.
5. `bot-takeover.spec.ts` — 3 contexts; one player stops acting; after 30 s
   server timeout the bot finishes their action; game completes.

## File layout

```
tests/
├── tests.config.json
├── playwright/
│   ├── global-setup.ts
│   └── global-teardown.ts
├── fixtures/
│   ├── seed.ts
│   ├── players.ts
│   ├── actions.ts
│   └── runtime.ts
├── smoke/      (8 specs)
├── scenario/   (6 specs)
└── e2e/        (5 specs, including moved sp-game.spec.ts)

src/__tests__/                          (existing, untouched)
supabase/functions/_shared/__tests__/   (existing + new createRoom.test.ts)

scripts/
└── run-tests.mjs                       (orchestrator, ~100 LOC)

playwright.config.js                    (extended with projects)
package.json                            (new test:* scripts)
```

### Git

- Committed: everything under `tests/**`, `scripts/run-tests.mjs`,
  `tests/tests.config.json`, the updated `playwright.config.js` and
  `package.json`.
- Gitignored: `.env.test` (contains local service-role key), `playwright-report/`,
  `test-results/`.

## Rollout phases

Each phase ships independently. `sp-game.spec.js` passes after every phase.

1. **Foundation.** Add `silent` to `createRoom`. Move
   `tests/sp-game.spec.js` → `tests/e2e/sp-game.spec.ts`. Update npm script.
   Scaffold `playwright.config.js` with empty projects. ✅ `npm run test:sp`
   green.
2. **Local Supabase + isolated Expo.** Implement `global-setup` /
   `global-teardown`. Run SP test against local Supabase on :8082. Add
   `KEEP_SUPABASE=1`. ✅ SP test green on clean local backend.
3. **Fixtures + proof-of-concept scenario.** Build `seedGame()` for one
   state (`notrump-hand-5`), minimal `players()`. Write
   `notrump-deal.spec.ts`. ✅ ~5-second green run.
4. **Smoke tier.** All 8 smoke specs. ✅ `--project=smoke` ≤3 min green.
5. **Scenario tier.** Extend `seedGame` for remaining states. Write 5 more
   specs (`play-again` `enabled: false` until feature lands). ✅
   `--project=scenario` green for enabled specs.
6. **End-to-end tier.** Multi-context helpers. Write 4 MP specs. Tune
   timeouts. ✅ `--project=e2e` green.
7. **Orchestrator + registry.** `scripts/run-tests.mjs`, `tests.config.json`,
   npm scripts. README with skip-before-release recipe. ✅
   `npm run test:fast` ≤3 min, `npm run test:all` runs everything.
8. **(Optional, later)** Minimal `.github/workflows/test.yml` for PR →
   `test:fast`. Release pipeline → `test:full`.

Phases 4 and 5 are independently shippable — if phase 5 stalls, phase 4
already gives a 3-minute pre-release smoke check.

## Risks & mitigations

- **Docker memory pressure on 24 GB Mac.** Local Supabase + Expo + Chrome
  Playwright = ~3 GB during e2e. The memory-guard hook will pause if free
  RAM drops below 2 GB. Mitigation: document closing dev Chrome before
  `test:full`; provide `KEEP_SUPABASE=1` so iteration runs don't repay
  startup cost.
- **Flake in multi-context realtime.** Reconnect timing is the most likely
  flake source. Mitigation: `enabled: false` + note is the explicit escape
  valve, not a workaround. Flaky specs get an issue + investigation, not
  retries that mask bugs.
- **`silent: true` accidentally shipping to client.** If a future PR pipes
  the flag through to the UI, Telegram broadcasts will silently stop.
  Mitigation: the createRoom unit test pins both branches; any code path
  that defaults `silent: true` will be obvious in review.
- **Test-data leakage to prod.** Local Supabase is on `127.0.0.1:54321`, prod
  is a different host. Mitigation: `globalSetup` asserts the loaded
  `.env.test` URL starts with `127.0.0.1` or `localhost` before any test
  runs; aborts otherwise.

## Open questions

None at design time. Implementation may surface details (e.g., exact
`seedGame` schema once we model the existing `rooms`/`hands`/`bets` tables)
that will be resolved in the implementation plan.
