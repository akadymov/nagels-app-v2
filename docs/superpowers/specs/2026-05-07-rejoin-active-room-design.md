# Resume / Rejoin an Active Room — Design

## Goal

A player who **accidentally** loses their game context — full page refresh, closed tab, OS-killed PWA, push-notification click that landed in the wrong place — must be able to come back to the same seat with the same state. **Explicit** "Leave Room" remains permanent and is only available where the cost of misclicking is reasonable (waiting room, betting phase). During the playing phase there is no Leave button at all — the player can only close the tab, which always rejoins cleanly.

This is not a new feature — most of the rejoin infrastructure already lives in the repo, just disabled. The work is to re-enable it, plug the missing leave-related plumbing, and adjust two surfaces (push-click target, BettingPhase).

## Non-goals

- **Bot replacement of a leaver.** Bots in the codebase today don't play well enough to substitute for a human mid-hand, and seating a bot into a partially-played hand involves logic we haven't built. Leaving mid-game intentionally **breaks the hand for everyone** — the room resets to the waiting screen with one fewer player, the host can restart from there.
- **Faster offline timeout.** The current 5-minute `request_timeout` budget stays. Tying it to push-subscription presence would add an extra DB lookup per turn and unfair behavior for users without push enabled. Out of this scope.
- **Cross-device active-room discovery.** Active room is keyed in **local** AsyncStorage on the device that joined. We don't fetch the user's open rooms from the server on a fresh install.
- **"Leave but hold seat" soft leave.** Hard leave only. Tab close is the soft path.

## What already exists (and is correct)

- `src/lib/activeRoom.ts`:
  - `setActiveRoom(roomId)` / `getActiveRoom()` / `clearActiveRoom()` — AsyncStorage wrappers, key `active_room_id_v1`.
  - `tryRestoreActiveRoom()` — full implementation: reads stored id, calls `supabase.rpc('get_room_state')`, hydrates `useRoomStore`, calls `subscribeRoom`, returns `'WaitingRoom' | 'GameTable' | null`. Already clears storage on `room === null` or `phase === 'finished'`.
- `setActiveRoom(roomId)` is already called from `LobbyScreen.tsx` on createRoom and joinRoom.
- Server-side `get_room_state` RPC and `get_my_session_id` RPC exist and work; they're what `tryRestoreActiveRoom` consumes.
- `requestTimeout.ts` action — auto-advances a stuck seat with default plays (bet=0 if legal, lowest legal card). Triggered after 5 min by `useTurnTimeout` on any mounted client. **Only works while the seat's `room_players` row exists** — i.e. while the player has not explicitly left.

## What's broken / missing

1. **`RejoinGuard` is a no-op.** `src/navigation/AppNavigator.tsx:210-215` is stubbed with the comment _"Rejoin path is being rebuilt … For now, just no-op."_ It never calls `tryRestoreActiveRoom()`. Effect: a hard refresh always lands on Lobby.
2. **`gameClient.leaveRoom` does not call `clearActiveRoom`.** Effect: after explicit leave the storage still points at the (now gone) room. `tryRestoreActiveRoom` clears it gracefully on next boot, but it's a wasted round-trip and a brief "rejoining…" flash.
3. **`leave_room` action does not handle mid-game leavers.** Today it just deletes the `room_players` row. If the hand is in progress, the seat at `current_seat` is now empty, `request_timeout` no-ops (no `rp` found), and the table hangs forever — no path to recover.
4. **No Leave button on the betting screen.** Today the only way out of a betting hand is to close the tab.
5. **Push notification click goes through `/join/<code>`.** `App.tsx` listens for `kind:'push:navigate'` from SW and `window.location.assign('/join/<code>')`. That triggers the new-player join flow, which rejects mid-game with "Game already started" toast. With RejoinGuard active and `setActiveRoom` already done at original join time, the push-click path should collapse into "open the app" — RejoinGuard will land the user in the correct room.

## Architecture — what the changes look like

### 1. RejoinGuard re-enabled

`AppNavigator.tsx:210` — replace the no-op effect with:

