# Host-Left Rescue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a one-tap rescue Leave banner whenever the room's host is missing from `room_players`, so a stuck regular player or spectator can always escape — even if the auto-eject broadcast was lost.

**Architecture:** Pure helper `isHostAbsent({room, players})` + stateless `<HostLeftBanner visible onLeave />` component. Mounted at the top of three screens: `WaitingRoomScreen`, `GameTableScreen`, `BettingPhase`. Each screen wires its own `iAmSpectator` flag to pick `leaveRoomAsSpectator` vs `leaveRoom`. No DB, no edge function, no schema changes.

**Tech Stack:** Expo (React Native + Web) + TypeScript + Zustand (`useRoomStore`) + i18next + Jest unit tests.

**Spec:** `docs/superpowers/specs/2026-05-26-host-left-rescue-design.md`

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/lib/hostAbsent.ts` | Create | Pure helper `isHostAbsent({room, players})` |
| `src/lib/__tests__/hostAbsent.test.ts` | Create | Unit tests for the helper |
| `src/components/HostLeftBanner.tsx` | Create | Stateless banner component |
| `src/i18n/locales/en.json` | Modify | `multiplayer.hostLeftBannerText` |
| `src/i18n/locales/ru.json` | Modify | Same key, Russian |
| `src/i18n/locales/es.json` | Modify | Same key, Spanish |
| `src/screens/WaitingRoomScreen.tsx` | Modify | Mount banner + rescue handler |
| `src/screens/GameTableScreen.tsx` | Modify | Mount banner + rescue handler |
| `src/components/betting/BettingPhase.tsx` | Modify | Mount banner + rescue handler |
| `tests/TEST_TODO.md` | Modify | Auto-refreshed by `npm run test:lint` |

Reuse existing `multiplayer.leaveRoom` ("Leave Room") for the CTA — no new key for that. Only `hostLeftBannerText` is new.

---

## Task 1: Pure helper + unit tests

**Files:**
- Create: `src/lib/hostAbsent.ts`
- Create: `src/lib/__tests__/hostAbsent.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/hostAbsent.test.ts`:

```ts
import { isHostAbsent } from '../hostAbsent';

