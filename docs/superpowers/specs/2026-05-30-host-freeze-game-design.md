# Host freeze game — pause & resume for multiplayer rooms

Date: 2026-05-30
Status: Approved (design)
Backlog origin: `docs/BACKLOG.md` → "Заморозка партии хостом — pause & resume для рейтинговых игр"

## Problem

A multiplayer game has no clean way to take a break. Today, if a player must step
away mid-game, either the table stalls (turn-timeout auto-plays the absent
seat via `requestTimeout`, possibly finishing the game without them) or someone
leaves (`leaveRoom` abandons the current hand and snaps the room to `waiting`,
losing in-progress progress; for rated games no settle runs, so the stake
"evaporates"). There is no host-controlled "freeze the table, everyone come back
later, resume from the same point."

## Goal

Let the host freeze the current game at any moment. The full game state (hand,
trick, scores, seats) is preserved untouched. Players can step away and return
freely. When the exact original lineup is back and live, the host resumes from
the same point. If the table never reconvenes within a TTL, the game is
abandoned (no rating settle — same as a plain interruption today).

## Decisions (locked)

- **Scope:** all multiplayer games (not only rated). Rated is the case where it
  matters most, but freeze is useful for any table.
- **When the host can freeze:** any time during play (mid-trick, mid-betting) —
  the state already lives in normalized DB rows, so freezing is just gating
  mutations.
- **Resume requirement:** the *exact* original lineup must be back and live —
  every `session_id` in `paused_lineup` has a live `room_players` row. No bot
  substitution / voting in v1.
