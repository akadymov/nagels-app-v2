# Spectator Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an invited friend open a `?as=spectator` link and watch a Nägels game in progress — public state only, no hands, chat visible.

**Architecture:** One new SQL migration (`024_spectator_mode.sql`) introduces `room_spectators` + two RPCs and additively extends `get_room_state` and `heartbeat`. Client gets thin `gameClient` wrappers, a deep-link parser branch, conditional UI in `WaitingRoomScreen` / `GameTableScreen` / `ChatPanel`, and i18n strings.

**Tech Stack:** Postgres + Supabase RPC, Expo / React Native, Zustand, expo-router-style deep links, Playwright (probe scripts).

---

## File Structure

**Create**
- `supabase/migrations/024_spectator_mode.sql`
- `scripts/probe-spectator-e2e.ts` — Playwright probe

**Modify**
- `src/store/roomStore.ts` — add `isSpectator`, `spectators`, setters
- `src/lib/gameClient.ts` — add `joinRoomAsSpectator`, `leaveRoomAsSpectator`
- `src/lib/heartbeat.ts` — comment only (server change covers spectators transparently)
- `src/navigation/AppNavigator.tsx` — parse `?as=spectator`, branch deep-link logic
- `src/screens/WaitingRoomScreen.tsx` — spectator badge, hide Ready, second share action
- `src/screens/GameTableScreen.tsx` — spectator placeholder bottom strip, badge, no interactions, `👁 N` indicator
- `src/components/ChatPanel.tsx` — render 👁 next to spectator messages
- `src/store/chatStore.ts` — carry `fromSpectator` in chat events
- `src/i18n/locales/en.json`, `ru.json`, `es.json` — six new keys
- `supabase/functions/_shared/types.ts` — extend `RoomSnapshot` with `spectators: Spectator[]`

---

## Task 1: SQL migration — schema + join/leave RPCs

**Files:**
- Create: `supabase/migrations/024_spectator_mode.sql`

- [ ] **Step 1: Create the migration file with table + indexes**

```sql
-- ============================================================
-- 024_spectator_mode — invited friends can watch a room
-- ============================================================
--
-- Spectators are session-scoped, seatless observers. They live in
-- room_spectators (separate from room_players so the seat-index
-- machinery is untouched). They see public room state only.
-- Per-room cap: 10. TTL cleanup mirrors room_players.
-- ============================================================

CREATE TABLE public.room_spectators (
  room_id       UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  session_id    UUID NOT NULL REFERENCES public.room_sessions(id) ON DELETE CASCADE,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, session_id)
);

CREATE INDEX idx_room_spectators_session ON public.room_spectators(session_id);

ALTER TABLE public.room_spectators ENABLE ROW LEVEL SECURITY;

-- Readable by anyone; writes are RPC-only (REVOKE below).
CREATE POLICY "room_spectators readable to all"
  ON public.room_spectators FOR SELECT USING (true);
```

- [ ] **Step 2: Add `join_room_as_spectator` RPC (append to same file)**

```sql
CREATE OR REPLACE FUNCTION public.join_room_as_spectator(p_room_id UUID)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_session_id UUID;
  v_count      INT;
BEGIN
  -- Resolve caller's session
  SELECT id INTO v_session_id
    FROM public.room_sessions
   WHERE auth_user_id = auth.uid()
   LIMIT 1;
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'no_session' USING ERRCODE = 'P0001';
  END IF;

  -- Room must exist
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = p_room_id) THEN
    RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Already a player? Reject.
  IF EXISTS (
    SELECT 1 FROM public.room_players
     WHERE room_id = p_room_id AND session_id = v_session_id
  ) THEN
    RAISE EXCEPTION 'cannot_spectate_own_seat' USING ERRCODE = 'P0001';
  END IF;

  -- Cap at 10 spectators per room
  SELECT count(*) INTO v_count
    FROM public.room_spectators
   WHERE room_id = p_room_id;
  IF v_count >= 10 AND NOT EXISTS (
    SELECT 1 FROM public.room_spectators
     WHERE room_id = p_room_id AND session_id = v_session_id
  ) THEN
    RAISE EXCEPTION 'too_many_spectators' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent insert
  INSERT INTO public.room_spectators (room_id, session_id)
       VALUES (p_room_id, v_session_id)
  ON CONFLICT (room_id, session_id)
    DO UPDATE SET last_seen_at = now();

  RETURN v_session_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.join_room_as_spectator(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.join_room_as_spectator(UUID) TO anon, authenticated;
```

- [ ] **Step 3: Add `leave_room_as_spectator` RPC (append)**

