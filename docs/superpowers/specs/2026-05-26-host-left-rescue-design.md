# Host-Left Rescue — Design Spec

**Date:** 2026-05-26
**Status:** Approved (pre-implementation)
**Related:** backlog entry "Leave-room rescue when host already left" (Akula, 2026-05-26)

## 1. Problem

The server already lets any player leave any room — `supabase/functions/game-action/actions/leaveRoom.ts` allows `target === actor.session_id` unconditionally. The client even has the right call (`gameClient.leaveRoom`). The bug is in the UI: when the host has already left but the auto-eject signal didn't reach this client (frozen hand, dropped broadcast, stale realtime sub), the regular player is stuck on `GameTableScreen` (or `BettingPhase`, or `WaitingRoomScreen`) with no escape. Akula hit this himself 2026-05-26 and could not finish testing the previous shipped feature.

The fix is a safety-net banner that appears whenever the room's host is no longer in `room_players`, regardless of why, with a single tap to leave.

## 2. Scope and decisions

In scope:

- A new `HostLeftBanner` component, mounted at the top of three screens: `WaitingRoomScreen`, `GameTableScreen`, `BettingPhase`.
- A shared helper `isHostAbsent({room, players})` in `src/lib/hostAbsent.ts` so the three call sites compute the signal the same way.
- One-tap leave (no confirm dialog) — the banner is itself the explicit prompt.
- Banner uses `pointerEvents="box-none"` so taps on empty space below pass through; the user can still interact with the game while the banner is visible.
- Two new i18n keys: `multiplayer.hostLeftBannerText`, `multiplayer.hostLeftBannerCta`.

Out of scope:

- Auto-leave without user click. Even with confidence in the signal, a banner-with-button gives the user control and a moment to copy chat or screenshot the table.
- Server-side fixes for why broadcasts can be lost. This is a UI safety-net; the underlying realtime/broadcast reliability is a separate, larger problem.
- Showing the banner to the host themselves (`room.host_session_id === myPlayerId`). Hosts have their own exit UX (the logo tap, the gear menu) and never need this rescue.
- Showing the banner in single-player. SP has no host concept.
- Showing the banner before the game starts when the room hasn't yet had a host (impossible state by the schema, but the helper returns `false` for null `host_session_id` defensively).

## 3. Architecture

A tiny stateless component plus a pure helper. No new RPCs, no schema changes, no edge function changes.

```
roomStore.snapshot.room  ┐
roomStore.snapshot.players ─→  isHostAbsent({room, players})  →  showBanner: boolean
viewer.myPlayerId ─→  isViewerHost  ─→  showBanner = absent && !host
                                              │
                                              ▼
                                      <HostLeftBanner visible onLeave={…} />
                                              │
                                              ▼
                              gameClient.leaveRoom(id)   (player)
                              gameClient.leaveRoomAsSpectator(id)  (spectator)
                              unsubscribeRoom()
                              useRoomStore.reset()
                              onExit()
```

Banner is `position: absolute; top: 0; zIndex: 1000` with `pointerEvents="box-none"` on the outer wrapper so non-button taps fall through to the screen beneath.

## 4. Component — `src/components/HostLeftBanner.tsx`

```tsx
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
          accessibilityLabel={t('multiplayer.hostLeftBannerCta', 'Leave room')}
          style={({ pressed }) => [styles.btn, { backgroundColor: '#ffffff', opacity: pressed ? 0.75 : 1 }]}
        >
          <Text style={[styles.btnText, { color: colors.error }]}>
            {t('multiplayer.hostLeftBannerCta', 'Leave room')}
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

## 5. Helper — `src/lib/hostAbsent.ts`

```ts
import type { RoomSnapshot } from '../../supabase/functions/_shared/types.ts';