- **Stake + TTL:** the stake stays locked for the whole pause. If `paused_at` is
  older than **48h**, the game is abandoned: `phase='finished'`, **no settle**,
  rating untouched (identical to today's interruption behavior). Settle only
  ever runs on a natural finish (`continueHand`), never on abandon.
- **No lobby blocking:** nobody is prevented from creating or joining another
  game while they have a paused room. Instead, every participant of a paused room
  sees a passive indicator (room code + TTL countdown) and can tap it to return.

## Architecture

Approach: a new `room.phase = 'paused'` plus a single gate in the action
dispatcher. (Rejected: a separate `is_paused` boolean — every gameplay path
would have to check both phase and flag, easy to miss one; and a full
state-serialization blob — over-engineering, the state is already normalized.)

`session_id` identity is stable across leave/return: `room_sessions.auth_user_id`
is UNIQUE (one row per auth user, reused across rooms), so `paused_lineup` keyed
by `session_id` survives a player leaving and rejoining.

### 1. Data model (one migration)

- `rooms.phase` CHECK: add `'paused'` →
  `CHECK (phase = ANY (ARRAY['waiting','playing','paused','finished']))`.
- `rooms` new columns:
  - `paused_at timestamptz NULL`
  - `paused_lineup uuid[] NULL` — `session_id`s of the players present at pause.
- Resume always returns `phase → 'playing'`; the fine-grained hand phase
  (`hands.phase` ∈ betting/playing/scoring) is never touched by pause/resume.
- `get_my_active_room` (currently `… AND public.room_is_alive(r.id)`) is amended
  to `… AND (public.room_is_alive(r.id) OR (r.phase = 'paused' AND r.paused_at >
  now() - INTERVAL '48 hours'))` in BOTH branches, so a paused room is always
  returnable to its participants even when everyone has stepped away — but only
  within the TTL window (an over-TTL paused room is simply not returned, so the
  user lands in the lobby; this is read-only and writes nothing). The function's
  returned JSON gains `paused_at` (null unless phase='paused') so the lobby can
  render the TTL countdown.

### 2. Two new edge actions

`supabase/functions/game-action/actions/pauseGame.ts`, `resumeGame.ts`, wired in
`index.ts` `switch(action.kind)` and in the `Action` type (`_shared/types.ts`)
and `gameClient`.

- **`pause_game`** — host-only. Precondition: `room.phase === 'playing'` and
  actor is `room.host_session_id`. Effect: set `phase='paused'`,
  `paused_at=now()`, `paused_lineup =` array of current `room_players.session_id`,
  `version = version + 1`. Emit `game_events` kind `game_paused`. Broadcast
  `state_changed`. Errors: `not_host`, `not_in_play` (wrong phase).
  **Repeat pauses reset the TTL:** because every `pause_game` call stamps
  `paused_at=now()` afresh, a game paused for the 2nd (3rd, …) time starts a new
  full 48h window — the countdown is always measured from the most recent pause,
  never accumulated across pauses.
- **`resume_game`** — host-only. Precondition: `room.phase === 'paused'`, actor
  is host, AND every `session_id` in `paused_lineup` has a `room_players` row in
  this room whose `last_seen_at > now() - INTERVAL '30 seconds'` (live). Effect:
  set `phase='playing'`, `paused_at=null`, `paused_lineup=null`,
  `version = version + 1`. Emit `game_events` kind `game_resumed`. Broadcast.
  Errors: `not_host`, `not_paused`, `lineup_incomplete` (returns the list of
  missing/stale `session_id`s so the client can show "ждём: …").

### 3. Single pause gate (correctness core)

In `supabase/functions/game-action/index.ts`, immediately before the
`switch(action.kind)` (the `prev` snapshot / room row is already fetched there):
if `room.phase === 'paused'` and the action is a gameplay mutation, return
`{ ok:false, error:'game_paused', state: prev, version }` without dispatching.

- **Gated while paused:** `place_bet`, `play_card`, `continue_hand`,
  `record_tricks`, `request_timeout`, `ready`, `start_game`, `restart_game`,
  `set_stake`, `toggle_stake_optin`.
- **Allowed while paused:** `resume_game`, `leave_room`, `set_display_name`,
  `join_room` (rejoin), plus heartbeat and chat (which don't go through this
  action path). This one check also neutralizes timeout auto-play of absent
  seats.

### 4. Leave / return during pause

- A player stepping away just navigates away / closes the tab — their
  `room_players` row (and `seat_index`) persists; their `last_seen_at` goes
  stale. Returning = reopening the app (heartbeat resumes → they're live again).
- `leaveRoom` while `phase='paused'`:
  - **Non-host:** treated as "step out, hold the seat" — the action returns
    success (client navigates to lobby) but does **not** delete the
    `room_players` row and does **not** abandon the hand. The seat waits. (The
    existing abandon branch only fires on `phase==='playing'`, so it is already
    inert during pause; we additionally short-circuit the row deletion for the
    paused case.) The player can return any time, or the 48h TTL reclaims it.
  - **Host:** abandons the game — `phase='finished'`, no settle (this is the
    "kill the frozen game" path, reachable from the in-room overlay or the lobby
    indicator). Existing host-leave logic already sets `finished`.
- The shipped host-absent rescue (`hostAbsent.ts`, 10-min `last_seen_at`
  threshold, wired into WaitingRoom/GameTable/BettingPhase) remains the escape
  hatch if the host vanishes during a pause.

### 5. TTL abandon (48h)

A paused room with `paused_at < now() - INTERVAL '48 hours'` is abandoned:
`phase='finished'`, no settle, rating untouched, `version++`. Since `paused_at`
is re-stamped on every `pause_game` (§2), the window always counts from the most
recent pause — a re-paused game gets a fresh 48h, never an accumulated total.
Because the read RPCs are `STABLE` (cannot write), enforcement is split:
- **Read side (no write):** `get_my_active_room` simply stops returning over-TTL
  paused rooms (the TTL clause in §1), so participants land in the lobby and the
  paused indicator disappears.
- **Write side (lazy):** `resume_game` rejects an over-TTL paused room with
  `game_abandoned` and sets `phase='finished'` in that same call, so the host's
  resume attempt cleanly converts a dead pause into a finished game (no settle).
- **Sweep (best-effort):** if a server-side stale-room cleanup job exists, extend
  it to finish over-TTL paused rooms. If none is scheduled, the read+write lazy
  paths above are sufficient for v1 — the lingering `paused` row is invisible
  (not returned) and harmless. Do not silently assume a sweep exists.

### 6. Snapshot

`get_room_state` `room` object gains `paused_at` and `paused_lineup` (both null
when not paused). `room.phase` already flows through. Clients derive "кого ждём"
by intersecting `paused_lineup` with the `players` array's liveness
(`last_seen_at`). No per-player snapshot field is added — liveness is already in
the players list.

### 7. Client / UI

- **Freeze button** — host-only, visible when `room.phase==='playing'`, in the
  GameTable top bar and BettingPhase (mobile + desktop). Calls
  `gameClient.pauseGame(room_id)`.
- **Paused overlay** — shown to everyone when `room.phase==='paused'`: "Партия
  заморожена хостом", the lineup with live/away markers, and (host-only) a
  **Resume** button enabled iff all lineup live (else disabled with "ждём:
  <names>"), plus a **Завершить** (kill) control and a **В лобби** control
  (navigate out without killing).
- **Lobby paused indicator** — when `get_my_active_room` reports a paused room,
  the lobby shows a persistent card "⏸ Замороженная партия (CODE) — авто-отмена
  через HH:MM" counting down from `paused_at + 48h`. Tapping returns to the room.
  Create/Join are NOT blocked.
- i18n: ~12–15 new strings × EN/RU/ES/FR.
- New `testID`s (freeze button, resume button, kill button, paused overlay,
  lobby paused card) → run `npm run test:lint -- --update-todo` and surface.

### 8. Testing

- **SQL/edge unit:** pause gate rejects a gameplay action with `game_paused`;
  `resume_game` rejects with `lineup_incomplete` when a lineup member is stale,
  succeeds when all live; TTL-over paused room treated as finished. Verified via
  the local stack (docker-exec psql + edge invocation), matching the existing
  no-SQL-harness pattern.
- **Smoke (~50s, must stay green):** host freezes → a gameplay action is rejected
  → host resumes → play continues. Add as one new smoke spec.
- **Sanity (manual, not auto):** full 6-player freeze → all step away → all
  return → resume → game reaches scoreboard.

## Deferred (v2 — explicitly out of scope)

- Bot substitution / remaining-players vote to resume without the full lineup.
- Seat restoration after a true hard-leave during pause (v1 holds the seat
  instead of deleting the row).
- Auto-promoting a new host if the host vanishes during a pause.
- A dedicated "forfeit for real" control during pause for non-hosts (TTL covers
  it in v1).

## Deploy notes

- One migration (phase CHECK + 2 columns + `get_my_active_room` amendment) →
  apply to prod via `supabase db push` (history is now reconciled, push works).
- Edge function `game-action` must be redeployed (new actions + the pause gate).
- Stacks cleanly on the connection-liveness work already on prod.