```sql
CREATE OR REPLACE FUNCTION public.leave_room_as_spectator(p_room_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_session_id UUID;
BEGIN
  SELECT id INTO v_session_id
    FROM public.room_sessions
   WHERE auth_user_id = auth.uid()
   LIMIT 1;
  IF v_session_id IS NULL THEN RETURN; END IF;

  DELETE FROM public.room_spectators
   WHERE room_id    = p_room_id
     AND session_id = v_session_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.leave_room_as_spectator(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.leave_room_as_spectator(UUID) TO anon, authenticated;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/024_spectator_mode.sql
git commit -m "feat(db): room_spectators table + join/leave RPCs"
```

---

## Task 2: SQL migration — extend get_room_state and heartbeat additively

**Files:**
- Modify: `supabase/migrations/024_spectator_mode.sql` (append)

- [ ] **Step 1: Re-declare `get_room_state` with additive `spectators` field**

Append to `024_spectator_mode.sql`. The body is the current version from `013_last_closed_trick_in_state.sql` plus one CTE and one output key. Copy the full function — do NOT diff. Re-declaring is how every prior migration evolves this RPC (see 012, 013, 014, 015, etc).

```sql
CREATE OR REPLACE FUNCTION public.get_room_state(p_room_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH
  room AS (
    SELECT id, code, host_session_id, player_count, max_cards,
           phase, current_hand_id, version
    FROM public.rooms WHERE id = p_room_id
  ),
  players AS (
    SELECT json_agg(jsonb_build_object(
      'session_id',   rp.session_id,
      'display_name', rs.display_name,
      'seat_index',   rp.seat_index,
      'is_ready',     rp.is_ready,
      'is_connected', rp.is_connected,
      'last_seen_at', rp.last_seen_at,
      'avatar',       au.raw_user_meta_data->>'avatar',
      'avatar_color', au.raw_user_meta_data->>'avatar_color'
    ) ORDER BY rp.seat_index) AS list
    FROM public.room_players rp
    JOIN public.room_sessions rs ON rs.id = rp.session_id
    LEFT JOIN auth.users au ON au.id = rs.auth_user_id
    WHERE rp.room_id = p_room_id
  ),
  spectators AS (
    SELECT json_agg(jsonb_build_object(
      'session_id',   rsp.session_id,
      'display_name', rs.display_name,
      'avatar',       au.raw_user_meta_data->>'avatar',
      'avatar_color', au.raw_user_meta_data->>'avatar_color',
      'joined_at',    rsp.joined_at
    ) ORDER BY rsp.joined_at) AS list
    FROM public.room_spectators rsp
    JOIN public.room_sessions rs ON rs.id = rsp.session_id
    LEFT JOIN auth.users au ON au.id = rs.auth_user_id
    WHERE rsp.room_id = p_room_id
  ),
  current_hand AS (
    SELECT to_jsonb(h.*) AS row
    FROM public.hands h
    JOIN room ON room.current_hand_id = h.id
  ),
  hand_scores AS (
    SELECT json_agg(to_jsonb(hs.*)) AS list
    FROM public.hand_scores hs
    JOIN current_hand ch ON (ch.row ->> 'id')::uuid = hs.hand_id
  ),
  current_trick AS (
    SELECT jsonb_build_object(
      'id',           t.id,
      'trick_number', t.trick_number,
      'lead_seat',    t.lead_seat,
      'winner_seat',  t.winner_seat,
      'cards',        COALESCE((
        SELECT json_agg(jsonb_build_object('seat', tc.seat_index, 'card', tc.card)
                        ORDER BY tc.played_at)
        FROM public.trick_cards tc WHERE tc.trick_id = t.id
      ), '[]'::json)
    ) AS row
    FROM public.tricks t
    JOIN current_hand ch ON (ch.row ->> 'id')::uuid = t.hand_id
    WHERE t.closed_at IS NULL
    ORDER BY t.trick_number DESC
    LIMIT 1
  ),
  last_closed_trick AS (
    SELECT jsonb_build_object(
      'id',           t.id,
      'trick_number', t.trick_number,
      'lead_seat',    t.lead_seat,
      'winner_seat',  t.winner_seat,
      'cards',        COALESCE((
        SELECT json_agg(jsonb_build_object('seat', tc.seat_index, 'card', tc.card)
                        ORDER BY tc.played_at)
        FROM public.trick_cards tc WHERE tc.trick_id = t.id
      ), '[]'::json)
    ) AS row
    FROM public.tricks t
    JOIN current_hand ch ON (ch.row ->> 'id')::uuid = t.hand_id
    WHERE t.closed_at IS NOT NULL
    ORDER BY t.closed_at DESC
    LIMIT 1
  ),
  history AS (
    SELECT json_agg(jsonb_build_object(
      'hand_number', h.hand_number,
      'closed_at',   h.closed_at,
      'scores',      (SELECT json_agg(to_jsonb(hs2.*))
                      FROM public.hand_scores hs2 WHERE hs2.hand_id = h.id)
    ) ORDER BY h.hand_number) AS list
    FROM public.hands h
    WHERE h.room_id = p_room_id AND h.phase = 'closed'
  )
  SELECT jsonb_build_object(
    'room',              (SELECT to_jsonb(room.*) FROM room),
    'players',           COALESCE((SELECT list FROM players), '[]'::json),
    'spectators',        COALESCE((SELECT list FROM spectators), '[]'::json),
    'current_hand',      (SELECT row FROM current_hand),
    'hand_scores',       COALESCE((SELECT list FROM hand_scores), '[]'::json),
    'current_trick',     (SELECT row FROM current_trick),
    'last_closed_trick', (SELECT row FROM last_closed_trick),
    'score_history',     COALESCE((SELECT list FROM history), '[]'::json)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_room_state(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_room_state(UUID) TO anon, authenticated;
```

