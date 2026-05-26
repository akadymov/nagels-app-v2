# Telegram Announce Allow-List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "new room" Telegram notification gated by a per-user allow-list managed in the existing admin block; default the per-room toggle to OFF and hide it entirely from non-allowed users.

**Architecture:** Three-layer gate. (1) UI: `LobbyScreen` shows the toggle only when `can_announce_telegram()` OR `admin_check()` returns true; default value is now `false`. (2) Edge function: `createRoom` re-checks server-side via `isCallerAllowedToAnnounce(svc, actor)` — client cannot bypass. (3) DB: new `telegram_announce_allowlist` table is the source of truth for the non-admin path; admins are env-based via `ADMIN_EMAILS`.

**Tech Stack:** Supabase Postgres (SECURITY DEFINER RPC) + Deno edge functions (`game-action`) + Expo React Native (TypeScript) + i18next + Zustand-less local component state.

**Spec:** `docs/superpowers/specs/2026-05-26-telegram-announce-allowlist-design.md`

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260526000000_telegram_allowlist.sql` | Create | Table + `can_announce_telegram()` RPC + RLS |
| `supabase/functions/_shared/types.ts` | Modify | Extend `create_room` Action (add `announce?: boolean`); add `admin_grant_telegram` / `admin_revoke_telegram` variants; extend `ActionKind` union |
| `supabase/functions/game-action/actions/createRoom.ts` | Modify | Replace `shouldSendRoomNotification` with `shouldSendByFlags` + new async `isCallerAllowedToAnnounce`; rewire call site |
| `supabase/functions/game-action/actions/adminGrantTelegram.ts` | Create | Admin-gated INSERT to allow-list |
| `supabase/functions/game-action/actions/adminRevokeTelegram.ts` | Create | Admin-gated DELETE from allow-list |
| `supabase/functions/game-action/actions/adminSearchUsers.ts` | Modify | Return `can_announce: boolean` on each row |
| `supabase/functions/game-action/index.ts` | Modify | Route the 2 new admin actions |
| `supabase/functions/_shared/__tests__/createRoom.test.ts` | Modify | Update import + assertions for `shouldSendByFlags` |
| `src/lib/gameClient.ts` | Modify | `canAnnounceTelegram`, `adminGrantTelegram`, `adminRevokeTelegram`; default `announce: false` in `createRoom` wrapper |
| `src/screens/LobbyScreen.tsx` | Modify | Load `canAnnounce` on mount; wrap toggle in `{canAnnounce && …}`; default state `false` |
| `src/components/admin/AdminRatingBlock.tsx` | Modify | Add per-row Telegram switch + optimistic toggle handler; extend `FoundUser` |
| `src/i18n/locales/en.json` | Modify | New `admin.allowTelegram*` keys |
| `src/i18n/locales/ru.json` | Modify | Same keys, Russian |
| `src/i18n/locales/es.json` | Modify | Same keys, Spanish |

The agent applies the migration itself (consistent with the previous feature) via `supabase db query --file` + `migration repair --status applied`, then deploys the edge function via `supabase functions deploy game-action`. Pushes are gated on a clean local `tsc` check.

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260526000000_telegram_allowlist.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260526000000_telegram_allowlist.sql
-- Per-user allow-list for the "new room" Telegram notification.
-- Admins (by ADMIN_EMAILS env) are NOT stored here; they are detected
-- in the edge function and bypass the table check.
-- See docs/superpowers/specs/2026-05-26-telegram-announce-allowlist-design.md

CREATE TABLE public.telegram_announce_allowlist (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by UUID            REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_announce_allowlist ENABLE ROW LEVEL SECURITY;
-- No CRUD policies: only SECURITY DEFINER RPCs and the game-action
-- edge function (service-role) read/write this table.

-- Caller's own permission check. Returns false for guests / unauthenticated.
CREATE OR REPLACE FUNCTION public.can_announce_telegram()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.telegram_announce_allowlist WHERE user_id = v_uid
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_announce_telegram() TO authenticated;
```

- [ ] **Step 2: Verify file size**

Run: `wc -l supabase/migrations/20260526000000_telegram_allowlist.sql`
Expected: ~30 lines.

- [ ] **Step 3: Apply to prod via Management API**

Run: `supabase db query --linked --file supabase/migrations/20260526000000_telegram_allowlist.sql`
Expected: `"rows": []` (DDL returns empty result).

