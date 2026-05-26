# Telegram Announce Allow-List — Design Spec

**Date:** 2026-05-26
**Status:** Approved (pre-implementation)
**Related:**
- Commit `cbcf754` — current per-room host toggle (defaults ON)
- `supabase/functions/game-action/actions/createRoom.ts` — current `shouldSendRoomNotification(action)` gate
- `docs/principles.md` §8 — test side-effect hygiene

## 1. Problem

The "new room" Telegram notification currently fires for every public room creation unless the host turns off a per-room toggle (default ON). This means any random user — including bots, accidental clicks, and new players trying things out — can spam the public channel.

We want a curated allow-list: only the admin (`akhmed.kadymov@gmail.com`) and a small set of users the admin explicitly approves can fire the notification. Even those users see the toggle default to **OFF**, so a deliberate per-room opt-in is required.

## 2. Scope and decisions

In scope:

- A new DB table `telegram_announce_allowlist` storing the per-user permission.
- An RPC `can_announce_telegram()` for the client to check its own permission.
- Two new admin actions (`admin_grant_telegram`, `admin_revoke_telegram`) to add/remove users from the allow-list, exposed through the existing `game-action` edge function and gated by `ADMIN_EMAILS`.
- A switch on each row of the admin's user-search results to toggle the permission.
- Hide the per-room toggle entirely for non-allowed users. Show it (default OFF) for allowed users.
- Backend gate in `createRoom`: even if the client sends `announce: true`, the notification only fires when the caller is admin or allow-listed. The client cannot bypass this.
- Default for `gameClient.createRoom`'s `announce` parameter changes from `true` to `false`.

Out of scope:

- A per-user "revoke own permission" flow. Allow-listed users either use the per-room toggle (default OFF) or ignore it.
- A separate UI screen for managing the allow-list — extends `AdminRatingBlock`.
- Notification history / audit log beyond the `granted_by` / `granted_at` columns on the table itself.
- Migrating the existing behaviour for the admin's own historical room creations.
- A grant-by-email flow detached from `adminSearchUsers` — the admin always uses the search → row → toggle.

## 3. Architecture

Three layers each enforce the gate:

1. **UI layer** (`LobbyScreen`) — the toggle block renders only when the caller is admin or allow-listed. Non-allowed users never see the option, so `gameClient.createRoom` always passes `announce: false`. Default for allowed users is also `false`.
2. **API layer** (`game-action` edge function) — `createRoom.ts` re-checks the caller's permission server-side. If the client lies (`announce: true` in body without being on the allow-list), the notification is suppressed.
3. **Data layer** — `telegram_announce_allowlist` is the source of truth for the non-admin path. Admins are detected via `ADMIN_EMAILS` env var, mirroring the existing `isAdminEmail` pattern.

The two existing signals on the `create_room` action are now orthogonal:

- `silent: boolean` (existing) — automation/dev-build gate, set by `shouldSilenceTelegram()` in `gameClient.ts`. Independent of host intent.
- `announce: boolean` (new) — host intent: "yes, post to Telegram". Default `false`.

A notification fires only when `silent === false` AND `announce === true` AND the caller passes the permission check.

## 4. Database

New migration `supabase/migrations/20260526000000_telegram_allowlist.sql`.

### 4.1 Table

```sql
CREATE TABLE public.telegram_announce_allowlist (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by UUID            REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_announce_allowlist ENABLE ROW LEVEL SECURITY;
-- No CRUD policies: only SECURITY DEFINER RPCs and edge functions touch this.
```

### 4.2 RPC `can_announce_telegram()`

```sql
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

The admin's permission is enforced separately on the client by also calling `gameClient.adminCheck()` and OR-ing the two results, mirroring how `isAdminEmail` works in the edge function. We do not push admin emails into the table.

## 5. Edge function

### 5.1 Action types (`supabase/functions/_shared/types.ts`)

Extend the `create_room` variant and add two admin actions:

```ts
| { kind: 'create_room'; player_count: number; max_cards?: number;
    display_name: string; mode?: RoomMode;
    silent?: boolean;     // existing — test/dev gate
    announce?: boolean }  // new — host intent, default treated as false
