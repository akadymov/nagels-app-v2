# Cross-Device Session Sync — Design Spec

**Date:** 2026-05-26
**Status:** Approved (pre-implementation)
**Related:**
- `docs/superpowers/specs/2026-05-07-rejoin-active-room-design.md` — local-storage rejoin (existing)
- `supabase/migrations/20260516185139_remote_schema_baseline.sql` lines 235-243 — existing `get_my_session_id()` RPC
- `src/lib/activeRoom.ts` — current `tryRestoreActiveRoom()` flow

## 1. Problem

A logged-in user who is in a room on device A opens the same account on device B (different browser, different machine, fresh PWA install). Today device B does not auto-rejoin the room — `tryRestoreActiveRoom()` reads from AsyncStorage which is device-local, so device B has no idea the user is "in" anything. The user lands on the lobby, has to manually find their friends, and may not even know the room code.

We want device B to land on the same screen device A is on, with full state, and stay in sync from there.

## 2. Scope and decisions

In scope:

- One new SECURITY DEFINER RPC `get_my_active_room()` that returns the calling user's current room (or null).
- One new client method `gameClient.getMyActiveRoom()`.
- Promote `tryRestoreActiveRoom()` to prefer the server lookup over the AsyncStorage cache for logged-in users.
- A small mount-time guard component `<CrossDeviceRejoinGuard />` in `AppNavigator` that re-runs the rejoin on three triggers: app boot, `SIGNED_IN` auth event, and `AppState` becomes `active`.

Out of scope (explicitly rejected during brainstorming):

- Schema changes to `room_sessions`. The existing UNIQUE constraint on `auth_user_id` actually helps us — both devices share the same `session_id`, so server-side state is already a single source of truth.
- Forced logout / takeover modal ("you're logged in elsewhere"). Multiple parallel sessions per user are allowed. The server validates each action ("whose turn", idempotency), so races are bounded; the user is trusted not to play from two devices simultaneously.
- A long-poll or per-user realtime channel. The three trigger events cover the realistic "user opens device B" path. Once a device is in a room, the existing `subscribeRoom` realtime sub handles cross-device updates.
- Guest cross-device. Guests use anonymous Supabase auth — different anon UUID per device — so there is no shared identity to sync. AsyncStorage-only rejoin remains the fallback for them.

## 3. Architecture

```
Device B fires one of: app boot | SIGNED_IN auth event | tab becomes active
       │
       ▼
  CrossDeviceRejoinGuard.check()
       │
       ├─ already in a room on this device? → noop (realtime keeps state synced)
       │
       └─ tryRestoreActiveRoom()
            │
            ├─ gameClient.getMyActiveRoom()   ← NEW server lookup
            │   ├─ {room_id, code, phase, role} → use it (authoritative)
            │   │   └─ setActiveRoom(room_id) in AsyncStorage  (sync cache)
            │   └─ null → fall through to AsyncStorage path (existing behavior, for guests)
            │
            └─ get_room_state → setMyPlayerId → applySnapshot → subscribeRoom → return phase
       │
       ▼
  navigation.navigate('WaitingRoom' | 'GameTable')
```

`session_id` is naturally shared across devices because `room_sessions.auth_user_id` is UNIQUE — both devices ask `get_my_session_id()` and get the same row id. That means:
- Both devices see the same `room_players` row → same heartbeat target (harmless 2× write rate).
- Both devices see the same `dealt_cards` rows → same hand.
- Both devices can submit actions; server's per-seat turn check accepts only the first.
- Existing realtime broadcasts on the room channel reach both devices identically.

No new realtime channel is needed; no per-device identity is needed.

## 4. Database

New migration: `supabase/migrations/20260526010000_get_my_active_room.sql`.