If the response is an error mentioning a missing column, STOP and report — do not retry blindly.

- [ ] **Step 4: Verify on prod**

Run:
```bash
supabase db query --linked "
SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='telegram_announce_allowlist';
SELECT 1 FROM pg_proc WHERE proname='can_announce_telegram' AND pronamespace='public'::regnamespace;
"
```
Expected: 2 rows with `?column?` = 1.

- [ ] **Step 5: Register in tracker**

Run: `supabase migration repair --status applied 20260526000000 --linked`
Expected: `Repaired migration history: [20260526000000] => applied`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260526000000_telegram_allowlist.sql
git commit -m "feat(telegram): allow-list table + can_announce_telegram RPC"
```

---

## Task 2: Action type union

**Files:**
- Modify: `supabase/functions/_shared/types.ts`

The current `Action` union has `create_room` with `silent?: boolean`. Extend it with `announce?: boolean` and add two new admin action variants. Also extend `ActionKind`.

- [ ] **Step 1: Read the current union**

Open `supabase/functions/_shared/types.ts` and locate the `Action` union (around lines 12–30) and `ActionKind` (lines 1–9). Confirm the shapes match what is shown in the spec.

- [ ] **Step 2: Edit `ActionKind`**

Currently:
```ts
export type ActionKind =
  | 'create_room' | 'join_room' | 'leave_room'
  | 'ready' | 'start_game'
  | 'place_bet' | 'play_card' | 'continue_hand'
  | 'record_tricks'
  | 'request_timeout'
  | 'restart_game'
  | 'set_display_name';
```

This union is not exhaustive of the Action variants already (e.g. `set_stake`, `admin_*` are not listed). Leave it alone — it is a stale narrowed kind list, not used in routing. Do NOT modify.

- [ ] **Step 3: Edit `create_room` variant**

Find:
```ts
  | { kind: 'create_room'; player_count: number; max_cards?: number; display_name: string; mode?: RoomMode; silent?: boolean }
```

Replace with:
```ts
  | { kind: 'create_room'; player_count: number; max_cards?: number; display_name: string; mode?: RoomMode; silent?: boolean; announce?: boolean }
```

- [ ] **Step 4: Add two admin variants**

Find the last admin variant in the union:
```ts
  | { kind: 'admin_reset_all_ratings' };
```

Replace with:
```ts
  | { kind: 'admin_reset_all_ratings' }
  | { kind: 'admin_grant_telegram';  target_user_id: string }
  | { kind: 'admin_revoke_telegram'; target_user_id: string };
```

- [ ] **Step 5: Verify the file still parses**

Run: `npx tsc --noEmit 2>&1 | grep "_shared/types" | head -5`
Expected: no output (no syntax error introduced in `types.ts`).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/types.ts
git commit -m "feat(types): extend create_room + admin_*_telegram actions"
```

---

## Task 3: Refactor createRoom notification gate

**Files:**
- Modify: `supabase/functions/game-action/actions/createRoom.ts`
- Modify: `supabase/functions/_shared/__tests__/createRoom.test.ts`

Replace the single `shouldSendRoomNotification(action)` with two functions: a pure synchronous one for unit tests, and an async DB-aware one for the real gate. Rewire the call site.

- [ ] **Step 1: Update the helper in `createRoom.ts`**

Find:
```ts
/**
 * Decide whether room creation should fire the Telegram new-room
 * notification. Off when the caller passes silent: true (tests, future
 * silent-room features). Off-by-default for new callers; default
 * behavior (no flag set) stays the same as before — notification on.
 */
export function shouldSendRoomNotification(
  action: Extract<Action, { kind: 'create_room' }>,
): boolean {
  return action.silent !== true;
}
```

