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

## Status (Phase 2 — Local Supabase + isolated Expo)

- ✅ `tests/e2e/sp-game.spec.js` — single-player vs Hard bots, full game
  to scoreboard.
  - Against the manual `:8081` dev server: `npm run test:sp`
  - Against an isolated `:8082` Expo + local supabase: `npm run test:sp:local`
- ✅ Edge-function unit tests: `cd supabase/functions && deno test --allow-all`
- ✅ Local backend orchestration via `tests/playwright/global-setup.ts` +
  `global-teardown.ts`. Activated by `LOCAL_SUPABASE=1`.
- ⏳ Smoke / scenario / multi-context layers — Phase 3+.

## Running

```bash
npm run test:sp           # SP e2e against manual :8081 dev server (headed)
npm run test:sp:local     # SP e2e against isolated :8082 + local supabase (headless)
npm run test:sp:prod      # same but against $APP_URL (production)
```

Edge-function tests (run separately for now — orchestrator in Phase 7):

```bash
cd supabase/functions && deno test --allow-all
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

## Conventions

- All test fixtures create rooms with `silent: true` so the Telegram
  channel is not spammed during runs. See `createRoom` action type
  (`silent?: boolean`).
- Test artifacts are tagged `test_<runId>_*` to allow easy cleanup and
  manual debug after failures.
