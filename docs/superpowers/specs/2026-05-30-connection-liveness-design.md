# Connection liveness — kill "dead room" resurrection + honest snapshot

Date: 2026-05-30
Status: Approved (design)
Tech-debt origin: `docs/BACKLOG.md` → `[tech][arch][R3][HIGH] Убрать is_connected boolean → derive из last_seen_at`

## Problem

`room_players.is_connected` is dead data. It is set to `true` by the `heartbeat`
RPC, defaults to `true`, and is **never set to `false` anywhere** in the
codebase (verified by grep — zero matches). No client code reads it to make a
decision — the only three references are stale comments
(`GameTableScreen.tsx:154`, `hostAbsent.ts:20`, `heartbeat.ts:3`). The
`GameTableScreen` comment claims "other clients read room_players.is_connected
via the snapshot to detect drop-offs" — this is aspirational; no such detection
exists.

Meanwhile the symptoms the user actually hits:

1. **Return to a dead room.** `get_my_active_room()` returns any non-finished
   room the caller has a seat/spectator row in, with **no liveness check on the
   room's other participants**. On boot / login / focus the client navigates the
   user straight back into a room everyone else has long abandoned.
2. **Can't leave.** Stuck in a room (typically host gone). Largely already
   addressed by the shipped host-left rescue (`hostAbsent.ts`, derives host
   absence from `last_seen_at` at a 10-minute threshold; wired into
   WaitingRoom, GameTable, BettingPhase).

Ghosts at the table (a stale player still listed as present, with no
"disconnected" badge) are explicitly **out of scope** for this change — during a
live game an absent player's turns already auto-advance via `useTurnTimeout` +
bot takeover, so a mid-game ghost is cosmetic. Per-player liveness filtering and
auto-close jobs (the full R3 from the audit) are deferred.

## Canonical liveness definition

> A room is **alive** ⟺ there exists a participant (player **or** spectator) with
> `last_seen_at > now() - INTERVAL '5 minutes'`. The caller's own row counts —
> so a brief reconnect within 5 minutes still returns the room, while returning
> after >5 minutes to a room where everyone else has gone cold does not.

Threshold: **5 minutes**. Heartbeat cadence is ~10s, so 5 min ≈ 30 missed beats
— comfortably past brief network blips, mobile background sleep, or app
switching. Chosen over a tighter 90s to minimize the risk of yanking a user out
during a long background/commute gap.

This is the single source of truth this change introduces. It is the same
signal `filter_stale_spectators` already uses for spectators (there at a 30s
threshold) and `hostAbsent` uses for the host (10 min). We are not unifying
those existing thresholds in this change — each serves a different purpose
(spectator list hygiene; conservative rescue trigger). We only add the
room-level "is this room alive at all" check where it is currently missing.

## Changes

### §1 — Fix `get_my_active_room` (new migration, RPC redefinition)

Redefine `public.get_my_active_room()` (current definition:
`20260526010000_get_my_active_room.sql`). In **both** selection branches
(player-seat and spectator-fallback) add a liveness guard:

```sql
AND EXISTS (
  SELECT 1 FROM public.room_players rp2
   WHERE rp2.room_id = r.id
     AND rp2.last_seen_at > now() - INTERVAL '5 minutes'
  UNION ALL
  SELECT 1 FROM public.room_spectators rsp2
   WHERE rsp2.room_id = r.id
     AND rsp2.last_seen_at > now() - INTERVAL '5 minutes'
)
```

Result: a dead room is no longer returned → the client lands in the lobby
instead of an empty table. Reconnect into a live in-progress game is unchanged.

**Explicit decision:** an abandoned `waiting` room the caller hosted and left
for >5 minutes is also treated as dead and not resurrected. Re-creating a room
is cheap; nothing of value is lost.

### §2 — Drop the dead `is_connected` column (same migration)

- `ALTER TABLE public.room_players DROP COLUMN is_connected;`
- Redefine `get_room_state(p_room_id uuid)` — copy the **current live body**
  (from `20260523000000_conditional_stakes.sql`) verbatim minus the
  `'is_connected', rp.is_connected,` line in the players `jsonb_build_object`.
- Redefine `heartbeat(p_room_id uuid)` — drop the `is_connected = true` line
  from its `UPDATE public.room_players SET ...`.

No code path inserts `is_connected` explicitly (the column only ever had a
DEFAULT + the heartbeat update), so no INSERT needs touching. Confirm this at
implementation time with a final grep before writing the migration.

### §3 — Client cleanup (drop the field everywhere it is named)

- `supabase/functions/_shared/types.ts:77` — remove `is_connected: boolean;`
  from the `RoomSnapshot` player type.
- `src/lib/supabase/types.ts` — remove `is_connected` from the generated
  `room_players` Row/Insert/Update types (regenerate or hand-edit).
- `src/components/betting/BettingPhase.tsx:111,156` — remove `is_connected: true`
  from the locally-constructed player object and its inline type.
- `supabase/functions/_shared/__tests__/push-transitions.test.ts:19` — remove
  `is_connected: true` from the fixture.
- Fix stale comments: `src/screens/GameTableScreen.tsx:154`,
  `src/lib/heartbeat.ts:3` (they describe is_connected as a drop-off signal).

## Testing

- **Unit (liveness logic):** against local Supabase (`.env.test`,
  `127.0.0.1:54321`). Seed a room with a stale-only participant → expect
  `get_my_active_room` returns NULL; seed with one fresh participant → expect it
  returns the room. Cover both player-seat and spectator-fallback branches.
- **Smoke:** must stay green. The column drop should be invisible to all smoke
  flows. Re-run `npm run smoke` after the change (requires the `:8081` dev
  server + a live local edge runtime — see the smoke-env gotcha: `.env.local`
  points `:8081` at the local Supabase stack, and its `edge_runtime` container
  must be up).
- **Untouched:** `hostAbsent` + `src/lib/__tests__/hostAbsent.test.ts` already
  derive from `last_seen_at`; not in scope.

## Deploy notes

- New migration (§1 + §2) must be applied to prod Supabase
  (`supabase db push` / CI) AND the redefined edge-consumed RPCs are server-side,
  so no separate edge-function deploy is required — but verify `get_room_state`
  shape change does not break a deployed `game-action` that expects
  `is_connected` in the snapshot (it does not — no consumer reads the field,
  see Problem).
- This stacks on the unreleased `20260530000000_revoke_switch_role_anon.sql`
  migration already on `main`.

## Out of scope (deferred)

- Per-player "disconnected" badge / dimming at the table (ghosts).
- Filtering stale players out of the snapshot player list the way spectators are.
- Server-side auto-close of dead rooms (TTL job).
- Unifying the three liveness thresholds (spectator 30s, room 5min, host 10min).