Replace with:
```ts
/**
 * Pure flag gate: the caller must NOT be a test/dev context AND must
 * have explicitly opted in. Server-side permission check happens
 * separately in isCallerAllowedToAnnounce().
 */
export function shouldSendByFlags(
  action: { silent?: boolean; announce?: boolean },
): boolean {
  return action.silent !== true && action.announce === true;
}

/**
 * Server-side permission gate: caller must be admin (by env) OR
 * present in telegram_announce_allowlist. Defends against a client
 * that fabricates `announce: true` in the request body.
 */
export async function isCallerAllowedToAnnounce(
  svc: SupabaseClient,
  actor: ActorContext,
): Promise<boolean> {
  const adminCsv = Deno.env.get('ADMIN_EMAILS') ?? '';
  const { data: sess } = await svc.from('room_sessions')
    .select('auth_user_id').eq('id', actor.session_id).maybeSingle();
  const authUserId = (sess as { auth_user_id: string } | null)?.auth_user_id ?? null;
  if (!authUserId) return false;
  const { data: au } = await svc.rpc('get_auth_user_info', { p_user_id: authUserId });
  if (isAdminEmail((au as { email: string | null } | null)?.email ?? null, adminCsv)) return true;
  const { data: row } = await svc.from('telegram_announce_allowlist')
    .select('user_id').eq('user_id', authUserId).maybeSingle();
  return !!row;
}
```

- [ ] **Step 2: Add the `isAdminEmail` import**

Near the top of `createRoom.ts`, add:
```ts
import { isAdminEmail } from '../../_shared/auth/isAdmin.ts';
```

The existing imports already include `SupabaseClient` and `ActorContext` — confirm via grep before editing. If they are NOT imported, add:
```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext } from '../../_shared/types.ts';
```

Run: `grep -E "^import" supabase/functions/game-action/actions/createRoom.ts | head -10` to confirm the final import block.

- [ ] **Step 3: Update the call site**

Find:
```ts
  if (shouldSendRoomNotification(action)) {
```
(around line 116)

Replace with:
```ts
  if (shouldSendByFlags(action) && await isCallerAllowedToAnnounce(svc, actor)) {
```

- [ ] **Step 4: Update the unit test**

Replace `supabase/functions/_shared/__tests__/createRoom.test.ts` with:
```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { shouldSendByFlags } from '../../game-action/actions/createRoom.ts';

Deno.test('shouldSendByFlags returns false when silent omitted and announce omitted', () => {
  assertEquals(shouldSendByFlags({}), false);
});

Deno.test('shouldSendByFlags returns false when announce false', () => {
  assertEquals(shouldSendByFlags({ silent: false, announce: false }), false);
});

Deno.test('shouldSendByFlags returns true when silent false and announce true', () => {
  assertEquals(shouldSendByFlags({ silent: false, announce: true }), true);
});

Deno.test('shouldSendByFlags returns false when silent true even if announce true', () => {
  assertEquals(shouldSendByFlags({ silent: true, announce: true }), false);
});

Deno.test('shouldSendByFlags returns true when silent omitted and announce true', () => {
  assertEquals(shouldSendByFlags({ announce: true }), true);
});
```

- [ ] **Step 5: Sanity-check (Deno test infra is not in this repo's npm scripts, skip)**

The repo does not run Deno tests in CI today. The file change is verified by the spec reviewer reading it.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/game-action/actions/createRoom.ts \
        supabase/functions/_shared/__tests__/createRoom.test.ts
git commit -m "feat(telegram): split flag gate from server permission gate"
```

---

## Task 4: Admin grant + revoke actions

**Files:**
- Create: `supabase/functions/game-action/actions/adminGrantTelegram.ts`
- Create: `supabase/functions/game-action/actions/adminRevokeTelegram.ts`

Both follow the pattern of `adminResetRating.ts` and `adminSearchUsers.ts` (admin email gate via `isAdminEmail`).

- [ ] **Step 1: Create `adminGrantTelegram.ts`**

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action } from '../../_shared/types.ts';
import { isAdminEmail } from '../../_shared/auth/isAdmin.ts';

export async function adminGrantTelegram(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'admin_grant_telegram' }>,
): Promise<{ ok: boolean; error?: string }> {
  const adminCsv = Deno.env.get('ADMIN_EMAILS') ?? '';
  const { data: sess } = await svc
    .from('room_sessions')
    .select('auth_user_id')
    .eq('id', actor.session_id)
    .maybeSingle();
  const callerId = (sess as { auth_user_id: string } | null)?.auth_user_id ?? null;
  if (!callerId) return { ok: false, error: 'not_admin' };
  const { data: au } = await svc.rpc('get_auth_user_info', { p_user_id: callerId });
  if (!isAdminEmail((au as { email: string | null } | null)?.email ?? null, adminCsv)) {
    return { ok: false, error: 'not_admin' };
  }

  const { error } = await svc
    .from('telegram_announce_allowlist')
    .upsert({ user_id: action.target_user_id, granted_by: callerId }, { onConflict: 'user_id' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
```

- [ ] **Step 2: Create `adminRevokeTelegram.ts`**

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action } from '../../_shared/types.ts';
import { isAdminEmail } from '../../_shared/auth/isAdmin.ts';

