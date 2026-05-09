## Backlog

### Active turn highlight — gradient fill + screen pulse

  - Replace current border-only highlight with gradient fill inside the active player's profile container. Drop the gold border on active states — the gradient does the work alone. Different gradients per state: diagonal sheen (active opponent) vs radial spotlight (active me). Designed in Figma — page Screens · frame "Active Turn Highlight" (file `M1B00D6SCCwqagN7aDTTiX`, node `129:2`). Olya's idea on UX colour, palette WIP — Akula will pick a reference from existing card-game / board-game UIs and we'll match.
  - Plus a "your turn" screen-edge inner-glow pulse, animated 0 → 0.85 → 0 in a 1.4s loop. Mounted only while `isMyTurn && phase === 'playing'`. Constant opacity 0.4 in Reduce-Motion.
  - Implementation: 2 commits — profile card gradient swap (expo-linear-gradient + react-native-radial-gradient) + screen pulse overlay.

### Google OAuth — Manual linking disabled

  - `supabase.auth.linkIdentity({ provider: 'google' })` in `linkGoogleToAnonymous` returns the error "Manual linking is disabled" because the Supabase project has the manual-linking flag off by default. Fix: Supabase Dashboard → Authentication → URL Configuration → enable **"Manual linking"** (or set env `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true`). Without this flag, anonymous → Google upgrade is impossible — the SaveProgressModal flow is broken for guests until enabled. Operator action only, no code change.

### Email-confirmed redirect — extra screen on confirm

  - From Дима via Akula (2026-05-08): after registering and confirming email, the user is bounced to `/auth/callback` showing the "Email confirmed!" page before being routed to the lobby. Looks like an unnecessary pit-stop. Investigate `EmailConfirmedScreen` flow vs `RejoinGuard` — for users who land on the app post-confirm with a recent `email_confirmed_at` (< 60s), short-circuit the screen and go straight to lobby, surface "Email confirmed" as a toast instead.

### Per-game seat shuffle in private rooms

  - Akula request (2026-05-08): when host taps "Play again" inside a multiplayer room, randomise `seat_index` for the next game so seating rotates between hands. Implementation lives in the `restart_game` RPC — shuffle, broadcast new snapshot, clients re-render. Toggle on the room (host can opt out). UX win for friend lobbies.

### Spectator mode in rooms

  - Akula request (2026-05-09): allow non-playing visitors to join a room as spectators — see the table state, optionally hand of one player (host opt-in), but cannot bid or play. Useful when one of the friends is sitting out a hand or watching the meta. Schema change: `room_players.role: 'player' | 'spectator'`. Realtime broadcast already filters by room — spectators just don't get redacted hand.

### Cards centred on desktop

  - From PopovIsNit (2026-05-08): on a large screen (PC) the player hand renders against the left edge instead of centred. Mobile-first layout doesn't constrain the CardHand container. Fix: max-width on the hand row plus `alignSelf: 'center'` when viewport > some breakpoint. Same for BettingPhase modal where bid chips also misalign.

### Bet button reachable from the felt

  - From PopovIsNit (2026-05-08): "add a button when bidding before the game and during gameplay (on the green felt)". Suspected ask: surface bet placement controls also on the table view — not only inside BettingPhase modal. Needs clarification from PopovIsNit on the precise wording/placement.

### Screenshots in feedback form

  - From PopovIsNit (2026-05-08): allow attaching screenshots to the in-app feedback. Server side: Supabase Storage bucket `feedback-attachments` with RLS that allows insert from any session, read only via service role (mirror the feedback table policy). Client side: image picker via `expo-image-picker`, upload to bucket, store URL in `feedback.extra.screenshots`.


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


