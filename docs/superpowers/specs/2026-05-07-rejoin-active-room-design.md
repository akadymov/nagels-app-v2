# Resume / Rejoin an Active Room — Design

## Goal

A player who **accidentally** loses their game context — full page refresh, closed tab, OS-killed PWA, push-notification click that landed in the wrong place — must be able to come back to the same seat with the same state. **Explicit** "Leave Room" remains permanent (the row in `room_players` is removed), but a confirmation dialog prevents misclicks during an in-progress hand.

This is not a new feature — most of the infrastructure already lives in the repo, just disabled. The work is to re-enable it, plug the missing leave-related plumbing, and adjust two surfaces (push-click target, GameTableScreen).

## Non-goals

- Cross-device handoff. We do not discover active rooms from a fresh install on a different browser/device. Active room is keyed in the **local** AsyncStorage on the device that joined.
- Bot-takeover redesign. If the bot took over the seat after a timeout, rejoin replaces the bot via the existing reconnect path; we do not change the bot logic.
- "Leave but hold seat" soft leave. Hard leave only. The "soft leave" effect is what every closed tab already produces — server keeps the seat, heartbeat goes stale, bot may take over after timeout per existing rules.

## What already exists (and is correct)

- `src/lib/activeRoom.ts`:
  - `setActiveRoom(roomId)` / `getActiveRoom()` / `clearActiveRoom()` — AsyncStorage wrappers, key `active_room_id_v1`.
  - `tryRestoreActiveRoom()` — full implementation: reads stored id, calls `supabase.rpc('get_room_state')`, hydrates `useRoomStore`, calls `subscribeRoom`, returns `'WaitingRoom' | 'GameTable' | null`. Already clears storage on `room === null` or `phase === 'finished'`.
- `setActiveRoom(roomId)` is already called from `LobbyScreen.tsx:188` (createRoom) and `:244` (joinRoom).
- Server-side `get_room_state` RPC and `get_my_session_id` RPC exist and work; they're what `tryRestoreActiveRoom` consumes.

## What's broken / missing

1. **`RejoinGuard` is a no-op.** `src/navigation/AppNavigator.tsx:210-215` is stubbed with the comment _"Rejoin path is being rebuilt … For now, just no-op."_ It never calls `tryRestoreActiveRoom()`. Effect: a hard refresh always lands on Lobby.
2. **`gameClient.leaveRoom` does not call `clearActiveRoom`.** Effect: after explicit leave the storage still points at the (now-empty-for-this-user) room. Not catastrophic — `tryRestoreActiveRoom` clears it gracefully on next boot — but causes a brief flash of "rejoining…" before the user is bounced back to Lobby.
3. **No Leave button on GameTableScreen.** Today the only way out of a live game is to close the tab. Players need an explicit exit; with rejoin enabled, the same closed-tab behavior still rejoins them, so we need a deliberate leave to truly end the session.
4. **Push notification click goes through `/join/<code>`.** `App.tsx` listens for `kind:'push:navigate'` from SW and `window.location.assign('/join/<code>')`. That triggers the new-player join flow, which rejects mid-game with "Game already started" toast. With RejoinGuard active and `setActiveRoom` already done at original join time, the push-click path can collapse into "open the app" — RejoinGuard will land the user in the correct room.

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

`tryRestoreActiveRoom` already handles the unhappy paths (room gone, finished, RPC failure) by calling `clearActiveRoom` internally and returning `null`. We only navigate if it returns a target. Lobby is the implicit fallback.

`rejoinAttempted` is the existing ref — protects against double-fire on auth state churn.

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

Also clear on host-leave (which finishes the room for everyone), and on game finish where the user should not be auto-rejoined: this is already handled inside `tryRestoreActiveRoom` (returns `null` when `phase === 'finished'`), so no explicit hook needed at finish-time.

### 3. Leave button on GameTableScreen

Add a Leave control to GameTableScreen — placement mirrors WaitingRoom (top-bar icon or pop-over from the existing top-bar). Tapping it shows a confirm dialog:

```
Title:  Leave the game?
Body:   You'll lose your seat and the game will continue without you.
        A bot may take over your turns.
Buttons: [Cancel]   [Leave]
```