export async function adminRevokeTelegram(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'admin_revoke_telegram' }>,
): Promise<{ ok: boolean; error?: string; affected?: number }> {
  const adminCsv = Deno.env.get('ADMIN_EMAILS') ?? '';
  const { data: sess } = await svc
    .from('room_sessions')
    .select('auth_user_id')
    .eq('id', actor.session_id)
    .maybeSingle();
  const callerId = (sess as { auth_user_id: string } | null)?.auth_user_id ?? null;
  if (!callerId) return { ok: false, error: 'not_admin' };
  const { data: au } = await svc.rpc('get_auth_user_info', { p_user_id: callerId });
  if (!isAdminEmail((au as { email: string | null } | null)?.email ?? null, adminCsv)) {
    return { ok: false, error: 'not_admin' };
  }

  const { error, count } = await svc
    .from('telegram_announce_allowlist')
    .delete({ count: 'exact' })
    .eq('user_id', action.target_user_id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, affected: count ?? 0 };
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/game-action/actions/adminGrantTelegram.ts \
        supabase/functions/game-action/actions/adminRevokeTelegram.ts
git commit -m "feat(admin): grant + revoke telegram allow-list entries"
```

---

## Task 5: Route admin actions in edge function index

**Files:**
- Modify: `supabase/functions/game-action/index.ts`

- [ ] **Step 1: Add the imports**

Near the existing admin imports (around lines 31–33), add:
```ts
import { adminGrantTelegram }  from './actions/adminGrantTelegram.ts';
import { adminRevokeTelegram } from './actions/adminRevokeTelegram.ts';
```

- [ ] **Step 2: Add routing in the `admin_` block**

Inside the `if (action.kind.startsWith('admin_'))` switch (around lines 59–77), BEFORE the `return jsonResponse({ ok: false, error: 'unknown_action' }, 400);` line, add:

```ts
      if (action.kind === 'admin_grant_telegram') {
        const r = await adminGrantTelegram(svc, actor, action);
        return jsonResponse(r, r.ok ? 200 : 403);
      }
      if (action.kind === 'admin_revoke_telegram') {
        const r = await adminRevokeTelegram(svc, actor, action);
        return jsonResponse(r, r.ok ? 200 : 403);
      }
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/game-action/index.ts
git commit -m "feat(edge): route admin grant/revoke telegram actions"
```

---

## Task 6: Extend adminSearchUsers with `can_announce`

**Files:**
- Modify: `supabase/functions/game-action/actions/adminSearchUsers.ts`

- [ ] **Step 1: Update the `Row` interface**

Find:
```ts
interface Row {
  id: string;
  email: string | null;
  display_name: string | null;
  balance: number;
}
```

Replace with:
```ts
interface Row {
  id: string;
  email: string | null;
  display_name: string | null;
  balance: number;
  can_announce: boolean;
}
```

- [ ] **Step 2: Query the allow-list**

Right after the existing `ratings` fetch and `balanceByUser` Map construction, add:
```ts
  const { data: allow } = await svc
    .from('telegram_announce_allowlist')
    .select('user_id')
    .in('user_id', ids);
  const canAnnounceById = new Set<string>(
    (allow ?? []).map((r: { user_id: string }) => r.user_id),
  );
```

- [ ] **Step 3: Include in rows**

Find the existing `rows: Row[] = matches.map(...)` block and add the new field:
```ts
  const rows: Row[] = matches.map((m: { id: string; email: string | null }) => ({
    id: m.id,
    email: m.email,
    display_name: nameByUser.get(m.id) ?? null,
    balance: balanceByUser.get(m.id) ?? 0,
    can_announce: canAnnounceById.has(m.id),
  }));
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/game-action/actions/adminSearchUsers.ts
git commit -m "feat(admin): include can_announce in search results"
```

---

## Task 7: Deploy edge function

**Files:** (no source changes — this task just deploys what Tasks 2–6 changed)

- [ ] **Step 1: Deploy `game-action`**

Run: `supabase functions deploy game-action`
Expected: `Deployed Functions on project evcaqgmkdlqesqisjfyh: game-action` near the end.

- [ ] **Step 2: Smoke-check the new RPC works**

Run:
```bash
supabase db query --linked "SELECT public.can_announce_telegram();"
```
Expected: `"rows": [{"can_announce_telegram": false}]` (no auth context → false).

- [ ] **Step 3: No commit**

This task only touches prod state. No git changes.

---

## Task 8: gameClient methods + default change

**Files:**
- Modify: `src/lib/gameClient.ts`

- [ ] **Step 1: Add the three new methods**

Insert directly AFTER `adminResetAllRatings` (search for `adminResetAllRatings:`), BEFORE `setDisplayName`:

```ts
  canAnnounceTelegram: async (): Promise<boolean> => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('can_announce_telegram');
    if (error) throw error;
    return data === true;
  },

  adminGrantTelegram: (target_user_id: string): Promise<{ ok: boolean; error?: string }> =>
    postAdminAction({ kind: 'admin_grant_telegram', target_user_id }),

  adminRevokeTelegram: (target_user_id: string): Promise<{ ok: boolean; error?: string; affected?: number }> =>
    postAdminAction({ kind: 'admin_revoke_telegram', target_user_id }),