| { kind: 'admin_grant_telegram';  target_user_id: string }
| { kind: 'admin_revoke_telegram'; target_user_id: string }
```

### 5.2 Two new admin action files

`supabase/functions/game-action/actions/adminGrantTelegram.ts`:

- Verify caller is admin via the existing `isAdminEmail` pattern (see `adminSearchUsers.ts` for the template).
- `INSERT INTO telegram_announce_allowlist (user_id, granted_by) VALUES (target_user_id, caller_auth_user_id) ON CONFLICT (user_id) DO NOTHING`.
- Return `{ ok: true }`.

`supabase/functions/game-action/actions/adminRevokeTelegram.ts`:

- Same admin gate.
- `DELETE FROM telegram_announce_allowlist WHERE user_id = target_user_id`.
- Return `{ ok: true, affected: <count> }`.

### 5.3 Extend `adminSearchUsers`

After resolving `ids` and balances, also query the allow-list:

```ts
const { data: allow } = await svc
  .from('telegram_announce_allowlist')
  .select('user_id')
  .in('user_id', ids);
const canAnnounceById = new Set((allow ?? []).map((r) => r.user_id));
```

Each `Row` gains `can_announce: boolean`. Existing call sites get a new field that's harmless to ignore.

### 5.4 Refactor `createRoom.ts` notification gate

Replace the single `shouldSendRoomNotification(action)` with two functions for clean unit-testing:

```ts
// Pure, sync — covered by createRoom.test.ts
export function shouldSendByFlags(action: { silent?: boolean; announce?: boolean }) {
  return action.silent !== true && action.announce === true;
}

// Async — DB-dependent, not unit-tested
export async function isCallerAllowedToAnnounce(
  svc: SupabaseClient,
  actor: ActorContext,
): Promise<boolean> {
  const adminCsv = Deno.env.get('ADMIN_EMAILS') ?? '';
  const { data: sess } = await svc.from('room_sessions')
    .select('auth_user_id').eq('id', actor.session_id).maybeSingle();
  if (!sess?.auth_user_id) return false;
  const { data: au } = await svc.rpc('get_auth_user_info', { p_user_id: sess.auth_user_id });
  if (isAdminEmail(au?.email ?? null, adminCsv)) return true;
  const { data: row } = await svc.from('telegram_announce_allowlist')
    .select('user_id').eq('user_id', sess.auth_user_id).maybeSingle();
  return !!row;
}
```

In `createRoom`, the existing call site becomes:

```ts
if (shouldSendByFlags(action) && await isCallerAllowedToAnnounce(svc, actor)) {
  // existing Telegram dispatch
}
```

The existing `createRoom.test.ts` keeps testing the synchronous flag gate against the new `shouldSendByFlags` name (update the import + a couple of assertions to set both `silent` and `announce`).

## 6. Client

### 6.1 `src/lib/gameClient.ts`

Three additions:

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

And the existing `createRoom` wrapper changes default + flag mapping:

```ts
createRoom: (
  displayName: string,
  player_count: number,
  max_cards = 10,
  mode: 'standard' | 'scorekeeper' = 'standard',
  announce: boolean = false,   // was: true
) =>
  postAction(displayName, {
    kind: 'create_room',
    display_name: displayName,
    player_count, max_cards, mode,
    silent: shouldSilenceTelegram(),   // tests + dev/preview builds only
    announce,
  }),
