# Spectator mode — design

**Status:** draft
**Date:** 2026-05-14
**Owner:** Akula

## Goal

Let an invited friend open a link and watch a game in progress. Spectator sees public state only (bids, played cards, scores, current turn), never anyone's hand. Players see who is watching and can read spectator chat.

## Non-goals (YAGNI)

- Promoting spectator → player without leaving and rejoining
- Listing rooms as "open to spectators" in the lobby
- Spectator mute / ban / moderation
- A separate spectator chat channel
- Recording or replaying games

## User flow

1. A player in `WaitingRoomScreen` or `GameTableScreen` opens the room menu and taps **Share spectator link**.
2. App produces a URL: `buildInviteLink(room.code) + '?as=spectator'`.
3. Friend opens the link. Deep-link handler reads `as=spectator` and routes straight into the room as a spectator, regardless of free seats.
4. Friend sees the game with no hand area, a "👁 Watching" badge, and the chat panel.
5. Players see `👁 N` in the room header; tapping shows nicknames. Spectator chat messages get an 👁 icon next to the sender's name.
6. Friend taps **Leave** → row deleted, players' counter decrements.

## Schema

One new table.

```sql
CREATE TABLE public.room_spectators (
  room_id       UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  session_id    UUID NOT NULL REFERENCES public.room_sessions(id) ON DELETE CASCADE,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, session_id)
);

CREATE INDEX idx_room_spectators_session ON public.room_spectators(session_id);
```

No `seat_index`, no `is_ready`. `room_sessions` already handles identity for both guests and authenticated users.

### RLS

Same model as `room_players` — readable by anyone in the room, writable only through RPCs.

## RPCs

### `join_room_as_spectator(p_room_id UUID, p_session_id UUID)`

- Verifies room exists.
- Verifies the session is not already seated as a player in this room (a player cannot also be a spectator).
- Caps spectators at **10 per room**; raises `too_many_spectators` if exceeded.
- Inserts row (idempotent on PK).
- Returns the spectator row.

### `leave_room_as_spectator(p_room_id UUID, p_session_id UUID)`

- Deletes the row. Idempotent.

### `get_room_state(p_room_id UUID)` — extended

Already returns only public information (no hands) — no fields are removed or changed. The output payload gains a `spectators` array: `[{session_id, nickname, avatar_url}]`. The change is purely additive; existing clients that ignore the field keep working without modification.

### `get_my_hand_authz` — unchanged

Already returns empty when the caller has no seat, so spectators get nothing by construction.

### TTL cleanup

Existing `cleanup_stale_rooms` job (`020_ttl_cleanup.sql`) gets one extra delete: rows in `room_spectators` whose `last_seen_at` is older than the same threshold used for disconnected players.

## Client

### Routing / deep links

The existing invite-link handler that resolves room codes already lives in the lobby flow. It gains one branch: when the URL contains `as=spectator`, set `joinAs: 'spectator'` and skip seat-assignment logic.

### `useRoomStore`

Add:
```ts
isSpectator: boolean;
spectators: { sessionId: string; nickname: string; avatarUrl?: string }[];
joinAsSpectator(roomCode: string): Promise<void>;
leaveAsSpectator(): Promise<void>;
```

`subscribe()` is unchanged — the same realtime channel feeds spectators.

The existing `heartbeat(p_room_id)` RPC (`011_heartbeat.sql`) currently updates `room_players.last_seen_at` only. We extend it to also update `room_spectators.last_seen_at` for the caller's session if a row exists there. One RPC, both paths covered, no client-side branching.

### `WaitingRoomScreen`

When `isSpectator`:
- Hide the **Ready** toggle.
- Show a **Watching** badge at the top.
- Replace **Leave** semantics (it already exists) to call `leaveAsSpectator()`.

When not spectator:
- Add a second share action **Share spectator link** next to the existing **Share** button. Reuses `Share.share` / `Clipboard` fallback.
- In the player list footer, render `👁 N` if `spectators.length > 0`. Tapping opens a small sheet listing nicknames.

### `GameTableScreen`

When `isSpectator`:
- Bottom hand zone replaced with a one-line placeholder: "👁 You're watching · Tap to leave".
- No bid input, no card-play taps, no haptic feedback on others' plays (keep tactile cues for spectators silent — passive watcher).
- Top bar shows **Watching** badge.

When not spectator:
- Top bar gains `👁 N` indicator (tap → spectator list).
- The existing share menu gains the **Share spectator link** action.

### `ChatPanel`

Chat is realtime-only (broadcast events on the `room:${id}` channel, no persistent table). Each outgoing event already carries the sender's identity; we add a boolean `fromSpectator` to the event payload, set at send time based on `useRoomStore.isSpectator`. The panel renders a small 👁 next to the nickname when `fromSpectator === true`. Trust model matches the rest of chat — clients trust the broadcast; server-side validation is out of scope for this spec.

### i18n

New keys in `en.json`, `ru.json`, `es.json`:
- `spectator.watching` — "Watching" / "Наблюдает" / "Observando"
- `spectator.youAreWatching` — "You're watching · Tap to leave" / etc.
- `spectator.shareLink` — "Share spectator link" / "Поделиться ссылкой для зрителя" / "Compartir enlace de espectador"
- `spectator.count` — "{{count}} watching"
- `spectator.tooMany` — "This room already has the maximum of 10 spectators."
- `spectator.cannotJoinAsPlayerAndSpectator` — "You're already a player in this room."

## Edge cases

- **Spectator opens an already-finished room (game ended, all players left):** room is destroyed by TTL; deep-link handler shows "Room not found".
- **Spectator opens a room mid-deal animation:** realtime channel feeds them the same events; first paint shows the current public state via `get_room_state`.
- **Network drop:** spectator reconnects, calls `join_room_as_spectator` again (idempotent on PK), resumes. TTL hasn't fired yet → seamless.
- **Player tries to spectate own room:** `join_room_as_spectator` raises `cannot_spectate_own_seat`. Client message: "You're already a player in this room."
- **Capacity 10 reached:** RPC raises `too_many_spectators`. Client shows toast with the i18n string.
- **Spectator after `restart_game`:** `room_spectators` rows survive restarts (only `room_players` and game state reset). Spectators watch the next game without rejoining.

## Migration

One new migration file: `024_spectator_mode.sql`. It contains:
- the `room_spectators` table + index
- `join_room_as_spectator` and `leave_room_as_spectator` RPCs
- updated `get_room_state` with the additive `spectators` field
- updated `heartbeat` that touches `room_spectators.last_seen_at` as well
- one extra `DELETE` inside the existing TTL cleanup function

## Testing

- RPC unit tests: join, leave, cap at 10, can't-spectate-own-seat, idempotency.
- E2E (Playwright, `npm run demo`): one room with 2 players + 1 spectator. Verify spectator UI, that hand is empty on the spectator client, that bids/plays propagate, that chat shows the eye icon.
- Mobile manual pass on iPhone-class viewport: thumb-zone unaffected; spectator placeholder doesn't push past safe-area inset.

## Estimated touch

- 1 SQL migration
- `src/store/useRoomStore.ts` — spectator branch
- `src/screens/GameTableScreen.tsx` — conditional render
- `src/screens/WaitingRoomScreen.tsx` — share action + ready hidden
- `src/screens/LobbyScreen.tsx` (or deep-link handler) — parse `?as=spectator`
- `src/components/ChatPanel.tsx` — role icon
- `src/i18n/locales/{en,ru,es}.json` — new keys