- [ ] **Step 2: Re-declare `heartbeat` to also touch `room_spectators`**

Append:

```sql
CREATE OR REPLACE FUNCTION public.heartbeat(p_room_id UUID)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_session_id UUID;
BEGIN
  SELECT id INTO v_session_id
    FROM public.room_sessions
   WHERE auth_user_id = auth.uid()
   LIMIT 1;
  IF v_session_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.room_players
     SET last_seen_at = now(),
         is_connected = true
   WHERE room_id    = p_room_id
     AND session_id = v_session_id;

  UPDATE public.room_spectators
     SET last_seen_at = now()
   WHERE room_id    = p_room_id
     AND session_id = v_session_id;

  RETURN v_session_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.heartbeat(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.heartbeat(UUID) TO anon, authenticated;
```

- [ ] **Step 3: Re-declare `cleanup_stale_rooms` to consider spectator activity**

Append. The change: the GREATEST() expression also considers `MAX(rsp.last_seen_at)` so a room with active spectators but no players doesn't get reaped mid-watch (unusual but possible after all players leave).

```sql
CREATE OR REPLACE FUNCTION public.cleanup_stale_rooms()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_deleted INT;
BEGIN
  WITH stale AS (
    SELECT r.id
      FROM public.rooms r
      LEFT JOIN public.room_players     rp  ON rp.room_id  = r.id
      LEFT JOIN public.room_spectators  rsp ON rsp.room_id = r.id
     GROUP BY r.id, r.created_at, r.updated_at
    HAVING GREATEST(
             COALESCE(MAX(rp.last_seen_at),  'epoch'::timestamptz),
             COALESCE(MAX(rsp.last_seen_at), 'epoch'::timestamptz),
             r.updated_at,
             r.created_at
           ) < now() - INTERVAL '24 hours'
  )
  DELETE FROM public.rooms
   WHERE id IN (SELECT id FROM stale);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE LOG '[cleanup_stale_rooms] deleted % stale room(s)', v_deleted;
  RETURN v_deleted;
END;
$$;
```

- [ ] **Step 4: Apply migration locally**

Run: `supabase db reset` (or `supabase migration up` if reset is too destructive).
Expected: migration applies cleanly, no errors.

- [ ] **Step 5: Smoke-test the RPCs in psql**

Run via Supabase Studio SQL editor or `psql`:

```sql
-- assume an existing room with id <ROOM_UUID>
SELECT join_room_as_spectator('<ROOM_UUID>');     -- returns session UUID
SELECT (get_room_state('<ROOM_UUID>') -> 'spectators');  -- returns 1-element array
SELECT join_room_as_spectator('<ROOM_UUID>');     -- idempotent
SELECT leave_room_as_spectator('<ROOM_UUID>');    -- returns void
SELECT (get_room_state('<ROOM_UUID>') -> 'spectators');  -- empty array
```