```

- [ ] **Step 2: Update the `createRoom` wrapper**

Find:
```ts
  createRoom: (
    displayName: string,
    player_count: number,
    max_cards = 10,
    mode: 'standard' | 'scorekeeper' = 'standard',
    announce: boolean = true,
  ) =>
    postAction(displayName, {
      kind: 'create_room',
      display_name: displayName,
      player_count,
      max_cards,
      mode,
      // Tests/automation AND dev/preview builds must not fire the
      // new-room Telegram notification. Only prod builds announce.
      // Host can also opt out per-room via the create form toggle.
      // See docs/principles.md §8 "Test side-effect hygiene".
      silent: shouldSilenceTelegram() || !announce,
    }),
```

Replace with:
```ts
  createRoom: (
    displayName: string,
    player_count: number,
    max_cards = 10,
    mode: 'standard' | 'scorekeeper' = 'standard',
    announce: boolean = false,
  ) =>
    postAction(displayName, {
      kind: 'create_room',
      display_name: displayName,
      player_count,
      max_cards,
      mode,
      // silent = test/dev gate (automation + non-prod builds).
      // announce = explicit host intent + server-enforced allow-list.
      // Both must be in the "announce" state for Telegram to fire.
      silent: shouldSilenceTelegram(),
      announce,
    }),
```

- [ ] **Step 3: Update the `Row` type returned by `adminSearchUsers`**

Find:
```ts
  adminSearchUsers: (
    q: string,
  ): Promise<{ ok: boolean; error?: string; rows?: Array<{ id: string; email: string | null; display_name: string | null; balance: number }> }> =>
    postAdminAction({ kind: 'admin_search_users', q }),
```

Replace with:
```ts
  adminSearchUsers: (
    q: string,
  ): Promise<{ ok: boolean; error?: string; rows?: Array<{ id: string; email: string | null; display_name: string | null; balance: number; can_announce: boolean }> }> =>
    postAdminAction({ kind: 'admin_search_users', q }),
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -i gameClient | head -10`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gameClient.ts
git commit -m "feat(rating): client wires for telegram allow-list + announce default off"
```

---

## Task 9: LobbyScreen gating + default

**Files:**
- Modify: `src/screens/LobbyScreen.tsx`

- [ ] **Step 1: Add the state**

Find:
```ts
  const [announceTelegram, setAnnounceTelegram] = useState(true);
```
(line ~152)

Replace with:
```ts
  const [announceTelegram, setAnnounceTelegram] = useState(false);
  const [canAnnounce, setCanAnnounce] = useState(false);
```

- [ ] **Step 2: Load permission on mount**

Find an existing `useEffect` near the top of the component, or add this new one near the other state-loading effects:

```ts
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [allow, adminRes] = await Promise.all([
        gameClient.canAnnounceTelegram().catch(() => false),
        gameClient.adminCheck().catch(() => ({ is_admin: false })),
      ]);
      if (!cancelled) setCanAnnounce(allow || !!adminRes.is_admin);
    })();
    return () => { cancelled = true; };
  }, []);
```

Make sure `useEffect` and `gameClient` are already imported (they should be).

- [ ] **Step 3: Wrap the toggle block**

Find the `<View … testID="row-announce-telegram"` block (around lines 585–599). It is currently rendered unconditionally (inside whatever parent renders the create-room form).

