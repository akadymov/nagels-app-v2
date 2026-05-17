# CLAUDE.md — Nagels Online

See [Project principles](docs/principles.md). Re-read at the start of every session.

## Stack
Expo (React Native) + TypeScript + Supabase + Zustand

## Run
```bash
npx expo start --port 8081   # Dev server
npm run tunnel               # ngrok tunnel (device testing)
npm run demo                 # 2-player Playwright demo (legacy Node script)
npm run demo:6players        # 6-player demo (legacy Node script)
```

## Testing — which command to run when

Three release-day situations map to three commands:

| Situation | Command | Time | Asserts |
|---|---|---|---|
| **Releasing a feature to prod** — pre-merge gate | `npm run smoke` | ~50s | jest unit + 9 smoke + 2 desktop-layout |
| **Big refactor / many changes** — manual confidence run | `npm run sanity` | ~30 min | full 6-player real-supabase game reaches scoreboard |
| **Recording a feature-touching demo** | `npm run demo:record` | ~60–90 min | best-effort, video.webm + summary (no hard asserts) |
| Full regression (pre-push) | `npm run test:all` | ~55 min | all 5 tiers in order |

### Rules of thumb for agents

- **Always run `npm run smoke` before suggesting a feature is ready for prod** — it's ~50s and catches obvious breakage. The user expects this gate.
- **Do NOT auto-trigger `sanity` or `demo:record` without explicit user consent** — they take 30–90 min, eat ~3 GB RAM (6 chromium contexts + Docker), and risk a kernel panic on the 24 GB MacBook if other heavy apps are open.
- `smoke` needs the `:8081` dev server running (the user usually has it open). If `lsof -i :8081` is empty, surface that as a blocker, don't try to start it for the user.
- `sanity` and `demo:record` boot their own isolated `:8082` Expo + local Supabase via Playwright `globalSetup`; the user's `:8081` is untouched.
- For interpreting failures: detailed troubleshooting in `tests/README.md` (Multiplayer e2e + Multiplayer DEMO sections).

## Keeping tests in sync with src changes

Tests reference production `testID` props by string. When src changes, tests can silently rot or get out of sync. Tooling:

- `npm run test:lint` — scans src for `testID="..."` / `testIDPrefix="..."` and tests for `[data-testid="..."]` / `tap(p, "...")` / `exists(p, "...")` calls. Surfaces:
  - **Orphans** — testIDs referenced in tests but missing from src (rename / removal). Warning, doesn't fail.
  - **Uncovered** — testIDs in src that no test references. Counter + entries in `tests/TEST_TODO.md`.
- Runs automatically as part of `npm run smoke` (`test:fast`). Exit code is always 0.
- `npm run test:lint -- --update-todo` rewrites the auto-section of `tests/TEST_TODO.md`.
- `npm run test:lint -- --verbose` prints the full uncovered list.

### Agent responsibilities

Whenever you (or another agent) **add, rename, or remove a `testID`** in `src/`:

1. Run `npm run test:lint` and surface the orphan list to the user. If an orphan is a rename, propose the test-side change. If it's a deliberate removal, propose the spec deletion.
2. If you introduce a **new testID** (new screen, new button, new modal), run `npm run test:lint -- --update-todo` so `tests/TEST_TODO.md` reflects it. Briefly mention it in your final user message — e.g., "Added testID `btn-foo`; appended to TEST_TODO.md, please decide if it needs smoke coverage."
3. If you **change a UX flow** (extra confirmation modal, reordered steps), the existing testIDs may still match but the flow no longer matches the test's assumptions. testIDs only tell you what's wired — they don't tell you what's correct. Read affected specs (`tests/smoke/`, `tests/e2e/`) and decide whether the spec needs updates. Surface to the user.

The user works alone and forgets easily. **Visibility > automation.** A short final-message line — "test:lint shows 3 orphans I think we should fix" — is exactly what they need.

## Env
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_APP_URL`

## Key Principles
- **Mobile-first**: all UI validated for 6.1"–6.7" screens (Safari/Chrome/PWA)
- **Guest-first**: no registration required to play
- **i18n**: full EN / RU / ES support
- **Game logic is immutable**: Nagels rules preserved from [legacy reference](https://github.com/akadymov/nagels-app/blob/main/api/info_en.html)

## Sources of Truth
- [Legacy codebase](https://github.com/akadymov/nagels-app) — original Svelte/Firebase implementation
- [Product roadmap spreadsheet](https://docs.google.com/spreadsheets/d/117oYt6tzSbarLFpdtWTk-ohP1Usm7WvgBH-RtXKfbB4/edit?gid=1424757228#gid=1424757228)

## Workflow
Akula (User) provides strategic direction. Specialized agents in `.claude/agents/` handle domain-specific tasks. See `.claude/rules/` for immutable constraints.
