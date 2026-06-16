# Discord friend invite + seamless auto-join — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inside a Discord Activity, any participant can invite friends via Discord's native dialog, and an invited friend who lands in the Activity is auto-joined into the same game room (as player if a seat is free, else spectator).

**Architecture:** Part A tags each room with the Discord Activity `instanceId` at creation and adds a lookup RPC + a once-per-launch auto-join hook. Part B adds a Discord-only invite button (shared component) that calls `sdk.commands.openInviteDialog()`. Pure decision helpers are unit-tested with jest; SQL/edge/UI are verified via `ts:check` + smoke + manual (no RN component-test harness exists in this repo).

**Tech Stack:** Expo RN + TS, Supabase (Postgres RPC + edge `game-action`), `@discord/embedded-app-sdk`, i18next (en/ru/es/fr), jest (pure logic only).

**Spec:** `docs/superpowers/specs/2026-06-17-discord-friend-invite-design.md`

---

## File structure

Part A (seamless mapping/auto-join):
- `supabase/migrations/<ts>_discord_instance_room.sql` — `rooms.discord_instance_id` + index + `get_active_room_for_instance` RPC.
- `supabase/functions/_shared/types.ts` — add `discord_instance_id?` to `create_room` action.
- `supabase/functions/game-action/actions/createRoom.ts` — store the column.
- `src/lib/discord/bootstrap.ts` — `getDiscordInstanceId()` accessor.
- `src/lib/gameClient.ts` — pass instanceId on create; `getActiveRoomForInstance` wrapper.
- `src/lib/discord/autoJoinInstanceRoom.ts` (new) — pure `decideAutoJoinRole` + orchestrator `maybeAutoJoinInstanceRoom`.
- `src/lib/discord/__tests__/autoJoinInstanceRoom.test.ts` (new) — unit test the pure helper.
- `src/hooks/useDiscordAutoJoin.ts` (new) — once-per-launch hook, mounted in `AppNavigator`.

Part B (invite button):
- `src/lib/discord/invite.ts` (new) — `invokeDiscordInvite()` + its jest test.
- `src/lib/discord/__tests__/invite.test.ts` (new).
- `src/components/DiscordInviteButton.tsx` (new) — gated button + error alert.
- `src/screens/WaitingRoomScreen.tsx`, `src/screens/GameTableScreen.tsx` — mount the button.
- `src/i18n/locales/{en,ru,es,fr}.json` — new keys.

---

## PART A — Seamless mapping + auto-join

### Task A1: Migration — column + index + lookup RPC

**Files:**
- Create: `supabase/migrations/20260617000000_discord_instance_room.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Tie a game room to the Discord Activity instance that created it, so an
-- invited friend launching the same Activity can be auto-joined into that
-- room. Nullable: rooms created outside Discord leave it null.
alter table public.rooms add column if not exists discord_instance_id text;

create index if not exists idx_rooms_discord_instance
  on public.rooms (discord_instance_id)
  where discord_instance_id is not null;

-- Returns the current open room for a Discord Activity instance (latest,
-- non-finished), or null. SECURITY DEFINER so it works regardless of RLS;
-- read-only, so anon/authenticated may call it.
create or replace function public.get_active_room_for_instance(p_instance_id text)
returns jsonb
language sql security definer set search_path to 'public', 'pg_catalog' as $$
  select jsonb_build_object(
    'room_id', r.id,
    'code', r.code,
    'phase', r.phase,
    'player_count', r.player_count,
    'seats_taken', (select count(*) from public.room_players rp where rp.room_id = r.id)
  )
  from public.rooms r
  where r.discord_instance_id = p_instance_id
    and r.phase <> 'finished'
  order by r.created_at desc
  limit 1;
$$;

grant execute on function public.get_active_room_for_instance(text)
  to anon, authenticated, service_role;
```

- [ ] **Step 2: Apply locally and verify**

Run: `supabase db reset` (or `supabase migration up` if the local stack is running)
Expected: migration applies with no error. Then:
Run: `supabase db execute "select public.get_active_room_for_instance('nonexistent');"` (or via the SQL editor)
Expected: returns `null` (no room for an unknown instance).

