# Chat Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a transient tooltip with a message preview above the sender's player card whenever a chat message arrives from another player while the chat panel is closed. Tap opens chat.

**Architecture:** A standalone Zustand store (`chatTooltipStore`) holds `Record<sessionId, Tooltip>`. Module-scope timers auto-dismiss after 5s. A hook (`useChatToastListener`) mounted per host screen subscribes to the chat-message stream, filters self/spectator/out-of-room/chat-open, and calls `show()`. A presentational `<PlayerChatTooltip>` reads its own slot from the store and renders an absolutely-positioned `Animated.View` above its anchor. Each opponent's `profileCard` gets the tooltip wrapper. Opening the chat calls `dismissAll()`.

**Tech Stack:** React Native + react-native-web (Expo SDK 51), TypeScript, Zustand, jest (unit) + Playwright (smoke).

**Spec:** `docs/superpowers/specs/2026-05-18-chat-tooltip-design.md`

---

## Task 1: chatTooltipStore + unit tests (TDD)

**Files:**
- Create: `src/store/chatTooltipStore.ts`
- Create: `src/store/__tests__/chatTooltipStore.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `src/store/__tests__/chatTooltipStore.test.ts`:

```ts
import { useChatTooltipStore, TOOLTIP_DURATION_MS } from '../chatTooltipStore';

