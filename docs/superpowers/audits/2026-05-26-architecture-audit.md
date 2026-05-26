# Nägels Online — Architecture Refactor Audit

**Date:** 2026-05-26
**Premise:** feature list essentially complete; ranked refactor opportunities (not new features).

## Highest-leverage refactors

### R1. Split `GameTableScreen.tsx` (2407 lines) into layered modules
- 44 hook calls, ~10 modals/banners conditionally rendered inline, table geometry math (`clockToScreen`, `getPlayerCardOffset` at 980-1029), trump color tables (944-955), a 250-line VM `useMemo` ending at 604 with 14 deps, 520 lines of JSX.
- **Target:** (a) `useGameTableVM(snapshot, isMultiplayer)` hook in `src/screens/gameTable/useGameTableVM.ts`; (b) presentational sub-components `<TopBar>`, `<TableSurface>`, `<MyHandTray>`, `<TrickOverlay>`, `<BannersStack>` each ≤200 lines; (c) `GameTableScreen` becomes ~150-line orchestrator. Geometry → pure functions in `src/screens/gameTable/geometry.ts`.
- **Effort:** 2-3 days. Do in slices: extract `useGameTableVM` first (mechanical, low risk), then peel banners, geometry last.
- **Pay-off:** Touched by every gameplay feature/fix. Single biggest source of cognitive load.

### R2. Consolidate "split RPC vs edge action" surface
- Frontend mixes both: `placeBet`/`playCard` through edge function, but `setMinCardsPerHand`/`switchRole`/`joinRoomAsSpectator`/`transferRating` go direct-to-RPC. **Direct-RPC calls bypass the broadcast pipeline** in `supabase/functions/game-action/index.ts:138-142` — other clients only learn of these mutations via heartbeat polling or page reload.
- Spectator-join has its own special-case in `gameClient.ts:195-213` (RPC + manual `get_room_state` + snapshot stitch), while player-join uses the edge function which auto-stitches.
- **Target:** rule — *any mutation that changes `RoomSnapshot` goes through `game-action`*; pure reads stay direct. Move `switch_role`, `set_min_cards_per_hand`, `join_room_as_spectator`, `leave_room_as_spectator` into the edge action switch.
- **Effort:** 1 day. New handler files wrap existing PL/pgSQL — don't rewrite the RPCs. Atomic edge deploy.
- **Pay-off:** Eliminates "why didn't my role-switch propagate?" bug class; collapses 6 special-case paths.

### R3. Replace `is_connected` boolean with derived freshness check
- `room_players.is_connected` is set to `true` on heartbeat but **never set back to `false`** by any code path — relies on cron cleanup + per-RPC `last_seen_at` filters scattered across 7 migrations (`20260520180000_filter_stale_spectators.sql`, `20260522080000_expose_avatar_url.sql`, `20260521005549_scorekeeper_mode.sql`, `20260523000000_conditional_stakes.sql`, etc.).
- **Confirmed live bug observed today:** host's tab died → `is_connected` stuck on true → host-left rescue couldn't detect it (required the `last_seen_at` staleness fix we just shipped).
- **Target:** drop the column. Compute `is_connected := now() - last_seen_at < interval '15s'` in a single SQL view or helper called from each RPC.
- **Effort:** 0.5 day. Add helper → rewrite each RPC's `jsonb_build_object` → drop column → remove `is_connected = true` writes. Snapshot type `_shared/types.ts:77` stays the same (server-internal change).
- **Pay-off:** Fixes the live bug structurally, kills 3-5 future "fix the next fix" migrations.

### R4. Collapse SP + MP state via a unified VM adapter layer
- `src/store/gameStore.ts` is 841 lines of SP engine + bot orchestration; `src/store/roomStore.ts` is 29 lines holding the server snapshot. Every consumer (`GameTableScreen.tsx`, `BettingPhase.tsx`, `ScoreboardModal.tsx`) has the same `if (isMultiplayer) read-snapshot else read-gameStore` branching. At least 250 lines of `vm` reconciliation plumbing exists across screens.
- **Target:** `useTableVM` selector layer that *always* returns the same `GameVM` shape, with adapters underneath: `adaptSnapshot(snapshot)` for MP, `adaptSp(gameStore)` for SP. Stores stay separate; consumers stop branching on `isMultiplayer`.
- **Effort:** 1-1.5 days, mostly mechanical. Pulling the 250-line `vm` memo out of `GameTableScreen` is the first version.
- **Pay-off:** Halves per-feature cost of any gameplay UI change. Pairs naturally with R1.

### R5. Replace `state_changed`-then-snapshot-refetch with delta-aware applies
- Every server mutation publishes `{event:'state_changed', version}` → each client calls `gameClient.refreshSnapshot(room_id)` → two RPC round-trips per action × N players. The actor's response already contains the new snapshot; only non-actors eat the round-trip.
- **Target (cheap, 0.5 day):** broadcast the snapshot in the payload (`{version, state}`); non-actors call `applySnapshot` directly. `my_hand` re-fetch can be skipped for actions that don't change anyone else's hand (most of them).
- **Target (pricier, 3+ days):** semantic events + client-side deltas. Probably not worth it for 2-6 player rooms.
- **Pay-off:** Cuts perceived "other player's turn → I see it" latency by ~150-400ms on mobile; ~3× fewer snapshot RPC calls.

