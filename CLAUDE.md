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