describe('chatTooltipStore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useChatTooltipStore.getState().dismissAll();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('show() adds a tooltip keyed by sessionId', () => {
    useChatTooltipStore.getState().show('s1', 'hi');
    expect(useChatTooltipStore.getState().tooltips.s1).toMatchObject({ body: 'hi' });
  });

  it('tooltip auto-dismisses after TOOLTIP_DURATION_MS', () => {
    useChatTooltipStore.getState().show('s1', 'hi');
    jest.advanceTimersByTime(TOOLTIP_DURATION_MS - 1);
    expect(useChatTooltipStore.getState().tooltips.s1).toBeDefined();
    jest.advanceTimersByTime(2);
    expect(useChatTooltipStore.getState().tooltips.s1).toBeUndefined();
  });

  it('repeated show() for same sessionId replaces body and resets the timer', () => {
    useChatTooltipStore.getState().show('s1', 'first');
    jest.advanceTimersByTime(4000);
    useChatTooltipStore.getState().show('s1', 'second');
    jest.advanceTimersByTime(4000);
    expect(useChatTooltipStore.getState().tooltips.s1?.body).toBe('second');
    jest.advanceTimersByTime(1500);
    expect(useChatTooltipStore.getState().tooltips.s1).toBeUndefined();
  });

  it('different sessionIds have independent timers', () => {
    useChatTooltipStore.getState().show('s1', 'a');
    jest.advanceTimersByTime(2000);
    useChatTooltipStore.getState().show('s2', 'b');
    jest.advanceTimersByTime(3500);
    expect(useChatTooltipStore.getState().tooltips.s1).toBeUndefined();
    expect(useChatTooltipStore.getState().tooltips.s2?.body).toBe('b');
  });

  it('dismiss() removes a single entry', () => {
    useChatTooltipStore.getState().show('s1', 'hi');
    useChatTooltipStore.getState().show('s2', 'yo');
    useChatTooltipStore.getState().dismiss('s1');
    expect(useChatTooltipStore.getState().tooltips.s1).toBeUndefined();
    expect(useChatTooltipStore.getState().tooltips.s2?.body).toBe('yo');
  });

  it('dismissAll() clears every entry and timers do not fire afterwards', () => {
    useChatTooltipStore.getState().show('s1', 'a');
    useChatTooltipStore.getState().show('s2', 'b');
    useChatTooltipStore.getState().dismissAll();
    expect(useChatTooltipStore.getState().tooltips).toEqual({});
    jest.advanceTimersByTime(TOOLTIP_DURATION_MS + 100);
    expect(useChatTooltipStore.getState().tooltips).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/chatTooltipStore.test.ts`
Expected: FAIL with "Cannot find module '../chatTooltipStore'".

- [ ] **Step 3: Implement the store**

Create `src/store/chatTooltipStore.ts`:

```ts
import { create } from 'zustand';

export const TOOLTIP_DURATION_MS = 5000;

export interface Tooltip {
  body: string;
  ts: number;
}

interface ChatTooltipState {
  tooltips: Record<string, Tooltip>;
  show: (sessionId: string, body: string) => void;
  dismiss: (sessionId: string) => void;
  dismissAll: () => void;
}

// Module-scope timers so they survive store re-creations during HMR and
// don't get serialized into state. One timer per sessionId.
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(sessionId: string): void {
  const t = timers.get(sessionId);
  if (t !== undefined) {
    clearTimeout(t);
    timers.delete(sessionId);
  }
}

export const useChatTooltipStore = create<ChatTooltipState>((set, get) => ({
  tooltips: {},
  show: (sessionId, body) => {
    clearTimer(sessionId);
    timers.set(
      sessionId,
      setTimeout(() => get().dismiss(sessionId), TOOLTIP_DURATION_MS),
    );
    set((s) => ({
      tooltips: { ...s.tooltips, [sessionId]: { body, ts: Date.now() } },
    }));
  },
  dismiss: (sessionId) => {
    clearTimer(sessionId);
    set((s) => {
      if (!(sessionId in s.tooltips)) return s;
      const next = { ...s.tooltips };
      delete next[sessionId];
      return { tooltips: next };
    });
  },
  dismissAll: () => {
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    set({ tooltips: {} });
  },
}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/chatTooltipStore.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/chatTooltipStore.ts src/store/__tests__/chatTooltipStore.test.ts
git commit -m "feat(chat): chatTooltipStore with auto-dismiss timers

Module-scope timer Map keeps timers stable across HMR; show() replaces
existing entry and resets timer; dismissAll() for chat-opened cleanup."
```

---

## Task 2: PlayerChatTooltip presentational component

**Files:**
- Create: `src/components/PlayerChatTooltip.tsx`

This is a render-only component. No new store/hook tests — covered by smoke later.

- [ ] **Step 1: Create the component**

Create `src/components/PlayerChatTooltip.tsx`:

```tsx
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useChatTooltipStore } from '../store/chatTooltipStore';
import { useTheme } from '../hooks/useTheme';
import { Radius, Spacing } from '../constants';

export interface PlayerChatTooltipProps {
  sessionId: string;
  onPress: () => void;
}

export const PlayerChatTooltip: React.FC<PlayerChatTooltipProps> = ({
  sessionId,
  onPress,
}) => {
  const tooltip = useChatTooltipStore((s) => s.tooltips[sessionId]);
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;
  const visible = !!tooltip;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 4,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, opacity, translateY]);

  if (!tooltip) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          opacity,
          transform: [{ translateX: -50 }, { translateY }],
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        testID={`chat-tooltip-${sessionId}`}
        style={[
          styles.bubble,
          {
            backgroundColor: colors.surface,
            borderColor: colors.glassLight,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.body, { color: colors.textPrimary }]}
        >
          {tooltip.body}
        </Text>
      </Pressable>
      <View
        style={[
          styles.arrow,
          { borderTopColor: colors.surface },
        ]}
      />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: '100%',
    left: '50%',
    marginBottom: 4,
    width: 100, // anchor width — translateX:-50 centers it; actual bubble width below
    alignItems: 'center',
    zIndex: 50,
  },
  bubble: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.md,
    borderWidth: 1,
    maxWidth: 200,
    minWidth: 80,
  },
  body: {
    fontSize: 12,
    lineHeight: 16,
  },
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
```

- [ ] **Step 2: Sanity-check TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors related to the new file.

- [ ] **Step 3: Commit**

```bash
git add src/components/PlayerChatTooltip.tsx
git commit -m "feat(chat): PlayerChatTooltip presentational component

Animated bubble above anchor; reads its sessionId slot from chatTooltipStore."
```

---

## Task 3: useChatToastListener hook

**Files:**
- Create: `src/hooks/useChatToastListener.ts`

- [ ] **Step 1: Create the hook**

Create `src/hooks/useChatToastListener.ts`:

```ts
import { useEffect } from 'react';
import { useChatStore } from '../store/chatStore';
import { useRoomStore } from '../store/roomStore';
import { useChatTooltipStore } from '../store/chatTooltipStore';

const PREVIEW_LIMIT = 60;

interface Args {
  selfSessionId: string | null;
  isChatOpen: boolean;
}

/**
 * Mount once per host screen that renders player containers (Waiting/
 * Betting/GameTable, mobile + desktop). Subscribes to chatStore and
 * pushes a tooltip into chatTooltipStore for each incoming message
 * that should surface above its sender's card.
 *
 * On unmount, clears every tooltip so timers from a previous room
 * don't fire on a new screen.
 */
export function useChatToastListener({ selfSessionId, isChatOpen }: Args): void {
  useEffect(() => {
    let lastSeenId: string | null = useChatStore.getState().messages.at(-1)?.id ?? null;

    const unsub = useChatStore.subscribe((state) => {
      const last = state.messages.at(-1);
      if (!last || last.id === lastSeenId) return;
      lastSeenId = last.id;

      if (isChatOpen) return;
      if (selfSessionId && last.sessionId === selfSessionId) return;
      if (last.fromSpectator === true) return;

      const players = useRoomStore.getState().snapshot?.players ?? [];
      const senderInRoom = players.some((p) => p.session_id === last.sessionId);
      if (!senderInRoom) return;

      const body =
        last.body.length > PREVIEW_LIMIT
          ? `${last.body.slice(0, PREVIEW_LIMIT)}…`
          : last.body;
      useChatTooltipStore.getState().show(last.sessionId, body);
    });

    return () => {
      unsub();
      useChatTooltipStore.getState().dismissAll();
    };
  }, [selfSessionId, isChatOpen]);
}
```

- [ ] **Step 2: Sanity-check TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useChatToastListener.ts
git commit -m "feat(chat): useChatToastListener subscribes chatStore → tooltipStore

Filters self/spectator/out-of-room senders; suppressed when chat open;
dismisses all on unmount so stale timers cannot leak across rooms."
```

---

## Task 4: Wire into GameTableScreen (covers mobile + desktop game table)

**Files:**
- Modify: `src/screens/GameTableScreen.tsx`

The desktop wrapper (`DesktopGameLayout`) renders `<GameTableScreen hideChat=… />` in its center pane, so the listener/tooltip wiring inside GameTableScreen automatically applies to desktop too. The chat-open flag for desktop comes from the existing `desktopUI?.chatVisible` context.

- [ ] **Step 1: Add imports near other imports (around `src/screens/GameTableScreen.tsx:26-27`)**

Locate the existing `import { ChatPanel }` line. Add **immediately after the existing chat-related imports**:

```tsx
import { PlayerChatTooltip } from '../components/PlayerChatTooltip';
import { useChatToastListener } from '../hooks/useChatToastListener';
import { useChatTooltipStore } from '../store/chatTooltipStore';
```

- [ ] **Step 2: Mount the listener inside the component body, just below the existing `const [showChat, setShowChat] = useState(false);` line (around `:536`)**

Add:

```tsx
useChatToastListener({
  selfSessionId: vm.myPlayer?.id ?? null,
  isChatOpen: desktopUI ? !!desktopUI.chatVisible : showChat,
});
```

> `vm.myPlayer?.id` is the local session id used by every other component on this screen. `desktopUI?.chatVisible` is undefined on mobile → falls back to `showChat`.

- [ ] **Step 3: Wrap the opponent profileCard at the existing render site (around `:1300-1322`)**

Find the block:
```tsx
<View
  key={player.id}
  style={[styles.opponentContainer, { top: positionStyle.top, left: positionStyle.left } as any]}
>
  <View style={[styles.profileCard, ...]}>
    ...
  </View>
</View>
```

Add `<PlayerChatTooltip>` as a sibling **inside the outer `opponentContainer` View**, right after the inner profileCard `</View>`. The `opponentContainer` is the absolutely-positioned wrapper, so positioning the tooltip relative to it places the bubble above the card. Replace the block exactly with:

```tsx
<View
  key={player.id}
  style={[styles.opponentContainer, { top: positionStyle.top, left: positionStyle.left } as any]}
>
  <View style={[styles.profileCard, /* existing styles unchanged */]}>
    {/* existing children unchanged */}
  </View>
  <PlayerChatTooltip
    sessionId={player.id}
    onPress={() => {
      if (desktopUI) {
        if (!desktopUI.chatVisible) desktopUI.toggleChat();
      } else {
        setShowChat(true);
      }
      useChatTooltipStore.getState().dismissAll();
    }}
  />
</View>
```

Keep the inner profileCard's `style` array and children identical to the current code. Only the outer wrapper gains the new sibling.

- [ ] **Step 4: Dismiss tooltips when the mobile chat opens via the existing chat button (`:1151`)**

Find the line:
```tsx
else setShowChat(true);
```

Replace with:
```tsx
else {
  setShowChat(true);
  useChatTooltipStore.getState().dismissAll();
}
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run test:lint`
Expected: exit 0; new testID `chat-tooltip-…` will appear as **uncovered** — that's expected, smoke test in Task 7 will reference it.

- [ ] **Step 6: Commit**

```bash
git add src/screens/GameTableScreen.tsx
git commit -m "feat(chat): chat tooltip above opponents in GameTable

Listener mounted in the screen; tooltip wraps each opponent card; tap
opens chat (modal mobile / right pane desktop) and dismisses all
tooltips. Desktop chat-open detection via desktopUI.chatVisible."
```

---

## Task 5: Wire into WaitingRoomScreen (covers mobile + desktop waiting room)

**Files:**
- Modify: `src/screens/WaitingRoomScreen.tsx`

The desktop wrapper `DesktopWaitingRoom` always shows the inline chat in the right pane and renders `<WaitingRoomScreen hideChat />`. We treat `hideChat===true` as "chat is permanently visible elsewhere" — so suppress tooltips.

- [ ] **Step 1: Add imports near the existing ChatPanel/chatStore imports (around `:37-39`)**

Add:

```tsx
import { PlayerChatTooltip } from '../components/PlayerChatTooltip';
import { useChatToastListener } from '../hooks/useChatToastListener';
import { useChatTooltipStore } from '../store/chatTooltipStore';
```

- [ ] **Step 2: Mount the listener below the existing `const [showChat, setShowChat] = useState(false);` (line `:80`)**

Locate the props destructure: `hideChat` is already an existing prop on `WaitingRoomScreen`. If not yet destructured, ensure it is (search file for `hideChat`). Then add:

```tsx
useChatToastListener({
  selfSessionId: myPlayerId,
  isChatOpen: !!hideChat || showChat,
});
```

> `myPlayerId` is already pulled from `useRoomStore` in this screen (verify near the top of the component). `!!hideChat` covers the desktop-wrapper case.

- [ ] **Step 3: Find the player chip render site and wrap each non-self player**

Search the file for the loop that maps over `players` to render chips (look for `player.session_id` and avatar / name composition). Wrap each chip's outer `View` like Task 4 — add `<PlayerChatTooltip>` as a sibling **inside the chip's outer container**, after its content View. Skip your own row:

```tsx
{players.map((p) => (
  <View key={p.session_id} style={styles.playerChip}>
    {/* existing chip content unchanged */}
    {p.session_id !== myPlayerId && (
      <PlayerChatTooltip
        sessionId={p.session_id}
        onPress={() => {
          setShowChat(true);
          useChatTooltipStore.getState().dismissAll();
        }}
      />
    )}
  </View>
))}
```

If the chip wrapper does not already have `position: 'relative'` or absolute positioning, the tooltip's `position: 'absolute'` will still anchor to the nearest positioned ancestor — confirm visually after running.

> On desktop, `hideChat===true` blocks the listener entirely, so the `onPress` here is only ever invoked on mobile (where `setShowChat` is the right setter). No desktop branch needed.

- [ ] **Step 4: Dismiss tooltips when the mobile chat button opens chat (`:305`)**

Find:
```tsx
onPress={() => setShowChat(true)}
```

Replace with:
```tsx
onPress={() => {
  setShowChat(true);
  useChatTooltipStore.getState().dismissAll();
}}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/screens/WaitingRoomScreen.tsx
git commit -m "feat(chat): chat tooltip above other players in WaitingRoom

Listener and tooltip wraps; hideChat (desktop wrapper) is treated as
chat-open to suppress tooltips when the right-pane chat is showing."
```

---

## Task 6: Wire into BettingPhase

**Files:**
- Modify: `src/components/betting/BettingPhase.tsx`

- [ ] **Step 1: Add imports near `:27-30`**

```tsx
import { PlayerChatTooltip } from '../PlayerChatTooltip';
import { useChatToastListener } from '../../hooks/useChatToastListener';
import { useChatTooltipStore } from '../../store/chatTooltipStore';
```

- [ ] **Step 2: Mount listener after the `const [showChat, setShowChat] = useState(false);` line (`:212`)**

```tsx
useChatToastListener({
  selfSessionId: myPlayer?.session_id ?? null,
  isChatOpen: showChat,
});
```

- [ ] **Step 3: Find each opponent row inside the betting list and wrap with tooltip**

Locate the rendering of opponent rows / chips inside BettingPhase (search for `players.map` or similar). For each non-self row, append:

```tsx
{p.session_id !== myPlayer?.session_id && (
  <PlayerChatTooltip
    sessionId={p.session_id}
    onPress={() => {
      setShowChat(true);
      useChatTooltipStore.getState().dismissAll();
    }}
  />
)}
```

inside the row's outer container.

- [ ] **Step 4: Dismiss tooltips when the chat button opens chat (`:677`)**

Find:
```tsx
onPress={() => setShowChat(true)}
```

Replace:
```tsx
onPress={() => {
  setShowChat(true);
  useChatTooltipStore.getState().dismissAll();
}}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/betting/BettingPhase.tsx
git commit -m "feat(chat): chat tooltip above other players in BettingPhase"
```

---

## Task 7: Desktop chat-toggle also dismisses tooltips

**Files:**
- Modify: `src/screens/desktop/DesktopGameLayout.tsx`

The right-pane toggle is `toggleChat()` (line `:110`). When it opens chat, dismiss all tooltips. When it closes chat, do nothing (tooltips fade naturally; new arrivals can fire again).

- [ ] **Step 1: Add import near the top imports**

```tsx
import { useChatTooltipStore } from '../../store/chatTooltipStore';
```

- [ ] **Step 2: Patch `toggleChat` (`:110`)**

Find:
```tsx
toggleChat: () => setChatVisible((v) => !v),
```

Replace with:
```tsx
toggleChat: () =>
  setChatVisible((v) => {
    const next = !v;
    if (next) useChatTooltipStore.getState().dismissAll();
    return next;
  }),
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/screens/desktop/DesktopGameLayout.tsx
git commit -m "feat(chat): dismiss tooltips when desktop chat pane opens"
```

---

## Task 8: Smoke test

**Files:**
- Create: `tests/smoke/chat-tooltip.spec.ts`

The smoke harness already supports two-guest WaitingRoom interactions. Pattern follows `tests/smoke/` neighbors.

- [ ] **Step 1: Look at an existing smoke spec for the boilerplate**

Run: `ls tests/smoke/ | head` and read one of them (e.g. `tests/smoke/chat-...spec.ts` if any, otherwise `tests/smoke/lobby-basics.spec.ts`) for the project's preferred two-player setup. Match its imports and fixtures.

- [ ] **Step 2: Write the spec**

Create `tests/smoke/chat-tooltip.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import {
  enterLobbyAsGuest,
  createRoomAsHost,
  joinRoomByCode,
} from '../fixtures/multiplayer';

test('chat tooltip surfaces a message above the sender card and opens chat on tap', async ({ browser }) => {
  const ctxA = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const ctxB = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await enterLobbyAsGuest(pageA, { nickname: 'Alpha' });
  await enterLobbyAsGuest(pageB, { nickname: 'Bravo' });

  const code = await createRoomAsHost(pageA, { players: 2 });
  await joinRoomByCode(pageB, code);

  // Find Alpha's session id from her snapshot — exposed via the
  // chat-tooltip testID once she speaks.
  await pageA.locator('[data-testid="btn-open-chat"]').first().click();
  await pageA.locator('[data-testid="chat-input"]').first().fill('hello bravo');
  await pageA.locator('[data-testid="chat-send"]').first().click();
  await pageA.locator('[data-testid="chat-close"]').first().click();

  // Bravo sees the tooltip — match by prefix since we don't have the
  // raw sessionId from this side without leaking the room snapshot.
  const tooltip = pageB.locator('[data-testid^="chat-tooltip-"]').first();
  await tooltip.waitFor({ state: 'visible', timeout: 5_000 });
  await expect(tooltip).toContainText('hello bravo');

  await tooltip.click();

  // Chat opens on Bravo's side.
  await pageB.locator('[data-testid="chat-input"]').first().waitFor({ state: 'visible', timeout: 5_000 });

  // Tooltip is gone.
  await expect(pageB.locator('[data-testid^="chat-tooltip-"]')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

test('chat tooltip auto-dismisses after 5 seconds', async ({ browser }) => {
  const ctxA = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const ctxB = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await enterLobbyAsGuest(pageA, { nickname: 'Alpha' });
  await enterLobbyAsGuest(pageB, { nickname: 'Bravo' });
  const code = await createRoomAsHost(pageA, { players: 2 });
  await joinRoomByCode(pageB, code);

  await pageA.locator('[data-testid="btn-open-chat"]').first().click();
  await pageA.locator('[data-testid="chat-input"]').first().fill('quick');
  await pageA.locator('[data-testid="chat-send"]').first().click();
  await pageA.locator('[data-testid="chat-close"]').first().click();

  const tooltip = pageB.locator('[data-testid^="chat-tooltip-"]').first();
  await tooltip.waitFor({ state: 'visible', timeout: 5_000 });
  // After ~6s the tooltip should be gone (5s lifetime + 200ms fade-out).
  await pageB.waitForTimeout(6500);
  await expect(pageB.locator('[data-testid^="chat-tooltip-"]')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
```

If the existing two-player smoke fixtures use slightly different names (e.g. `enterAsGuest` vs `enterLobbyAsGuest`, `joinRoomByCode` vs `joinRoom`), adjust the imports to match. The shape of the test stays the same.

- [ ] **Step 3: Confirm dev server is running on :8081**

Run: `lsof -i :8081 | head -3`
Expected: at least one node process listening. If empty, ask the user to start `npx expo start --port 8081` before continuing — per CLAUDE.md, don't auto-start it.

- [ ] **Step 4: Run only the new smoke spec**

Run: `npx playwright test tests/smoke/chat-tooltip.spec.ts --reporter=list`
Expected: both tests pass. If the first run fails for layout reasons (tooltip clipped off-screen by an `overflow: hidden` ancestor), the trace under `test-results/` reveals where — adjust the tooltip's `zIndex` or check that the wrapping `opponentContainer`/`playerChip` does not clip overflow. Fix and re-run.

- [ ] **Step 5: Run the smoke suite to ensure no regressions**

Run: `npm run smoke`
Expected: all green (smoke is ~50s).

- [ ] **Step 6: Refresh test:lint TODO so the new testID is recorded**

Run: `npm run test:lint -- --update-todo`
Then: `git status` — if `tests/TEST_TODO.md` changed, include it in the commit.

- [ ] **Step 7: Commit**

```bash
git add tests/smoke/chat-tooltip.spec.ts tests/TEST_TODO.md
git commit -m "test(smoke): chat tooltip — appears, opens chat on tap, auto-dismisses"
```

---

## Self-review notes

- **Spec coverage:**
  - Goal/non-goals — covered by component design + listener filters.
  - Trigger filters (self/spectator/out-of-room/chat-open) — Task 3 listener.
  - Burst replace + reset timer — Task 1 unit test + store implementation.
  - 5s duration, fade-in/out — Task 1 (timer) + Task 2 (Animated).
  - 60-char preview — Task 3.
  - Tap target = bubble only — Task 2 (no `Pressable` on profileCard).
  - Suppression when chat is open — Task 3 `isChatOpen` arg.
  - Mobile vs desktop chat-open detection — Task 4 `desktopUI?.chatVisible` fallback.
  - Spectator anchor skip — Task 3 `last.fromSpectator === true` filter.
  - dismissAll on chat open — Tasks 4, 5, 6, 7.
  - Player-left-mid-game — Task 3 `senderInRoom` check.
  - HMR/unmount cleanup — Task 3 useEffect cleanup.
  - Unit tests — Task 1.
  - Smoke tests — Task 8 (visible + tap + auto-dismiss).
- **Placeholder scan:** none found; every step shows code or exact commands.
- **Type consistency:** `tooltips`, `show`, `dismiss`, `dismissAll`, `TOOLTIP_DURATION_MS`, `PlayerChatTooltipProps`, `useChatToastListener` are used consistently between definition (Task 1-3) and consumers (Tasks 4-8).
