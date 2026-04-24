# Pull-to-Refresh Game State Resync

## Problem

Supabase Realtime can silently drop events — a player's client misses a state update (e.g. card played, turn advanced) and doesn't know it's their turn. The game freezes for everyone with no recovery path except leaving the room.

## Solution

Gesture-based pull-to-refresh on GameTableScreen. Swiping down from the top of the screen fetches the latest `game_state` snapshot from the server and replaces local state. No page reload, no navigation change, no channel re-subscription.

## Components

### 1. `PullToRefresh` wrapper component

Location: `src/components/PullToRefresh.tsx`

- Uses `PanResponder` to detect downward swipe gesture
- Activation zone: top ~100px of screen only (avoids conflicts with cards and buttons in thumb zone)
- Activation threshold: ~60px downward drag
- Shows a small spinner/arrow indicator at the top of the screen during loading
- Spinner disappears when data loads
- No ScrollView — preserves the fixed circular game layout

### 2. Refresh logic

- Calls existing `refreshGameState()` from `eventHandler.ts` — queries `game_states` table ordered by version DESC
- Result applied via `gameStore.setRemoteState()` with version check
- Purely a data fetch — no page reload, no navigation, room and game preserved

### 3. Constraints

- Debounce: maximum once per 2 seconds
- Multiplayer only (no-op in single-player)
- Non-blocking: rest of UI remains interactive during fetch

## What's NOT included

- Automatic heartbeat/polling (future iteration)
- Channel re-subscription
- Event replay
- Any form of page/app reload

## Key files

- `src/components/PullToRefresh.tsx` — new wrapper component
- `src/screens/GameTableScreen.tsx` — wrap game content with PullToRefresh
- `src/lib/multiplayer/eventHandler.ts` — existing `refreshGameState()` used as-is
- `src/store/gameStore.ts` — existing `setRemoteState()` used as-is
