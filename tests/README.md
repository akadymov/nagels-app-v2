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

## Status (Phase 4 — Smoke + orchestrator shipped)

- ✅ `tests/e2e/sp-game.spec.js` — single-player vs Hard bots, full game.
  - Manual `:8081` dev server: `npm run test:sp`
  - Isolated `:8082` Expo + local supabase: `npm run test:sp:local`
- ✅ `tests/scenario/notrump-deal.spec.ts` — POC scenario.
  - `npm run test:scenario:local` (~6 min spec + ~1 min boot)
- ✅ `tests/smoke/*.spec.ts` — 7 mobile + 1 desktop spec against `:8081`.
  - `npm run test:smoke` (~90s)
  - `npm run test:smoke:desktop` (~30s)
- ✅ Reusable click helpers `tests/fixtures/actions.ts`.
- ✅ Scenario seeding `tests/fixtures/seed.ts`.
- ✅ Smoke helpers `tests/fixtures/smoke.ts`.
- ✅ Edge-function unit tests: `cd supabase/functions && deno test --allow-all`.
- ✅ Cross-tier orchestrator: `npm run test:all` (see Orchestrator section below).
- ⏳ Additional scenarios / multi-context e2e — Phase 5+.

## Running

| Command | What it runs | Backend | Duration |
|---|---|---|---|
| `npm run test:unit` | jest unit suite | none | ~2s |
| `npm run test:smoke` | 9 mobile smoke specs | manual `:8081` | ~40s |
| `npm run test:smoke:desktop` | 2 desktop-layout specs | manual `:8081` | ~5s |
| `npm run test:fast` | unit + smoke + smoke-desktop | manual `:8081` | ~50s |
| `npm run test:sp` | SP e2e (full game vs bots) | manual `:8081`, headed | ~13 min |
| `npm run test:sp:local` | same SP e2e | isolated `:8082` + local Supabase | ~22 min |
| `npm run test:scenario:local` | scenario tier (notrump-deal) | isolated `:8082` + local Supabase | ~7 min |
| `npm run test:all` | all five tiers via orchestrator | manual `:8081` + isolated `:8082` | ~30 min |
| `npm run test:sp:prod` | SP e2e against `$APP_URL` | production | — |

Edge-function tests run separately for now — they're Deno suites, not Jest. Orchestrator integration is a Phase 7+ task; until then the registry's `unit` tier only carries the three real Jest specs (`gameLoop`, `engine`, `local-backend`).

```bash
cd supabase/functions && deno test --allow-all
```

## Environment flags

All scripts honour these env vars — prepend on the CLI to override:

| Flag | Effect | Default |
|---|---|---|
| `HEADLESS=1` | Run Chromium headless (CI / background runs) | unset → headed with `slowMo: 80` |
| `SLOW_MO=N` | Per-action delay in ms (headed mode only) | `80` |
| `DEMO_URL=…` | Override the URL Playwright hits | `:8081` (or `:8082` w/ LOCAL_SUPABASE) |
| `LOCAL_SUPABASE=1` | Boot isolated Supabase + Expo on `:8082` via `globalSetup` | unset → manual `:8081` |
| `KEEP_SUPABASE=1` | Don't `supabase stop` on teardown — reuse stack on next run | unset → full teardown |
| `TILE_WINDOWS=1` | Headed parallel run with tiled Chromium windows (smoke only) | unset → serial single window |

Examples:

```bash
HEADLESS=1 npm run test:smoke              # CI-style headless
SLOW_MO=300 npm run test:smoke             # slower playback for live review
TILE_WINDOWS=1 npm run test:smoke          # 6-up tiled layout (see Smoke tier section)
KEEP_SUPABASE=1 npm run test:sp:local      # reuse local stack across runs
DEMO_URL=$APP_URL npm run test:smoke       # smoke against staging/production
```

## Local backend (LOCAL_SUPABASE=1)

`globalSetup` (in `tests/playwright/global-setup.ts`) boots a fully
isolated test backend:

1. `supabase start` — Postgres + Auth + Realtime + edge-runtime on
   `127.0.0.1:54321` (Studio + Inbucket disabled for memory).
2. `supabase db reset --local --no-seed` — applies the baseline
   migration (`supabase/migrations/<ts>_remote_schema_baseline.sql`,
   captured from prod via `supabase db dump`) to a clean DB.