```sql
CREATE OR REPLACE FUNCTION public.get_my_active_room()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_sid  uuid;
  v_row  RECORD;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_sid FROM public.room_sessions
    WHERE auth_user_id = v_uid LIMIT 1;
  IF v_sid IS NULL THEN RETURN NULL; END IF;

  -- Player seat first; prefer playing > waiting > scoring; tie-break by
  -- updated_at DESC to pick the most recently active room.
  SELECT r.id AS room_id, r.phase, r.code, 'player' AS role
    INTO v_row
  FROM public.rooms r
  JOIN public.room_players rp ON rp.room_id = r.id
  WHERE rp.session_id = v_sid AND r.phase <> 'finished'
  ORDER BY
    CASE r.phase WHEN 'playing' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END,
    r.updated_at DESC
  LIMIT 1;

  IF v_row.room_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'room_id', v_row.room_id,
      'code',    v_row.code,
      'phase',   v_row.phase,
      'role',    v_row.role
    );
  END IF;

  -- Spectator fallback.
  SELECT r.id AS room_id, r.phase, r.code, 'spectator' AS role
    INTO v_row
  FROM public.rooms r
  JOIN public.room_spectators rsp ON rsp.room_id = r.id
  WHERE rsp.session_id = v_sid AND r.phase <> 'finished'
  ORDER BY r.updated_at DESC
  LIMIT 1;

  IF v_row.room_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'room_id', v_row.room_id,
      'code',    v_row.code,
      'phase',   v_row.phase,
      'role',    v_row.role
    );
  END IF;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_active_room() TO authenticated;
```

Returns `null` when:
- Not authenticated (`auth.uid()` is null).
- User has no `room_sessions` row.
- User has no `room_players` or `room_spectators` row in any non-finished room.

Idempotent: safely re-callable on every focus event without side effects.

## 5. Client

### 5.1 `src/lib/gameClient.ts`

One new method:

```ts
getMyActiveRoom: async (): Promise<
  | { room_id: string; code: string; phase: 'waiting' | 'playing' | 'scoring'; role: 'player' | 'spectator' }
  | null
> => {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('get_my_active_room');
  if (error) throw error;
  return (data as any) ?? null;
},
```

### 5.2 `src/lib/activeRoom.ts`

Extend `tryRestoreActiveRoom()` to prefer the server lookup. Pseudocode of the new top of the function:

```ts
export async function tryRestoreActiveRoom(): Promise<'WaitingRoom' | 'GameTable' | null> {
  // 1. Server lookup first (cross-device authoritative path).
  let roomId: string | null = null;
  try {
    const { gameClient } = await import('./gameClient');
    const active = await gameClient.getMyActiveRoom();
    if (active?.room_id) {
      roomId = active.room_id;
      await setActiveRoom(active.room_id, active.code, active.role);
    }
  } catch {
    // Server failure → fall through to local cache.
  }

  // 2. Fallback: AsyncStorage (guests, anon sessions, server miss).
  if (!roomId) {
    roomId = await getActiveRoom();
  }
  if (!roomId) return null;

  // …existing flow from here: get_room_state → setMyPlayerId → applySnapshot → subscribeRoom → return phase
}
```

The existing AsyncStorage write inside `setActiveRoom(active.room_id, ...)` keeps the local cache in sync with the server-truth, so the next boot can hit AsyncStorage first if needed (e.g. brief connectivity dropout).

### 5.3 `src/components/CrossDeviceRejoinGuard.tsx`

```tsx
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getSupabaseClient } from '../lib/supabase/client';
import { tryRestoreActiveRoom } from '../lib/activeRoom';
import { useRoomStore } from '../store/roomStore';

export function CrossDeviceRejoinGuard() {
  const navigation = useNavigation<any>();

  useEffect(() => {
    const supabase = getSupabaseClient();
    let lastCheckMs = 0;
    const COOLDOWN_MS = 5_000;

    const check = async (reason: string) => {
      const now = Date.now();
      if (now - lastCheckMs < COOLDOWN_MS) return;
      lastCheckMs = now;
      if (useRoomStore.getState().snapshot?.room?.id) return;
      try {
        const dest = await tryRestoreActiveRoom();
        if (dest) navigation.navigate(dest);
      } catch (err) {
        console.warn(`[CrossDeviceRejoin:${reason}] failed:`, err);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') check('signed_in');
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check('app_active');
    });
    return () => { subscription.unsubscribe(); sub.remove(); };
  }, [navigation]);

  return null;
}
```

