# Scoreboard Redesign — Design Spec

## Goal
Replace card-per-player scoreboard with a table layout showing full score history per round.

## Game Store Changes

### New type: `HandResult`
```typescript
interface HandResult {
  handNumber: number;
  startingPlayerIndex: number;
  results: {
    playerId: string;
    bet: number;
    tricksWon: number;
    points: number;
    bonus: number;
  }[];
}
```

### New store field: `scoreHistory: HandResult[]`
- Populated in `completeHand()` before transitioning to `scoring` phase
- Client-side only, no DB changes needed
- Reset on `reset()` / new game

## Scoreboard UI — Two Modes

### Compact (mid-game, 🏆 button)
- Single row: player names + total scores
- Sorted by score (leader first)
- "Show History" button at bottom toggles to Full mode
- Same modal container as current

### Full (end-of-round + toggle from compact)
- Table: columns = players, rows = rounds
- Bonus scores (>=10 points) circled in green
- ▶ next to first player each round
- "Total" row at bottom, bold
- Vertical scroll for many rounds
- "Continue" button at bottom

## Files to Modify
- `src/store/gameStore.ts` — add `scoreHistory`, populate in `completeHand()`
- `src/screens/ScoreboardModal.tsx` — full rewrite of render, keep swipe-to-close
- `src/screens/GameTableScreen.tsx` — pass `scoreHistory` to ScoreboardModal

## Theme Support
- All colors from `useTheme()` (already connected)
- Player names: `textPrimary`
- Bonus circle: `success` color
- Miss scores: `error` color