3. Writes a gitignored `.env.test` with the local URL/anon key.
4. Spawns `npx expo start --port 8082` with those env vars forced
   into the child process — your `:8081` dev server is not touched.
5. Polls `http://localhost:8082` until the bundler responds.

`globalTeardown` reverses (5) → (1), removes `.env.test`, and skips
the `supabase stop` step if `KEEP_SUPABASE=1` was set — useful for
fast iteration:

```bash
KEEP_SUPABASE=1 npm run test:sp:local    # 1st run pays the boot cost
KEEP_SUPABASE=1 npm run test:sp:local    # 2nd run reuses the stack
supabase stop --no-backup                # when done
```

**Memory budget:** the docker stack is ~1 GB; add Chrome + Expo +
Playwright and the run sits around ~3 GB. The `memory-guard.sh`
hook denies the launch if free RAM drops below 2 GB — close other
heavy apps if you see a deny.

**Safety:** `globalSetup` aborts the run if the URL returned by
`supabase status` is not `127.0.0.1`/`localhost`. Tests cannot
accidentally hit production.

The old numbered migrations (001-029) that don't apply cleanly from
an empty DB live in `supabase/migrations.legacy/` for historical
reference. They're not picked up by `db reset`.

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

## Smoke tier (`tests/smoke/`)

8 specs that prove the app boots, renders, and navigates. Runs against
the manual `:8081` dev server — start it yourself with
`npx expo start --port 8081` before running.

| Spec | What it proves |
|------|---------------|
| `boot.spec.ts` | Welcome renders, Skip-to-Lobby navigates to Lobby. |
| `lobby.spec.ts` | Tabs switch, Quick Match / Create / Join CTAs render. |
| `auth-modals.spec.ts` | Auth screen opens, sign-in/sign-up tabs toggle. |
| `settings.spec.ts` | Theme + language pills change on click. |
| `quickmatch-entry.spec.ts` | Quick Match reaches game table. |
| `private-room.spec.ts` | Bad join code surfaces an error. |
| `i18n.spec.ts` | No untranslated keys in EN/RU/ES. |
| `desktop-layout.spec.ts` | 1440×900 layout has no overflow / pane overlap. |

**Why `:8081` and not `:8082`?** Smoke is the fast, side-effect-free
pre-commit check. The local Supabase stack adds ~1 min boot and
hits Postgres / Realtime / Auth for assertions that don't need them.
Keep the heavy stack for scenario + e2e.

**Why not auto-start the dev server?** Auto-spawn would conflict with
the one Akula already has open in a browser. Smoke fails fast with
the start command in the error message if `:8081` is dead.

**Adding a new smoke spec:**
1. Drop a `<name>.spec.ts` in `tests/smoke/`. It auto-picks-up.
2. Call `ensureDevServer()` in `test.beforeAll`.
3. Use existing `data-testid` selectors; if none exists, add a
   testID to the production component (single-token, no behaviour
   change — see Task 1 of the Phase 4 plan).

**Tiled headed mode (visual review on a big monitor):**

```bash
TILE_WINDOWS=1 npm run test:smoke           # 6 windows in a row, parallel
TILE_WINDOWS=1 npm run test:smoke:desktop   # cascade with 20% rightward shift
```

Default Playwright run is serial (`workers: 1`, headed with slowMo).
Setting `TILE_WINDOWS=1` bumps to `workers: 6 + fullyParallel: true`
and positions each worker's Chromium window via `--window-position`
based on `TEST_PARALLEL_INDEX`. Mobile: row layout (6 per row,
470×1000 each — 7th wraps to row 2). Desktop: cascade with a 296px
(20% × 1480) rightward shift + 40px vertical drop per worker.
Scenario and e2e tiers are untouched.

**Caveats:**

- `TILE_WINDOWS=1` is incompatible with `HEADLESS=1` — headless
  Chromium ignores `--window-position`. Make sure `HEADLESS` is
  unset (`echo $HEADLESS` should print nothing).
- Mobile row needs a monitor ≥ **2880px wide** to fit all 6 windows
  on one row (6 × 470 = 2820 + slack). Narrower screens visually
  wrap, but `TEST_PARALLEL_INDEX` still assigns row=0 — the OS just
  clamps the off-screen windows. To change the per-row count, edit
  `tileMobileArgs()` in `playwright.config.js` (`perRow` constant).