Wrap the entire `<View testID="row-announce-telegram" …>…</View>` element in a conditional:

```tsx
{canAnnounce && (
  <View
    /* … existing props … */
    testID="row-announce-telegram"
  >
    {/* … existing children … */}
  </View>
)}
```

The exact span: from the line containing `testID="row-announce-telegram"` (and its opening `<View`) through its closing `</View>`. Use grep to find the opening tag, then visually identify the matching close. There is also a likely outer wrapper `<View>` immediately preceding it — DO NOT wrap that one; only the `row-announce-telegram` view.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -i lobbyscreen | head -10`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/screens/LobbyScreen.tsx
git commit -m "feat(lobby): hide telegram toggle unless allow-listed; default off"
```

---

## Task 10: AdminRatingBlock — per-row Telegram switch

**Files:**
- Modify: `src/components/admin/AdminRatingBlock.tsx`

- [ ] **Step 1: Extend `FoundUser`**

Find:
```ts
interface FoundUser { id: string; email: string | null; display_name: string | null; balance: number }
```

Replace with:
```ts
interface FoundUser { id: string; email: string | null; display_name: string | null; balance: number; can_announce: boolean }
```

- [ ] **Step 2: Import `BrandSwitch`**

Add to the existing imports at the top of the file:
```ts
import { BrandSwitch } from '../BrandSwitch';
```

(Confirm `src/components/BrandSwitch.tsx` exists — it is used in `LobbyScreen.tsx`, so the path should be `../BrandSwitch`.)

- [ ] **Step 3: Add the toggle handler**

Inside the `AdminRatingBlock` component body, alongside `resetOne` and `resetAll`, add:

```ts
  const toggleTelegram = async (u: FoundUser, next: boolean) => {
    setResults((prev) => prev.map((x) => x.id === u.id ? { ...x, can_announce: next } : x));
    try {
      const r = next
        ? await gameClient.adminGrantTelegram(u.id)
        : await gameClient.adminRevokeTelegram(u.id);
      if (!r.ok) throw new Error(r.error || 'unknown');
    } catch {
      setResults((prev) => prev.map((x) => x.id === u.id ? { ...x, can_announce: !next } : x));
      Alert.alert('Error', 'Could not update Telegram permission');
    }
  };
```

`Alert` is already imported at the top (used by `resetAll`).

- [ ] **Step 4: Add the switch to each result row**

Find the row JSX:
```tsx
      {results.map((u) => (
        <View key={u.id} style={[styles.row, { borderColor: colors.glassLight }]}>
          <Text style={[styles.rowText, { color: colors.textPrimary }]} numberOfLines={1}>{u.email}</Text>
          <Text style={[styles.rowText, { color: colors.textMuted }]}>{u.balance}</Text>
          <Pressable
            onPress={() => resetOne(u)}
            disabled={u.balance === 0}
            style={[styles.btnSmall, { borderColor: colors.error, opacity: u.balance === 0 ? 0.4 : 1 }]}
            testID={`admin-reset-${u.id}`}
          >
            <Text style={{ color: colors.error, fontWeight: '700', fontSize: 13 }}>Reset</Text>
          </Pressable>
        </View>
      ))}
```

Replace with:
```tsx
      {results.map((u) => (
        <View key={u.id} style={[styles.row, { borderColor: colors.glassLight }]}>
          <Text style={[styles.rowText, { color: colors.textPrimary }]} numberOfLines={1}>{u.email}</Text>
          <Text style={[styles.rowText, { color: colors.textMuted }]}>{u.balance}</Text>
          <BrandSwitch
            value={u.can_announce}
            onValueChange={(v) => toggleTelegram(u, v)}
            testID={`admin-allow-telegram-${u.id}`}
          />
          <Pressable
            onPress={() => resetOne(u)}
            disabled={u.balance === 0}
            style={[styles.btnSmall, { borderColor: colors.error, opacity: u.balance === 0 ? 0.4 : 1 }]}
            testID={`admin-reset-${u.id}`}
          >
            <Text style={{ color: colors.error, fontWeight: '700', fontSize: 13 }}>Reset</Text>
          </Pressable>
        </View>
      ))}
```

The existing `styles.row` already uses `flexDirection: 'row', alignItems: 'center', gap: 8` — the switch slots in between balance and Reset with no extra style work needed. If `BrandSwitch` looks too large on mobile, follow up later; do not adjust now.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -i AdminRatingBlock | head -10`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/AdminRatingBlock.tsx
git commit -m "feat(admin): per-row switch to grant/revoke telegram announcement"
```

