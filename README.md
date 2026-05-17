# Nagels Online

A real-time multiplayer trick-taking card game built with Expo, Supabase, and Zustand.

> Related docs: [`docs/principles.md`](docs/principles.md) (working agreement on repo/commits/docs) • [`docs/BACKLOG.md`](docs/BACKLOG.md) (task kanban) • [`CLAUDE.md`](CLAUDE.md) (agent instructions)

## Features

- **Full game engine** — 20 hands per game, trump suits, bidding, tricks, scoring
- **Single player** — play against AI bots (Easy / Medium / Hard)
- **Multiplayer** — create rooms, invite friends, real-time sync with chat
- **Mobile-first** — glassmorphic UI with haptic feedback, optimized for 6.1"–6.7" screens
- **Guest-first** — no registration required, anonymous or email/password auth
- **i18n** — English, Russian, Spanish

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Expo (React Native) |
| Language | TypeScript |
| Backend | Supabase (Auth, Database, Realtime) |
| State | Zustand |
| i18n | i18next |

## Getting Started

```bash
# Install dependencies
npm install

# Create .env.local with your Supabase credentials
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Start dev server
npx expo start --port 8081
```

## Project Structure

```
src/
├── game/rules.ts           — Game engine (immutable logic)
├── screens/                — 8 screens (Welcome, Lobby, GameTable, etc.)
├── components/             — Cards, BettingPhase, AuthModal, ChatPanel
├── lib/bot/botAI.ts        — AI bots (3 difficulty levels)
├── lib/supabase/           — Auth, sync, room management
├── lib/multiplayer/        — Event handling, state sync, reconnection
├── store/                  — Zustand stores (game, auth, multiplayer)
└── i18n/locales/           — EN / RU / ES translations
```

## Scripts

| Command | Description |
|---------|-------------|
| `npx expo start --port 8081` | Start dev server |
| `npm run tunnel` | ngrok tunnel for device testing |
| `npm run demo` | 2-player automated demo |
| `npm run demo:6players` | 6-player automated demo |

## Testing

Three commands map to three release-day situations:

| Situation | Command | Time | What runs |
|---|---|---|---|
| **Releasing a feature to prod** | `npm run smoke` | ~50s | jest unit + 9 smoke specs + 2 desktop-layout specs (headless, no Docker) |
| **Big changes / sanity check** | `npm run sanity` | ~30 min | Full 6-player game (4 mobile + 2 desktop) against an isolated stack, watch it play |
| **Recording a demo / feature showcase** | `npm run demo:record` | ~60–90 min | Same 6 players with fixed lang/theme/deck configs, deep-link join, per-hand chat + scoreboard + last-trick. Video.webm per player. |

Requirements:
- `smoke` — needs `:8081` dev server up (`npx expo start --port 8081`).
- `sanity` and `demo:record` — boot their own isolated `:8082` + local Supabase via Playwright globalSetup; Docker required.

Full five-tier suite (`unit` / `smoke` / `smoke-desktop` / `scenario` / `end-to-end`), env flags, CLI filters, registry, monitoring background runs, cleanup — in **[`tests/README.md`](tests/README.md)**.

```bash
npm run test:all                # full regression run, all 5 tiers (~55 min)
```

## Game Rules

Nagels is a trick-taking card game for 2–6 players using a 36-card deck (6 through Ace). Each game consists of 20 hands with varying card counts. Players bid on tricks they expect to win — exact bids score points, misses cost points. Strategy comes from trump management, card counting, and reading opponents' bids.

Full rules: [Legacy reference](https://github.com/akadymov/nagels-app/blob/main/api/info_en.html)

## License

Private