On Confirm → `gameClient.leaveRoom(roomId)` → `clearActiveRoom` (per #2) → `navigation.navigate('Lobby')` → reset `useRoomStore`.

### 4. Confirmation also fires from WaitingRoom *only* if `room.phase !== 'waiting'`

Currently `WaitingRoomScreen.handleLeave` calls `gameClient.leaveRoom` directly. Wrap it: if `room.phase === 'waiting'` (no game started), leave silently as today. If `room.phase === 'playing'` (rare — WaitingRoom usually unmounts on phase flip, but during the brief transition window) show the same confirm dialog.

We share one confirm-leave helper between both screens. Place it in `src/lib/leaveWithConfirm.ts`:

```ts
export async function leaveWithConfirm(
  roomId: string,
  needsConfirm: boolean,
  t: TFunction,
): Promise<boolean> {
  if (needsConfirm) {
    const ok = window.confirm
      ? window.confirm(`${t('multiplayer.leaveConfirmTitle')}\n\n${t('multiplayer.leaveConfirmBody')}`)
      : true;
    if (!ok) return false;
  }
  const r = await gameClient.leaveRoom(roomId);
  if (r.ok) await clearActiveRoom();
  return r.ok;
}
```

`window.confirm` is the cheapest path on web; native React Native would use `Alert.alert`, but the project already routes through `window.alert` for cross-platform reliability (see `WaitingRoomScreen.showMessage`). Mirror that pattern.

i18n keys to add (EN normative; RU/ES translated alongside):

- `multiplayer.leaveConfirmTitle` — "Leave the game?"
- `multiplayer.leaveConfirmBody` — "You'll lose your seat and the game will continue without you. A bot may take over your turns."
- `common.leave` — "Leave"
- `common.cancel` — already exists.

### 5. SW push notification click — drop the `/join/<code>` redirect

`public/sw.js` `notificationclick` handler currently does:

```js
const target = room_code ? `/join/${room_code}` : '/';
// … focus client + postMessage push:navigate
// fallback: openWindow(target)
```

`App.tsx`'s `push:navigate` handler does `window.location.assign('/join/<code>')`, which is the part that triggers join-flow. With RejoinGuard active, the user already has the active room in storage; we just need to bring the app to the foreground. Change:

- SW `notificationclick`: still `clients.matchAll` → `focus()` if a same-origin client exists. If none, `openWindow('/')` — root, not `/join/`.
- The `postMessage({kind:'push:navigate', room_code, room_id})` to focused clients **stays**, but `App.tsx`'s handler now does **nothing UI-visible** if the user is already in the right room (RejoinGuard already loaded them). If a client receives the message but is on Lobby (e.g., user manually navigated away from the game and got a push), force a state refresh: call `tryRestoreActiveRoom()` again — which will land them back. No `window.location.assign`.

```ts
// App.tsx
const handler = async (event: MessageEvent) => {
  const msg = event.data;
  if (msg?.kind !== 'push:navigate') return;
  const target = await tryRestoreActiveRoom();
  if (target) navigationRef.navigate(target);
};
```

(needs a navigation ref hoisted to App level, or a global event the navigator listens to — choose whichever is already in the codebase pattern.)

## Edge cases

- **Active room storage points at a finished or non-existent room.** `tryRestoreActiveRoom` returns `null` and clears storage. User lands on Lobby. Already handled.
- **User signed out then back in (different account).** `get_room_state` is RLS-protected; if the session no longer matches the room players, the RPC returns `null` or errors → `clearActiveRoom` → Lobby. Already handled by existing fallback.
- **Multiple tabs of the same site with the same active room.** Each tab calls RejoinGuard once on its own boot. Both end up in GameTable. They compete on heartbeats but the snapshot is server-authoritative — fine. (No new locking required.)
- **User has active room A, gets a push for room B.** Push subscriptions are bound to `auth_user_id`, not `room_id`. If user is in only one room at a time, B == A and there's no conflict. If they were in B previously and got a stale push (rare; B's `room_players` row should be gone after they switched), the click brings them to the active room A via RejoinGuard — push-from-B is silently ignored. Acceptable.
- **Tab close during game with no Leave button pressed.** Server keeps the seat (`room_players` row stays). Heartbeat goes stale → existing `is_connected` flag flips → bot-takeover may activate per existing rules. On reopen, `tryRestoreActiveRoom` rehydrates and the user takes back control via the existing reconnect path.
- **`window.confirm` not available** (very old WebView). `leaveWithConfirm` falls through to `true` (skip confirm) rather than blocking the leave. Unlikely on supported targets.

## Testing

- `tryRestoreActiveRoom` already has implicit coverage; no new server tests.
- Manual smoke (in dev):
  1. Create a room with two browsers, mark ready, start game, place bids, play one card, then **hard refresh** one browser. Expect: lands on GameTable with the same hand state, my hand intact, current trick visible.
  2. Hard refresh during WaitingRoom. Expect: lands on WaitingRoom with same player list.
  3. Click Leave in WaitingRoom. Expect: no confirm, immediately Lobby.
  4. Click Leave in GameTable mid-game. Expect: confirm dialog. Cancel returns to GameTable. Confirm goes to Lobby and the seat is removed (visible from the other browser).
  5. Push-notification click on phone with PWA closed: open PWA → lands on the active room directly, no "Game already started" toast.
  6. Tab close mid-game. Reopen tab → same screen as before.
- No new automated tests required; this is mostly UI/navigation glue. Existing server tests for `leave_room` action stay green.

## File diff summary

| Path | Action | What |
|---|---|---|
| `src/navigation/AppNavigator.tsx` | Modify | Re-enable `RejoinGuard` to call `tryRestoreActiveRoom`. |
| `src/lib/gameClient.ts` | Modify | `leaveRoom` clears active room on success. |
| `src/lib/leaveWithConfirm.ts` | Create | Shared confirm-then-leave helper. |
| `src/screens/WaitingRoomScreen.tsx` | Modify | Use `leaveWithConfirm` (skip confirm in `waiting` phase). |
| `src/screens/GameTableScreen.tsx` | Modify | Add Leave button, route through `leaveWithConfirm`. |
| `public/sw.js` | Modify | `notificationclick` opens `/` instead of `/join/<code>`. |
| `src/App.tsx` | Modify | `push:navigate` handler uses `tryRestoreActiveRoom` instead of `window.location.assign('/join/<code>')`. |
| `src/i18n/locales/{en,ru,es}.json` | Modify | Add `multiplayer.leaveConfirmTitle`, `leaveConfirmBody`, `common.leave`. |

No server-side or migration changes.

## Out of scope (follow-ups, not blocking)

- **Bot kicks itself out on rejoin.** If the bot is currently holding a seat the rejoining user owns, the seat owner takes back control automatically? Or is the bot allowed to finish the current hand? Today's bot logic predates this work; behavior is whatever it was. If wrong, separate ticket.
- **`beforeunload` warning** when closing a tab during a live game. Browser-native confirm. Doesn't work on iOS PWA. Skip for now — explicit Leave covers the deliberate case, accidental close auto-rejoins.
- **Cross-device active room discovery.** Server already knows what rooms a `auth_user_id` is in. We could add `rpc('get_my_active_rooms')` and offer "Resume game" CTA on Lobby for users who left their game on another device. Not in this spec.