describe('isHostAbsent', () => {
  it('returns false when room is null', () => {
    expect(isHostAbsent({ room: null, players: [] })).toBe(false);
  });

  it('returns false when room has no host_session_id', () => {
    expect(isHostAbsent({
      room: { host_session_id: null } as any,
      players: [{ session_id: 'p1' } as any],
    })).toBe(false);
  });

  it('returns false when host is present in players', () => {
    expect(isHostAbsent({
      room: { host_session_id: 'host-1' } as any,
      players: [
        { session_id: 'host-1' } as any,
        { session_id: 'p2' } as any,
      ],
    })).toBe(false);
  });

  it('returns true when host_session_id is set but absent from players', () => {
    expect(isHostAbsent({
      room: { host_session_id: 'host-1' } as any,
      players: [{ session_id: 'p2' } as any],
    })).toBe(true);
  });

  it('returns true when players list is empty but host_session_id is set', () => {
    expect(isHostAbsent({
      room: { host_session_id: 'host-1' } as any,
      players: [],
    })).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `npx jest src/lib/__tests__/hostAbsent.test.ts 2>&1 | tail -20`
Expected: 5 failures, error mentions module `'../hostAbsent'` cannot be found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/hostAbsent.ts`:

```ts
import type { RoomSnapshot } from '../../supabase/functions/_shared/types.ts';

/**
 * True iff the room exists, has a host_session_id, and no player in the
 * snapshot's players list matches that session_id. Used by the host-left
 * rescue banner to detect a stuck client where the auto-eject broadcast
 * was lost.
 */
export function isHostAbsent(
  snap: Pick<RoomSnapshot, 'room' | 'players'>,
): boolean {
  const room = snap.room;
  if (!room?.host_session_id) return false;
  return !snap.players.some((p) => p.session_id === room.host_session_id);
}
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `npx jest src/lib/__tests__/hostAbsent.test.ts 2>&1 | tail -10`
Expected: `Tests:  5 passed, 5 total`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hostAbsent.ts src/lib/__tests__/hostAbsent.test.ts
git commit -m "feat(rescue): pure isHostAbsent helper + unit tests"
```

---

## Task 2: HostLeftBanner component

**Files:**
- Create: `src/components/HostLeftBanner.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/HostLeftBanner.tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';

interface Props {
  visible: boolean;
  onLeave: () => void;
}

export const HostLeftBanner: React.FC<Props> = ({ visible, onLeave }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (!visible) return null;
  return (
    <View
      pointerEvents="box-none"
      style={styles.wrap}
      testID="host-left-banner"
    >
      <View style={[styles.bar, { backgroundColor: colors.error, borderColor: colors.glassLight }]}>
        <Text style={[styles.text, { color: '#ffffff' }]} numberOfLines={2}>
          {t('multiplayer.hostLeftBannerText', 'Host left the room.')}
        </Text>
        <Pressable
          testID="host-left-banner-leave"
          onPress={onLeave}
          accessibilityRole="button"
          accessibilityLabel={String(t('multiplayer.leaveRoom', 'Leave Room'))}
          style={({ pressed }) => [styles.btn, { backgroundColor: '#ffffff', opacity: pressed ? 0.75 : 1 }]}
        >
          <Text style={[styles.btnText, { color: colors.error }]}>
            {t('multiplayer.leaveRoom', 'Leave Room')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 1000,
    paddingTop: 8, paddingHorizontal: 12,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  text: { flex: 1, fontSize: 14, fontWeight: '600' },
  btn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  btnText: { fontSize: 13, fontWeight: '700' },
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep HostLeftBanner | head -5`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/HostLeftBanner.tsx
git commit -m "feat(rescue): HostLeftBanner component"
```

---

## Task 3: i18n key

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/es.json`

Only one new key — `multiplayer.hostLeftBannerText`. CTA reuses the existing `multiplayer.leaveRoom`.

- [ ] **Step 1: Add to en.json**

Inside the existing `"multiplayer": { … }` block (around line 245+), add after `"leaveRoom": "Leave Room",`:

```json
    "hostLeftBannerText": "Host left the room.",
```

(Comma at the end since other keys follow.)

- [ ] **Step 2: Add to ru.json**

In the `"multiplayer"` block, add:

```json
    "hostLeftBannerText": "Хост вышел из комнаты.",
```

- [ ] **Step 3: Add to es.json**

In the `"multiplayer"` block, add:

```json
    "hostLeftBannerText": "El anfitrión salió de la sala.",
```

- [ ] **Step 4: Validate JSON**

Run:
```bash
node -e "['en','ru','es'].forEach(l => { const j = JSON.parse(require('fs').readFileSync('src/i18n/locales/'+l+'.json','utf8')); console.log(l, typeof j.multiplayer?.hostLeftBannerText); })"
```
Expected: three lines `en string`, `ru string`, `es string`.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/ru.json src/i18n/locales/es.json
git commit -m "i18n(rescue): hostLeftBannerText key"
```

---

## Task 4: Mount banner in WaitingRoomScreen

**Files:**
- Modify: `src/screens/WaitingRoomScreen.tsx`

- [ ] **Step 1: Add imports**

Near the existing imports at the top of `src/screens/WaitingRoomScreen.tsx`, add:

```ts
import { HostLeftBanner } from '../components/HostLeftBanner';
import { isHostAbsent } from '../lib/hostAbsent';
```

`useCallback`, `gameClient`, `useRoomStore`, `unsubscribeRoom` should already be imported — confirm via grep if unsure. If `unsubscribeRoom` is NOT yet imported, add to the existing realtimeBroadcast import line.

- [ ] **Step 2: Compute the flag and handler**

Inside the `WaitingRoomScreen` component body, near the existing `isHost` / `hostStillIn` / `myPlayerId` reads (around line 90-110), add:

```ts
  const hostAbsent = isHostAbsent({ room, players });
  const isViewerHost = !!room && !!myPlayerId && room.host_session_id === myPlayerId;
  const showHostLeftBanner = hostAbsent && !isViewerHost;

  const handleHostLeftRescue = useCallback(async () => {
    if (!room?.id) return;
    try {
      if (isSpectator) {
        await gameClient.leaveRoomAsSpectator(room.id);
      } else {
        await gameClient.leaveRoom(room.id);
      }
    } catch (err) {
      console.error('[HostLeftRescue:WaitingRoom] leave failed:', err);
    }
    onLeave?.();
  }, [room?.id, isSpectator, onLeave]);
```

(Notes on this screen:
- `room`, `players`, `myPlayerId`, `isSpectator` are already read from `useRoomStore` near line 79-81. Use those bindings verbatim.
- The exit callback in `WaitingRoomScreen` is `onLeave`, not `onExit` — confirm by searching for `onLeave` in the props/destructure. If the actual prop name differs, use the screen's existing one.
- This screen does not unsubscribe realtime manually — `onLeave` handles navigation; the room store reset happens elsewhere.)

- [ ] **Step 3: Mount the banner**

In the returned JSX, immediately after the outermost root element opens (typically a `<SafeAreaView>` or `<View>` wrapping everything), add the banner BEFORE the rest of the screen content. Find the line that opens the outermost element (e.g. `<SafeAreaView … >`); insert immediately after it:

```tsx
        <HostLeftBanner
          visible={showHostLeftBanner}
          onLeave={handleHostLeftRescue}
        />
```

Indentation should match the surrounding JSX.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep WaitingRoomScreen | head -10`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/screens/WaitingRoomScreen.tsx
git commit -m "feat(rescue): host-left banner in WaitingRoom"
```

---

## Task 5: Mount banner in GameTableScreen

**Files:**
- Modify: `src/screens/GameTableScreen.tsx`

- [ ] **Step 1: Add imports**

Near the existing imports, add:

```ts
import { HostLeftBanner } from '../components/HostLeftBanner';
import { isHostAbsent } from '../lib/hostAbsent';
```

`useCallback`, `gameClient`, `useRoomStore`, `unsubscribeRoom` are all already imported in this file.

- [ ] **Step 2: Compute the flag and handler**

Inside the `GameTableScreen` component body, near the existing `isHost` definition (around line 215) and the existing `handleSpectatorLeave` (around line 277), add:

```ts
  const hostAbsent = isMultiplayer && isHostAbsent({ room, players: mpPlayers });
  const isViewerHost = isMultiplayer && !!room && !!myPlayerId && room.host_session_id === myPlayerId;
  const showHostLeftBanner = !!hostAbsent && !isViewerHost;

  const handleHostLeftRescue = useCallback(async () => {
    if (!room?.id) return;
    try {
      if (isSpectator) {
        await gameClient.leaveRoomAsSpectator(room.id);
      } else {
        await gameClient.leaveRoom(room.id);
      }
    } catch (err) {
      console.error('[HostLeftRescue:GameTable] leave failed:', err);
    }
    unsubscribeRoom();
    useRoomStore.getState().reset();
    onExit?.();
  }, [room?.id, isSpectator, onExit]);
```

(Notes:
- `mpPlayers` is the multiplayer players array in this screen (see line ~426). Use it, not `sp.players`.
- `isMultiplayer` gates the whole thing — single-player has no host.
- The unsubscribe + store reset + `onExit?.()` mirror the existing `handleSpectatorLeave` pattern from line 277.)

- [ ] **Step 3: Mount the banner**

In the returned JSX, immediately after the outermost root element opens (the file is large; find the `return (` block — typically returns a `<View>` or `<SafeAreaView>` wrapper), insert the banner as the FIRST child:

```tsx
      <HostLeftBanner
        visible={showHostLeftBanner}
        onLeave={handleHostLeftRescue}
      />
```

If the screen returns a Fragment with multiple children at the top, mount the banner as the first child of the Fragment.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep GameTableScreen | head -10`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/screens/GameTableScreen.tsx
git commit -m "feat(rescue): host-left banner in GameTable"
```

---

## Task 6: Mount banner in BettingPhase

**Files:**
- Modify: `src/components/betting/BettingPhase.tsx`

- [ ] **Step 1: Add imports**

Near the existing imports, add:

```ts
import { HostLeftBanner } from '../HostLeftBanner';
import { isHostAbsent } from '../../lib/hostAbsent';
```

(Note the `../` count — `BettingPhase.tsx` lives in `src/components/betting/`, so `HostLeftBanner.tsx` at `src/components/HostLeftBanner.tsx` is `../HostLeftBanner`, and `src/lib/hostAbsent.ts` is `../../lib/hostAbsent`.)

`useCallback`, `gameClient`, `useRoomStore` are already imported.

- [ ] **Step 2: Compute the flag and handler**

Inside the `BettingPhase` component body, near the existing `myPlayerId` derivation (around line 159) and `myPlayer` (line 167), add:

```ts
  const mpRoom = useRoomStore((s) => s.snapshot?.room ?? null);
  const mpPlayers = useRoomStore((s) => s.snapshot?.players ?? []);
  const hostAbsent = isMultiplayer && isHostAbsent({ room: mpRoom, players: mpPlayers });
  const isViewerHost = isMultiplayer && !!mpRoom && !!myPlayerId && mpRoom.host_session_id === myPlayerId;
  const showHostLeftBanner = !!hostAbsent && !isViewerHost;

  const handleHostLeftRescue = useCallback(async () => {
    const roomId = useRoomStore.getState().snapshot?.room?.id;
    if (!roomId) return;
    try {
      if (useRoomStore.getState().isSpectator) {
        await gameClient.leaveRoomAsSpectator(roomId);
      } else {
        await gameClient.leaveRoom(roomId);
      }
    } catch (err) {
      console.error('[HostLeftRescue:BettingPhase] leave failed:', err);
    }
    onClose?.();
  }, [onClose]);
```

(Notes:
- `BettingPhase` already uses `useRoomStore((s) => …)` selectors and inline `useRoomStore.getState()` reads in handlers — see lines 95, 275, 298. Match that style.
- The screen's exit callback prop name is likely `onClose` or `onExit` — search the file for one of these in the existing leave handlers (around lines 270-310) and use the same one. If the prop is named differently, substitute.
- If `room` and `players` are already destructured in scope under different names that BettingPhase uses for multiplayer state, prefer those over re-reading from the store.)

- [ ] **Step 3: Mount the banner**

In the returned JSX, find the outermost `<Pressable …>` overlay (line 528). The banner should mount as the FIRST child of that Pressable, BEFORE `<ActiveTurnPulseBorder …>`:

```tsx
      <HostLeftBanner
        visible={showHostLeftBanner}
        onLeave={handleHostLeftRescue}
      />
      <ActiveTurnPulseBorder active={isMyTurn && myBet === null} />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep BettingPhase | head -10`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/components/betting/BettingPhase.tsx
git commit -m "feat(rescue): host-left banner in BettingPhase"
```

---

## Task 7: Lint + smoke surface

**Files:**
- Modify (auto): `tests/TEST_TODO.md`

- [ ] **Step 1: Type-check src/ end-to-end**

Run: `npx tsc --noEmit 2>&1 | grep -vE "supabase/functions|node_modules|Deno" | grep "error TS" | head -10`
Expected: no output (no errors in src/).

- [ ] **Step 2: Run jest unit tests**

Run: `npx jest src/lib/__tests__/hostAbsent.test.ts 2>&1 | tail -5`
Expected: `Tests:  5 passed, 5 total`.

- [ ] **Step 3: Refresh TEST_TODO**

Run: `npm run test:lint -- --update-todo 2>&1 | tail -5`
Expected: exit 0; `tests/TEST_TODO.md refreshed`.

- [ ] **Step 4: Confirm new testIDs landed**

Run: `grep -E "host-left-banner|host-left-banner-leave" tests/TEST_TODO.md`
Expected: 2 entries listed.

- [ ] **Step 5: Commit + surface to user**

```bash
git add tests/TEST_TODO.md
git commit -m "chore(tests): refresh TEST_TODO for host-left banner"
```

Report:
> "All client code in place + jest unit tests for the helper pass. No DB or edge changes; nothing to deploy. Manual verification: open two tabs, host creates room, second player joins, host starts game and abruptly closes their tab — within a few seconds the banner appears in the second tab with red background and a single white Leave button. Tap → returns to Lobby."

---

## Done

Final user-facing summary:

1. New testIDs: `host-left-banner`, `host-left-banner-leave`.
2. 5 unit tests for `isHostAbsent` pass.
3. Banner mounted in WaitingRoomScreen + GameTableScreen + BettingPhase.
4. No prod deploys needed — `git push origin main` is the only release step.
