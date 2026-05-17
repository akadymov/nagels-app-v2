# Testing — Phase 6 addendum: multiplayer-demo (feature-touching showcase)

**Date:** 2026-05-17
**Status:** active
**Owner:** Akula
**Predecessor:** `multiplayer-6p-mixed.spec.ts` (baseline 6p e2e). This addendum is a SEPARATE spec.

## Goal

A fixed, opinionated **6-player demo spec** that touches every major MVP feature in one run. Used for:

- Manual visual review when Akula wants to confirm "all the things still work" end-to-end
- Recording demo videos (Playwright produces `video.webm` per context)
- Catching cross-feature regressions that the minimal baseline misses

Crucially **NOT a regression test** — best-effort, no hard `expect()` assertions on the showcased features. Result of a run = video + console logs.

## Player roster (immutable)

| # | Account | Lang | Theme | Deck | Auth | Viewport | Entry path | Role |
|---|---|---|---|---|---|---|---|---|
| P1 | alice@nigels.test | EN | light | 4-color | registered (seed) | mobile | login | **host** |
| P2 | bob@nigels.test | RU | dark | 4-color | registered (seed) | mobile | login → code | — |
| P3 | (anonymous) | ES | light | 2-color | guest | mobile | guest → **deep-link** /join/CODE | nickname change |
| P4 | dave@nigels.test | EN | dark | 4-color | registered (seed) | mobile | login → code | — |
| P5 | eve@nigels.test | RU | light | 4-color | registered (seed) | desktop | login → code | — |
| P6 | (anonymous) | ES | dark | 2-color | guest | desktop | guest → **deep-link** /join/CODE | nickname change |

Rules baked into this table (per user's directive):

- Languages cycle EN/RU/ES every player; first 3 different + next 3 different.
- Every 2nd player (P2/P4/P6) is dark theme.
- Every 3rd player (P3/P6) has 2-color deck.
- Every 3rd player (P3/P6) is guest with manual nickname change in Lobby.
- Every 3rd player (P3/P6) joins via deep-link `/join/CODE` (the rest type the code in `tab-join`).
- P1 (first registered, host) creates the room.

Registered players' theme/lang/deck come from server-side `user_metadata` seeded via migration — no Settings clicks needed on boot. Guests' theme/lang/deck are set manually via the Settings modal in the Lobby pre-room-join (showcases that flow).

## Per-hand interactions (best-effort)

Each player tries to perform these during *every* hand. Failures log a warning but never throw.

**Mobile players (P1–P4):**

- Send ≥1 chat message (betting phase or playing phase)
- View previous trick at least once (from hand 2+, via `game-btn-last-trick`)
- Open Scoreboard once (via `game-btn-scoreboard` / equivalent)

**Desktop players (P5, P6):**

- Toggle right pane: Scoreboard → Profile → Scoreboard
- Toggle chat panel: close → open

Counters are tracked per player and printed in the final summary. The spec passes regardless of counts; the human reviewer reads the summary alongside video.

## Architecture

**One spec file:** `tests/e2e/multiplayer-demo.spec.ts`.

**Helpers:** new `tests/fixtures/multiplayer-demo.ts` extends `multiplayer.ts`:

- `loginAsRegistered(page, email, password)` — Welcome → Sign-in → auth screen → submit → Lobby.
- `applyGuestSettings(page, prefs)` — Settings modal → set theme/lang/deck/avatar pills → close.
- `changeNicknameInLobby(page, nickname)` — focus `input-player-name`, replace text, blur.
- `joinViaDeepLink(page, code)` — direct nav to `/join/CODE`, wait for WaitingRoom.
- `sendChatMessage(page, phase, text)` — `betting-chat-input` or game-chat panel.
- `viewLastTrick(page)` — open + close the last-trick modal.
- `openScoreboardMobile(page)` / `toggleDesktopRightPane(page)` / `toggleDesktopChat(page)`.
- `runDemoGameLoop(page, opts)` — extended version of `runGameLoop` that injects per-hand actions on each `Continue` boundary.

**Test accounts seeding:** new migration `supabase/migrations/<ts>_seed_demo_accounts.sql`:

- 4 accounts (alice/bob/dave/eve@nigels.test), all `email_confirmed_at` set
- Password hashes for `demo-pass-1234` (env-overridable via `DEMO_LOGIN_PASS`)
- `user_metadata` populated with: `display_name`, `lang`, `theme`, `deck`, `avatar`

The migration runs as part of `supabase db reset` in globalSetup, so the accounts exist on every isolated `:8082` stack. Idempotent (`ON CONFLICT (email) DO NOTHING`).

## Registry + npm scripts

- Registry entry: `{ "name": "multiplayer-demo", "tier": "end-to-end", "enabled": false, "note": "Demo, not regression — run manually with npm run demo:full" }`.
- New scripts:
  - `demo:full:local:headed` — canonical: isolated `:8082` + local Supabase, **headed**, `slowMo=120` (slightly slower so the showcase reads well on video).
  - `demo:full:local` — same but headless (for CI-record).
  - `demo:full` — against manual `:8081` (relies on dev's `.env.local` being prod; only useful for sanity-checking demo logic locally).

## Memory + perf budget

- 6 chromium contexts × ~20 hands × ~2.5 min/hand + interaction overhead = **45-90 min wall-clock**.
- Demo intentionally long; not run in CI.
- 24 GB MacBook should handle it if Chrome/Slack are closed.
- `test.setTimeout(2 * 60 * 60 * 1000)` (2 h) so a slow demo machine survives.

## Definition of done (this addendum)

- `npm run demo:full:local:headed` runs to scoreboard, exits 0.
- Console output contains per-player interaction counters at finish.
- `video.webm` for each of 6 contexts in `test-results/multiplayer-demo-*/`.
- `tests/tests.config.json` lists `multiplayer-demo` with `enabled: false`.
- `tests/README.md` gains a Multiplayer demo section.

## Out of scope

- Reconnect, host exit, spectator (Phase 6.1+).
- Mid-game language switching (separate scenario spec material).
- Bot inclusion (this spec is humans-only; bot mixed-table is a future addition).