```ts
useEffect(() => {
  if (!isInitialized || rejoinAttempted.current) return;
  rejoinAttempted.current = true;
  void (async () => {
    try {
      const target = await tryRestoreActiveRoom();
      if (target) navigation.navigate(target);
    } catch (err) {
      console.warn('[rejoin] tryRestoreActiveRoom threw:', err);
    }
  })();
}, [isInitialized, navigation]);
```

`tryRestoreActiveRoom` already handles unhappy paths (room gone, finished, RPC failure) by calling `clearActiveRoom` internally and returning `null`. Lobby is the implicit fallback.

### 2. `clearActiveRoom` on explicit leave

`src/lib/gameClient.ts` — in the body of the `leaveRoom` method, after the action returns `ok: true`:

```ts
import { clearActiveRoom } from './activeRoom';
// …
async leaveRoom(roomId: string) {
  const result = await this.invoke({ kind: 'leave_room', room_id: roomId });
  if (result.ok) await clearActiveRoom();
  return result;
}
```

### 3. Server: `leave_room` resets a mid-game room to `'waiting'`

`supabase/functions/game-action/actions/leaveRoom.ts` — extend the existing handler to detect mid-game leaves and abandon the in-progress hand. Pseudocode addition (after the existing `room_players.delete()`):

```ts
const isHostLeaving = target === room.host_session_id;
if (isHostLeaving) {
  // existing logic — close the room for everyone, no host transfer
  return …;
}

if (room.phase === 'playing' && room.current_hand_id) {
  // Non-host left mid-hand. The hand can't continue (the seat at
  // current_seat is now empty; request_timeout would no-op). Abandon
  // the hand and snap the room back to waiting so the host can restart.
  const hid = room.current_hand_id;
  // FK cascade chain: trick_cards → tricks, hand_scores, dealt_cards, hands.
  // We delete in the order that respects FKs. (Or rely on ON DELETE CASCADE
  // if it's already configured — verify against the schema.)
  await svc.from('trick_cards').delete().in('trick_id',
    (await svc.from('tricks').select('id').eq('hand_id', hid)).data?.map((r: any) => r.id) ?? []);
  await svc.from('tricks').delete().eq('hand_id', hid);
  await svc.from('hand_scores').delete().eq('hand_id', hid);
  await svc.from('dealt_cards').delete().eq('hand_id', hid);
  await svc.from('hands').delete().eq('id', hid);

  await svc.from('rooms').update({
    phase: 'waiting',
    current_hand_id: null,
    version: room.version + 1,
  }).eq('id', room.id);

  // Surface the leaver in chat / a banner via game_events. The
  // existing `kind` column is free-form text (compare with `kind: 'timeout'`
  // used by requestTimeout). No migration required.
  await svc.from('game_events').insert({
    room_id: room.id,
    hand_id: null,
    session_id: target,
    kind: 'player_left_mid_game',
    payload: { display_name: actor.display_name },
  });
}

const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
return { ok: true, state: snapshot, version: snapshot.room?.version ?? 0 };
```

The hand-cleanup query order should be a single SQL function for atomicity; verify whether the project's existing pattern is "inline supabase-js calls" (likely, given other handlers) or "delegate to a PL/pgSQL function". If inline is fine elsewhere it's fine here. If FK-cascade rules already drop child rows on parent delete, simplify accordingly — verify with `\d` or migration history.

Past hand scores in `hand_scores` for *closed* prior hands stay untouched; only the in-progress hand's rows are removed. `score_history` view (if any) auto-recalculates from `hand_scores`.

`is_ready` flags on remaining players are **not** reset. They were ready a moment ago; the host can press Start again immediately without re-readying everyone. (If the host wants to wait for someone to step away first, they ready-down themselves manually.)

### 4. Leave button — only in BettingPhase, with confirmation

`src/components/betting/BettingPhase.tsx` — add a small Leave control (icon + label) in the corner. Tapping it shows a confirmation:

```
Title:  Leave the game?
Body:   The game can't continue without you. Everyone goes back
        to the waiting room and your hand is dropped — the host
        can restart with the remaining players.

        If you just need to step away or refresh — close the tab
        instead. You'll come back to the same seat.
Buttons: [Cancel]   [Leave anyway]
```

