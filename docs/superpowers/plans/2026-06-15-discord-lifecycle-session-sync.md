# Discord Lifecycle & Session Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (B) Stop the offline game resetting when the layout swaps on the `useIsDesktop` breakpoint (Discord chat shrink / browser resize), and (A) freeze the multiplayer game promptly when a player leaves the Discord Activity, by feeding the existing freeze path off Discord participant updates.

**Architecture:** (B) is removing a stray unmount-time `sp.reset()` so a remount preserves the gameStore. (A) adds a pure participant-diff helper plus a Discord-gated hook that, on a participant leaving while you're in a room, forces an immediate snapshot resync (the same `refreshSnapshot` + heartbeat that focus-reconnect uses) so heartbeat staleness / host-absent surfaces a poll sooner. Everything in (A) is `isDiscordActivity()`-gated; heartbeat staleness stays as the always-on fallback.

**Tech Stack:** Expo (React Native) + react-native-web, TypeScript, Zustand, `@discord/embedded-app-sdk`, jest (ts-jest).

**Spec:** `docs/superpowers/specs/2026-06-15-discord-lifecycle-session-sync-design.md`

**Branch:** continue on `feat/discord-activity`.

---

## File Structure

- Modify: `src/screens/GameTableScreen.tsx` — remove the SP-init unmount reset (B); mount the new participant-sync hook (A).
- Modify: `src/screens/WaitingRoomScreen.tsx` — mount the new participant-sync hook (A).
- Create: `src/lib/discord/participants.ts` — pure `diffParticipants` + the `useDiscordParticipantSync` hook (A).
- Create: `src/lib/discord/__tests__/participants.test.ts` — jest tests for the pure diff (A).

---

## Task 1 (Part B): offline game survives a layout remount

**Files:**
- Modify: `src/screens/GameTableScreen.tsx`

The single-player init effect (around line 344) returns a cleanup `() => { sp.reset(); }` (line ~357). On a layout swap the screen unmounts and that wipes the gameStore. The explicit exit handlers already reset: `handleExit` (~line 238) and `handleLogoLeave` (~line 272) both call `sp.reset()`. So the unmount reset is redundant for real exits and harmful on remounts.

- [ ] **Step 1: Audit the SP exit paths (read-only)**

Read `src/screens/GameTableScreen.tsx`. Confirm both SP-exit handlers reset:
- the Exit button handler near line 238 (`try { sp.reset(); } catch {}` then `onExit?.()`),
- the logo-leave handler near line 272 (`try { sp.reset(); } catch {}` then `onExit?.()`).
Also grep for any other navigation away from an SP game that does NOT route through these (e.g. a "play again"/restart that re-inits). Report what you find. If a real exit path is found that does NOT reset and relied on the unmount cleanup, add an explicit `sp.reset()` there in Step 2.

- [ ] **Step 2: Remove the unmount reset**

