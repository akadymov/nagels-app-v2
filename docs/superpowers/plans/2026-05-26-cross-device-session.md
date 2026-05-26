# Cross-Device Session Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-rejoin a logged-in user into their active room on any second device (different browser, different machine), with state continuously synced via the existing realtime layer.

**Architecture:** New SECURITY DEFINER RPC `get_my_active_room()` exposes the server-side source of truth. `tryRestoreActiveRoom()` calls it first (falls back to AsyncStorage for guests). New always-mounted `CrossDeviceRejoinGuard` re-runs the rejoin on three triggers: app boot, `SIGNED_IN` auth event, `AppState` becomes `active`. No schema change — both devices already share the same `session_id` thanks to the existing `room_sessions.auth_user_id UNIQUE` constraint.

**Tech Stack:** Supabase Postgres (SECURITY DEFINER RPC) + Expo React Native (TypeScript) + Zustand (`useRoomStore`) + Supabase realtime broadcasts + React Navigation.

**Spec:** `docs/superpowers/specs/2026-05-26-cross-device-session-design.md`

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260526010000_get_my_active_room.sql` | Create | New RPC + GRANT |
| `src/lib/gameClient.ts` | Modify | `getMyActiveRoom()` wrapper |
| `src/lib/activeRoom.ts` | Modify | Prefer server lookup over AsyncStorage |
| `src/components/CrossDeviceRejoinGuard.tsx` | Create | Stateless guard, uses `navigationRef` |
| `src/navigation/AppNavigator.tsx` | Modify | Mount the guard once, top-level |
| `tests/TEST_TODO.md` | Modify | Auto-refreshed (no new testIDs in this feature) |

No new i18n keys (no user-visible strings). No new tests beyond manual verification — the RPC is straightforward and the rest is glue.

---

## Task 1: Migration + RPC

**Files:**
- Create: `supabase/migrations/20260526010000_get_my_active_room.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260526010000_get_my_active_room.sql
-- Cross-device session sync: lookup the calling user's active room.
-- Used by the client on boot / login / focus to auto-navigate the user
-- into whatever room they're currently in on another device.
-- See docs/superpowers/specs/2026-05-26-cross-device-session-design.md

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

- [ ] **Step 2: Verify file**

Run: `wc -l supabase/migrations/20260526010000_get_my_active_room.sql`
Expected: 55-65 lines.

- [ ] **Step 3: Apply to prod**

Run: `supabase db query --linked --file supabase/migrations/20260526010000_get_my_active_room.sql 2>&1 | tail -10`

Expected output ends with `"rows": []` (DDL returns empty rows). If error mentions a missing column or table, STOP and report — do NOT retry.

- [ ] **Step 4: Verify on prod**

Run:
```bash
supabase db query --linked "
SELECT EXISTS(
  SELECT 1 FROM pg_proc
  WHERE proname='get_my_active_room' AND pronamespace='public'::regnamespace
) AS func_ok;
SELECT public.get_my_active_room() AS result_when_anon;
"
```

Expected: `func_ok: true`, `result_when_anon: null` (no auth context → null).

- [ ] **Step 5: Register in tracker**

Run: `supabase migration repair --status applied 20260526010000 --linked`
Expected: `Repaired migration history: [20260526010000] => applied`.

- [ ] **Step 6: Commit (do NOT push)**

```bash
git add supabase/migrations/20260526010000_get_my_active_room.sql
git commit -m "feat(cross-device): get_my_active_room RPC"
```

---

## Task 2: gameClient method

**Files:**
- Modify: `src/lib/gameClient.ts`

- [ ] **Step 1: Add the method**

