# Testing strategy — Phase 6 (Multi-context e2e) Design

**Date:** 2026-05-17
**Status:** active
**Owner:** Akula
**Predecessor:** Phases 1-4 closed (smoke + orchestrator). Phase 5 (additional scenarios) deferred.

## Goal

Ship the first true multi-context e2e: a real 6-player room running a full 20-hand game with mixed mobile + desktop viewports. Closes the last gap in the testing tiers — multi-player sync regressions (the worst bug class per `project_sync_architecture` memory) are not catchable by sp-game or smoke.

## Strategic decisions (set in conversation)

| Question | Answer |
|---|---|
| Scope | One spec: 6p mixed (4 mobile + 2 desktop) |
| Backend | Isolated `:8082` + local Supabase via `globalSetup` (Phase 2 plumbing) |
| Game length | Full 20-hand game to scoreboard |
| Viewport mix | Fixed per spec, no env parametrisation |

## Architecture

**One spec file: `tests/e2e/multiplayer-6p-mixed.spec.ts`** under the existing `e2e` Playwright project.

- Test fixture spawns 6 browser contexts (4 mobile @ 430×932, 2 desktop @ 1440×900) and one page each.
- Player 6 (last, desktop) is host: skip-to-lobby → `tab-create` → `btn-create-room`, captures `room-code`.
- Players 1-5 join via the captured code: skip-to-lobby → `tab-join` → fill code → `btn-join-room`.
- All 6 mark `btn-ready`, host clicks `btn-start-game`.
- Each context runs a parallel `gameLoop` that handles: onboarding-tip dismissal, betting phase (tap any visible `bet-btn-*`), playing phase (tap any visible `card-*` in `my-hand`), Continue button, scoreboard end-state.
- Spec passes when ALL 6 pages observe `scoreboard-winner-banner` within the watchdog window.

## Shared helpers — new file `tests/fixtures/multiplayer.ts`

Ports the room flow + game loop from `demo/play-demo.js` into TS, adapted for Playwright Test:

- `createRoomAsHost(page, playerCount): Promise<string>` — returns 6-char code
- `joinRoomByCode(page, code): Promise<void>`
- `markReady(page): Promise<void>`
- `startGame(page): Promise<void>` — host-only
- `runGameLoop(page, opts?): Promise<'won' | 'lost'>` — bet/play/scoreboard, returns when game-over banner seen

Reuses `dismissTipIfAny`, `dismissPwaModalIfAny`, `tryBet`, `tryPlay`, `tap`, `sleep` from existing `tests/fixtures/actions.ts`. Mirrors `demo/play-demo.js` proven flow but on the headless `:8082` stack.

## Registry + npm scripts

- Registry entry: `{ "name": "multiplayer-6p-mixed", "tier": "end-to-end", "enabled": true }`.
- New scripts:
  - `test:mp` — against manual `:8081` (headed, for debugging).
  - `test:mp:local` — `LOCAL_SUPABASE=1 HEADLESS=1 DEMO_URL=:8082` (canonical, used by orchestrator).
- Orchestrator's `end-to-end` tier picks it up automatically since it's in `tests/e2e/`.

## Memory + perf budget

- 6 chromium contexts + Expo on :8082 + Supabase docker ≈ 3 GB.
- `memory-guard.sh` denies <2 GB free. Close Chrome/Slack before running on a 24 GB machine.
- Expected duration: 25-30 min headless. Wall-clock for `test:all` becomes ~55 min (was ~30 min — sp-game stays, adds mp).

## Mitigations

- Per-action timeout bumped to 20 s for this spec (multi-context contention on :8082).
- Project-level `retries: 1` so a single transient flake doesn't burn the whole 30 min.
- Watchdog: spec fails if no progress (no Continue / bet / play tapped on ANY page) for 90 s.
- All 6 pages log via `console.log(\`[P${i}] ...\`)` so failure attribution is trivial in trace output.

## Out of scope (Phase 6.1+)

- Mid-game host exit / promotion (memory item)
- Player reconnect after disconnect
- Spectator mode
- Chat assertions

These get separate, smaller specs once the base mp spec proves the harness works.

## Definition of done

- `npm run test:mp:local` exits 0 in ≤45 min on a clean machine.
- `npm run test:all` runs unit → smoke → smoke-desktop → scenario → sp-game → multiplayer-6p-mixed and exits 0.
- `tests/tests.config.json` enumerates the new spec; toggling `enabled: false` honoured.
- README documents the new scripts + the memory caveat.