Expected: each step matches the comment. If `cannot_spectate_own_seat` fires, the caller is also a player — switch test accounts.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/024_spectator_mode.sql
git commit -m "feat(db): extend get_room_state, heartbeat, cleanup for spectators"
```

---

## Task 3: TypeScript types — extend RoomSnapshot

**Files:**
- Modify: `supabase/functions/_shared/types.ts`

- [ ] **Step 1: Find the `RoomSnapshot` type definition**

Run: `grep -n "RoomSnapshot\|interface.*Snapshot\|type.*Snapshot" supabase/functions/_shared/types.ts`
Expected: locates the snapshot type.

- [ ] **Step 2: Add a `Spectator` type and add `spectators` to `RoomSnapshot`**

In the same file, add (placement next to the existing `Player` type):

```ts
export interface Spectator {
  session_id: string;
  display_name: string;
  avatar?: string | null;
  avatar_color?: string | null;
  joined_at: string;
}
```

Then add to `RoomSnapshot`:

```ts
  spectators: Spectator[];
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: passes (no consumers required to read `spectators` yet).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/types.ts
git commit -m "feat(types): add Spectator type, extend RoomSnapshot"
```

---

## Task 4: gameClient — spectator wrappers

**Files:**
- Modify: `src/lib/gameClient.ts`

- [ ] **Step 1: Find the `gameClient` object literal and the location of `joinRoom`**

Run: `grep -n "joinRoom\|leaveRoom\|export const gameClient" src/lib/gameClient.ts`
Expected: `joinRoom` near line 78, `leaveRoom` near line 81.

- [ ] **Step 2: Add two new methods to the `gameClient` object**

Insert after `leaveRoom`:

```ts
  joinRoomAsSpectator: async (code: string) => {
    const supabase = getSupabaseClient();
    // Resolve room id by code
    const { data: room, error: roomErr } = await supabase
      .from('rooms')
      .select('id')
      .eq('code', code.toUpperCase())
      .maybeSingle();
    if (roomErr || !room) {
      return { ok: false as const, error: 'room_not_found' as const };
    }
    const { error: rpcErr } = await supabase.rpc('join_room_as_spectator', {
      p_room_id: room.id,
    });
    if (rpcErr) {
      return { ok: false as const, error: rpcErr.message };
    }
    // Pull initial snapshot
    const { data: snap, error: snapErr } = await supabase.rpc('get_room_state', {
      p_room_id: room.id,
    });
    if (snapErr || !snap) {
      return { ok: false as const, error: snapErr?.message ?? 'no_state' };
    }
    return { ok: true as const, room_id: room.id as string, state: snap };
  },

  leaveRoomAsSpectator: async (room_id: string) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc('leave_room_as_spectator', {
      p_room_id: room_id,
    });
    return { ok: !error, error: error?.message };
  },
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/lib/gameClient.ts
git commit -m "feat(client): gameClient.joinRoomAsSpectator + leaveRoomAsSpectator"
```

---

## Task 5: roomStore — spectator flag

**Files:**
- Modify: `src/store/roomStore.ts`

- [ ] **Step 1: Extend the store with `isSpectator`**

Replace the file contents:

```ts
import { create } from 'zustand';
import type { RoomSnapshot } from '../../supabase/functions/_shared/types.ts';

interface RoomState {
  snapshot: RoomSnapshot | null;
  version: number;
  myPlayerId: string | null; // = session_id
  isSpectator: boolean;
  connState: 'idle' | 'syncing' | 'connected' | 'reconnecting' | 'error';
  setMyPlayerId: (id: string | null) => void;
  setIsSpectator: (v: boolean) => void;
  applySnapshot: (s: RoomSnapshot, version: number) => void;
  setConnState: (s: RoomState['connState']) => void;
  reset: () => void;
}

export const useRoomStore = create<RoomState>((set) => ({
  snapshot: null,
  version: 0,
  myPlayerId: null,
  isSpectator: false,
  connState: 'idle',
  setMyPlayerId: (id) => set({ myPlayerId: id }),
  setIsSpectator: (isSpectator) => set({ isSpectator }),
  applySnapshot: (snapshot, version) =>
    set((st) => (version >= st.version ? { snapshot, version } : st)),
  setConnState: (connState) => set({ connState }),
  reset: () => set({ snapshot: null, version: 0, connState: 'idle', isSpectator: false }),
}));
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: passes (no existing consumer reads `isSpectator` yet).

- [ ] **Step 3: Commit**

```bash
git add src/store/roomStore.ts
git commit -m "feat(store): add isSpectator flag to roomStore"
```

---

## Task 6: Deep-link handler — parse `?as=spectator`

**Files:**
- Modify: `src/navigation/AppNavigator.tsx` (around lines 295-337)

- [ ] **Step 1: Capture query param at module load**

Find the existing `_initialJoinCode` capture (search: `_initialJoinCode`). Add a sibling capture immediately after it (still at module scope):

```ts
let _initialJoinAsSpectator = false;
if (typeof window !== 'undefined' && window.location.search) {
  const params = new URLSearchParams(window.location.search);
  _initialJoinAsSpectator = params.get('as') === 'spectator';
}
```

- [ ] **Step 2: Branch the auto-join logic**

In the `if (Platform.OS === 'web' && ... _initialJoinCode)` block (around line 298), replace the inner `(async () => { ... })()` with:

