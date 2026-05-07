# Resume / Rejoin an Active Room — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players who lose context (refresh, close tab, push-click) get rejoined into their active room automatically; explicit Leave is permanent and gated behind a confirmation that exists only on the betting screen, with a server-side reset to `'waiting'` so the host can restart with the remaining players.

**Architecture:** Mostly re-enabling existing infrastructure (`tryRestoreActiveRoom`) plus a new server-side branch in the `leave_room` action that abandons the in-progress hand and snaps the room back to `waiting`. A new realtime broadcast event surfaces the "X left mid-game" banner. No migrations.

**Tech Stack:** Expo (React Native Web) + TypeScript + Supabase (Edge Functions in Deno, Postgres) + Zustand store.

**Spec:** `docs/superpowers/specs/2026-05-07-rejoin-active-room-design.md`

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/navigation/AppNavigator.tsx` | Modify | Re-enable `RejoinGuard` to invoke `tryRestoreActiveRoom`. |
| `src/lib/gameClient.ts` | Modify | `leaveRoom` clears active room on success. |
| `public/sw.js` | Modify | `notificationclick` opens `/`, never `/join/<code>`. |
| `src/App.tsx` | Modify | `push:navigate` handler routes via `tryRestoreActiveRoom`, not `window.location.assign`. |
| `supabase/functions/game-action/actions/leaveRoom.ts` | Modify | Mid-game non-host leave abandons the in-progress hand, snaps room to `waiting`, broadcasts a `left_mid_game` event. |
| `src/lib/realtimeBroadcast.ts` | Modify | Subscribe to `left_mid_game` broadcasts and dispatch into a new system-event store. |
| `src/store/systemEventStore.ts` | Create | Tiny zustand store holding the most recent `left_mid_game` event with auto-expiry. |
| `src/components/betting/BettingPhase.tsx` | Modify | Add Leave button + confirm dialog. |
| `src/lib/leaveWithConfirm.ts` | Create | Shared confirm-then-leave helper. |
| `src/screens/WaitingRoomScreen.tsx` | Modify | Render banner for the most recent `left_mid_game` event. |
| `src/i18n/locales/{en,ru,es}.json` | Modify | Add `multiplayer.leaveConfirmTitle`, `leaveConfirmBody`, `leaveAnyway`, `leftMidGame`. |

---

## Task 1: Re-enable RejoinGuard

**Files:**
- Modify: `src/navigation/AppNavigator.tsx:210-215`

The current `RejoinGuard` rejoin effect is a no-op stub. Replace it with a call to the existing `tryRestoreActiveRoom()` helper (already implemented in `src/lib/activeRoom.ts`).

- [ ] **Step 1: Open the file and find the no-op block**

Run: `grep -n "Rejoin path is being rebuilt" src/navigation/AppNavigator.tsx`

Expected: prints one line, ~213.

- [ ] **Step 2: Replace the no-op effect with the real one**

In `src/navigation/AppNavigator.tsx`, find the block near line 210 that reads:

```ts
useEffect(() => {
  if (!isInitialized || rejoinAttempted.current) return;
  rejoinAttempted.current = true;
  // Rejoin path is being rebuilt on top of the new server-authoritative
  // pipeline (see plan §M8). For now, just no-op.
}, [isInitialized]);
```

Replace it with:

```ts
useEffect(() => {
  if (!isInitialized || rejoinAttempted.current) return;
  rejoinAttempted.current = true;
  void (async () => {
    try {
      const { tryRestoreActiveRoom } = await import('../lib/activeRoom');
      const target = await tryRestoreActiveRoom();
      if (target) navigation.navigate(target);
    } catch (err) {
      console.warn('[rejoin] tryRestoreActiveRoom threw:', err);
    }
  })();
}, [isInitialized, navigation]);
```

The dynamic `import` mirrors the existing dynamic-import pattern used elsewhere in this file (e.g., `LobbyScreen.tsx` uses dynamic `import('../lib/activeRoom')` for `setActiveRoom`).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "AppNavigator|activeRoom"`