```

The `Row` type returned by `adminSearchUsers` gains `can_announce: boolean`.

### 6.2 `src/screens/LobbyScreen.tsx`

Add two state hooks near the existing `announceTelegram`:

```ts
const [canAnnounce, setCanAnnounce] = useState(false);
const [announceTelegram, setAnnounceTelegram] = useState(false); // was: true
```

In a mount-time effect, OR the RPC and the admin check:

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

Wrap the existing `row-announce-telegram` block in `{canAnnounce && (…)}`. No disabled-state placeholder for non-allowed users — the block does not render at all.

### 6.3 `src/components/admin/AdminRatingBlock.tsx`

The result row currently has email / display_name / balance + a single Reset Pressable. Add a `BrandSwitch` (existing component, used in `LobbyScreen`) on the right edge of the row, value `u.can_announce`. testID: `admin-allow-telegram-<user_id>` (dynamic — will not appear in `test:lint` static scan, that's expected).

Optimistic toggle:

```ts
const toggleTelegram = async (u: FoundUser, next: boolean) => {
  setResults((prev) => prev.map((x) => x.id === u.id ? { ...x, can_announce: next } : x));
  try {
    const r = next
      ? await gameClient.adminGrantTelegram(u.id)
      : await gameClient.adminRevokeTelegram(u.id);
    if (!r.ok) throw new Error(r.error || 'unknown');
  } catch {
    // rollback
    setResults((prev) => prev.map((x) => x.id === u.id ? { ...x, can_announce: !next } : x));
    Alert.alert('Error', 'Could not update Telegram permission');
  }
};
```

The local `FoundUser` interface gains `can_announce: boolean`.

## 7. i18n

Three new keys (en/ru/es), placed inside the existing `admin` block:

```
admin.allowTelegram          — "Can announce in TG" / "Может слать в TG" / "Puede anunciar en TG"
admin.allowTelegramHint      — short hint (one line)
admin.toggleTelegramError    — Alert body on failure
```

The lobby block (`lobby.announceTelegram`, `lobby.announceTelegramHint`) is unchanged — same wording works for the now-allow-listed-only audience.

## 8. Testing and side effects

- `npm run smoke` must still pass. The `silent` gate is preserved verbatim for automated contexts via `isAutomatedContext()` — the new `announce` field defaulting to `false` is an additional layer of safety, not a replacement.
- `supabase/functions/_shared/__tests__/createRoom.test.ts` requires a small update: import becomes `shouldSendByFlags`, and assertions must pass both `silent` and `announce` (e.g. `shouldSendByFlags({ silent: false, announce: true }) === true`).
- New dynamic testID `admin-allow-telegram-<id>` is not static, so `test:lint` ignores it (consistent with existing dynamic IDs in admin block).
- Side-effect hygiene improves: in addition to `silent`, two new server-enforced predicates must hold before any Telegram POST. Worst case (client bypass + admin DB tampering) still requires DB write access, which only the SECURITY DEFINER path provides.

## 9. Rollout

1. Apply migration (single new table + one function) to prod via the same `supabase db query --file` + `migration repair --status applied` pattern used for `20260525000000_rating_transfers.sql`.
2. Deploy `game-action` edge function with the new admin actions and the updated `createRoom` gate (`supabase functions deploy game-action`).
3. Push client changes — non-admin / non-allow-listed users immediately stop seeing the toggle, and any new room creation defaults to silent.
4. Admin populates the allow-list via the existing admin search → toggle per user.

There is no data migration — the table starts empty. The admin retains permission by virtue of `ADMIN_EMAILS`, with no allow-list row needed.

## 10. Edge cases

- **Caller is a guest** (`auth.uid()` is null): `can_announce_telegram()` returns `false`; toggle is hidden; even if a guest crafts a request body with `announce: true`, the edge function's `isCallerAllowedToAnnounce` short-circuits at the missing `auth_user_id` lookup.
- **Allow-listed user later removed**: their LobbyScreen still shows the toggle until next mount (we don't subscribe). The server gate refuses any subsequent room-create with `announce: true`. Acceptable — UI eventually catches up; no spam reaches the channel.
- **Admin loses email match** (someone changes `ADMIN_EMAILS`): the admin block disappears and the lobby toggle disappears on next mount. No way to re-grant without env access — by design.
- **Concurrent grant + create_room**: harmless — `INSERT … ON CONFLICT DO NOTHING` and the edge function's read are independent. Worst case: a single room created in the moment-of-revocation does not announce; admin grants again and tries once more.
- **Allow-list table queried by anonymous JWTs**: RLS without policies = no rows visible. Only SECURITY DEFINER paths can see contents.