```ts
(async () => {
  const { getSupabaseClient } = await import('../lib/supabase/client');
  const supabase = getSupabaseClient();
  let session = null as any;
  for (let i = 0; i < 30 && !session; i++) {
    const { data } = await supabase.auth.getSession();
    session = data.session;
    if (!session) await new Promise((r) => setTimeout(r, 100));
  }
  if (!session) {
    (window as any).alert(`Couldn't sign in to join ${code}. Try refresh.`);
    return;
  }

  const { gameClient } = await import('../lib/gameClient');
  const { setActiveRoom } = await import('../lib/activeRoom');
  const { subscribeRoom } = await import('../lib/realtimeBroadcast');

  if (_initialJoinAsSpectator) {
    const result = await gameClient.joinRoomAsSpectator(code);
    if (result.ok) {
      useRoomStore.getState().setIsSpectator(true);
      useRoomStore.getState().applySnapshot(result.state as any, Date.now());
      await setActiveRoom(result.room_id);
      subscribeRoom(result.room_id);
      navigation.navigate('GameTable'); // works both during waiting and in-game
    } else {
      (window as any).alert(`Couldn't watch ${code}: ${result.error ?? 'unknown'}`);
    }
    return;
  }

  const displayName = useAuthStore.getState().displayName || 'Guest';
  try {
    const result = await gameClient.joinRoom(displayName, code);
    if (result.ok && result.state.room?.id) {
      await setActiveRoom(result.state.room.id);
      subscribeRoom(result.state.room.id);
      navigation.navigate('WaitingRoom');
    } else {
      (window as any).alert(`Couldn't join ${code}: ${(result as any).error ?? 'unknown error'}`);
    }
  } catch (err) {
    (window as any).alert(`Auto-join failed: ${(err as Error)?.message ?? err}`);
  }
})();
```

Note: the file already imports `useRoomStore` and `useAuthStore`. If not, add the imports.

- [ ] **Step 3: Verify imports**

Run: `grep -n "useRoomStore\|useAuthStore" src/navigation/AppNavigator.tsx | head -5`
Expected: both are imported near the top of the file. If `useRoomStore` is missing, add `import { useRoomStore } from '../store/roomStore';` to the imports.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/navigation/AppNavigator.tsx
git commit -m "feat(deeplink): handle /join/CODE?as=spectator"
```

---

## Task 7: WaitingRoomScreen — share spectator link + spectator UI

**Files:**
- Modify: `src/screens/WaitingRoomScreen.tsx`

- [ ] **Step 1: Read the file and locate `handleShare`**

Read `src/screens/WaitingRoomScreen.tsx`. Confirm `handleShare` is around line 201 and the JSX `onPress={handleShare}` is around line 285.

- [ ] **Step 2: Add `handleShareSpectator` next to `handleShare`**

Insert after `handleShare`:

```tsx
  const handleShareSpectator = useCallback(async () => {
    if (!room) return;
    const link = `${buildInviteLink(room.code)}?as=spectator`;
    const message = `${t('spectator.shareMessage')}\n${link}`;
    try {
      await Share.share(
        { message, title: 'Nägels Online' },
        { dialogTitle: t('spectator.shareLink') }
      );
    } catch {
      await Clipboard.setStringAsync(link);
      Alert.alert(t('multiplayer.codeCopied'), link);
    }
  }, [room, t]);
```

- [ ] **Step 3: Read the spectator flag in render**

Near the top of the component, add:

```tsx
const isSpectator = useRoomStore((s) => s.isSpectator);
const spectators = useRoomStore((s) => s.snapshot?.spectators ?? []);
```

- [ ] **Step 4: Render spectator badge + adjust Ready button**

Find the Ready button JSX (search for `is_ready` or `t('multiplayer.ready'`). Wrap it in a conditional:

```tsx
{isSpectator ? (
  <View style={styles.spectatorBadge}>
    <Text style={[styles.spectatorBadgeText, { color: colors.text }]}>
      👁 {t('spectator.watching')}
    </Text>
  </View>
) : (
  /* existing Ready button JSX unchanged */
)}
```

Add to the StyleSheet at the bottom:

```ts
spectatorBadge: {
  paddingHorizontal: 14,
  paddingVertical: 8,
  borderRadius: 999,
  alignSelf: 'center',
},
spectatorBadgeText: {
  fontSize: 14,
  fontWeight: '600',
},
```

- [ ] **Step 5: Add second share action (only when not spectator)**

Below the existing `Pressable onPress={handleShare}` block, add:

```tsx
{!isSpectator && (
  <Pressable
    onPress={handleShareSpectator}
    style={[styles.shareButton, { backgroundColor: colors.glassLight }]}
  >
    <Text style={[styles.shareButtonText, { color: colors.text }]}>
      👁 {t('spectator.shareLink')}
    </Text>
  </Pressable>
)}
```

Reuse `styles.shareButton` / `styles.shareButtonText` — they exist for the primary share button.

- [ ] **Step 6: Render `👁 N` indicator**

Where the player count or header info renders (look for `t('multiplayer.maxPlayers')` or the player count text), append next to it:

```tsx
{spectators.length > 0 && (
  <Text style={[styles.spectatorCount, { color: colors.textSecondary }]}>
    {`  ·  👁 ${spectators.length}`}
  </Text>
)}
```

Add style:

```ts
spectatorCount: {
  fontSize: 13,
},
```

- [ ] **Step 7: Wire spectator leave**