If the local Supabase stack is not running, surface that to the user as a blocker — do not start heavy Docker services unprompted.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260617000000_discord_instance_room.sql
git commit -m "feat(db): rooms.discord_instance_id + get_active_room_for_instance"
```

---

### Task A2: Edge — store discord_instance_id on create

**Files:**
- Modify: `supabase/functions/_shared/types.ts:14`
- Modify: `supabase/functions/game-action/actions/createRoom.ts:92-99`

- [ ] **Step 1: Add the field to the create_room action type**

In `supabase/functions/_shared/types.ts`, change the `create_room` variant (line 14) from:

```ts
  | { kind: 'create_room'; player_count: number; max_cards?: number; display_name: string; mode?: RoomMode; silent?: boolean; announce?: boolean }
```

to:

```ts
  | { kind: 'create_room'; player_count: number; max_cards?: number; display_name: string; mode?: RoomMode; silent?: boolean; announce?: boolean; discord_instance_id?: string | null }
```

- [ ] **Step 2: Store it in the insert**

In `supabase/functions/game-action/actions/createRoom.ts`, change the insert (lines 92-99) from:

```ts
      .insert({
        code,
        host_session_id: actor.session_id,
        player_count: action.player_count,
        max_cards: action.max_cards ?? 10,
        mode: action.mode ?? 'standard',
        phase: 'waiting',
      })
```

to:

```ts
      .insert({
        code,
        host_session_id: actor.session_id,
        player_count: action.player_count,
        max_cards: action.max_cards ?? 10,
        mode: action.mode ?? 'standard',
        phase: 'waiting',
        discord_instance_id: action.discord_instance_id ?? null,
      })
```

- [ ] **Step 3: Typecheck**

Run: `npm run ts:check`
Expected: no new `src/` errors (pre-existing `supabase/functions` Deno-resolution errors are baseline; ignore them).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/types.ts supabase/functions/game-action/actions/createRoom.ts
git commit -m "feat(edge): persist discord_instance_id on create_room"
```

---

### Task A3: Client — pass instanceId, add lookup wrapper

**Files:**
- Modify: `src/lib/discord/bootstrap.ts` (after `getDiscordSdk`, ~line 150)
- Modify: `src/lib/gameClient.ts` (createRoom action body ~170-182; add wrapper near joinRoom ~196)

- [ ] **Step 1: Add an instanceId accessor to bootstrap**

In `src/lib/discord/bootstrap.ts`, after the `getDiscordSdk` function (around line 150), add:

```ts
/**
 * The Discord Activity instance id, shared by every participant of the same
 * launched Activity. Null outside Discord or before the SDK is ready.
 */
export function getDiscordInstanceId(): string | null {
  return discordSdk?.instanceId ?? null;
}
```

- [ ] **Step 2: Pass instanceId from gameClient.createRoom**

In `src/lib/gameClient.ts`, add the import near the other local imports at the top of the file:

```ts
import { getDiscordInstanceId } from './discord/bootstrap';
```

Then in the `createRoom` action object (lines ~170-182), add the field after `announce`:

```ts
    postAction(displayName, {
      kind: 'create_room',
      display_name: displayName,
      player_count,
      max_cards,
      mode,
      silent: shouldSilenceTelegram(),
      announce,
      discord_instance_id: getDiscordInstanceId(),
    }),
```

- [ ] **Step 3: Add the lookup wrapper**

In `src/lib/gameClient.ts`, add this method to the `gameClient` object, right after `joinRoom` (after line 185):

```ts
  /** Look up the current open room for a Discord Activity instance. */
  getActiveRoomForInstance: async (
    instanceId: string,
  ): Promise<
    | { room_id: string; code: string; phase: string; player_count: number; seats_taken: number }
    | null
  > => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('get_active_room_for_instance', {
      p_instance_id: instanceId,
    });
    if (error || !data) return null;
    return data as {
      room_id: string; code: string; phase: string; player_count: number; seats_taken: number;
    };
  },
```

- [ ] **Step 4: Typecheck**

Run: `npm run ts:check`
Expected: no new `src/` errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/discord/bootstrap.ts src/lib/gameClient.ts
git commit -m "feat(client): pass instanceId on create + getActiveRoomForInstance"
```

---

### Task A4: Auto-join logic (pure helper + orchestrator, TDD)

**Files:**
- Create: `src/lib/discord/autoJoinInstanceRoom.ts`
- Create: `src/lib/discord/__tests__/autoJoinInstanceRoom.test.ts`

- [ ] **Step 1: Write the failing test for the pure decision helper**

Create `src/lib/discord/__tests__/autoJoinInstanceRoom.test.ts`:

```ts
import { decideAutoJoinRole } from '../autoJoinInstanceRoom';