- "Already in a room" early return prevents redundant server hits while the user is actively playing — realtime sync handles in-room cross-device updates.
- 5s cooldown protects against `visibilitychange` storms (browser fires it twice on some platforms).
- Errors are swallowed (warned) — failing to auto-rejoin is annoying but never breaks the app; user lands on lobby and can manually proceed.

### 5.4 Mount point — `src/navigation/AppNavigator.tsx`

Add `<CrossDeviceRejoinGuard />` once at the top of the navigator (inside `NavigationContainer`, alongside existing global components). It mounts once per app lifetime.

## 6. Cross-device state propagation

Already handled by the existing realtime layer — no new code:

- Both devices subscribe to the same room channel via `subscribeRoom(roomId)`.
- Server bumps `rooms.version` on every state-changing action.
- Broadcast `state_changed` fires to all subscribers.
- Each device pulls a fresh `get_room_state` and applies it.

What this gives us out of the box:
- Card played on A → visible on B within the broadcast round-trip (~100-300ms).
- Bet placed on A → visible on B.
- Host kicks someone on A → both A and B see the player gone.
- Chat message sent from A → B sees it.

What is NOT free:
- Server-side action conflicts. If user submits a card on A and B at almost the same moment, server processes them sequentially; the second action gets `not_your_turn` because the seat already advanced. No data corruption; UI may briefly show "you can play" twice in a row. Acceptable.
- Per-device UI state (open modals, scroll position, drafts in chat input) is not synced. Acceptable.

## 7. Testing

- Unit-testable: `get_my_active_room()` SQL is straightforward; verified end-to-end via manual two-device test (no DB-test infra in this repo). The client method is a one-line RPC wrapper.
- `CrossDeviceRejoinGuard` — no automated test; behavior is event-driven and depends on Supabase auth events. Manual test covers it.
- `tryRestoreActiveRoom()` — already exercised by the existing rejoin manual flow. New server-first path is purely additive on top, with AsyncStorage fallback intact.

## 8. Side effects

- One extra RPC call per boot/login/focus for logged-in users (typical: ≤3/min). Negligible cost.
- No notifications, no Telegram, no email — pure DB read + client navigation.
- Migration is non-destructive: only a `CREATE OR REPLACE FUNCTION` + GRANT.

## 9. Manual verification plan

1. Apply migration to prod.
2. Log in on device A (browser tab 1). Create a room. Stay in WaitingRoom.
3. Log in on device B (different browser / incognito / another machine, same account). Expected: device B auto-navigates to WaitingRoom of the same room within ~1s of login.
4. On device A, start the game. Expected: device B transitions to GameTable automatically via realtime.
5. On device B, place a bet. Expected: device A sees the bet via realtime.
6. On device A, close the tab. Expected: device B stays in the room. After 10 minutes (HOST_STALE_MS, if device A was the host), the host-left rescue banner appears on device B.
7. On device A, reopen. Expected: device A auto-rejoins (same `tryRestoreActiveRoom` path).

## 10. Edge cases

- **User has rows in both `room_players` and `room_spectators`**: shouldn't happen by enforcement, but if it does the player seat wins (queried first).
- **User has rows in multiple `room_players` in different non-finished rooms**: shouldn't happen (leaveRoom blocks re-join into another room while you're in one), but if it does we pick the most recently-updated room (`ORDER BY updated_at DESC`).
- **`updated_at` not in our `rooms` table**: confirmed present via the baseline schema (`rooms.updated_at TIMESTAMPTZ DEFAULT now() NOT NULL`).
- **Device B has stale AsyncStorage from a prior account**: server lookup returns the current account's room, AsyncStorage write overwrites the stale entry, no leak.
- **User logs out on device B while device A is in a room**: device B clears local state; device A is unaffected (server-side session_id is still valid; row stays).
- **First login on a fresh device, no prior session_id**: server creates `room_sessions` row when the user first calls `createRoom` or `joinRoom`. Until then, `get_my_active_room()` returns null. User sees lobby — correct behavior.
