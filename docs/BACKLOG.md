## Backlog

### Push notifications — follow-ups

  - Desktop Chrome subscription doesn't complete via Settings toggle when `Notification.permission` is already `granted` from earlier attempts. PWA path works. Likely stale SW or stale `pushManager` subscription bound to a previous VAPID key. Reset path (chrome://settings/content/notifications → remove site → unregister SW → reload) confirmed manual workaround. Need a client-side detect-and-resubscribe step when state probe finds a granted permission but no fresh subscription, or surface the reset hint in-UI.
  - Notification click on phone opens lobby with "Game already started" toast instead of dropping the player back into the live game. SW posts `{kind:'push:navigate', room_code}` and `App.tsx` routes via `/join/<code>`, which goes through the new-player join flow and rejects mid-game. Need a separate "resume" path that resolves the player's existing seat by `auth_user_id` (server already has the snapshot) and lands them on `GameTable` directly. This unblocks rejoining after disconnect / app close, not only from notifications.
  - Logout / account-switch on a shared device leaves the previous user's `push_subscriptions` row pointing at the same SW endpoint until the new user subscribes. New subscriber's `push-subscribe` claims the endpoint by deleting other-user rows for the same endpoint, but during the gap A's pushes still arrive on B's device. Hook `disable()` (or a server-side delete-by-endpoint) into auth state changes.


### Custom game modes — replace 1-card rounds with 2-card rounds


### Offline scorekeeper — record real-life game results without card dealing, manual score entry


### Conditional stakes — agree on stake before game, winners earn rating points, losers pay difference


### Player stats — game history, win rate, exact bid percentage


### Leaderboard — global rankings


### Discord integration


### Sound effects — card played, bonus earned, turn notification


### Lobby chat — general chat for finding players and socializing


### Video/voice chat — "home game" atmosphere during multiplayer


### Table/skin customization — visual themes


## Next Up

## In Progress

## Done

### Project principles + repo hygiene


### Rich feedback metadata — device, browser, settings, viewport


### TTL cleanup — 24h auto-delete of stale rooms and inactive guest accounts


### Haptic feedback on key gameplay events


### Installable PWA — manifest + service worker + icons


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


