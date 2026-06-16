# Invite Discord friends into the room (seamless auto-join)

Date: 2026-06-17
Branch: feat/discord-activity
Status: design approved, pending spec review

## Problem

Inside a Discord Activity, players want to pull their Discord friends into
the **current game room** straight from the room UI. Today there is no invite
affordance in the room, and — critically — **no link between a Supabase room
and a Discord Activity instance**, so even Discord's native invite drops the
friend into the Activity as a separate session who must type the room code by
hand.

Two Discord realities shape the design:

- You **cannot** invite a specific friend programmatically. The only API is
  `sdk.commands.openInviteDialog()`, which opens Discord's **own** native
  invite picker. We never build our own friend list.
- All participants of one launched Activity share a stable
  `discordSdk.instanceId` (`@discord/embedded-app-sdk`,
  `Discord.d.ts: readonly instanceId: string`).

## Goal

Any participant in a Discord Activity can press one button to invite friends
(via Discord's native dialog); an invited friend who lands in the Activity is
**auto-joined into the same game room** with no manual code entry.

## Non-goals (YAGNI)

- No custom in-game friend picker (Discord forbids it).
- No invite path outside a Discord Activity (no SDK there — button hidden).
- No multi-room-per-instance modelling beyond "the latest active room".
- No new spectator UI if the waiting room already lets a spectator take a seat
  (reuse the existing role-convert path).

## Design

### Part A — Room ↔ Discord instance mapping (the seamless part)

**A1. Schema.** Add a nullable column to `rooms`:

```sql
ALTER TABLE rooms ADD COLUMN discord_instance_id text;
CREATE INDEX idx_rooms_discord_instance ON rooms (discord_instance_id)
  WHERE discord_instance_id IS NOT NULL;
```

**A2. Tag the room on creation.** `createRoom` (edge action) accepts an
optional `discord_instance_id` and stores it. The client wrapper
(`gameClient.createRoom`) passes `getDiscordSdk()?.instanceId ?? null` — non-null
only inside a Discord Activity. Outside Discord the column stays null and
nothing changes.

**A3. Lookup RPC.** New `get_active_room_for_instance(p_instance_id text)`
returns the single current open room for that instance: filter
`discord_instance_id = p_instance_id AND phase NOT IN ('finished','paused')`,
order by `created_at DESC`, limit 1. Returns null when none (so a stale,
finished, or host-frozen `paused` instance room never auto-joins — a paused
room is "parked", per `activeRoom.ts`). (Room phases are
`waiting | playing | paused | finished`; an earlier draft said `'closed'`,
which is a hand phase, not a room phase.)

**A4. Auto-join hook.** A hook that runs **once per Activity launch**, after
Discord auth resolves and before the user settles in the lobby:

1. Guard: only when `isDiscordActivity()` and the user has **no** active room
   (no `activeRoom` persisted) — so a player who deliberately left the room
   is not yanked back.
2. Read `instanceId = getDiscordSdk()?.instanceId`. If absent, stop.
3. Call `get_active_room_for_instance(instanceId)`. If null, stop (the inviter
   may create a room next, which then tags the instance).
4. If a room is found and the user is not already in it: **silently join**,
   choosing the RPC from the looked-up room state:
   - Room `phase === 'waiting'` and a seat is free → attempt **player** join
     (`gameClient.joinRoom` by code). If the server rejects because the last
     seat was taken by a concurrent arrival, **fall back** to spectator.
   - Otherwise (game in progress, or seats full) → join as **spectator**
     (`gameClient.joinRoomAsSpectator(code)`).
5. Navigate into the room screen (WaitingRoom or GameTable per phase).

A spectator who joined a live game can take a free seat at the next `waiting`
phase via the existing role-convert path (`gameClient` convert to `'player'`).
No new UI if the waiting room already exposes seat-taking; otherwise a minimal
"take seat" affordance for spectators is added (decided during planning).

### Part B — Invite button

A button labelled "Invite friends" (`profile`/`room` i18n key
`room.inviteDiscord`), shown **only** when `useIsDiscordActivity()` is true, in
both `WaitingRoomScreen` / `DesktopWaitingRoom` and `GameTableScreen` /
`DesktopGameLayout`. Visible to **every** participant, not just the host —
Discord's dialog invites to the shared voice channel, matching "any player can
invite".

On press: `await getDiscordSdk()?.commands.openInviteDialog()`. On rejection
(e.g. the user lacks invite permission in the channel) catch and show a toast
(`room.inviteDiscordFailed`). The friend who accepts lands in the Activity and
Part A's auto-join does the rest.

### i18n

Add to en/ru/es/fr: `room.inviteDiscord` ("Invite friends" / "Пригласить
друзей" / "Invitar amigos" / "Inviter des amis"), `room.inviteDiscordFailed`
(a short "couldn't open the invite dialog" message), and an auto-join spectator
notice `room.joinedAsSpectator` ("Game in progress — you joined as a
spectator").

## Affected files

- `supabase/migrations/<new>.sql` — `rooms.discord_instance_id` + index + the
  `get_active_room_for_instance` RPC.
- `supabase/functions/game-action/actions/createRoom.ts` — accept/store
  `discord_instance_id`.
- `src/lib/gameClient.ts` — pass `instanceId` on create; add
  `getActiveRoomForInstance` wrapper.
- `src/lib/discord/` — new `autoJoinInstanceRoom` helper + a launch hook
  (mounted near the Discord bootstrap / lobby route).
- `src/screens/WaitingRoomScreen.tsx`, `src/screens/desktop/DesktopWaitingRoom.tsx`,
  `src/screens/GameTableScreen.tsx`, `src/screens/desktop/DesktopGameLayout.tsx`
  — the Discord-only invite button.
- `src/i18n/locales/{en,ru,es,fr}.json` — new keys.

## Risks / verification

- **`openInviteDialog` auth gating.** An earlier spec
  (`2026-06-14-discord-ui-adaptation-design.md`) deferred this pending
  confirmation it works after `ready()` without a full `authenticate()`
  handshake. The plan includes an explicit verification step; if it requires
  auth, the button is gated behind the (in-progress) Discord auth track.
- **Auto-join "once per launch".** Must not re-trigger on every lobby focus, or
  it fights a user who left the room on purpose. Guard on a session-scoped
  "already attempted" flag plus "no active room".
- **Race: two friends arrive together.** Both attempt to seat; the server
  rejects the loser of the last seat, and that client falls back to a spectator
  join (A4 step 4). No client-side seat reservation.
- **Stale mapping.** Lookup excludes finished/paused rooms; a new room in the
  same instance supersedes by `created_at DESC`.
- **Known hardening follow-ups (from final review, not blocking).** (1) The
  "don't yank back a leaver" guard reads only local `getActiveRoom()`; a fresh
  webview with cleared storage but a server-side seat could re-run join — could
  also consult `getMyActiveRoom()`. (2) `useDiscordAutoJoin` and the
  `NavigatorGuard` rejoin effect both navigate without a shared "already
  navigated this launch" flag — no double-nav observed, but worth a shared
  guard if one surfaces.
- **Gate:** `npm run smoke` before "ready"; `npm run test:lint` if testIDs
  change. Manual: in a real Discord Activity, invite a second account → it
  lands in the same room (player if seat free, else spectator).