Search for the `getMyRating: async () =>` block in `src/lib/gameClient.ts`. Insert the new method DIRECTLY AFTER it (and BEFORE `getRatingSettlement`):

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "gameClient|getMyActiveRoom" | head -5`
Expected: no output.

- [ ] **Step 3: Commit (do NOT push)**

```bash
git add src/lib/gameClient.ts
git commit -m "feat(cross-device): gameClient.getMyActiveRoom"
```

---

## Task 3: Extend tryRestoreActiveRoom

**Files:**
- Modify: `src/lib/activeRoom.ts`

Promote the server lookup ahead of the AsyncStorage read.

- [ ] **Step 1: Edit `tryRestoreActiveRoom()`**

Find this block at the top of the function (around lines 74-77):
```ts
export async function tryRestoreActiveRoom(): Promise<'WaitingRoom' | 'GameTable' | null> {
  const roomId = await getActiveRoom();
  if (!roomId) return null;
```

Replace with:
```ts
export async function tryRestoreActiveRoom(): Promise<'WaitingRoom' | 'GameTable' | null> {
  // 1. Server-side lookup first (cross-device authoritative path).
  // Falls through to the local AsyncStorage cache for anonymous guests
  // (no auth.uid()) or transient server failures.
  let roomId: string | null = null;
  try {
    const { gameClient } = await import('./gameClient');
    const active = await gameClient.getMyActiveRoom();
    if (active?.room_id) {
      roomId = active.room_id;
      // Sync the local cache so a subsequent offline boot still works.
      await setActiveRoom(active.room_id, active.code, active.role);
    }
  } catch (err) {
    console.warn('[rejoin] get_my_active_room failed, falling back to cache:', err);
  }

  // 2. Fallback: AsyncStorage (guests, server miss).
  if (!roomId) {
    roomId = await getActiveRoom();
  }
  if (!roomId) return null;
```

The rest of the function (everything from `const supabase = getSupabaseClient();` downward) stays identical.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep activeRoom | head -5`
Expected: no output.

- [ ] **Step 3: Commit (do NOT push)**

```bash
git add src/lib/activeRoom.ts
git commit -m "feat(cross-device): activeRoom prefers server lookup"
```

---

## Task 4: CrossDeviceRejoinGuard component

**Files:**
- Create: `src/components/CrossDeviceRejoinGuard.tsx`

A stateless guard. Uses `navigationRef` passed as prop (no `useNavigation` hook needed — works at the top level of `NavigationContainer`).

- [ ] **Step 1: Create the file**

```tsx
// src/components/CrossDeviceRejoinGuard.tsx
import { useEffect } from 'react';
import { AppState } from 'react-native';
import type { NavigationContainerRef } from '@react-navigation/native';
import { getSupabaseClient } from '../lib/supabase/client';
import { useRoomStore } from '../store/roomStore';

interface Props {
  /**
   * The navigation ref from AppNavigator. Used to dispatch navigation
   * without a useNavigation() hook, so this guard can mount above the
   * Stack.Navigator.
   */
  navigationRef: NavigationContainerRef<any>;
}

/**
 * Listens for events that indicate the user might have an active room
 * elsewhere and auto-navigates them into it.
 *
 * Triggers:
 *   1. Supabase auth SIGNED_IN — login on this device
 *   2. AppState becomes 'active' — tab/PWA came back to foreground
 *
 * Boot-time rejoin is already handled by RejoinGuard inside Welcome.
 * This component covers the "user logs in / focuses tab AFTER boot"
 * cases that the existing guard misses.
 *
 * Side-effect-free when the user is already in a room (gated by
 * roomStore snapshot) — realtime keeps state synced from there.
 */
export function CrossDeviceRejoinGuard({ navigationRef }: Props) {
  useEffect(() => {
    const supabase = getSupabaseClient();
    let lastCheckMs = 0;
    const COOLDOWN_MS = 5_000;

    const check = async (reason: string) => {
      const now = Date.now();
      if (now - lastCheckMs < COOLDOWN_MS) return;
      lastCheckMs = now;
      // Already in a room on this device — realtime keeps us synced.
      if (useRoomStore.getState().snapshot?.room?.id) return;
      try {
        const { tryRestoreActiveRoom } = await import('../lib/activeRoom');
        const dest = await tryRestoreActiveRoom();
        if (!dest || !navigationRef.isReady()) return;
        if (dest === 'GameTable') {
          // Restored room is always multiplayer.
          (navigationRef as any).navigate('GameTable', { isMultiplayer: true });
        } else {
          navigationRef.navigate(dest as never);
        }
      } catch (err) {
        console.warn(`[CrossDeviceRejoin:${reason}] failed:`, err);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') void check('signed_in');
    });
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check('app_active');
    });

    return () => {
      subscription.unsubscribe();
      appStateSub.remove();
    };
  }, [navigationRef]);

  return null;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep CrossDeviceRejoinGuard | head -5`
Expected: no output.

- [ ] **Step 3: Commit (do NOT push)**

```bash
git add src/components/CrossDeviceRejoinGuard.tsx
git commit -m "feat(cross-device): CrossDeviceRejoinGuard component"
```

---

## Task 5: Mount guard in AppNavigator

**Files:**
- Modify: `src/navigation/AppNavigator.tsx`

- [ ] **Step 1: Add import**

Near the existing imports at the top, add:

```ts
import { CrossDeviceRejoinGuard } from '../components/CrossDeviceRejoinGuard';
```

- [ ] **Step 2: Mount the guard**

Find the existing `<NavigationContainer ref={navigationRef} linking={linking}>` block (around line 463) and its first child `<AuthProvider>`. Insert the guard as the FIRST child of `<AuthProvider>`, BEFORE `<Stack.Navigator>`:

```tsx
    <NavigationContainer ref={navigationRef} linking={linking}>
      <AuthProvider>
        <CrossDeviceRejoinGuard navigationRef={navigationRef} />
        <Stack.Navigator
          initialRouteName="Welcome"
          /* …existing screenOptions… */
        >
```

The guard returns `null`, so it has no visual impact. It mounts once and lives for the app's lifetime.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "AppNavigator|CrossDeviceRejoinGuard" | head -5`
Expected: no output.

- [ ] **Step 4: Commit (do NOT push)**

```bash
git add src/navigation/AppNavigator.tsx
git commit -m "feat(cross-device): mount CrossDeviceRejoinGuard at top of navigator"
```

---

## Task 6: Final lint + push

**Files:**
- Modify (auto): `tests/TEST_TODO.md` (no expected changes; this feature adds no testIDs)

- [ ] **Step 1: Full src/ tsc**

Run: `npx tsc --noEmit 2>&1 | grep -vE "supabase/functions|node_modules|Deno" | grep "error TS" | head -10`
Expected: no output.

- [ ] **Step 2: Refresh TEST_TODO**

Run: `npm run test:lint -- --update-todo 2>&1 | tail -5`
Expected: exit 0; "✓ tests/TEST_TODO.md refreshed".

- [ ] **Step 3: Push**

```bash
git log --oneline origin/main..HEAD
git push origin main 2>&1 | tail -3
```

- [ ] **Step 4: Surface to user**

Report:
> "All 5 client commits + migration applied to prod. Manual verification:
>
> 1. Open device A (browser tab 1). Log in. Create or join a room. Stay there.
> 2. Open device B (different browser / incognito / another device). Log in with the same account.
> 3. Expected: device B auto-navigates to the same room within ~1 second of login.
> 4. Play, bet, chat on either device → both stay in sync via existing realtime.
> 5. Close device A. Device B stays in the room independently.
>
> Migration `20260526010000_get_my_active_room.sql` is already applied and registered."

No git commit in this task — no source files changed.

---

## Done

Final user-facing summary:

1. Migration applied + registered in tracker (Task 1).
2. No edge function changes — RPC is direct supabase-js call.
3. No new testIDs.
4. Manual two-device verification needed before declaring shippable.
5. Pre-existing per-device behavior (rejoin from AsyncStorage on Welcome) preserved as fallback.
