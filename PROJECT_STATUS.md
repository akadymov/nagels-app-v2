# PROJECT STATUS — Nagels Online
_Last updated: 2026-03-29_

---

## Current State

**Stage:** MVP ready. Functional, can be published and tested.
First live tests completed with real users (friends).

**Stack:** Expo (React Native) + TypeScript + Supabase + Zustand

---

## What's Implemented and Working

| Area | Status | Details |
|------|--------|---------|
| Game rules | Done | Full engine: 20 hands, trumps, bids, tricks, scoring |
| Single player vs bots | Done | Easy / Medium / Hard AI |
| Multiplayer | Working | Rooms, codes, real-time sync, chat, reconnect |
| Auth | Implemented | Anonymous + email/password, sessions via AsyncStorage |
| i18n | Complete | EN / RU / ES |
| Mobile UI | Ready | Glassmorphic design, haptics, safe areas |
| Chat | Working | Real-time with deduplication |
| Demo scripts | Available | Playwright: 2-player and 6-player auto-demo |

---

## Known Issues

### Critical / Pre-launch

- **Design** — Early users (friends) had complaints. Specific feedback not yet collected.
- **Session persistence** — Unclear how reliably sessions survive app restart. Need to test: login -> close -> reopen.
- **Realtime room subscriptions** — Disabled due to payload format issues. Using polling. TODO in `src/lib/supabase/client.ts:120`.
- **Hidden bugs** — Likely exist but not documented. Need proper tests.

### AI Bots

- **Bots feel weak** — Strategy is unpredictable/confusing rather than challenging. Easy/Medium/Hard implemented, but Hard bot doesn't feel smart.
- Logic in `src/lib/bot/botAI.ts` (456 lines).

### Testing

- `gameLoop.test.ts` exists (basic hand transition test, hands 1-5)
- Playwright demo scripts exist but are demos, not tests
- **No comprehensive test coverage**: edge cases, multiplayer sync, auth flows not covered

---

## Next Steps: Pre-launch

1. **Collect design feedback** — gather specific complaints from users, fix them
2. **Verify sessions** — ensure users don't get kicked after app restart
3. **Improve AI bots** — rework strategy to be smarter and more predictable
4. **Tests** — write integration tests: auth flow, game flow, multiplayer sync
5. **Fix realtime** — resolve room subscription issues, remove polling workaround
6. **Deploy** — choose and configure deployment platform

---

## Backlog: Post-launch

- **Voice chat** — not implemented, planned
- **Video calls** — not implemented, planned ("home game" atmosphere)
- **Leaderboard** — not implemented
- **Point stakes** — each point = virtual amount, adds excitement (no real money)
- **Custom games** — skip 1-card hands, play 2+ card rounds multiple times
- **Table/skin customization** — visual themes
- **Push notifications** — "your turn", "game started"
- **Player stats** — game history, exact bid percentage

---

## Technical Map

```
src/
├── game/rules.ts          — Game engine (20 KB, immutable logic)
├── screens/               — 8 screens, main: GameTableScreen.tsx (1479 lines)
├── lib/bot/botAI.ts       — AI bots (456 lines, 3 levels)
├── lib/supabase/          — Auth, sync, room management
├── store/                 — Zustand: gameStore (38KB), authStore, multiplayerStore
├── i18n/locales/          — EN / RU / ES translations
└── components/            — Cards, BettingPhase, AuthModal, ChatPanel
```

**Env vars:** `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_APP_URL`

---

## How to Run

```bash
npx expo start --port 8081   # Dev server
npm run tunnel               # ngrok tunnel (device testing)
npm run demo                 # 2-player Playwright demo
npm run demo:6players        # 6-player demo
```