On Confirm → `gameClient.leaveRoom(roomId)` → server resets per §3 → broadcast triggers all clients to re-fetch snapshot → other clients see `phase === 'waiting'` and re-render WaitingRoomScreen → leaver's client gets `clearActiveRoom` (per §2) and navigates to Lobby.

**No Leave button on the playing-phase view of GameTableScreen.** Once cards are on the table, the only way out is to close the tab. This is intentional: closing the tab keeps the seat (request_timeout will auto-advance after 5 min if needed) and the player can come back via RejoinGuard. Removing the button removes the misclick risk during the most-fragile phase of the game.

**WaitingRoom Leave** stays as today — no confirmation needed, the game hasn't started so the cost is zero. If the host leaves WaitingRoom, the existing host-leave logic ends the room for everyone (unchanged).

i18n keys to add (EN normative; RU/ES translated alongside):

- `multiplayer.leaveConfirmTitle` — "Leave the game?"
- `multiplayer.leaveConfirmBody` — "The game can't continue without you. Everyone goes back to the waiting room and your hand is dropped — the host can restart with the remaining players.\n\nIf you just need to step away or refresh — close the tab instead. You'll come back to the same seat."
- `multiplayer.leaveAnyway` — "Leave anyway"
- `multiplayer.leftMidGame` — "🚪 {{name}} left the game"
- `common.cancel` — already exists.

### 5. Display the "X left mid-game" event in WaitingRoom

When the room snaps back to waiting after a mid-game leave, remaining players land on WaitingRoomScreen. They should see *who* left and that the game was abandoned. The repository already has a chat panel (`src/components/ChatPanel.tsx`) and a `game_events` table; the natural fit is to render a one-line system message in the chat panel using `multiplayer.leftMidGame`.

Concretely: WaitingRoomScreen subscribes to `game_events` for the room (today it likely subscribes to chat-kind events; extend the filter to also pick up `kind === 'player_left_mid_game'` and render with a system-message style). If extending the existing chat subscription is too invasive, a simpler fallback: show a single dismissable banner at the top of WaitingRoomScreen for the most recent `player_left_mid_game` event from the current session.

Pick whichever is closer to the existing chat code; the spec is agnostic on the visual treatment.

### 6. SW push notification click — drop the `/join/<code>` redirect

`public/sw.js` `notificationclick` handler currently does:

```js
const target = room_code ? `/join/${room_code}` : '/';
// … focus client + postMessage push:navigate
// fallback: openWindow(target)
```

Change:

- `notificationclick`: `clients.matchAll` → `focus()` if a same-origin client exists. If none, `openWindow('/')` — root, not `/join/`.
- `App.tsx`'s `push:navigate` handler stops doing `window.location.assign('/join/<code>')`. Instead it calls `tryRestoreActiveRoom()` and navigates to the returned target. RejoinGuard already does this on cold boot; the message handler is the warm-tab equivalent.

```ts
// App.tsx
const handler = async (event: MessageEvent) => {
  const msg = event.data;
  if (msg?.kind !== 'push:navigate') return;
  const target = await tryRestoreActiveRoom();
  if (target) navigationRef.navigate(target);
};
```

## Edge cases

- **Active room storage points at a finished or non-existent room.** `tryRestoreActiveRoom` returns `null` and clears storage. User lands on Lobby.
- **User signed out then back in (different account).** `get_room_state` is RLS-protected; if the session no longer matches the room players, the RPC returns `null` or errors → `clearActiveRoom` → Lobby.
- **Tab close during betting/playing with no Leave pressed.** Server keeps the seat. Heartbeat goes stale → `is_connected` flips. After 5 min of inactivity, `useTurnTimeout` posts `request_timeout` from any mounted client; the server auto-advances the seat (bet=0 if legal, lowest legal card). On reopen, `tryRestoreActiveRoom` rehydrates and the user takes back control. **This is the encouraged "I'll be right back" flow** — the dialog text in §4 explicitly steers users here.
- **Host leaves from BettingPhase.** Existing host-leave branch in `leaveRoom` runs first — closes the room for everyone, marks `phase = 'finished'`. The mid-game-reset code in §3 only runs for non-host leavers. (Order matters in the implementation: `if (isHostLeaving) return …` before the mid-game branch.)
- **Two players leave simultaneously mid-game.** Both `leave_room` calls hit the server. The first deletes its row, runs the mid-game-reset, sets `phase = 'waiting'`. The second hits a `phase === 'waiting'` room — the mid-game branch's `if (room.phase === 'playing')` check is false, so it just deletes the row and leaves quietly. Net: one chat banner for the first leaver, none for the second. Acceptable.
- **`window.confirm` not available** (very old WebView). Confirm helper falls through to `true` (skip confirm) rather than blocking the leave. Unlikely on supported targets.

