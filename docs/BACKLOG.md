## Backlog

### Post-game scoreboard + "Play again" on host exit (Akhmed, 2026-05-16)

When the host ends a table mid-game, every player should see the final
scoreboard with a "Play again" CTA. Exiting the game returns the player
to the Lobby (not the welcome screen). Right now host-exit drops players
back into Welcome without scores.

### Bet confirmation — explicit Confirm button (Akula, 2026-05-16)

User reverted on the current tap-twice flow: a single tap on a bid chip
should preview the selection, then an explicit "Confirm bet" button below
the chips commits it. Goal: zero ambiguity about whether the bid is
locked. Replaces the tap-twice flow we shipped earlier.

### Turn timebank — countdown until auto-play (Akula, 2026-05-16)

Add a visible countdown showing how long the active player has before the
server auto-advances them. The server-side timeout already fires (30s),
but the UI gives no warning. Should be a slim ring or bar tied to the
active player's avatar.

### Score icon is unclear (Akula, 2026-05-16)

The trophy glyph in the in-game top bar is read as "winner / awards"
rather than "scoreboard". Consider labelling, swapping the icon, or
adding a short tooltip on hover.

### Betting screen — cards span the full width (Akula, 2026-05-16)

While bidding, the player's hand should fill the screen width
horizontally — even if that means wrapping to two rows. The current
single-row scroll is fine on phones but feels squished on wider
screens.

### Email-confirmed redirect — extra screen on confirm (Dima via Akula, 2026-05-08)

After registering, the email confirmation link briefly bounces through
an `/auth/callback` page that flashes "Email confirmed" before landing
on the home screen. We tightened Method 1 + 2 in this session to skip
this for Google OAuth, but the email-signup flow still flashes the
intermediate screen. Make the redirect direct.

### Screenshots in feedback form (PopovIsNit, 2026-05-08)

Let users attach screenshots when filling out the feedback form. Right
now feedback is text-only, which makes "это не работает" entries hard
to triage.

### Bet button reachable from the felt (PopovIsNit, 2026-05-08)

A "Bet" button should be reachable directly from the felt — both during
the bidding phase and during play (re-opening the bid chip cluster). The
modal-only flow is hard to find mid-hand on mobile.

### Push notifications — follow-ups

Outstanding push polish (icon variants, throttle, deep-links).

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

### Active turn highlight — gradient fill + screen pulse (Akula, 2026-05-08)

### Cards centred on desktop (PopovIsNit, 2026-05-08)

Cards during betting and play should be centred horizontally on
desktop, not left-aligned. The desktop game layout has been built;
this item covers re-aligning the inner card row.

### Per-game seat shuffle in private rooms (Akula, 2026-05-08)


## Done

### Desktop layouts — 5 split-pane screens for ≥1024px viewports (2026-05-16)

Lobby + Profile, Welcome + Auth, Game Table + Scoreboard + Chat,
Betting + Scoreboard + Chat, Waiting Room + Chat. Mobile-first stays
intact below 1024px. Top-bar buttons toggle desktop side panes;
SettingsBody surfaces Link Google + Set Password inline.

### Spectator mode — invite-link based read-only watcher with chat (Akula, 2026-05-08)

### Google OAuth + linking + auto-register + display_name backfill (2026-05-15)

Polished end-to-end: branded GoogleButton with G logo, "Link Google
Account" in Settings, in-app collision modal (PWA gesture fix),
local-scope signOut to avoid auth-lock contention, set-password flow
for Google-only users, auto-backfill display_name from given_name
(first name only), robust isGuest against lagging is_anonymous.

### Bet confirmation — confirm step before locking bid

Initial tap-twice version shipped 2026-05-15; superseded by the
explicit-button request that's now in the Backlog above.

### Custom game modes — replace 1-card rounds with 2-card rounds (2026-05-15)

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