In the existing leave-room handler (search `useRoomStore.getState().reset`), branch:

```tsx
if (useRoomStore.getState().isSpectator) {
  const roomId = useRoomStore.getState().snapshot?.room?.id;
  if (roomId) await gameClient.leaveRoomAsSpectator(roomId);
} else {
  // existing leave-as-player path unchanged
}
```

- [ ] **Step 8: Type-check + manual web smoke**

Run: `npx tsc --noEmit`
Expected: passes.

Run: `npx expo start --port 8081`
In two browser tabs, open `http://localhost:8081/join/<CODE>` and `http://localhost:8081/join/<CODE>?as=spectator`. Confirm second tab shows the Watching badge and no Ready button. Stop the dev server when done.

- [ ] **Step 9: Commit**

```bash
git add src/screens/WaitingRoomScreen.tsx
git commit -m "feat(ui): spectator badge and share-spectator-link on WaitingRoom"
```

---

## Task 8: GameTableScreen — spectator placeholder + indicator

**Files:**
- Modify: `src/screens/GameTableScreen.tsx`

- [ ] **Step 1: Read spectator state at top of component**

```tsx
const isSpectator = useRoomStore((s) => s.isSpectator);
const spectators = useRoomStore((s) => s.snapshot?.spectators ?? []);
```

- [ ] **Step 2: Replace hand zone with placeholder when spectator**

Find the bottom hand render (search `CardHand` or `myHand` usage). Wrap:

```tsx
{isSpectator ? (
  <Pressable
    onPress={handleLeave}
    style={[styles.spectatorStrip, { backgroundColor: colors.glassLight }]}
    accessibilityLabel={t('spectator.youAreWatching')}
  >
    <Text style={[styles.spectatorStripText, { color: colors.text }]}>
      👁 {t('spectator.youAreWatching')}
    </Text>
  </Pressable>
) : (
  /* existing CardHand / my-hand JSX unchanged */
)}
```

Style additions:

```ts
spectatorStrip: {
  paddingVertical: 14,
  alignItems: 'center',
  justifyContent: 'center',
  borderTopWidth: StyleSheet.hairlineWidth,
},
spectatorStripText: {
  fontSize: 15,
  fontWeight: '600',
},
```

- [ ] **Step 3: Hide bid input + play actions for spectator**

Locate the bid input UI (search `BettingPhase` or `placeBet`). Conditionally render only when `!isSpectator`.

Locate the card-play handlers (search `playCard`). Add a guard at handler entry:

```tsx
if (isSpectator) return;
```

This is belt-and-suspenders — without a hand the user can't tap a card anyway, but stop the dispatch path explicitly.

- [ ] **Step 4: Render `👁 N` indicator in top bar**

In the top bar JSX (search for the room-header area; usually has the room code or settings icon), add:

```tsx
{spectators.length > 0 && (
  <Pressable onPress={() => setShowSpectators(true)} accessibilityLabel={t('spectator.count', { count: spectators.length })}>
    <Text style={[styles.spectatorIndicator, { color: colors.textSecondary }]}>
      👁 {spectators.length}
    </Text>
  </Pressable>
)}
```

Add state at top of component:

```tsx
const [showSpectators, setShowSpectators] = useState(false);
```

And a simple modal/list near the bottom of the component's JSX:

```tsx
{showSpectators && (
  <Pressable
    style={styles.spectatorSheetBackdrop}
    onPress={() => setShowSpectators(false)}
  >
    <View style={[styles.spectatorSheet, { backgroundColor: colors.surface }]}>
      <Text style={[styles.spectatorSheetTitle, { color: colors.text }]}>
        {t('spectator.title')}
      </Text>
      {spectators.map((s) => (
        <Text key={s.session_id} style={[styles.spectatorRow, { color: colors.text }]}>
          {s.display_name}
        </Text>
      ))}
    </View>
  </Pressable>
)}
```

Styles:

```ts
spectatorIndicator: {
  fontSize: 13,
  fontWeight: '600',
  paddingHorizontal: 8,
},
spectatorSheetBackdrop: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: 'rgba(0,0,0,0.4)',
  justifyContent: 'center',
  alignItems: 'center',
},
spectatorSheet: {
  minWidth: 220,
  borderRadius: 16,
  padding: 16,
  gap: 8,
},
spectatorSheetTitle: {
  fontSize: 16,
  fontWeight: '700',
  marginBottom: 8,
},
spectatorRow: {
  fontSize: 14,
  paddingVertical: 4,
},
```

- [ ] **Step 5: Branch the leave-room handler**

Same pattern as Task 7 Step 7 — if `useRoomStore.getState().isSpectator`, call `gameClient.leaveRoomAsSpectator(roomId)` instead of `gameClient.leaveRoom(roomId)`.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 7: Manual web smoke**