describe('decideAutoJoinRole', () => {
  it('seats a player when waiting and a seat is free', () => {
    expect(decideAutoJoinRole({ phase: 'waiting', player_count: 4, seats_taken: 2 })).toBe('player');
  });
  it('spectates when waiting but full', () => {
    expect(decideAutoJoinRole({ phase: 'waiting', player_count: 4, seats_taken: 4 })).toBe('spectator');
  });
  it('spectates when a game is in progress even with a free seat', () => {
    expect(decideAutoJoinRole({ phase: 'playing', player_count: 4, seats_taken: 2 })).toBe('spectator');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- autoJoinInstanceRoom`
Expected: FAIL — `decideAutoJoinRole` is not exported / module missing.

- [ ] **Step 3: Implement the helper + orchestrator**

Create `src/lib/discord/autoJoinInstanceRoom.ts`:

```ts
import { getDiscordInstanceId } from './bootstrap';
import { isDiscordActivity } from './context';
import { gameClient } from '../gameClient';
import { getActiveRoom, setActiveRoom } from '../activeRoom';
import { subscribeRoom } from '../realtimeBroadcast';
import { useRoomStore } from '../../store/roomStore';

type InstanceRoom = { room_id: string; code: string; phase: string; player_count: number; seats_taken: number };

/** Pure: should a fresh arrival take a seat, or watch? */
export function decideAutoJoinRole(
  room: { phase: string; player_count: number; seats_taken: number },
): 'player' | 'spectator' {
  if (room.phase === 'waiting' && room.seats_taken < room.player_count) return 'player';
  return 'spectator';
}

export type AutoJoinResult =
  | { joined: false; reason: 'not_discord' | 'no_instance' | 'no_room' | 'already_in_room' | 'failed' }
  | { joined: true; room_id: string; code: string; role: 'player' | 'spectator'; phase: string };

// Server errors that mean "the seat is gone" → retry as spectator.
const SEAT_LOST = new Set(['room_full', 'room_in_progress', 'seat_taken']);

/**
 * Once-per-launch: if we're in a Discord Activity, have no active room, and the
 * Activity instance already has an open room, join it (player if a seat is
 * free, else spectator). Returns a result; navigation is the caller's job.
 */
export async function maybeAutoJoinInstanceRoom(displayName: string): Promise<AutoJoinResult> {
  if (!isDiscordActivity()) return { joined: false, reason: 'not_discord' };
  // Don't yank back a user who deliberately left the room this session.
  // getActiveRoom() is async (returns Promise<string | null>) — must await.
  if (await getActiveRoom()) return { joined: false, reason: 'already_in_room' };

  const instanceId = getDiscordInstanceId();
  if (!instanceId) return { joined: false, reason: 'no_instance' };

  const room: InstanceRoom | null = await gameClient.getActiveRoomForInstance(instanceId);
  if (!room) return { joined: false, reason: 'no_room' };

  let role = decideAutoJoinRole(room);

  if (role === 'player') {
    const res = await gameClient.joinRoom(displayName, room.code);
    if (!res.ok) {
      const err = (res as any).error as string | undefined;
      if (!err || !SEAT_LOST.has(err)) return { joined: false, reason: 'failed' };
      role = 'spectator'; // lost the last seat to a concurrent arrival
    } else {
      await setActiveRoom(res.state.room?.id ?? room.room_id, room.code, 'player');
      subscribeRoom(room.room_id);
      return { joined: true, room_id: room.room_id, code: room.code, role: 'player', phase: room.phase };
    }
  }

  // Spectator path (either decided up-front or after losing the seat).
  const spec = await gameClient.joinRoomAsSpectator(room.code);
  if (!spec.ok) return { joined: false, reason: 'failed' };
  useRoomStore.getState().applySnapshot(spec.state, Number((spec.state as any)?.room?.version ?? 0));
  useRoomStore.getState().setIsSpectator(true);
  await setActiveRoom(room.room_id, room.code, 'spectator');
  subscribeRoom(room.room_id);
  return { joined: true, room_id: room.room_id, code: room.code, role: 'spectator', phase: room.phase };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- autoJoinInstanceRoom`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run ts:check`
Expected: no new `src/` errors. (`getActiveRoom`, `setActiveRoom` are confirmed exports of `src/lib/activeRoom.ts`; `getActiveRoom` is async — already awaited above. `setIsSpectator` is confirmed on `useRoomStore`.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/discord/autoJoinInstanceRoom.ts src/lib/discord/__tests__/autoJoinInstanceRoom.test.ts
git commit -m "feat(discord): auto-join the Activity instance's room (player or spectator)"
```

---

### Task A5: Mount the auto-join hook

**Files:**
- Create: `src/hooks/useDiscordAutoJoin.ts`
- Modify: `src/navigation/AppNavigator.tsx` (mount the hook in the root navigator component, near `const isDesktop = useIsDesktop();` at line 300)

- [ ] **Step 1: Write the hook**

Create `src/hooks/useDiscordAutoJoin.ts`:

```ts
import { useEffect, useRef } from 'react';
import { useNavigation } from '@react-navigation/native';
import { maybeAutoJoinInstanceRoom } from '../lib/discord/autoJoinInstanceRoom';
import { isDiscordActivity } from '../lib/discord/context';
import { useAuthStore } from '../store/authStore';

/**
 * Runs once per launch inside a Discord Activity: after auth is available,
 * auto-joins the Activity instance's room (if any) and navigates into it.
 * Mounted at the navigator root so navigation is available.
 */
export function useDiscordAutoJoin(): void {
  const navigation = useNavigation<any>();
  const displayName = useAuthStore((s) => s.displayName);
  const user = useAuthStore((s) => s.user);
  const attempted = useRef(false);

  useEffect(() => {
    if (!isDiscordActivity()) return;
    if (attempted.current) return;
    if (!user) return; // wait until Discord auth has minted a session
    attempted.current = true;
    (async () => {
      const result = await maybeAutoJoinInstanceRoom(displayName || 'Guest');
      if (result.joined) {
        navigation.navigate(result.phase === 'waiting' ? 'WaitingRoom' : 'GameTable', {
          isMultiplayer: true,
        });
      }
    })();
  }, [user, displayName, navigation]);
}
```

- [ ] **Step 2: Mount it in AppNavigator**

In `src/navigation/AppNavigator.tsx`, add the import with the other hook imports:

```ts
import { useDiscordAutoJoin } from '../hooks/useDiscordAutoJoin';
```

Then call it inside the main navigator component (the same component that has `const isDesktop = useIsDesktop();` around line 300 — the one rendering `<Stack.Navigator>`), as the first hook in its body:

```ts
  useDiscordAutoJoin();
```

(If line 300 is a small route-wrapper rather than the navigator component, place the call in the component that renders `<Stack.Navigator>` with the `WaitingRoom`/`GameTable` screens — that component is inside `NavigationContainer`, so `useNavigation` resolves.)

- [ ] **Step 3: Typecheck**

Run: `npm run ts:check`
Expected: no new `src/` errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useDiscordAutoJoin.ts src/navigation/AppNavigator.tsx
git commit -m "feat(discord): mount once-per-launch auto-join hook"
```

---

## PART B — Invite button

### Task B1: Invite helper (TDD) + i18n

**Files:**
- Create: `src/lib/discord/invite.ts`
- Create: `src/lib/discord/__tests__/invite.test.ts`
- Modify: `src/i18n/locales/{en,ru,es,fr}.json`

- [ ] **Step 1: Write the failing test**

Create `src/lib/discord/__tests__/invite.test.ts`:

```ts
import { invokeDiscordInvite } from '../invite';

jest.mock('../bootstrap', () => ({ getDiscordSdk: jest.fn() }));
import { getDiscordSdk } from '../bootstrap';

describe('invokeDiscordInvite', () => {
  it('returns no_sdk when the SDK is absent', async () => {
    (getDiscordSdk as jest.Mock).mockReturnValue(null);
    expect(await invokeDiscordInvite()).toEqual({ ok: false, error: 'no_sdk' });
  });
  it('opens the invite dialog when the SDK is present', async () => {
    const openInviteDialog = jest.fn().mockResolvedValue(undefined);
    (getDiscordSdk as jest.Mock).mockReturnValue({ commands: { openInviteDialog } });
    expect(await invokeDiscordInvite()).toEqual({ ok: true });
    expect(openInviteDialog).toHaveBeenCalledTimes(1);
  });
  it('returns the error when the dialog rejects', async () => {
    const openInviteDialog = jest.fn().mockRejectedValue(new Error('no_permission'));
    (getDiscordSdk as jest.Mock).mockReturnValue({ commands: { openInviteDialog } });
    expect(await invokeDiscordInvite()).toEqual({ ok: false, error: 'no_permission' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- discord/__tests__/invite`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the helper**

Create `src/lib/discord/invite.ts`:

```ts
import { getDiscordSdk } from './bootstrap';

export type InviteResult = { ok: true } | { ok: false; error: string };

/**
 * Open Discord's native "invite friends to this Activity" dialog. We cannot
 * pick a specific friend — Discord owns that UI. Returns a result instead of
 * throwing so callers can show a toast.
 */
export async function invokeDiscordInvite(): Promise<InviteResult> {
  const sdk = getDiscordSdk();
  if (!sdk) return { ok: false, error: 'no_sdk' };
  try {
    await sdk.commands.openInviteDialog();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'invite_failed' };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- discord/__tests__/invite`
Expected: PASS (3 tests).

- [ ] **Step 5: Add i18n keys**

In each of `src/i18n/locales/{en,ru,es,fr}.json`, add a `room` object key block (merge into the existing `room` object if present, else add it). Keys and values:

en.json:
```json
    "inviteDiscord": "Invite friends",
    "inviteDiscordFailed": "Couldn't open the Discord invite — you may not have permission to invite here.",
    "joinedAsSpectator": "Game in progress — you joined as a spectator."
```
ru.json:
```json
    "inviteDiscord": "Пригласить друзей",
    "inviteDiscordFailed": "Не удалось открыть приглашение Discord — возможно, нет прав приглашать сюда.",
    "joinedAsSpectator": "Игра уже идёт — вы зашли как зритель."
```
es.json:
```json
    "inviteDiscord": "Invitar amigos",
    "inviteDiscordFailed": "No se pudo abrir la invitación de Discord — quizá no tienes permiso para invitar aquí.",
    "joinedAsSpectator": "Partida en curso — entraste como espectador."
```
fr.json:
```json
    "inviteDiscord": "Inviter des amis",
    "inviteDiscordFailed": "Impossible d'ouvrir l'invitation Discord — tu n'as peut-être pas la permission d'inviter ici.",
    "joinedAsSpectator": "Partie en cours — tu as rejoint en spectateur."
```

If there is no existing top-level `"room"` object in a locale file, add one: `"room": { <keys above> },`. Verify placement by searching the file for `"room"`.

- [ ] **Step 6: Verify JSON + commit**

Run: `node -e "['en','ru','es','fr'].forEach(l=>{const r=require('./src/i18n/locales/'+l+'.json').room; if(!r||!r.inviteDiscord) throw new Error('missing '+l)}); console.log('OK')"`
Expected: `OK`

```bash
git add src/lib/discord/invite.ts src/lib/discord/__tests__/invite.test.ts src/i18n/locales/en.json src/i18n/locales/ru.json src/i18n/locales/es.json src/i18n/locales/fr.json
git commit -m "feat(discord): invite helper + i18n keys"
```

---

### Task B2: DiscordInviteButton component + mount in room screens

**Files:**
- Create: `src/components/DiscordInviteButton.tsx`
- Modify: `src/screens/WaitingRoomScreen.tsx` (room-code card, after the share buttons ~line 524)
- Modify: `src/screens/GameTableScreen.tsx` (near the existing spectator-share affordance)

- [ ] **Step 1: Write the component**

Create `src/components/DiscordInviteButton.tsx`:

```tsx
import React, { useCallback } from 'react';
import { Pressable, Text, Alert, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { useIsDiscordActivity } from '../hooks/useIsDiscordActivity';
import { invokeDiscordInvite } from '../lib/discord/invite';
import { Spacing } from '../constants';

/**
 * Renders only inside a Discord Activity. Opens Discord's native invite dialog
 * so any participant can bring friends into the shared Activity (and, via
 * auto-join, this room). No-op surface outside Discord.
 */
export const DiscordInviteButton: React.FC = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const isDiscord = useIsDiscordActivity();

  const onPress = useCallback(async () => {
    const res = await invokeDiscordInvite();
    if (!res.ok) {
      Alert.alert(
        String(t('room.inviteDiscord', 'Invite friends')),
        String(t('room.inviteDiscordFailed', "Couldn't open the Discord invite.")),
      );
    }
  }, [t]);

  if (!isDiscord) return null;

  return (
    <Pressable testID="btn-invite-discord" onPress={onPress} hitSlop={8} style={styles.btn}>
      <Text style={[styles.btnText, { color: colors.textPrimary }]}>
        🎮 {t('room.inviteDiscord', 'Invite friends')}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  btn: { paddingVertical: Spacing.sm, alignItems: 'center' },
  btnText: { fontSize: 14, fontWeight: '600' },
});
```

- [ ] **Step 2: Mount it in the WaitingRoom code card**

In `src/screens/WaitingRoomScreen.tsx`, add the import near the other component imports:

```ts
import { DiscordInviteButton } from '../components/DiscordInviteButton';
```

Then inside the room-code `GlassCard`, immediately after the `{!isSpectator && ( ... btn-share-spectator ... )}` block and before the card's closing `</GlassCard>` (around line 524-525), add:

```tsx
            <DiscordInviteButton />
```

- [ ] **Step 3: Mount it in the game table**

In `src/screens/GameTableScreen.tsx`, add the same import:

```ts
import { DiscordInviteButton } from '../components/DiscordInviteButton';
```

Then render `<DiscordInviteButton />` next to the existing spectator-share control (search for `handleShareSpectator` to find the share affordance's JSX, and place `<DiscordInviteButton />` adjacent to it). The component self-hides outside Discord, so placement only needs to be somewhere always-mounted in the table chrome.

- [ ] **Step 4: Typecheck + testID lint**

Run: `npm run ts:check`
Expected: no new `src/` errors.
Run: `npm run test:lint -- --update-todo`
Expected: exit 0; `btn-invite-discord` appears in `tests/TEST_TODO.md`.

- [ ] **Step 5: Commit**

```bash
git add src/components/DiscordInviteButton.tsx src/screens/WaitingRoomScreen.tsx src/screens/GameTableScreen.tsx tests/TEST_TODO.md
git commit -m "feat(discord): invite button in waiting room and game table"
```

---

## Final verification (controller runs)

- [ ] `npm run test:unit` — all unit tests pass (the two new pure-helper suites included).
- [ ] `npm run smoke` — needs `:8081`. 12/13 baseline (the pre-existing `stakes-waitingroom` failure is unrelated; confirm no *new* failures and no Telegram noise).
- [ ] Rebuild the Discord playtest bundle: `npx expo export -p web` (the Activity serves static `dist/`), then reload the Activity.
- [ ] Manual in a real Discord Activity: create a room → press "Invite friends" → Discord's dialog opens → a second account accepts → it lands in the same room (player if a seat is free, spectator if the game is mid-hand or full).

## Risks to surface during execution

- **`openInviteDialog` may require `authenticate()`.** If Step B's manual test shows the dialog throwing an auth error, the invite button must be gated behind the completed Discord auth track; report it rather than working around it.
- **Spectator promotion next game.** A spectator taking a free seat at the next `waiting` phase relies on `gameClient.switchRole(...)` already being wired into the waiting-room UI. If no seat-taking affordance exists for spectators there, that promotion is a small follow-up (out of this plan's core scope per the spec non-goal).
- **Hook mount point (Task A5).** The hook must live under `NavigationContainer` (where `useNavigation` works) and in a component that stays mounted across the lobby → room transition.

---

## Self-review

- **Spec coverage:** A1 schema+RPC → spec A1/A3; A2 edge → A2; A3 client → A2/A3; A4+A5 auto-join hook (silent, once-per-launch, player-or-spectator, seat-loss fallback) → A4; B1+B2 invite button (Discord-only, all participants, error toast) → Part B; i18n → spec §i18n. Spectator→player promotion reuses existing `switchRole` (noted as out-of-new-UI per spec non-goal).
- **Placeholders:** none — every code step shows real code; the one open verification (`getActiveRoom` accessor name) is explicitly flagged with where to confirm.
- **Type consistency:** `discord_instance_id` (column/action/insert), `getDiscordInstanceId`, `getActiveRoomForInstance` (return shape `{room_id, code, phase, player_count, seats_taken}`), `decideAutoJoinRole`, `maybeAutoJoinInstanceRoom`, `AutoJoinResult`, `invokeDiscordInvite`/`InviteResult`, `DiscordInviteButton`, testID `btn-invite-discord`, i18n keys `room.inviteDiscord` / `room.inviteDiscordFailed` / `room.joinedAsSpectator` — all used consistently across tasks.