## Mid-tier improvements

- **`WaitingRoomScreen.tsx` (1268)** and **`BettingPhase.tsx` (1316)** — same split pattern as R1, lower priority; extract chat/header sub-components first.
- **`ScoreboardModal.tsx` (969)** — `useState` after early return at line 199 (self-noted bug); lift state above visibility guard.
- **`AppNavigator.tsx` (635 lines, 35 `as any`)** — type the route param list once and delete the casts.
- **`require('../store/settingsStore')` inline imports** in `AppNavigator.tsx:150, 205, 222, 231, 234` — circular-import workaround; resolve the cycle.
- **Drop `supabase/migrations.legacy/`** — 26 files no longer applied, baseline contains everything. Move to `docs/history/` or delete.
- **130 `as any` total in src** — top 5 files: `AppNavigator` 35, `GameTableScreen` 22, `WaitingRoom` 16, `hostAbsent.test` 14, `gameClient` 6. The `gameClient.ts` ones (94-104, 292, 305, 312, 322) parse server payloads without narrowing — typed parser would prevent silent shape drift.
- **Snapshot type duplication** — `_shared/types.ts` imported from frontend via relative path crossing the supabase boundary (`gameClient.ts:5`). Move shared types to `src/shared/contracts.ts`; edge function imports *from* there.
- **Telemetry is just `console.*`** — 98 calls in `src/`, 5 in edge. Wrap in `logger.ts` with level + structured fields; makes future Sentry/Datadog a one-line swap.
- **Per-tab `isHost` recomputation** — derived in multiple components; centralize as `useIsHost()` selector.
- **`broadcastStateChanged`** opens a fresh realtime channel per action (`broadcast.ts:13-23`). On busy rooms this is O(N) handshakes/sec. Cache channel per edge-function instance.

## Don't-touch list

- **`src/game/rules.ts` + `src/game/engine.ts` shared-by-re-export pattern** — clean single source of truth, enforced by `.claude/rules/game-logic.md`. The "duplication" detected by `diff -q` is the re-export shim.
- **`gameStore.ts` SP internals** — passes `engine.test.ts` (599 lines of coverage). The pain is the MP boundary (R4), not internals.
- **`migrations/20260516185139_remote_schema_baseline.sql`** (1705 lines) — already a deliberate baseline-collapse of 30+ legacy migrations. Don't re-fragment.
- **Edge action file organization** — 19 files, none over 200 lines, one action per file. Cleanest part of the codebase.
- **Test pyramid** (50s smoke → 30min sanity → 60-90min demo:record) — well-tuned for solo dev. The gap is observability of failures, not coverage.
- **`authService.ts` (431 lines)** — long but cohesive and battle-tested through OAuth collision + cross-device work. High risk / low reward.

## Architectural debt heatmap

| Module | Lines | Density | Reason |
|---|---|---|---|
| `src/screens/GameTableScreen.tsx` | 2407 | **High** | 44 hooks, 14-dep VM memo, geometry + 10 modals inline |
| `src/screens/WaitingRoomScreen.tsx` | 1268 | High | Same shape as GameTable, less touched |
| `src/components/betting/BettingPhase.tsx` | 1316 | Medium-High | Standalone "screen" mis-classed as component |
| `src/screens/ScoreboardModal.tsx` | 969 | Medium | Hooks-after-early-return self-noted bug |
| `src/store/gameStore.ts` | 841 | Medium | Big but cohesive; pain is at MP boundary (R4) |
| `src/lib/gameClient.ts` | 400 | Medium | Mixed RPC/edge surface, payload-parse `as any` |
| `src/navigation/AppNavigator.tsx` | 635 | Medium | 35 `as any`, 4 `require()` cycle hacks |
| `src/lib/supabase/authService.ts` | 431 | Low-Medium | Long but stable; don't touch |
| `supabase/functions/game-action/actions/` | 1606 total | Low | Cleanly per-action, max 191 lines |
| `supabase/migrations/20260516185139_baseline.sql` | 1705 | Low | Squashed baseline, organized |
| `supabase/migrations.legacy/` | 26 files | Cosmetic | Confusing, deletable |
| `src/store/roomStore.ts` + `realtimeBroadcast.ts` | 140 | Medium | Refetch-on-every-broadcast pattern (R5) |
| Heartbeat / `is_connected` (server-wide) | scattered | **High** | Confirmed live bug (R3) |

## TL;DR
If only one frontend thing gets done: **R1 (split GameTableScreen)** — unblocks every future UI touch.
If only one backend thing gets done: **R3 (kill `is_connected`)** — fixes a real bug today, prevents future migration cycles.
R2 + R4 are best done together as a "consolidation week"; half cost vs separately.