---

## Task 11: i18n keys

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/es.json`

Note: the existing admin block uses hardcoded English strings ("Admin · Reset ratings", "Reset", etc.) and the new switch label is also exposed only when the admin opens admin UI — but adding the keys keeps things consistent with project conventions for any text the admin sees.

- [ ] **Step 1: en.json**

Locate the `"admin": { … }` block. If it does not exist (the current admin UI is hardcoded English), CREATE it as a new top-level key. If it exists, add inside it.

Add these three keys:
```json
    "allowTelegram": "Can announce in Telegram",
    "allowTelegramHint": "Allows this user's create-room toggle to fire the public-channel notification.",
    "toggleTelegramError": "Could not update Telegram permission"
```

- [ ] **Step 2: ru.json**

Same `admin` block, Russian copy:
```json
    "allowTelegram": "Может анонсить в Telegram",
    "allowTelegramHint": "Разрешает свич «Анонс в Telegram» в форме создания комнаты у этого юзера.",
    "toggleTelegramError": "Не удалось обновить разрешение Telegram"
```

- [ ] **Step 3: es.json**

Same `admin` block, Spanish copy:
```json
    "allowTelegram": "Puede anunciar en Telegram",
    "allowTelegramHint": "Permite que el interruptor «Anunciar en Telegram» del usuario dispare la notificación al canal público.",
    "toggleTelegramError": "No se pudo actualizar el permiso de Telegram"
```

- [ ] **Step 4: Validate JSON**

Run:
```bash
node -e "['en','ru','es'].forEach(l => JSON.parse(require('fs').readFileSync('src/i18n/locales/'+l+'.json','utf8'))); console.log('OK')"
```
Expected: `OK`

- [ ] **Step 5: Wire `toggleTelegramError` in AdminRatingBlock**

In `src/components/admin/AdminRatingBlock.tsx`, replace `'Could not update Telegram permission'` in the `toggleTelegram` catch with `String(t('admin.toggleTelegramError', 'Could not update Telegram permission'))`. Ensure `useTranslation` is in scope (it already is — `const { t } = useTranslation()` exists at the top of the component).

- [ ] **Step 6: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/ru.json src/i18n/locales/es.json \
        src/components/admin/AdminRatingBlock.tsx
git commit -m "i18n(admin): keys for telegram allow-list toggle + error"
```

---

## Task 12: Test lint + smoke pre-flight

**Files:**
- Modify (auto): `tests/TEST_TODO.md`

- [ ] **Step 1: Type-check the whole src/**

Run: `npx tsc --noEmit 2>&1 | grep -vE "supabase/functions|node_modules|Deno" | grep "error TS" | head -10`
Expected: no output. If errors appear in `src/`, FIX them before committing.

- [ ] **Step 2: Refresh TEST_TODO**

Run: `npm run test:lint -- --update-todo 2>&1 | tail -10`
Expected: exit 0, possibly `tests/TEST_TODO.md refreshed`.

- [ ] **Step 3: Confirm new dynamic testIDs are intentionally absent**

Run: `grep "admin-allow-telegram" tests/TEST_TODO.md`
Expected: no match (dynamic testIDs are not scanned).

- [ ] **Step 4: Surface to the user**

Report:
> "All client code in place. Migration `20260526000000_telegram_allowlist.sql` already applied to prod (Task 1). Edge function `game-action` already deployed (Task 7). Recommended manual verification: open Lobby as a non-allow-listed account — the Telegram toggle should not appear. Open it as the admin — the toggle should appear, default OFF. Open admin block, search for a user, flip the new switch — verify the second account now sees the toggle on next Lobby reload."

- [ ] **Step 5: Commit TEST_TODO**

```bash
git add tests/TEST_TODO.md
git commit -m "chore(tests): refresh TEST_TODO after telegram allow-list"
```

---

## Done

Final user-facing summary should include:

1. Migration applied + edge function deployed in-band (Tasks 1 & 7).
2. List of new testIDs (only `admin-allow-telegram-<id>` is added; dynamic, not lint-tracked).
3. The before/after behavioural change: by default no one fires Telegram now, including the admin if they don't explicitly flip the per-room toggle to ON.
4. Recommendation to `git push origin main` after manual verification.