## Testing

Manual smoke (in dev):

1. **Refresh during betting:** create a 3-player room, start game, place one bid each, **hard refresh** one browser before the third bid lands. Expect: lands back on the betting view with their previous bid (if any) intact.
2. **Refresh during playing:** start a hand, play one card, hard refresh another browser. Expect: lands on GameTable with current trick visible, my hand intact.
3. **Leave from WaitingRoom:** no confirm, immediately Lobby.
4. **Leave from BettingPhase (non-host):** confirm dialog. Cancel returns to betting. Confirm: leaver lands on Lobby. Other clients see WaitingRoom with chat banner "🚪 X left the game". Host can press Start again, game restarts with remaining players.
5. **Leave from BettingPhase (host):** confirm dialog. Confirm: room ends for everyone, `phase = 'finished'`, all clients clear active room and land on Lobby.
6. **No Leave button on playing-phase GameTable.** Inspect — no Leave-related UI present once the first card has been played.
7. **Push-notification click on phone with PWA closed:** open PWA → lands on the active room directly via RejoinGuard, no "Game already started" toast.
8. **Tab close during playing:** wait 6 minutes from another browser. Expect: `request_timeout` auto-played the absent seat with bet=0 / lowest card. Reopen the closed tab — RejoinGuard lands them on GameTable with degraded but consistent state.

No new automated tests required; this is mostly UI/navigation glue plus a server-side state reset that mirrors existing patterns.

## File diff summary

| Path | Action | What |
|---|---|---|
| `src/navigation/AppNavigator.tsx` | Modify | Re-enable `RejoinGuard` to call `tryRestoreActiveRoom`. |
| `src/lib/gameClient.ts` | Modify | `leaveRoom` clears active room on success. |
| `supabase/functions/game-action/actions/leaveRoom.ts` | Modify | Mid-game non-host leave abandons hand + snaps room to `waiting` + emits `player_left_mid_game` game_event. |
| `src/components/betting/BettingPhase.tsx` | Modify | Add Leave button + confirm dialog. |
| `src/screens/WaitingRoomScreen.tsx` | Modify | Subscribe to / render `player_left_mid_game` events as chat-style banner. |
| `public/sw.js` | Modify | `notificationclick` opens `/` instead of `/join/<code>`. |
| `src/App.tsx` | Modify | `push:navigate` handler uses `tryRestoreActiveRoom` instead of `window.location.assign('/join/<code>')`. |
| `src/lib/leaveWithConfirm.ts` | Create | Shared confirm-then-leave helper used by BettingPhase. |
| `src/i18n/locales/{en,ru,es}.json` | Modify | Add `multiplayer.leaveConfirmTitle`, `leaveConfirmBody`, `leaveAnyway`, `leftMidGame`. |

No migration required — `game_events.kind` is free-form, no new tables or columns.

## Out of scope (follow-ups, not blocking)

- **Replace leaver with a smart bot.** Requires bot logic that can be seated mid-hand with partial deck knowledge, plus a UI to show "🤖 Bot took over X's seat". Akula has a separate planning thread for the bot's full-hand strategy. Until that lands, leaving = game resets.
- **Auto-kick frozen players.** "X has been silent for N minutes — kick them?" UI in the banner / chat, host-only. The current 5-min auto-advance keeps the table flowing without explicit kick; this would only matter for very long sessions.
- **Cross-device active room discovery.** Server already knows which rooms a `auth_user_id` is in. We could add an `rpc('get_my_active_rooms')` and offer "Resume game" on Lobby for users who left their game on another device.
- **`beforeunload` warning** when closing a tab during betting / playing. Browser-native confirm. Doesn't work on iOS PWA, and the current "tab close = rejoin cleanly" flow makes it largely unnecessary.
