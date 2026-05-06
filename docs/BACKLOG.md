<!--
Связанные документы: [principles](principles.md) • [README](../README.md) • [CLAUDE](../CLAUDE.md)
Колонки внизу читаются расширением Markdown Kanban для VS Code как доска (## = column, ### = card). Карточки описаны кратко; расширенные обсуждения и ADR живут отдельными файлами в docs/.
-->

## Backlog

### Discord integration

OAuth login + bot. "Sign in with Discord" to skip the
manual signup flow. A Discord bot that can post game-results to a
configured channel (room.discord_webhook?), and ideally support
"play with my Discord friends" — invite link posted by the bot,
joinable from the Discord button. Requires Discord Developer
Application + bot token.

### Push notifications — "Your turn", "Game started"


### Sound effects — card played, bonus earned, turn notification


### Custom game modes — replace 1-card rounds with 2-card rounds


### Offline scorekeeper — record real-life game results without card dealing, manual score entry


### Conditional stakes — agree on stake before game, winners earn rating points, losers pay difference




### Player stats — game history, win rate, exact bid percentage


### Leaderboard — global rankings


### Lobby chat — general chat for finding players and socializing


### Video/voice chat — "home game" atmosphere during multiplayer


### Table/skin customization — visual themes


## Next Up

## In Progress

## Done

### Project principles + repo hygiene

docs/principles.md captures the working agreement: file roles
(CLAUDE.md / README.md / docs/BACKLOG.md / docs/<topic>.md), commit
discipline (Conventional Commits, ≥1 commit/6h, no force-push to
main, cherry-pick-first integration), kanban backlog structure, and
the personal-memory vs shared-docs split. CLAUDE.md links to it; no
duplication. Repo root cleaned (PROJECT_STATUS.md, BACKLOG.pdf, stray
screenshots/recordings dropped); .gitignore tightened with anchored
patterns. .env.example added documenting all EXPO_PUBLIC_* vars.

### Rich feedback metadata — device, browser, settings, viewport

Feedback submissions now ship a debug context object in the `extra`
JSONB column: deviceType (mobile/tablet/desktop), deviceModel,
osVersion, browser, appLanguage + systemLocale + systemLocales,
userType (guest / guest-pending-email / registered),
themePreference + themeResolved + fourColorDeck + hapticsEnabled,
viewport WxH + visualViewport height (catches iOS Safari URL-bar
state), pixelRatio, orientation, isPWA, online, timezone,
tzOffsetMin, timestamp. Best-effort UA parsing without a dep.

### TTL cleanup — 24h auto-delete of stale rooms and inactive guest accounts

pg_cron jobs run hourly: stale-rooms at :15, stale-guests at :45.
Rooms with no player heartbeat in 24h are dropped (cascades to hands,
plays, events). Anonymous auth.users with no recent room activity AND
no recent sign-in in 24h are deleted (cascades to room_sessions).
Email-confirmed users are never touched. First pass cleared 47/49
rooms and 1003/1083 guests.

### Haptic feedback on key gameplay events

cardSelect, betPlaced, trickWonByMe, bonusEarned (perfect bid), and
gameWon all fire native haptics via expo-haptics on iOS/Android, with
a navigator.vibrate fallback on Android web (iOS Safari has no
Vibration API). Settings → Vibration toggle persists to AsyncStorage
+ user_metadata.

### Installable PWA — manifest + service worker + icons

Site is now installable on Android Chrome ("Install app" prompt) and
iOS Safari ("Add to Home Screen" → standalone shell). Minimal
service worker is pass-through only (no offline cache, deliberately —
keeps every Vercel deploy authoritative).

### Reconnect resilience — graceful disconnect, rejoin, bot takeover on timeout, fix realtime subscriptions


### In-game onboarding — contextual hints on first launch (bid, play, trump) shown at right moment



### Design system (Figma) — 3 pages, 11 screens, 9 components


### Scoreboard redesign — table layout with score history per round, bonus circles, ▶ first player


### Reset password flow

  - defaultExpanded: false

### Theme system — light/dark with system auto-detect


### Settings screen — theme, deck colors, language


### All screens themed — Welcome, Lobby, Betting, GameTable, Scoreboard, Chat, rooms


### PlayingCard redesign — themed, yellow selection, 4 sizes


### GameTable layout — green/gray table, icon top bar, semi-transparent profiles


### Auth flow — guest-to-registered conversion, login/register before first game, profile management


### BettingPhase — poker chips, smart hints, player grid


### Welcome + Lobby redesign — Akula logo, tab-based lobby


### i18n — all UI strings EN/RU/ES


### Vercel deployment — nigels-app-v2.vercel.app


### GitHub repo — github.com/akadymov/nagels-app-v2