The SP-init effect currently ends:
```tsx
    sp.initGame(gamePlayers, 'player-0');
    setTimeout(() => sp.startBetting(), 500);
    return () => {
      sp.reset();
    };
  }, [isMultiplayer]);
```
Change it to drop the cleanup (the init guard `if (sp.players.length > 0) return` already prevents re-init on remount, so the running game is preserved):
```tsx
    sp.initGame(gamePlayers, 'player-0');
    setTimeout(() => sp.startBetting(), 500);
    // No unmount cleanup: a layout swap (useIsDesktop breakpoint flip when the
    // Discord chat shrinks the Activity, or a browser resize) unmounts this
    // screen, and resetting here wiped the in-memory game. Real exits reset via
    // handleExit / handleLogoLeave instead.
  }, [isMultiplayer]);
```
(Add explicit `sp.reset()` to any non-resetting exit path found in Step 1.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `src/screens/GameTableScreen.tsx`.

- [ ] **Step 4: Run the unit suite**

Run: `npm run test:unit`
Expected: all pass (no behavior change in logic; this only removes an unmount side-effect).

- [ ] **Step 5: Commit**

```bash
git add src/screens/GameTableScreen.tsx
git commit -m "fix(game): don't reset the offline game on unmount (survives layout remount)"
```

Manual verification (deferred to the device pass, Task 5): in Discord desktop, start a bot game, open/close the Discord chat (cross the breakpoint) → game persists. Also resize a desktop browser across 1024px mid-bot-game → game persists.

---

## Task 2 (Part A): pure participant-diff helper

**Files:**
- Create: `src/lib/discord/participants.ts`
- Test: `src/lib/discord/__tests__/participants.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/discord/__tests__/participants.test.ts
import { diffParticipants } from '../participants';

describe('diffParticipants', () => {
  it('reports ids that were present before but not now', () => {
    const prev = new Set(['a', 'b', 'c']);
    const r = diffParticipants(prev, ['a', 'c']);
    expect(r.left).toEqual(['b']);
    expect([...r.next].sort()).toEqual(['a', 'c']);
  });

  it('reports no departures when everyone stays or joins', () => {
    const prev = new Set(['a']);
    const r = diffParticipants(prev, ['a', 'b']);
    expect(r.left).toEqual([]);
    expect([...r.next].sort()).toEqual(['a', 'b']);
  });

  it('handles an empty previous set', () => {
    const r = diffParticipants(new Set<string>(), ['a']);
    expect(r.left).toEqual([]);
    expect([...r.next]).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- src/lib/discord/__tests__/participants.test.ts`
Expected: FAIL — cannot find module `../participants`.

- [ ] **Step 3: Implement the pure helper**

```ts
// src/lib/discord/participants.ts
// Discord Activity participant tracking → prompt freeze. The pure diff is
// unit-tested; the hook below wires it to the SDK + snapshot resync.

/** Given the previous id set and the new id list, return who left + the new set. */
export function diffParticipants(prev: Set<string>, nextIds: string[]): { next: Set<string>; left: string[] } {
  const next = new Set(nextIds);
  const left: string[] = [];
  for (const id of prev) {
    if (!next.has(id)) left.push(id);
  }
  return { next, left };
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm run test:unit -- src/lib/discord/__tests__/participants.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/discord/participants.ts src/lib/discord/__tests__/participants.test.ts
git commit -m "feat(discord): pure participant-diff helper"
```

---

## Task 3 (Part A): `useDiscordParticipantSync` hook

**Files:**
- Modify: `src/lib/discord/participants.ts`

A Discord-gated hook (mirroring `useReconnectOnFocus`) that subscribes to the
Activity's participant updates and, when anyone leaves while you're in a room,
forces an immediate snapshot resync — so the existing staleness/host-absent
freeze surfaces a poll sooner. Best-effort: if the SDK/subscribe is unavailable
it no-ops and the heartbeat fallback still works.

- [ ] **Step 1: Add the hook to `participants.ts`**

```ts
import { useEffect, useRef } from 'react';
import { useRoomStore } from '../../store/roomStore';
import { gameClient } from '../gameClient';
import { getSupabaseClient } from '../supabase/client';
import { isDiscordActivity } from './context';
import { getDiscordSdk } from './bootstrap';

// Discord SDK event for instance participant changes. Verified in Task 5.
const PARTICIPANTS_UPDATE = 'ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE';

/**
 * While in a room inside a Discord Activity, watch the voice-channel
 * participants. When someone leaves, force an immediate snapshot resync so the
 * existing freeze/host-absent detection fires without waiting out the heartbeat
 * staleness window. Mount once per room screen (next to useReconnectOnFocus).
 */
export function useDiscordParticipantSync(): void {
  const roomId = useRoomStore((s) => s.snapshot?.room?.id);
  const lastResync = useRef(0);

  useEffect(() => {
    if (!roomId) return;
    if (!isDiscordActivity()) return;
    const sdk = getDiscordSdk() as any;
    if (!sdk?.subscribe || !sdk?.commands?.getInstanceConnectedParticipants) return;

    let prev = new Set<string>();
    let active = true;

    const resync = () => {
      const now = Date.now();
      if (now - lastResync.current < 1000) return; // debounce churn
      lastResync.current = now;
      const supabase = getSupabaseClient();
      Promise.resolve(supabase.rpc('heartbeat', { p_room_id: roomId })).catch(() => {});
      void gameClient.refreshSnapshot(roomId);
    };

    const toIds = (payload: any): string[] =>
      (payload?.participants ?? []).map((p: any) => String(p?.id ?? p?.user?.id)).filter(Boolean);

    const onUpdate = (payload: any) => {
      if (!active) return;
      const { next, left } = diffParticipants(prev, toIds(payload));
      prev = next;
      if (left.length > 0) resync();
    };

    // Seed the initial set, then subscribe.
    Promise.resolve(sdk.commands.getInstanceConnectedParticipants())
      .then((p: any) => { if (active) prev = new Set(toIds(p)); })
      .catch(() => {});
    try { sdk.subscribe(PARTICIPANTS_UPDATE, onUpdate); } catch (e) { console.warn('[Discord] participant subscribe failed', e); }

    return () => {
      active = false;
      try { sdk.unsubscribe?.(PARTICIPANTS_UPDATE, onUpdate); } catch {}
    };
  }, [roomId]);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `src/lib/discord/participants.ts`.

- [ ] **Step 3: Run the unit suite (import-safety)**

Run: `npm run test:unit`
Expected: all pass — `participants.ts` is import-safe in jest (the hook isn't invoked; `getDiscordSdk()` returns null off-Discord, and the diff test still passes).

- [ ] **Step 4: Commit**

```bash
git add src/lib/discord/participants.ts
git commit -m "feat(discord): participant-sync hook — resync snapshot when a player leaves the Activity"
```

---

## Task 4 (Part A): mount the hook in the room screens

**Files:**
- Modify: `src/screens/GameTableScreen.tsx`
- Modify: `src/screens/WaitingRoomScreen.tsx`

`useReconnectOnFocus()` is already mounted in both (GameTableScreen ~line 164, WaitingRoomScreen ~line 174). Mount the new hook right beside it.

- [ ] **Step 1: GameTableScreen**

Add the import near the other `../lib/discord/*` imports:
```ts
import { useDiscordParticipantSync } from '../lib/discord/participants';
```
And call it next to `useReconnectOnFocus();` (~line 164):
```ts
  useReconnectOnFocus();
  useDiscordParticipantSync();
```

- [ ] **Step 2: WaitingRoomScreen**

Add the import near the existing `useReconnectOnFocus` import (~line 34):
```ts
import { useDiscordParticipantSync } from '../lib/discord/participants';
```
And call it next to `useReconnectOnFocus();` (~line 174):
```ts
  useReconnectOnFocus();
  useDiscordParticipantSync();
```

- [ ] **Step 3: Typecheck + unit + lint**

Run: `npx tsc --noEmit && npm run test:unit && npm run test:lint`
Expected: clean; no new testID orphans.

- [ ] **Step 4: Commit**

```bash
git add src/screens/GameTableScreen.tsx src/screens/WaitingRoomScreen.tsx
git commit -m "feat(discord): mount participant-sync in the room screens"
```

---

## Task 5: verify in Discord + on resize (manual)

No commit unless a fix is needed.

- [ ] **Step 1: Confirm the SDK event name/shape**

Rebuild `dist/` (the tunnel loop) and launch the Activity. In the Activity DevTools console, confirm `ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE` is the right event and that the payload exposes participant ids in the shape `toIds` expects (`participants[].id` or `participants[].user.id`). If the event name or shape differs, fix the constant / `toIds` in `participants.ts`, re-deploy, re-check. If the SDK requires an OAuth scope we didn't request to receive participant updates, fall back to: subscribe is skipped, heartbeat staleness still freezes (Part A degrades gracefully — note this outcome).

- [ ] **Step 2: Part B — game survives layout change**

In Discord desktop, start a bot game. Open and close the Discord channel chat (which shrinks/grows the Activity across the breakpoint). The game must persist (no reset to a fresh hand). Then resize a normal desktop browser across 1024px mid-bot-game → game persists.

- [ ] **Step 3: Part A — prompt freeze on exit**

Two devices in one multiplayer room (both in the Activity). One closes the Activity / leaves the voice channel. The other should see the room freeze/host-absent **promptly** (noticeably faster than before — within a second or two, not the full staleness window).

---

## Final verification (before any merge toward prod)

- [ ] `npm run test:unit` — green (incl. the new participant tests).
- [ ] `npm run smoke` — web path unchanged (Part A is `isDiscordActivity()`-gated; Part B only removes an unmount side-effect that doesn't change normal play). Run once local Supabase + memory allow.

## Notes for the implementer

- Part A is best-effort and `isDiscordActivity()`-gated; web/PWA is unchanged. Part B affects all platforms but only removes a harmful unmount reset (the running game is preserved; real exits still reset).
- **Deferred follow-up (not in this plan):** the precise "instant host-absent freeze" via mapping a departed Discord id to the host player needs `discord_id` surfaced in the room snapshot (a `get_room_state` change + redeploy). The MVP here resyncs on any departure, which is enough to accelerate detection without a backend change. Log it if the MVP isn't crisp.
- Don't stage unrelated WIP (`tests/TEST_TODO.md`, untracked `scripts/`, `assets/marketing/`).
- The tunnel rig is the manual-verification surface; prod stays untouched until the Vercel quota is resolved.
