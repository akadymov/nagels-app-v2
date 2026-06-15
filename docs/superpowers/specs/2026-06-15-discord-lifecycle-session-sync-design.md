# Discord Lifecycle & Session Sync (Design)

Date: 2026-06-15
Status: Draft for review
Branch: `feat/discord-activity` (continue)
Follows: the Discord auth + UI-adaptation specs (2026-06-14/15)

## Goal

Two related session-stability problems inside a Discord Activity, done as one
track:

- **(B) Stop the offline game from resetting on a layout change.** Opening the
  Discord chat shrinks the Activity below the `useIsDesktop` 1024px breakpoint;
  the layout swaps (desktop ↔ mobile), the game screen remounts, and the
  in-memory single-player/bot game is wiped.
- **(A) Freeze the multiplayer game promptly when a player exits in Discord.**
  Today an abrupt exit (closing the Activity / leaving the voice channel) is only
  caught by heartbeat staleness — correct, but delayed by the staleness window.
  Discord's Embedded SDK can report participant changes so the existing freeze
  fires immediately.

## Decisions (locked in brainstorm)

| Topic | Decision |
|---|---|
| Scope | Both A and B in one track |
| Freeze policy | UNCHANGED — A only makes the **existing** host-absent/freeze detection faster; it does not change what freezes or when (policy-wise) |
| B fix shape | Stop destroying offline state on unmount; real exits still reset |
| Fallback | Heartbeat staleness stays as the always-on fallback; the SDK path is an accelerator, not a replacement |

## Part B — offline game survives a layout remount

### Root cause (to confirm with a repro first)

`GameTableScreen`'s single-player init effect (`useEffect(..., [isMultiplayer])`)
returns a cleanup `() => { sp.reset(); }`. When the viewport crosses the
`useIsDesktop` 1024px breakpoint, the app swaps between the desktop wrapper and
the mobile screen → `GameTableScreen` unmounts → the cleanup wipes the gameStore.
Explicit exits already call `sp.reset()` (GameTableScreen ~238, ~272), so the
cleanup reset is redundant for real exits and harmful on remounts. This is a
**general** bug (also reproducible by resizing a desktop browser across 1024px);
Discord's chat panel just triggers it.

### Fix

Remove the `sp.reset()` from the init effect's unmount cleanup. The init effect
already guards re-initialization with `if (sp.players.length > 0) return`, so on a
remount it preserves the running game instead of recreating it. The game resets
only on the explicit exit handlers that already call `sp.reset()`.

Before locking this in, the plan must **verify every real "leave the game" path
resets** (the exit/leave buttons do; confirm there's no back-nav path that relied
solely on the unmount cleanup). If a gap exists, add an explicit reset there
rather than restoring the unmount reset.

Optional hardening (only if the remount itself causes a visible flicker): in a
Discord Activity, avoid the layout swap on transient width changes (e.g. keep the
layout that was chosen at first mount, or raise the breakpoint hysteresis inside
Discord). Not required if the remount is otherwise invisible once state survives.

## Part A — prompt freeze on Discord exit

### Mechanism

On bootstrap inside Discord (after `sdk.ready()`), subscribe to the Embedded
SDK's Activity-instance participant updates and keep the set of connected Discord
user IDs. The installed SDK exposes `subscribe(...)` and
`getInstanceConnectedParticipants()`; the exact event constant (expected
`ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE`) is verified in the plan.

When a participant **disappears** from the set:
1. Map their Discord user id to a Nägels room player.
2. If the departed player is the room **host**, treat the room as host-absent
   **immediately** — feed the existing local host-absent/freeze path (the same
   one `isHostAbsent` + the host-absent ticker drive) without waiting for the
   `last_seen` staleness window.
3. If a non-host player departs, trigger an immediate snapshot resync so their
   absence (and any existing absent handling) surfaces faster.

Heartbeat staleness remains the always-on fallback: outside Discord, or if an
event is missed, freezing still happens the way it does today.

### Mapping Discord participant → room player

The freeze needs to know which room player a departed Discord id corresponds to.
Room players don't currently expose `discord_id`. Two options (decide in the
plan):
- **Add `discord_id` to the room snapshot** — `get_room_state` already reads
  `raw_user_meta_data` for `avatar_url`; also surface `discord_id`. Clean, exact
  match. Small backend change + redeploy.
- **Match the local user only** — the only departure we can detect with certainty
  about identity is... actually any participant, but mapping needs the id. If the
  backend change is undesirable now, scope A's MVP to: on ANY participant
  shrink while in a multiplayer room, trigger an immediate snapshot resync (no
  per-player mapping) so staleness is detected a poll sooner. Less precise, no
  backend change.

Recommendation: ship the **resync-on-participant-shrink MVP** first (no backend
change, immediately useful), and add `discord_id`-to-host mapping for the
instant host-absent freeze as a follow-up within the same track if the MVP isn't
crisp enough.

### Local-user close

When **you** close the Activity, the iframe unloads and JS stops — there's no
reliable pre-close SDK hook, so your own exit is covered by the other clients'
heartbeat staleness (unchanged, and now optionally accelerated by their
participant-update). No new local-close handler is needed.

## Out of scope

- Changing the freeze **policy** (what freezes, auto-play, kick rules).
- Seamless invite / auto-room from the Discord instance (separate backlog item).
- Any change to the explicit `leaveWithConfirm` flow.

## Error handling & edge cases

- SDK `subscribe` unavailable / event shape differs → log once, fall back to
  heartbeat staleness only (no crash; Part A is best-effort).
- Participant-update fires with the local user only (you're alone) → no freeze.
- Rapid join/leave churn → debounce the resync so we don't spam the server.
- Part B: if removing the unmount reset surfaces a stale-game-on-new-game path,
  reset at the new-game/lobby entry instead.

## Testing & verification

- **B:** unit-test that the SP game state survives an `isMultiplayer`-stable
  remount (the init effect doesn't reset on unmount). Manual: in Discord desktop,
  start a bot game, open/close the Discord chat (cross the breakpoint) → game must
  persist. Also manual: resize a desktop browser across 1024px mid-game.
- **A:** unit-test the pure participant-diff logic (given previous/next id sets →
  who left). Manual in Discord: two devices in one room; one closes the Activity →
  the other sees the freeze promptly (faster than the staleness window).
- `isDiscordActivity()`-gated; `npm run smoke` stays green (web path unchanged).

## Risks

- **Exact SDK event/permission** for participant updates is unverified — the plan
  starts by confirming `subscribe` event name + that it works inside the proxied
  Activity (mirror how the auth spec flagged session-minting). If it needs an
  OAuth scope we didn't request, fall back to the resync-only MVP.
- **B's unmount-reset removal** is a general behavior change — the plan must
  enumerate exit paths and confirm no reset is lost.