export function isHostAbsent(
  snap: Pick<RoomSnapshot, 'room' | 'players'>,
): boolean {
  const room = snap.room;
  if (!room?.host_session_id) return false;
  return !snap.players.some((p) => p.session_id === room.host_session_id);
}
```

Defensive: returns `false` when there is no room or no host_session_id (impossible-but-cheap guard against an empty/initial snapshot).

## 6. Integration — same pattern in three screens

Each of `WaitingRoomScreen.tsx`, `GameTableScreen.tsx`, `BettingPhase.tsx` adds:

```tsx
import { HostLeftBanner } from '../components/HostLeftBanner';
import { isHostAbsent } from '../lib/hostAbsent';

// inside component body, alongside existing room/players/myPlayerId reads:
const hostAbsent = isHostAbsent({ room, players });
const isViewerHost = !!room && !!myPlayerId && room.host_session_id === myPlayerId;
const showHostLeftBanner = hostAbsent && !isViewerHost;

const handleHostLeftRescue = useCallback(async () => {
  if (!room?.id) return;
  try {
    if (iAmSpectator) {
      await gameClient.leaveRoomAsSpectator(room.id);
    } else {
      await gameClient.leaveRoom(room.id);
    }
  } catch (err) {
    console.error('[HostLeftRescue] leave failed:', err);
  }
  unsubscribeRoom();
  useRoomStore.getState().reset();
  onExit?.();
}, [room?.id, iAmSpectator, onExit]);
```

And at the top of the returned JSX (right inside the outermost container, before any other absolute-positioned overlays):

```tsx
<HostLeftBanner
  visible={showHostLeftBanner}
  onLeave={handleHostLeftRescue}
/>
```

The exact name `iAmSpectator` may differ per screen (each already computes this; e.g. `WaitingRoomScreen` has `isSpectator`, `GameTableScreen` has its own). Use the screen's existing flag verbatim; the helper just maps it to the right RPC.

Each screen already imports `useCallback`, `gameClient`, `useRoomStore` and provides an `onExit` prop. No new imports beyond the two component/helper additions per screen.

## 7. i18n

Add two keys under existing `multiplayer.*` block in en/ru/es:

```
multiplayer.hostLeftBannerText  — "Host left the room." / "Хост вышел из комнаты." / "El anfitrión salió de la sala."
multiplayer.hostLeftBannerCta   — "Leave room" / "Покинуть комнату" / "Salir de la sala"
```

If `multiplayer.leaveRoom` already exists with the same Russian/English/Spanish text, reuse it for `Cta`; otherwise add new.

## 8. Testing and side effects

- No DB or edge changes; smoke unaffected.
- `npm run test:lint -- --update-todo` will pick up two new static testIDs: `host-left-banner`, `host-left-banner-leave`. Surface to the user.
- No external side effects — banner is local UI; `leaveRoom` already exists and was tested by past smoke runs.

## 9. Manual verification plan

1. Open two browser tabs, both signed in (different accounts; one is host).
2. Host creates a room, second player joins, host starts the game.
3. From host's tab, close the tab abruptly (simulate uncoordinated disconnect).
4. On the second tab, within a few seconds the banner should appear with red background and a single white "Leave room" button.
5. Tap the button → second tab returns to Lobby; previous broken state is cleared.

## 10. Edge cases

- **Spectator viewer**: `room.host_session_id` is a player's session, never a spectator's, so `isHostAbsent` works the same. Spectator gets the banner with the same wording; tap routes through `leaveRoomAsSpectator` instead of `leaveRoom`.
- **Race: host rejoins after leaving**: `room_players` re-acquires the host's session_id, `isHostAbsent` flips back to false, banner unmounts on next render. No harm done.
- **Game already finished normally** (`room.phase === 'finished'` after last hand): host is still in `room_players` until they tap "Exit" on the post-game scoreboard. Banner does NOT show in this case — `hostAbsent` only triggers when host is genuinely missing from the players list.
- **Banner overlaps with existing modals** (post-game scoreboard, settings drawer): `zIndex: 1000` keeps it on top. Acceptable; the rescue exit is more important than scoreboard UX.
- **No `myPlayerId` (rare boot moment)**: `isViewerHost` is `false`, banner shows. If the user is actually the host but their `myPlayerId` hasn't loaded yet, they see a momentary rescue banner — tapping it just leaves the room normally. Harmless transient.
