# Pull-to-Refresh Game State Resync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add gesture-based pull-to-refresh on GameTableScreen so players can manually resync game state when Supabase Realtime silently drops events.

**Architecture:** A reusable `PullToRefresh` wrapper component uses `PanResponder` to detect downward swipes in the top zone of the screen. On trigger, it calls `refreshGameState()` (exported from `eventHandler.ts`) which fetches the latest `game_states` row from Supabase and applies it to the Zustand store. An `ActivityIndicator` at the top provides visual feedback. The wrapper is added to `GameTableScreen` in multiplayer mode only.

**Tech Stack:** React Native `PanResponder`, `Animated`, `ActivityIndicator`, Supabase query, Zustand

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/multiplayer/eventHandler.ts` | Modify | Export `refreshGameState` (currently private) |
| `src/hooks/useMultiplayer.ts` | Modify | Add `refreshGameState` action to hook return |
| `src/components/PullToRefresh.tsx` | Create | Gesture detection + spinner indicator |
| `src/screens/GameTableScreen.tsx` | Modify | Wrap game content with `PullToRefresh` |

---

### Task 1: Export `refreshGameState` from eventHandler

**Files:**
- Modify: `src/lib/multiplayer/eventHandler.ts:214`

- [ ] **Step 1: Make `refreshGameState` exported**

In `src/lib/multiplayer/eventHandler.ts`, change line 214 from:

```typescript
async function refreshGameState(roomId: string): Promise<void> {
```

to:

```typescript
export async function refreshGameState(roomId: string): Promise<void> {
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors related to `refreshGameState`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/multiplayer/eventHandler.ts
git commit -m "feat: export refreshGameState from eventHandler"
```

---

### Task 2: Add `refreshGameState` to `useMultiplayer` hook

**Files:**
- Modify: `src/hooks/useMultiplayer.ts`

- [ ] **Step 1: Import `refreshGameState`**

In `src/hooks/useMultiplayer.ts`, add `refreshGameState` to the import from `eventHandler`:

```typescript
import {
  subscribeToRoomEvents,
  unsubscribeFromRoomEvents,
  refreshGameState,
} from '../lib/multiplayer/eventHandler';
```

- [ ] **Step 2: Add `refreshGameState` to the `UseMultiplayerReturn` interface**

Add to the interface (after `refreshRoom`):

```typescript
  refreshGameState: () => Promise<void>;
```

- [ ] **Step 3: Create the handler**

Add after the `handleRefreshRoom` callback (around line 184):

```typescript
  const handleRefreshGameState = useCallback(async () => {
    if (!currentRoom?.id) return;
    await refreshGameState(currentRoom.id);
  }, [currentRoom?.id]);
```

- [ ] **Step 4: Add to the return object**

In the return object, after `refreshRoom: handleRefreshRoom,`:

```typescript
    refreshGameState: handleRefreshGameState,
```

- [ ] **Step 5: Verify no TypeScript errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useMultiplayer.ts
git commit -m "feat: expose refreshGameState in useMultiplayer hook"
```

---

### Task 3: Create `PullToRefresh` component

**Files:**
- Create: `src/components/PullToRefresh.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/PullToRefresh.tsx` with the following content:

```tsx
/**
 * PullToRefresh — gesture-based pull-to-refresh without ScrollView.
 *
 * Uses PanResponder to detect a downward swipe starting in the top
 * zone of the screen.  Shows an ActivityIndicator while refreshing.
 */

import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  PanResponder,
  Animated,
  ActivityIndicator,
  StyleSheet,
  type GestureResponderEvent,
  type PanResponderGestureState,
  type ViewStyle,
} from 'react-native';

const ACTIVATION_ZONE_Y = 100; // px from top of component
const PULL_THRESHOLD = 60;     // px to drag before triggering
const DEBOUNCE_MS = 2000;      // minimum interval between refreshes

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  enabled?: boolean;
  children: React.ReactNode;
  style?: ViewStyle;
}

export const PullToRefresh: React.FC<PullToRefreshProps> = ({
  onRefresh,
  enabled = true,
  children,
  style,
}) => {
  const [refreshing, setRefreshing] = useState(false);
  const lastRefreshRef = useRef(0);
  const pullDistance = useRef(new Animated.Value(0)).current;
  const startY = useRef(0);

  const handleRefresh = useCallback(async () => {
    const now = Date.now();
    if (now - lastRefreshRef.current < DEBOUNCE_MS) return;
    lastRefreshRef.current = now;

    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
      Animated.timing(pullDistance, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [onRefresh, pullDistance]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (
        evt: GestureResponderEvent,
        gestureState: PanResponderGestureState,
      ) => {
        if (!enabled || refreshing) return false;
        // Only capture if touch started in the top activation zone
        const touchStartY = evt.nativeEvent.pageY - gestureState.dy;
        if (touchStartY > ACTIVATION_ZONE_Y) return false;
        // Only capture downward swipes (dy > 10 filters out taps)
        return gestureState.dy > 10 && Math.abs(gestureState.dx) < gestureState.dy;
      },

      onPanResponderGrant: (_evt, gestureState) => {
        startY.current = gestureState.y0;
      },

      onPanResponderMove: (_evt, gestureState) => {
        if (gestureState.dy > 0) {
          // Dampen the pull — max visual travel is PULL_THRESHOLD
          const clamped = Math.min(gestureState.dy, PULL_THRESHOLD);
          pullDistance.setValue(clamped);
        }
      },

      onPanResponderRelease: (_evt, gestureState) => {
        if (gestureState.dy >= PULL_THRESHOLD) {
          handleRefresh();
        } else {
          Animated.timing(pullDistance, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }).start();
        }
      },

      onPanResponderTerminate: () => {
        Animated.timing(pullDistance, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  return (
    <View style={[styles.container, style]} {...panResponder.panHandlers}>
      {/* Pull indicator */}
      <Animated.View
        style={[
          styles.indicator,
          {
            opacity: pullDistance.interpolate({
              inputRange: [0, PULL_THRESHOLD * 0.5, PULL_THRESHOLD],
              outputRange: [0, 0.5, 1],
            }),
            transform: [{ translateY: pullDistance.interpolate({
              inputRange: [0, PULL_THRESHOLD],
              outputRange: [-30, 0],
            }) }],
          },
        ]}
      >
        <ActivityIndicator size="small" color="#888" />
      </Animated.View>

      {/* Refreshing indicator (stays visible during fetch) */}
      {refreshing && (
        <View style={styles.refreshingBar}>
          <ActivityIndicator size="small" color="#888" />
        </View>
      )}

      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  indicator: {
    position: 'absolute',
    top: 4,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  refreshingBar: {
    position: 'absolute',
    top: 4,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
});
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/PullToRefresh.tsx
git commit -m "feat: add PullToRefresh gesture component"
```

---

### Task 4: Integrate PullToRefresh into GameTableScreen

**Files:**
- Modify: `src/screens/GameTableScreen.tsx`

- [ ] **Step 1: Add imports**

Add to the imports at the top of `GameTableScreen.tsx`:

```typescript
import { PullToRefresh } from '../components/PullToRefresh';
import { refreshGameState } from '../lib/multiplayer/eventHandler';
```

- [ ] **Step 2: Add refresh handler**

Inside the `GameTableScreen` component, after the existing `currentRoom` selector (around line 151), add:

```typescript
  const handlePullRefresh = useCallback(async () => {
    if (!currentRoom?.id) return;
    await refreshGameState(currentRoom.id);
  }, [currentRoom?.id]);
```

Also add `useCallback` to the React import at line 7 if not already present.

- [ ] **Step 3: Wrap the SafeAreaView content**

Change the render from:

```tsx
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>

      {/* Connection Status (multiplayer only) */}
      {isMultiplayer && <ConnectionStatus />}

      {/* Top Bar — ... */}
```

to:

```tsx
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <PullToRefresh onRefresh={handlePullRefresh} enabled={isMultiplayer}>

      {/* Connection Status (multiplayer only) */}
      {isMultiplayer && <ConnectionStatus />}

      {/* Top Bar — ... */}
```

And before the closing `</SafeAreaView>` (line 1042), add:

```tsx
      </PullToRefresh>
    </SafeAreaView>
```

So the structure becomes `SafeAreaView > PullToRefresh > [all game content]`.

- [ ] **Step 4: Verify no TypeScript errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/screens/GameTableScreen.tsx
git commit -m "feat: integrate pull-to-refresh on game table screen"
```

---

### Task 5: Manual verification with demo

- [ ] **Step 1: Run the 2-player demo**

```bash
DEMO_URL=https://nigels.online DEMO_SLOW=10 npm run demo
```

Verify the game plays through without regressions — pull-to-refresh should not interfere with normal card play, betting, or button taps.

- [ ] **Step 2: Manual browser test (if dev server available)**

Open the game in a browser, start a multiplayer game. During gameplay, swipe down from the top of the screen. Verify:
- A spinner briefly appears at the top
- The game state is unchanged (since it's already in sync)
- No navigation occurs, no page reload
- Cards, bets, and turns continue working normally

- [ ] **Step 3: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: pull-to-refresh integration adjustments"
```