Run: `npx expo start --port 8081`
- Open `?as=spectator` URL in one tab, normal join in another.
- Confirm spectator tab has no playable hand, the placeholder strip is visible above the safe-area bottom inset.
- Confirm `👁 1` shows for the player; tap reveals nickname list.

Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add src/screens/GameTableScreen.tsx
git commit -m "feat(ui): spectator placeholder strip + 👁 indicator on GameTable"
```

---

## Task 9: ChatPanel — spectator badge on messages

**Files:**
- Modify: `src/store/chatStore.ts`
- Modify: `src/components/ChatPanel.tsx`

- [ ] **Step 1: Extend chat message shape**

In `src/store/chatStore.ts`, find the chat message interface. Add an optional field:

```ts
fromSpectator?: boolean;
```

Where messages are sent (find the function that publishes to the realtime channel), include the flag derived from `useRoomStore.getState().isSpectator`:

```ts
broadcast({ ...payload, fromSpectator: useRoomStore.getState().isSpectator });
```

(Exact location: search for `channel.send` inside the chat store.)

- [ ] **Step 2: Render the badge in ChatPanel**

In `src/components/ChatPanel.tsx`, find where each message renders the sender's name. Prepend:

```tsx
{msg.fromSpectator && <Text style={styles.spectatorEye}>👁 </Text>}
<Text style={styles.senderName}>{msg.senderName}</Text>
```

Add style:

```ts
spectatorEye: {
  fontSize: 12,
  opacity: 0.7,
},
```

- [ ] **Step 3: Type-check + smoke**

Run: `npx tsc --noEmit`
Expected: passes.

Manual: with a spectator and a player both in the room, send a message from each. Spectator's message should have the eye icon.

- [ ] **Step 4: Commit**

```bash
git add src/store/chatStore.ts src/components/ChatPanel.tsx
git commit -m "feat(chat): tag spectator messages with eye icon"
```

---

## Task 10: i18n strings — EN/RU/ES

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/es.json`

- [ ] **Step 1: Add a `spectator` block to each locale**

In each file, add a top-level `spectator` object next to existing blocks (e.g., next to `multiplayer`):

**en.json**
```json
"spectator": {
  "watching": "Watching",
  "youAreWatching": "You're watching · Tap to leave",
  "shareLink": "Share spectator link",
  "shareMessage": "Watch our Nägels game:",
  "count": "{{count}} watching",
  "tooMany": "This room already has the maximum of 10 spectators.",
  "cannotJoinAsPlayerAndSpectator": "You're already a player in this room.",
  "title": "Watching"
}
```

**ru.json**
```json
"spectator": {
  "watching": "Наблюдает",
  "youAreWatching": "Вы наблюдаете · Тап чтобы выйти",
  "shareLink": "Поделиться ссылкой для зрителя",
  "shareMessage": "Посмотри нашу партию в Нагели:",
  "count": "{{count}} наблюдают",
  "tooMany": "В комнате уже максимум 10 зрителей.",
  "cannotJoinAsPlayerAndSpectator": "Вы уже играете в этой комнате.",
  "title": "Зрители"
}
```

**es.json**
```json
"spectator": {
  "watching": "Observando",
  "youAreWatching": "Estás observando · Toca para salir",
  "shareLink": "Compartir enlace de espectador",
  "shareMessage": "Mira nuestra partida de Nägels:",
  "count": "{{count}} observando",
  "tooMany": "La sala ya tiene el máximo de 10 espectadores.",
  "cannotJoinAsPlayerAndSpectator": "Ya eres jugador en esta sala.",
  "title": "Espectadores"
}
```

- [ ] **Step 2: Validate JSON**

Run: `node -e "['en','ru','es'].forEach(l => JSON.parse(require('fs').readFileSync('src/i18n/locales/'+l+'.json','utf8')))"`
Expected: no parse errors.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/ru.json src/i18n/locales/es.json
git commit -m "i18n: spectator strings (en/ru/es)"
```

---

## Task 11: Playwright probe — spectator flow

**Files:**
- Create: `scripts/probe-spectator-e2e.ts`

- [ ] **Step 1: Add testIDs the probe relies on**

Add `testID` props to the new spectator UI:
- `WaitingRoomScreen.tsx`: the spectator badge → `testID="spectator-badge"`; the share-spectator button → `testID="btn-share-spectator"`.
- `GameTableScreen.tsx`: the `👁 N` indicator → `testID="spectator-count"`; the bottom placeholder strip → `testID="spectator-strip"`.

Commit:
```bash
git add src/screens/WaitingRoomScreen.tsx src/screens/GameTableScreen.tsx
git commit -m "test: add testIDs for spectator probe"
```

- [ ] **Step 2: Write the probe**

Create `scripts/probe-spectator-e2e.ts`. The structure mirrors `probe-deeplink-e2e.ts`. Inlined in full so this task is self-contained:

```ts
/**
 * Probe: spectator mode.
 *  1) context A: skip-to-lobby, create a 4p room, capture code.
 *  2) context B: open /join/{code}?as=spectator, verify WatchingBadge + no Ready button.
 *  3) Back to A: verify 👁 1 indicator appeared.
 *
 *   APP_URL=http://localhost:8081 npx tsx scripts/probe-spectator-e2e.ts
 */

