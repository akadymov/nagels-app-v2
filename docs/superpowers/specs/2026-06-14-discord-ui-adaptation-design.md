# Discord Activity — UI Adaptation (Design)

Date: 2026-06-14
Status: Draft for review
Branch: `feat/discord-activity` (continue on the existing branch)
Follows: `2026-06-14-discord-activity-first-test-design.md` (first playable test — DONE)

## Goal

When Nägels runs inside a Discord Activity, adapt the UI so the game is
comfortable in Discord's shorter, chrome-bounded viewport: the full hand
is always visible, and Discord-redundant chrome (in-game chat, external
share/spectator links, feedback FAB, PWA/push prompts) is removed. Replace
our share affordance with Discord's native invite.

This is purely presentational and **entirely gated on
`isDiscordActivity()`** — normal web/PWA play is byte-for-byte unchanged.

## What's wrong today (observed in Discord desktop, 2026-06-14)

The wide Activity area trips our desktop breakpoint, so the desktop
two-pane layout renders. But the Activity is **shorter** than a browser
window (Discord eats the top bar + an occasional mic-error banner, and
the bottom voice/video strip). During trick play the table oval + the
2-row hand exceed the available height and **the hand's bottom row is
clipped**. The oval is also half-empty (reclaimable vertical space). The
chat button, share/spectator links, and feedback FAB add noise that's
redundant inside Discord.

## Decisions (locked in brainstorm)

| Topic | Decision |
|---|---|
| Hand fit | Single-row **tight overlapping fan** even on desktop (as if space is ample), shrinking the table footprint + card size so it fits; **horizontal scroll only as fallback** if it still doesn't fit |
| Hide in Discord | in-game chat, share link, spectator-share, spectator-count, feedback FAB |
| Suppress in Discord | PWA install prompt, web-push prompts |
| Safe area | drop the top inset (no notch in a Discord window) |
| Invite | replace the removed share with Discord's native `commands.openInviteDialog()` |
| Two-pane desktop | keep it (uses Discord's wide area well); only fix the right pane's vertical fit |

## Architecture

A single new hook, mirroring the existing `useIsDesktop` variant pattern,
threaded through the few screens that need Discord-mode tweaks. No new
layout system — small, gated conditionals in existing files.

**`src/hooks/useIsDiscordActivity.ts`** — returns `isDiscordActivity()`
(from `src/lib/discord/context.ts`). Discord-ness is fixed for the
session, so the hook just returns the boolean; the hook form keeps call
sites consistent with `useIsDesktop` and SSR/native-safe (false off-web).

### Changes by file

**`src/App.tsx`** — when in Discord:
- `SafeAreaView` `edges` without `'top'` (drop the top inset).
- Suppress the PWA install listener (`setupPwaInstallListener`) and any
  web-push permission prompt path. The existing web-viewport CSS effect
  stays (it's harmless and helps), but the install/push side-effects are
  Discord-irrelevant and should not fire.

**`src/navigation/AppNavigator.tsx`** — hide the global feedback FAB
(`FeedbackButton`) when in Discord (return `null` from the FAB host).

**`src/screens/GameTableScreen.tsx`** — when in Discord:
- Hide chat: don't render the chat button (`game-btn-chat`) and suppress
  the `ChatPanel` mount (the existing `hideChat` prop already does the
  suppression for desktop wrappers — reuse that path).
- Hide share/spectator: don't render `game-btn-share-spectator` or
  `spectator-count`.
- Render the hand as a **single-row** overlapping fan via `CardHand`
  (`size: 'tiny'`, dynamic overlap = `cards.length`, single row, with the
  component's built-in horizontal scroll as the fallback) instead of the
  current 2-row wrap. The `handSection` `maxHeight` (today
  `SCREEN_HEIGHT * 0.36`) is reduced so the single row + a shrunken table
  both fit.
- Shrink the table oval's vertical footprint so table + single-row hand
  fit the Activity viewport. Exact ratio must be **measured on a real
  Discord window** (desktop + phone) before locking — the plan will
  instrument and tune, not guess.
- Add a Discord-native **invite** button in the spot vacated by share,
  calling `commands.openInviteDialog()`.

**`src/components/cards/CardHand.tsx`** — verify/extend a single-row mode:
it already documents "overlap and scrolling" and supports `size` +
`overlap`. If a single-row (no-wrap) variant isn't already expressible
via props, add a minimal `singleRow?: boolean` (default false → current
behavior). No change to existing call sites.

**`src/lib/discord/bootstrap.ts`** — expose the initialized SDK instance
(e.g. `getDiscordSdk()`) so the invite button can call
`sdk.commands.openInviteDialog()`. Today the SDK is created but not
exported.

## Out of scope (separate tracks / specs)

- **Auth** (stop the double login; Discord identity; account linking).
- **Leave/exit lifecycle** (Embedded SDK close/participant events →
  graceful freeze).
- These are logged in `docs/BACKLOG.md` under "Discord integration".

## Testing & verification

- No new automated coverage required; everything is gated by
  `isDiscordActivity()`, which is `false` in the smoke browser, so
  `npm run smoke` must stay green (run it as the pre-merge gate once the
  local Supabase + memory situation allows — see prior spec's note).
- Real verification is visual, inside a Discord Activity on **desktop and
  phone**: full hand visible (no clipped row), no chat/share/spectator/FAB,
  table + hand fit without clipping, native invite dialog opens.

## Notes / risks

- **WIP coexistence:** the post-frame-capture branch has a 1-line
  uncommitted change in `GameTableScreen.tsx` (adds `testID="trick-card"`
  ~line 1614). It's in a different region than this work — no real
  collision; no need to stash it.
- **Measurement dependency:** the table/hand vertical ratios can't be
  finalized from code alone — they depend on the real Activity viewport.
  The implementation plan must include a measure-then-tune step on a
  device, and must `log()`/surface the chosen ratios rather than hardcode
  blindly.
- **`openInviteDialog` availability:** confirm it's available without the
  OAuth `authenticate` handshake (we're still guest-only in this track);
  if it requires authorization, defer the native-invite sub-item to the
  auth track and just hide share for now.
