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