Expected: no output (clean for these files; project-wide tsc may surface unrelated noise — only AppNavigator.tsx and activeRoom.ts should be free of fresh errors).

- [ ] **Step 4: Manual smoke**

Start dev server: `npx expo start --port 8081`. In a browser:
1. Open the app, sign in as anonymous.
2. Create a room, mark ready, start the game.
3. **Hard refresh** (Cmd+Shift+R) the tab.
4. Expected: app reloads to GameTable / BettingPhase, not Lobby.

If it bounces to Lobby instead — the rejoin failed silently. Open Console for `[rejoin]` warnings.

- [ ] **Step 5: Commit**

```bash
git add src/navigation/AppNavigator.tsx
git commit -m "feat(rejoin): re-enable RejoinGuard via tryRestoreActiveRoom"
```

---

## Task 2: Clear active room on explicit leave

**Files:**
- Modify: `src/lib/gameClient.ts`

Today `gameClient.leaveRoom` is a one-liner that just posts the `leave_room` action and returns. After Task 1, the `active_room_id_v1` AsyncStorage key persists past the leave, causing a brief "rejoining…" flash the next time the app boots before `tryRestoreActiveRoom` clears it. Clear it inline on success.

- [ ] **Step 1: Find the existing `leaveRoom` shorthand**

Run: `grep -n "leaveRoom:" src/lib/gameClient.ts`

Expected: shows `leaveRoom: (room_id: string, target_session_id?: string) => …` near line 81.

- [ ] **Step 2: Replace the one-liner with a method that clears active room**

In `src/lib/gameClient.ts`, change the `leaveRoom` entry from:

```ts
  leaveRoom: (room_id: string, target_session_id?: string) =>
    postAction(null, { kind: 'leave_room', room_id, target_session_id }),
```

To:

```ts
  leaveRoom: async (room_id: string, target_session_id?: string) => {
    const result = await postAction(null, { kind: 'leave_room', room_id, target_session_id });
    // Clear local "active room" so RejoinGuard doesn't bounce us back into a
    // room we just chose to leave. Only clears for self-leave; if a host
    // kicks someone else (target_session_id !== self), don't touch storage.
    if (result.ok && !target_session_id) {
      const { clearActiveRoom } = await import('./activeRoom');
      await clearActiveRoom();
    }
    return result;
  },
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "gameClient"`

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/gameClient.ts
git commit -m "feat(rejoin): clearActiveRoom on explicit leave"
```

---

## Task 3: Push notification click — open root, not /join/

**Files:**
- Modify: `public/sw.js`
- Modify: `src/App.tsx`

SW currently navigates to `/join/<code>`, which triggers the new-player join flow and rejects mid-game ("Game already started"). With RejoinGuard active, we just need to bring the app to foreground and let RejoinGuard land the user in the right room.

- [ ] **Step 1: Update SW `notificationclick`**

In `public/sw.js`, find the `notificationclick` listener:

```js
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const room_code = data.room_code;
  const target = room_code ? `/join/${room_code}` : '/';
  …
});
```

Replace its body with:

```js
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const ours = all.find((c) => new URL(c.url).origin === self.location.origin);
    if (ours) {
      await ours.focus();
      // Tell the focused client to refresh its rejoin state. The room_code
      // and room_id are passed for the client's information, but the client
      // does NOT use them to call /join/ — it calls tryRestoreActiveRoom().
      ours.postMessage({ kind: 'push:navigate', room_code: data.room_code, room_id: data.room_id });
      return;
    }
    // No existing client — open the root URL. RejoinGuard runs on cold boot
    // and lands the user in their active room via AsyncStorage.
    await self.clients.openWindow('/');
  })());
});
```

- [ ] **Step 2: Update `src/App.tsx` `push:navigate` handler**

Find the handler added in the web-push branch — it currently does `window.location.assign(\`/join/${msg.room_code}\`)`. Replace its body so the message handler delegates to `tryRestoreActiveRoom`:

```ts
useEffect(() => {
  if (Platform.OS !== 'web') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const handler = async (event: MessageEvent) => {
    const msg = event.data;
    if (msg?.kind !== 'push:navigate') return;
    try {
      const { tryRestoreActiveRoom } = await import('./lib/activeRoom');
      // Side-effect: hydrates useRoomStore + subscribes channel. Navigation
      // is then driven by RejoinGuard (already mounted) reacting to
      // useRoomStore. We don't have a navigation ref here in App.tsx's
      // outer component; the subsequent state push is enough to make
      // existing screens re-render correctly because RejoinGuard fired
      // on the original cold boot.
      await tryRestoreActiveRoom();
    } catch (err) {
      console.warn('[push] navigate handler failed:', err);
    }
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}, []);
```

If the engineer finds that `tryRestoreActiveRoom` doesn't trigger a navigation while the app is *already* on a non-room screen (e.g., user navigated to Lobby manually after subscribing), they should fall back to wiring a `navigationRef` (React Navigation's pattern) and calling `navigationRef.navigate(target)` here. The cold-boot path is covered by Task 1's `RejoinGuard`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "App.tsx|sw.js"`