- Window size/shift constants also live in `tileMobileArgs()` /
  `tileDesktopArgs()` — tweak there if your display geometry differs.
- Inside `npm run test:all` the flag only affects the smoke tiers;
  scenario and e2e still run on the isolated `:8082` stack
  (headless by orchestrator design).

## Cross-tier orchestrator (`npm run test:all`)

Reads `tests/tests.config.json` and runs each tier in order:
`unit → smoke → smoke-desktop → scenario → end-to-end`.

```bash
# Pre-commit: ~2 min (no Docker, requires :8081 up).
npm run test:fast

# Pre-push: ~30 min (boots Supabase + isolated Expo, also requires :8081 up).
npm run test:all

# CLI overrides (do NOT mutate the registry):
npm run test:all -- --skip notrump-deal,sp-game
npm run test:all -- --only boot,lobby
npm run test:all -- --tag '!flaky'
```

**Where to find spec names** for `--only` / `--skip`: open
`tests/tests.config.json` — the `name` field of each entry is exactly
what the CLI flags expect. Quick listing:

```bash
node -e "require('./tests/tests.config.json').specs.forEach(s => console.log(s.tier.padEnd(15), s.name))"
```

**Registry semantics:**

`tests/tests.config.json` is a single committed JSON file. Each entry:

| Field | Required | Meaning |
|-------|----------|---------|
| `name` | yes | Spec basename without extension. Must match a real spec file. |
| `tier` | yes | One of `unit`, `smoke`, `smoke-desktop`, `scenario`, `end-to-end`. |
| `enabled` | yes | If `false`, the spec is silently skipped, but always shown in the summary's skip report. |
| `note` | no | Shown in skip report alongside the spec name. |
| `tags` | no | String array for `--tag` filtering. |

**Skip vs registry vs CLI precedence**:

1. `enabled: false` always wins.
2. `--only` narrows the set after registry filtering.
3. `--skip` removes from the narrowed set.
4. `--tag` removes by tag predicate.

All skipped specs are listed in the final summary block so nothing
disappears silently.

**Adding a new spec to the registry:**

1. Add an entry to `tests/tests.config.json`.
2. Run `npm run test:all -- --only <new-name>` and confirm the
   right tier runs.
3. The orchestrator warns (but does not fail) if a registry entry
   has no matching spec file on disk — that's how stale entries get
   noticed.

## Monitoring and cleanup

`test:all` runs for ~30 min, often invoked with `&` or in a background
shell. Quick recipes:

```bash
# Anything test-related running right now?
ps aux | grep -E "playwright|test-all|tsx scripts" | grep -v grep

# Local Supabase Docker containers (booted by globalSetup):
docker ps --filter "name=supabase" --format 'table {{.Names}}\t{{.Status}}'

# Is the isolated test Expo (:8082) listening? (it's gone after teardown)
lsof -i :8082 -sTCP:LISTEN -P -n
```

Background runs spawned with `&` write to your shell's stdout; if you
redirected to a file, tail it:

```bash
npm run test:all > /tmp/testall.log 2>&1 &
tail -f /tmp/testall.log     # Ctrl-C to detach (job keeps running)
```

**Interrupting a run** (e.g., to start over after fixing a flaky spec):

```bash
# 1. Kill the orchestrator (children die with it):
ps aux | grep "tsx scripts/test-all" | grep -v grep | awk '{print $2}' | xargs kill

# 2. If Supabase Docker stack is still up after the kill:
supabase stop --no-backup

# 3. Stale isolated Expo on :8082 (rare — globalTeardown usually wins):
lsof -i :8082 -t | xargs -r kill
```

**Artifacts from a failed run** live under `test-results/` (gitignored):

```bash
ls test-results/                                  # failed-spec folders
npx playwright show-trace test-results/<dir>/trace.zip   # interactive trace viewer
open test-results/<dir>/video.webm                # record of the actual run
```

`test-results/` is wiped at the start of every new Playwright invocation, so save anything you want to keep before the next run.

## Conventions

- All test fixtures create rooms with `silent: true` so the Telegram
  channel is not spammed during runs. See `createRoom` action type
  (`silent?: boolean`).
- Test artifacts are tagged `test_<runId>_*` to allow easy cleanup and
  manual debug after failures.