import { chromium, Page } from 'playwright';

const APP_URL = (process.env.APP_URL || 'http://localhost:8081').replace(/\/$/, '');

async function attach(page: Page, label: string) {
  page.on('console', m => console.log(`[${label}] CONSOLE ${m.type().padEnd(7)} ${m.text().slice(0, 200)}`));
  page.on('pageerror', e => console.log(`[${label}] PAGEERR ${e.name}: ${e.message}`));
  page.on('dialog', async d => { console.log(`[${label}] DIALOG ${d.type()}: ${d.message()}`); await d.dismiss(); });
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ── Context A: create room ──────────────────────
  const ctxA = await browser.newContext({ viewport: { width: 480, height: 760 } });
  const a = await ctxA.newPage();
  await attach(a, 'A');
  await a.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await a.getByTestId('btn-skip-to-lobby').click();
  await a.getByTestId('input-player-name').fill('Alice');
  await a.getByTestId('player-count-4').click();
  await a.getByTestId('tab-create').click();
  await a.getByTestId('btn-create-room').click();
  const codeEl = a.getByTestId('room-code');
  await codeEl.waitFor({ state: 'visible', timeout: 15000 });
  const code = ((await codeEl.textContent()) ?? '').trim();
  console.log(`\n=== Room created: ${code} ===\n`);

  // ── Context B: spectator deep-link ──────────────
  const ctxB = await browser.newContext({ viewport: { width: 480, height: 760 } });
  const b = await ctxB.newPage();
  await attach(b, 'B');
  await b.goto(`${APP_URL}/join/${code}?as=spectator`, { waitUntil: 'domcontentloaded' });

  // Spectator UI must appear
  const badge = b.getByTestId('spectator-badge');
  await badge.waitFor({ state: 'visible', timeout: 15000 });

  // Ready button must NOT be present for spectator
  const readyCount = await b.getByTestId('btn-ready').count();
  if (readyCount > 0) {
    console.error('FAIL: btn-ready visible to spectator');
    await browser.close();
    process.exit(1);
  }

  // ── Context A sees the indicator ────────────────
  const indicator = a.getByTestId('spectator-count');
  await indicator.waitFor({ state: 'visible', timeout: 15000 });
  const indicatorText = (await indicator.textContent()) ?? '';
  if (!indicatorText.includes('1')) {
    console.error(`FAIL: spectator-count text "${indicatorText}" does not include 1`);
    await browser.close();
    process.exit(1);
  }

  console.log('\nOK — spectator probe passed\n');
  await browser.close();
  process.exit(0);
})();
```

- [ ] **Step 3: Run probe against local dev**

Start dev server in one terminal: `npx expo start --port 8081`.
In another: `npx tsx scripts/probe-spectator-e2e.ts`
Expected: "OK — spectator probe passed".

Kill the dev server after the probe finishes.

- [ ] **Step 4: Commit**

```bash
git add scripts/probe-spectator-e2e.ts
git commit -m "test(e2e): playwright probe for spectator mode"
```

---

## Task 12: Update BACKLOG.md — move feature to Done

**Files:**
- Modify: `docs/BACKLOG.md`

- [ ] **Step 1: Move the `Spectator mode in rooms` line from Backlog to Done**

- [ ] **Step 2: Commit**

```bash
git add docs/BACKLOG.md
git commit -m "docs: mark spectator mode done"
```

---

## Self-review notes

- Every spec section is covered by at least one task:
  - Schema → Task 1
  - join/leave RPCs → Task 1
  - get_room_state + heartbeat additive → Task 2
  - TTL cleanup → Task 2 Step 3
  - Types → Task 3
  - Client wrappers → Task 4
  - useRoomStore → Task 5
  - Deep-link parse → Task 6
  - WaitingRoomScreen → Task 7
  - GameTableScreen → Task 8
  - ChatPanel → Task 9
  - i18n → Task 10
  - E2E test → Task 11
- "10 spectators per room" hard-coded in Task 1 Step 2 — matches spec.
- Method names consistent: `joinRoomAsSpectator` / `leaveRoomAsSpectator` (gameClient), `setIsSpectator` (store), `join_room_as_spectator` / `leave_room_as_spectator` (RPC).
- No "implement appropriate error handling" placeholders — all error paths spelled out.
- Chat persistence assumption verified: `chatStore.ts` is the realtime broadcast — `fromSpectator` lives in the event payload, no schema change.