Expected: no errors for these files (sw.js is JS so tsc doesn't check it; App.tsx must be clean).

- [ ] **Step 4: Commit**

```bash
git add public/sw.js src/App.tsx
git commit -m "feat(rejoin): SW + App handle push click via tryRestoreActiveRoom"
```

---

## Task 4: Server `leave_room` handles mid-game leavers

**Files:**
- Modify: `supabase/functions/game-action/actions/leaveRoom.ts`

Extend the action so that when a non-host player leaves while `room.phase === 'playing'`, the server abandons the in-progress hand and resets the room to `'waiting'`. Insert a `game_event` of `kind: 'player_left_mid_game'` so the client banner has data to render. The host-leave branch is untouched.

- [ ] **Step 1: Add the mid-game branch**

In `supabase/functions/game-action/actions/leaveRoom.ts`, find the line after the `room_players.delete()` (around line 39) and the existing `if (isHostLeaving) { … }` block. **Before** the existing non-host `game_events.insert({…kind:'leave_room'…})` call (near line 72), insert a new branch:

```ts
  // Non-host leaving while a hand is in progress — abandon the hand and
  // snap the room back to waiting so the host can restart with the
  // remaining players. Past hand_scores from already-closed hands stay
  // intact; only the current_hand and its child rows are dropped.
  if (!isHostLeaving && room.phase === 'playing' && (room as any).current_hand_id) {
    const hid = (room as any).current_hand_id as string;
    // Walk the FK chain top-down: trick_cards → tricks, hand_scores,
    // dealt_cards, hands. (If the schema already has ON DELETE CASCADE
    // on these chains, deleting `hands` alone would suffice. Doing it
    // explicitly is defensive and idempotent.)
    const trickRows = await svc.from('tricks').select('id').eq('hand_id', hid);
    const trickIds = (trickRows.data ?? []).map((r: any) => r.id);
    if (trickIds.length > 0) {
      await svc.from('trick_cards').delete().in('trick_id', trickIds);
    }
    await svc.from('tricks').delete().eq('hand_id', hid);
    await svc.from('hand_scores').delete().eq('hand_id', hid);
    await svc.from('dealt_cards').delete().eq('hand_id', hid);
    await svc.from('hands').delete().eq('id', hid);

    await svc.from('rooms').update({
      phase: 'waiting',
      current_hand_id: null,
      version: (room.version ?? 0) + 1,
    }).eq('id', room.id);

    await svc.from('game_events').insert({
      room_id: room.id,
      session_id: actor.session_id,
      kind: 'player_left_mid_game',
      payload: { display_name: actor.display_name },
    });

    // Broadcast a one-shot system event so other clients can render a
    // banner without polling game_events. Mirrors the pattern of
    // broadcastStateChanged but on a different event name.
    const channel = svc.channel(`room:${room.id}`);
    await new Promise<void>((resolve) => {
      channel.subscribe((status) => { if (status === 'SUBSCRIBED') resolve(); });
    });
    await channel.send({
      type: 'broadcast',
      event: 'left_mid_game',
      payload: { display_name: actor.display_name, at: new Date().toISOString() },
    });
    await channel.unsubscribe();

    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: true, state: snapshot, version: snapshot.room?.version ?? 0 };
  }
```

The cast to `(room as any).current_hand_id` is because the existing `select('id, host_session_id, phase, version')` at line 19 doesn't fetch `current_hand_id`. Either widen the select to include it (preferred) or keep the cast.

**Recommended:** widen the select. Find the line:

```ts
    .select('id, host_session_id, phase, version')
```

Change to:

```ts
    .select('id, host_session_id, phase, version, current_hand_id')
```

After widening, drop the `(room as any)` casts in the new branch.

- [ ] **Step 2: Verify FK behavior on the schema**

Run (locally if you have a stack, else inspect via Supabase Studio):

```sql
SELECT conname, conrelid::regclass, confrelid::regclass, confdeltype
FROM pg_constraint
WHERE confrelid = 'public.hands'::regclass;
```

Expected: shows the children of `hands`. If `ON DELETE CASCADE` is `'c'` on every chain (`trick_cards.trick_id → tricks.id`, `tricks.hand_id → hands.id`, `hand_scores.hand_id → hands.id`, `dealt_cards.hand_id → hands.id`), the explicit deletes in the branch are redundant — but harmless. If any are `'a'` (no action) or `'r'` (restrict), the explicit deletes are mandatory. Either way, the code handles both.

- [ ] **Step 3: Type-check the function**

Run: `cd /tmp && deno check /Users/akadymov/claude-projects/nigels-app-v2/supabase/functions/game-action/actions/leaveRoom.ts`

Expected: clean check from /tmp (avoids the project's deno.lock confusing the npm: resolver — same gotcha as the web-push wire layer).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/game-action/actions/leaveRoom.ts
git commit -m "feat(rejoin): mid-game leave abandons hand, snaps room to waiting"
```

---

## Task 5: Deploy `game-action` and smoke the server reset

**Files:** none — operational task.

- [ ] **Step 1: Deploy the updated function**

```bash
supabase functions deploy game-action
```

Expected: one "Deployed" line.

- [ ] **Step 2: Manual smoke against staging/prod**

(No automated test target for edge function actions in this repo — manual verification only.)

1. Open the app in two browsers, both create + ready up + start a 2-player game.
2. Place at least one bid in browser A.
3. In browser A, open DevTools → Network. Manually invoke `leaveRoom` from Console:
   ```js
   const { gameClient } = await import('/_expo/static/js/web/index-...js');
   // can't reliably import; instead just leave through the UI once Task 6 lands.
   ```
   For now, smoke-test from the database side:
4. In Supabase Studio → SQL Editor:
   ```sql
   SELECT id, phase, current_hand_id FROM public.rooms ORDER BY created_at DESC LIMIT 1;
   SELECT id, hand_number, phase FROM public.hands WHERE room_id = '<id>';
   ```
5. Manually trigger a `leave_room` POST against `https://evcaqgmkdlqesqisjfyh.supabase.co/functions/v1/game-action` via curl with a valid JWT:
   ```bash
   curl -X POST 'https://evcaqgmkdlqesqisjfyh.supabase.co/functions/v1/game-action' \
     -H "Authorization: Bearer $JWT" \
     -H "apikey: $ANON_KEY" \
     -H 'Content-Type: application/json' \
     -d '{"action":{"kind":"leave_room","room_id":"<ROOM_ID>"}}'
   ```
6. Re-run the SQL queries. Expected:
   - `rooms.phase = 'waiting'`, `rooms.current_hand_id IS NULL`.
   - `hands` table no longer has the row for the abandoned hand.
   - `game_events` has a new row with `kind = 'player_left_mid_game'`.
   - `room_players` has one fewer row.

If any assertion fails, fix the action and redeploy. **Do not advance** to Task 6 until the server side is verified.

- [ ] **Step 3 (no commit)**

Operational task only — nothing to commit.

---

## Task 6: System event store + realtime subscription

**Files:**
- Create: `src/store/systemEventStore.ts`
- Modify: `src/lib/realtimeBroadcast.ts`

A tiny zustand store holds the most recent `left_mid_game` event for the WaitingRoom banner. Auto-clears after 30 seconds.

- [ ] **Step 1: Create the store**

Create `src/store/systemEventStore.ts`:

```ts
import { create } from 'zustand';

export interface LeftMidGameEvent {
  display_name: string;
  at: string; // ISO timestamp
}

interface SystemEventState {
  lastLeftMidGame: LeftMidGameEvent | null;
  setLeftMidGame: (ev: LeftMidGameEvent) => void;
  clearLeftMidGame: () => void;
}

export const useSystemEventStore = create<SystemEventState>((set) => ({
  lastLeftMidGame: null,
  setLeftMidGame: (ev) => {
    set({ lastLeftMidGame: ev });
    // Auto-clear after 30s so the banner doesn't stick around forever.
    setTimeout(() => {
      set((state) => state.lastLeftMidGame === ev ? { lastLeftMidGame: null } : state);
    }, 30_000);
  },
  clearLeftMidGame: () => set({ lastLeftMidGame: null }),
}));
```

The "compare reference, only clear if still the same event" guard prevents a freshly-arrived second leave from being clobbered by the timer of an older one.

- [ ] **Step 2: Subscribe to `left_mid_game` events in realtimeBroadcast**

Open `src/lib/realtimeBroadcast.ts` and find the existing `channel.on('broadcast', { event: 'state_changed' }, …)` and `chat` listeners. Add a third listener for `left_mid_game`:

```ts
import { useSystemEventStore } from '../store/systemEventStore';
// …
channel.on('broadcast', { event: 'left_mid_game' }, ({ payload }) => {
  if (!payload || typeof payload.display_name !== 'string') return;
  useSystemEventStore.getState().setLeftMidGame({
    display_name: payload.display_name,
    at: payload.at ?? new Date().toISOString(),
  });
});
```

Add this listener immediately below the existing `'chat'` one inside the same `subscribeRoom` function — it shares the channel.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "systemEventStore|realtimeBroadcast"`

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/store/systemEventStore.ts src/lib/realtimeBroadcast.ts
git commit -m "feat(rejoin): system event store + left_mid_game broadcast subscription"
```

---

## Task 7: i18n strings for confirm dialog and banner

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/es.json`

EN copy is normative. RU/ES are translated alongside.

- [ ] **Step 1: Add EN keys**

In `src/i18n/locales/en.json`, find the `multiplayer` section. Add these keys at the bottom of that section (before the closing brace):

```jsonc
"leaveConfirmTitle": "Leave the game?",
"leaveConfirmBody": "The game can't continue without you. Everyone goes back to the waiting room and your hand is dropped — the host can restart with the remaining players.\n\nIf you just need to step away or refresh — close the tab instead. You'll come back to the same seat.",
"leaveAnyway": "Leave anyway",
"leftMidGame": "🚪 {{name}} left the game"
```

- [ ] **Step 2: Add RU keys**

In `src/i18n/locales/ru.json`, in the `multiplayer` section:

```jsonc
"leaveConfirmTitle": "Выйти из игры?",
"leaveConfirmBody": "Игра не сможет продолжиться без тебя. Все вернутся в комнату ожидания, а раздача будет сброшена — хост сможет перезапустить игру с оставшимися.\n\nЕсли просто хочешь отойти или обновить страницу — закрой вкладку. Ты вернёшься на то же место.",
"leaveAnyway": "Всё равно выйти",
"leftMidGame": "🚪 {{name}} покинул игру"
```

- [ ] **Step 3: Add ES keys**

In `src/i18n/locales/es.json`, in the `multiplayer` section:

```jsonc
"leaveConfirmTitle": "¿Abandonar la partida?",
"leaveConfirmBody": "La partida no puede continuar sin ti. Todos vuelven a la sala de espera y tu mano se descarta — el anfitrión puede reiniciar con el resto.\n\nSi sólo necesitas alejarte o actualizar la página — cierra la pestaña. Volverás al mismo asiento.",
"leaveAnyway": "Salir igualmente",
"leftMidGame": "🚪 {{name}} ha abandonado la partida"
```

- [ ] **Step 4: Verify JSON parses cleanly**

Run: `node -e "['en','ru','es'].forEach(l => JSON.parse(require('fs').readFileSync('src/i18n/locales/'+l+'.json')))"`

Expected: no output (silent success). If it throws — fix the trailing comma / quote you missed.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/ru.json src/i18n/locales/es.json
git commit -m "feat(rejoin): i18n strings for leave confirm + mid-game banner"
```

---

## Task 8: Shared `leaveWithConfirm` helper

**Files:**
- Create: `src/lib/leaveWithConfirm.ts`

A tiny helper used by `BettingPhase`. Wraps the confirm step + `gameClient.leaveRoom` call so the calling component stays clean.

- [ ] **Step 1: Create the helper**

Create `src/lib/leaveWithConfirm.ts`:

```ts
import type { TFunction } from 'i18next';
import { gameClient } from './gameClient';

/**
 * Shows a confirm dialog, then calls leave_room if the user accepts.
 * Returns true if the leave was attempted and acknowledged ok by the
 * server; false if the user cancelled or the action failed.
 *
 * Currently only used by BettingPhase. WaitingRoom uses gameClient.leaveRoom
 * directly because no confirm is needed there.
 */
export async function leaveWithConfirm(
  roomId: string,
  t: TFunction,
): Promise<boolean> {
  // window.confirm is the cheapest cross-platform option. RN-web routes
  // it correctly; native React Native would use Alert.alert, but the
  // app is web-first today (see WaitingRoomScreen.showMessage pattern).
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const title = t('multiplayer.leaveConfirmTitle');
    const body = t('multiplayer.leaveConfirmBody');
    const accepted = window.confirm(`${title}\n\n${body}`);
    if (!accepted) return false;
  }
  const result = await gameClient.leaveRoom(roomId);
  return result.ok === true;
}
```

`window.confirm` doesn't render the custom "Leave anyway" button label — it shows the native OK/Cancel. That's an acceptable trade-off for v1; if the design later wants a custom button, swap to a React modal.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "leaveWithConfirm"`

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/leaveWithConfirm.ts
git commit -m "feat(rejoin): shared leaveWithConfirm helper"
```

---

## Task 9: Leave button in BettingPhase

**Files:**
- Modify: `src/components/betting/BettingPhase.tsx`

Add a small, unobtrusive Leave control inside the betting modal. Tapping it calls `leaveWithConfirm`. On confirmed leave, the parent flow handles unmount/navigation via the snapshot change (room.phase flips to waiting → GameTableScreen unmounts → user lands back on WaitingRoom or, for the leaver, on Lobby via `clearActiveRoom` from Task 2 + the host-side snapshot push).

- [ ] **Step 1: Find a sensible mounting point in the BettingPhase JSX**

Open `src/components/betting/BettingPhase.tsx`. Find the top-level `View` of the betting layout (the one that wraps the bid pills + chat button row). The Leave button should sit somewhere visible but out-of-way — typical placement is the top-right of the modal, near the language/chat row. Use `grep -n "LanguageSwitcher\|ChatPanel\|ScrollView" src/components/betting/BettingPhase.tsx` to identify the existing top-bar row.

- [ ] **Step 2: Add the Leave button**

Inside the BettingPhase component (alongside the existing chat/lang controls), add:

```tsx
import { leaveWithConfirm } from '../../lib/leaveWithConfirm';
// (top-of-file imports)

// inside the component:
const { t } = useTranslation();        // already imported
const handleLeave = useCallback(async () => {
  const room_id = useRoomStore.getState().snapshot?.room?.id;
  if (!room_id) return;
  await leaveWithConfirm(room_id, t);
  // No imperative navigation here — gameClient.leaveRoom + clearActiveRoom
  // handle the leaver's local state, and the room snapshot push handles
  // the remaining players. The modal will unmount when snapshot.room.phase
  // flips back to 'waiting' (driven by the existing useEffect in
  // GameTableScreen).
}, [t]);
```

In the JSX (top-right corner of the betting modal — pick a position consistent with the existing layout):

```tsx
<Pressable
  onPress={handleLeave}
  style={({ pressed }) => [
    styles.leaveBtn,
    { borderColor: colors.glassLight, opacity: pressed ? 0.6 : 1 },
  ]}
  testID="betting-leave"
>
  <Text style={[styles.leaveBtnText, { color: colors.textMuted }]}>
    {t('multiplayer.leaveAnyway')}
  </Text>
</Pressable>
```

Add to the `StyleSheet.create({ ... })` block at the bottom of the file:

```ts
leaveBtn: {
  paddingHorizontal: Spacing.sm,
  paddingVertical: Spacing.xs,
  borderRadius: Radius.md,
  borderWidth: 1,
  alignSelf: 'flex-start',
},
leaveBtnText: {
  fontSize: 12,
  fontWeight: '500',
},
```

(Adjust the position to wherever the existing layout naturally has space — exact placement is the engineer's call. Keep the affordance small; this is a destructive action, not a primary CTA.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "BettingPhase"`

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/components/betting/BettingPhase.tsx
git commit -m "feat(rejoin): leave button in BettingPhase with confirm dialog"
```

---

## Task 10: WaitingRoom banner for "X left mid-game"

**Files:**
- Modify: `src/screens/WaitingRoomScreen.tsx`

Render the most recent `left_mid_game` event (from the new `useSystemEventStore`) as a transient banner at the top of the WaitingRoom layout. Uses the i18n key `multiplayer.leftMidGame` with `name` interpolation.

- [ ] **Step 1: Wire the store**

In `src/screens/WaitingRoomScreen.tsx`, near the existing `useRoomStore` and `useChatStore` imports, add:

```ts
import { useSystemEventStore } from '../store/systemEventStore';
```

Inside the component, alongside the other store reads:

```ts
const lastLeft = useSystemEventStore((s) => s.lastLeftMidGame);
const clearLastLeft = useSystemEventStore((s) => s.clearLeftMidGame);
```

- [ ] **Step 2: Render the banner**

Inside the JSX, place the banner above the existing room layout. Find the top of the main content area (typically a `<ScrollView>` or top-level `<View>` after `<SafeAreaView>` opening) and insert:

```tsx
{lastLeft && (
  <Pressable
    onPress={clearLastLeft}
    style={[styles.leftBanner, { backgroundColor: colors.warningSurface ?? colors.surfaceSecondary, borderColor: colors.glassLight }]}
    testID="left-mid-game-banner"
  >
    <Text style={[styles.leftBannerText, { color: colors.textPrimary }]}>
      {t('multiplayer.leftMidGame', { name: lastLeft.display_name })}
    </Text>
    <Text style={[styles.leftBannerDismiss, { color: colors.textMuted }]}>×</Text>
  </Pressable>
)}
```

Add to the `StyleSheet.create({…})` at the bottom of the file:

```ts
leftBanner: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: Spacing.md,
  paddingVertical: Spacing.sm,
  marginHorizontal: Spacing.md,
  marginTop: Spacing.sm,
  borderRadius: Radius.md,
  borderWidth: 1,
},
leftBannerText: {
  ...TextStyles.caption,
  flex: 1,
},
leftBannerDismiss: {
  ...TextStyles.h3,
  marginLeft: Spacing.md,
},
```

If `colors.warningSurface` doesn't exist in the theme today, the fallback to `surfaceSecondary` keeps it readable. The engineer can promote this to a real warning surface later if they want.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "WaitingRoomScreen"`

Expected: no output.

- [ ] **Step 4: Manual smoke**

After Task 5 confirmed the server side works:

1. Start dev server, two browsers join a room.
2. Mark ready, host starts game, both place one bid.
3. Browser A clicks the new "Leave anyway" button in BettingPhase, confirms.
4. Expected:
   - Browser A returns to Lobby.
   - Browser B sees its BettingPhase modal disappear, lands on WaitingRoomScreen.
   - Browser B sees "🚪 A left the game" banner at the top, dismissable by tapping.
   - Host of B can re-press Start (after readying remaining players if needed) and a fresh hand begins.

- [ ] **Step 5: Commit**

```bash
git add src/screens/WaitingRoomScreen.tsx
git commit -m "feat(rejoin): waiting room banner for left_mid_game"
```

---

## Task 11: Full-flow smoke test (no code, manual)

**Files:** none — runs through the spec's eight smoke tests end-to-end.

- [ ] **Step 1: Refresh during betting (spec test 1)**

Two browsers, both create+ready+start. Place one bid in browser A. **Hard refresh** browser A. Expected: lands back on BettingPhase with previous bid visible.

- [ ] **Step 2: Refresh during playing (spec test 2)**

Continue the same hand into the playing phase. Play one card from B. **Hard refresh** B. Expected: lands on GameTable with the trick still visible, my hand intact.

- [ ] **Step 3: Leave from WaitingRoom (spec test 3)**

From a fresh waiting room, click Leave. Expected: no confirm, immediately Lobby.

- [ ] **Step 4: Leave from BettingPhase, non-host (spec test 4)**

3-player game, betting phase. Non-host clicks Leave anyway, confirms. Expected: leaver lands on Lobby; the other two players see WaitingRoom with the chat banner.

- [ ] **Step 5: Leave from BettingPhase, host (spec test 5)**

Host clicks Leave anyway during betting. Expected: room ends for everyone, all clients land on Lobby with cleared active room.

- [ ] **Step 6: No Leave button on playing-phase GameTable (spec test 6)**

Once the first card is played, inspect the GameTable layout. Expected: no Leave-related UI (the Leave button only lives inside BettingPhase, which is unmounted by now).

- [ ] **Step 7: Push notification click (spec test 7)**

In PWA on phone, subscribe to push, then close the PWA. From another browser, trigger a "your turn" event. Tap the resulting notification. Expected: PWA opens directly into the room via RejoinGuard, no "Game already started" toast.

- [ ] **Step 8: Tab close mid-game + 5-min auto-advance (spec test 8)**

In one browser, close the tab during the playing phase when it's that user's turn. Wait 6 minutes (or fast-forward by editing `TURN_TIMEOUT_LONG_MS` in `src/lib/turnTimeout.ts` temporarily). Expected: another browser observes the absent player's turn auto-advance with bet=0 / lowest legal card. Reopen the closed tab — RejoinGuard places the user back on GameTable with the degraded but consistent state.

- [ ] **Step 9 (no commit)**

Manual run only. If any step fails, file the failing case in BACKLOG and decide whether to fix in this branch or follow up.

---

## Self-review

Spec coverage:
- §1 RejoinGuard re-enabled → Task 1. ✓
- §2 clearActiveRoom on leave → Task 2. ✓
- §3 Server resets mid-game room to waiting → Task 4. ✓
- §4 Leave button + confirmation in BettingPhase only → Task 9 (button) + Task 8 (helper). ✓
- §5 WaitingRoom banner for X-left-mid-game → Task 6 (store + subscription) + Task 10 (banner). ✓
- §6 SW push click → Task 3. ✓
- i18n strings → Task 7. ✓
- Manual smoke tests → Task 11 covers all eight from the spec. ✓
- Operator deploy step → Task 5 (deploy + DB-side verification gating client work). ✓

Placeholder scan: no "TBD" / "TODO" / unspecified steps. Two acceptable hedges: Task 4 Step 1 mentions `(room as any).current_hand_id` as a fallback if the engineer skips the recommended `select` widening. Task 9 Step 2 says "exact placement is the engineer's call" — the spec is explicit about placement (top-right, small, unobtrusive); the JSX example is complete.

Type consistency: `LeftMidGameEvent` shape declared in Task 6, consumed identically in Task 10. `leaveWithConfirm(roomId, t)` signature consistent across Task 8 and Task 9. `clearActiveRoom` import path same across Tasks 1, 2, 3.

Out-of-scope items deliberately omitted (per spec): bot-replacement, fast-offline-timeout, cross-device discovery, `beforeunload` warning. None of these block the core flow.
