# Freeze UX Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace native `window.confirm` (freeze + leave/end-game) with a styled in-app modal via an imperative `confirm()`; make the lobby returned-counter exclude the viewer themselves; and stop auto-entering a paused room on boot (return only via the lobby card).

**Architecture:** A zustand-backed imperative `confirm(opts): Promise<boolean>` resolves through a single mounted `<ConfirmRoot>` rendering a presentational `<ConfirmModal>` — so existing `window.confirm` call sites swap with a one-line `await confirm(...)` and keep their imperative shape. Two small client tweaks: lobby counter excludes self (via existing `get_my_session_id` RPC), and `tryRestoreActiveRoom` returns null for paused rooms.

**Tech Stack:** Expo React Native + TypeScript, zustand, i18next, Playwright smoke. **Client-only — no migration, no edge deploy.**

**Spec:** `docs/superpowers/specs/2026-05-30-freeze-ux-round2-design.md`

**Branch:** `feat/freeze-ux-round2` (created; spec committed there).

**Known-good facts (verified):** `common.cancel` + `common.confirm` already exist in i18n (no new keys needed — just verify all 4 locales). `leaveWithConfirm` uses existing `multiplayer.*ConfirmTitle/Body` keys. `get_my_session_id` RPC already exists (used in `activeRoom.ts:149`). App root render is in `src/App.tsx` (providers around `<AppNavigator/>`).

**Env:** memory-constrained Mac — no sanity/demo; one `npm run smoke` OK (needs `:8081` + local edge). `tsc` for typecheck.

---

## File Structure
- `src/components/ConfirmModal.tsx` (new) — presentational styled modal (mirrors PwaInstallModal).
- `src/lib/confirmDialog.tsx` (new) — `useConfirmStore` zustand store + `confirm()` function + `<ConfirmRoot>`.
- `src/App.tsx` — mount `<ConfirmRoot/>` once inside the providers.
- `src/lib/freezeWithConfirm.ts`, `src/lib/leaveWithConfirm.ts` — swap `window.confirm` → `await confirm(...)`.
- `src/screens/GameTableScreen.tsx`, `src/components/betting/BettingPhase.tsx` — swap the raw leave/end-game `window.confirm` → `await confirm(...)`.
- `src/screens/LobbyScreen.tsx` — counter excludes self via `get_my_session_id`.
- `src/lib/activeRoom.ts` — `tryRestoreActiveRoom` returns null for paused.
- `tests/smoke/freeze-game.spec.ts` — tap the modal confirm button instead of accepting a native dialog.

---

## Task 1: ConfirmModal + imperative confirm() service + mount

**Files:** Create `src/components/ConfirmModal.tsx`, `src/lib/confirmDialog.tsx`; modify `src/App.tsx`

- [ ] **Step 1: Verify common labels exist in all 4 locales.**
Run:
```bash
node -e "['en','ru','es','fr'].forEach(l=>{const c=require('./src/i18n/locales/'+l+'.json').common||{}; if(!c.cancel||!c.confirm) throw new Error('missing common.cancel/confirm in '+l)}); console.log('OK: common.cancel + common.confirm in all 4 locales')"
```
Expected: OK. (If missing in any locale, add `cancel`/`confirm` to that locale's `common` block — RU "Отмена"/"Подтвердить", ES "Cancelar"/"Confirmar", FR "Annuler"/"Confirmer" — before continuing.)

- [ ] **Step 2: Create `src/components/ConfirmModal.tsx`.**
Read `src/components/PwaInstallModal.tsx` first to mirror its `<Modal>` + backdrop + card structure and the real theme tokens (`useTheme().colors`, `Spacing/Radius/TextStyles` from `../constants`). Then create:
```tsx
import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../hooks/useTheme';
import { Spacing, Radius, TextStyles } from '../constants';

export interface ConfirmModalProps {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  visible, title, body, confirmLabel, cancelLabel, danger, onConfirm, onCancel,
}) => {
  const { colors } = useTheme();
  const confirmBg = danger ? colors.error : colors.accent;
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.6)' }]} testID="confirm-modal">
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
          <Text style={[styles.title, { color: colors.accent }]}>{title}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{body}</Text>
          <Pressable testID="btn-confirm-modal" onPress={onConfirm}
            style={[styles.btnPrimary, { backgroundColor: confirmBg }]}>
            <Text style={[styles.btnPrimaryText, { color: '#fff' }]}>{confirmLabel}</Text>
          </Pressable>
          <Pressable testID="btn-cancel-modal" onPress={onCancel} style={styles.btnGhost}>
            <Text style={[styles.btnGhostText, { color: colors.textSecondary }]}>{cancelLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  card: { width: '100%', maxWidth: 420, borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm },
  title: { ...TextStyles.h2, textAlign: 'center' },
  body: { ...TextStyles.body, textAlign: 'center' },
  btnPrimary: { paddingVertical: Spacing.sm, borderRadius: Radius.md, alignItems: 'center', marginTop: Spacing.sm },
  btnPrimaryText: { ...TextStyles.button },
  btnGhost: { paddingVertical: Spacing.sm, alignItems: 'center' },
  btnGhostText: { ...TextStyles.button },
});

export default ConfirmModal;
```
(If `TextStyles.h2`/`button` or `Radius.xl` differ, use the same tokens `PausedOverlay.tsx` uses — grep `src/constants`.)

- [ ] **Step 3: Create `src/lib/confirmDialog.tsx`** (store + `confirm()` + `<ConfirmRoot>`):
```tsx
import React from 'react';
import { create } from 'zustand';
import { ConfirmModal } from '../components/ConfirmModal';

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}

interface ConfirmState {
  req: ConfirmOptions | null;
  _resolve: ((v: boolean) => void) | null;
  open: (req: ConfirmOptions, resolve: (v: boolean) => void) => void;
  settle: (v: boolean) => void;
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  req: null,
  _resolve: null,
  open: (req, resolve) => set({ req, _resolve: resolve }),
  settle: (v) => {
    const r = get()._resolve;
    set({ req: null, _resolve: null });
    r?.(v);
  },
}));

/**
 * Styled replacement for window.confirm. Resolves true on confirm, false on
 * cancel/dismiss. A previously-pending request (if any) is resolved false first.
 */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const prev = useConfirmStore.getState()._resolve;
    if (prev) prev(false);
    useConfirmStore.getState().open(opts, resolve);
  });
}

/** Mount once at the app root. Renders the active confirm dialog, if any. */
export const ConfirmRoot: React.FC = () => {
  const req = useConfirmStore((s) => s.req);
  const settle = useConfirmStore((s) => s.settle);
  if (!req) return null;
  return (
    <ConfirmModal
      visible
      title={req.title}
      body={req.body}
      confirmLabel={req.confirmLabel}
      cancelLabel={req.cancelLabel}
      danger={req.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
};
```
(Confirm zustand's import style matches the repo — grep an existing store, e.g. `import { create } from 'zustand'` in `src/store/roomStore.ts`.)

- [ ] **Step 4: Mount `<ConfirmRoot/>` in `src/App.tsx`.**
Read `src/App.tsx` around the root render (the `<SafeAreaProvider><I18nextProvider>…<AppNavigator/>…` block, ~line 251). Add the import `import { ConfirmRoot } from './lib/confirmDialog';` and render `<ConfirmRoot />` as a sibling AFTER `<AppNavigator />` inside the providers so it overlays all screens:
```tsx
        <AppNavigator />
        <ConfirmRoot />
```
(Place it inside the same parent that wraps AppNavigator — match the actual JSX structure you see.)

- [ ] **Step 5: Typecheck.**
Run:
```bash
npx tsc --noEmit 2>&1 | grep -iE "ConfirmModal|confirmDialog|App.tsx" | grep -viE "esm.sh|Cannot find module 'https|Deno" || echo "OK: confirm service typechecks"
```
Expected: `OK: confirm service typechecks`.

- [ ] **Step 6: Commit.**
```bash
git add src/components/ConfirmModal.tsx src/lib/confirmDialog.tsx src/App.tsx
git commit -m "feat(ui): styled ConfirmModal + imperative confirm() service mounted at root"
```

---

## Task 2: Swap window.confirm → confirm() at the freeze + leave/end-game call sites

**Files:** `src/lib/freezeWithConfirm.ts`, `src/lib/leaveWithConfirm.ts`, `src/screens/GameTableScreen.tsx`, `src/components/betting/BettingPhase.tsx`

- [ ] **Step 1: freezeWithConfirm.** Replace the body of `src/lib/freezeWithConfirm.ts` with:
```ts
import type { TFunction } from 'i18next';
import { gameClient } from './gameClient';
import { confirm } from './confirmDialog';

/**
 * Confirm (anti-misclick + explain) via the styled in-app modal, then freeze.
 * Returns true iff the pause request succeeded.
 */
export async function freezeWithConfirm(roomId: string, t: TFunction): Promise<boolean> {
  const accepted = await confirm({
    title: t('freeze.confirmTitle'),
    body: t('freeze.confirmBody'),
    confirmLabel: t('freeze.button'),
    cancelLabel: t('common.cancel'),
  });
  if (!accepted) return false;
  const result = await gameClient.pauseGame(roomId);
  return result.ok === true;
}
```

- [ ] **Step 2: leaveWithConfirm.** In `src/lib/leaveWithConfirm.ts`, replace the `window.confirm` block with the styled `confirm`. Add `import { confirm } from './confirmDialog';` at the top, then replace the body's confirm section so it reads:
```ts
  const context: Context = opts.context ?? 'game';
  let titleKey: string;
  let bodyKey: string;
  if (context === 'room') {
    titleKey = opts.isHost ? 'multiplayer.leaveRoomHostConfirmTitle' : 'multiplayer.leaveRoomConfirmTitle';
    bodyKey = opts.isHost ? 'multiplayer.leaveRoomHostConfirmBody' : 'multiplayer.leaveRoomConfirmBody';
  } else {
    titleKey = opts.isHost ? 'multiplayer.endGameConfirmTitle' : 'multiplayer.leaveConfirmTitle';
    bodyKey = opts.isHost ? 'multiplayer.endGameConfirmBody' : 'multiplayer.leaveConfirmBody';
  }
  const accepted = await confirm({
    title: t(titleKey),
    body: t(bodyKey),
    confirmLabel: t('common.confirm'),
    cancelLabel: t('common.cancel'),
    danger: true,
  });
  if (!accepted) return false;
  const result = await gameClient.leaveRoom(roomId);
  return result.ok === true;
```
(Keep the function signature + the `Context` type + `gameClient` import; only the confirm mechanism changes. No more `typeof window.confirm` guard.)

- [ ] **Step 3: GameTableScreen raw confirms.** In `src/screens/GameTableScreen.tsx`, find the two raw confirm blocks (~lines 225, 255) of the form:
```ts
      const accept = typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(msg)
        : true;
```
Read each block to capture the title/body it builds (`msg` and any title). Replace each with an `await confirm({...})` using the same message text it already constructs (split into title/body if the code has both, else pass the message as `body` with an appropriate `title`), `confirmLabel: t('common.confirm')`, `cancelLabel: t('common.cancel')`, `danger: true`. Add `import { confirm } from '../lib/confirmDialog';`. Ensure the enclosing function is `async` (these handlers already `await` — verify). Example shape:
```ts
      const accept = await confirm({
        title: <the title key/text already used>,
        body: <the msg already used>,
        confirmLabel: t('common.confirm'),
        cancelLabel: t('common.cancel'),
        danger: true,
      });
      if (!accept) return;
```
Preserve whatever the existing code does on accept/decline.

- [ ] **Step 4: BettingPhase raw confirm.** In `src/components/betting/BettingPhase.tsx` (~line 331) apply the same swap as Step 3 (add `import { confirm } from '../../lib/confirmDialog';`).

- [ ] **Step 5: Typecheck + no stray window.confirm in the swapped files.**
Run:
```bash
npx tsc --noEmit 2>&1 | grep -iE "freezeWithConfirm|leaveWithConfirm|GameTableScreen|BettingPhase" | grep -viE "esm.sh|Cannot find module 'https|Deno" || echo "OK: swaps typecheck"
grep -rn "window.confirm" src/lib/freezeWithConfirm.ts src/lib/leaveWithConfirm.ts && echo "FAIL: window.confirm remains in helpers" || echo "OK: helpers use confirm()"
```
Expected: `OK: swaps typecheck` and `OK: helpers use confirm()`. (`window.confirm` may still exist in AdminRatingBlock/StakeSelector — out of scope, fine.)

- [ ] **Step 6: Commit.**
```bash
git add src/lib/freezeWithConfirm.ts src/lib/leaveWithConfirm.ts src/screens/GameTableScreen.tsx src/components/betting/BettingPhase.tsx
git commit -m "feat(ui): route freeze + leave/end-game confirms through the styled modal"
```

---

## Task 3: Lobby counter excludes the viewer

**Files:** `src/screens/LobbyScreen.tsx`

- [ ] **Step 1: Exclude self from the count.** In `fetchPausedRoom` (added round 1), where it computes `back`/`total` from `get_room_state`, also fetch the viewer's session id and exclude it. Replace the count computation with:
```ts
          const { getSupabaseClient } = await import('../lib/supabase/client');
          const supa = getSupabaseClient();
          const [{ data: snap }, { data: mySid }] = await Promise.all([
            supa.rpc('get_room_state', { p_room_id: active.room_id }),
            supa.rpc('get_my_session_id'),
          ]);
          const lineup: string[] = ((snap as any)?.room?.paused_lineup ?? []) as string[];
          const players: Array<{ session_id: string; last_seen_at: string }> = ((snap as any)?.players ?? []) as any[];
          const others = lineup.filter((sid) => sid !== mySid);
          const LIVE_MS = 30_000;
          total = others.length;
          back = others.filter((sid) => {
            const p = players.find((x) => x.session_id === sid);
            return !!p && (Date.now() - Date.parse(p.last_seen_at)) < LIVE_MS;
          }).length;
```
(Match the existing variable names / dynamic-import style already in the file from round 1 — read the current `fetchPausedRoom` first. `get_my_session_id` returns the caller's `room_sessions.id` as a uuid string, or null.)

- [ ] **Step 2: Typecheck.**
Run:
```bash
npx tsc --noEmit 2>&1 | grep -iE "LobbyScreen" || echo "OK: LobbyScreen typechecks"
```
Expected: `OK: LobbyScreen typechecks`.

- [ ] **Step 3: Commit.**
```bash
git add src/screens/LobbyScreen.tsx
git commit -m "fix(freeze): lobby counter excludes the viewer (host in lobby not counted as back)"
```

---

## Task 4: No auto-enter into a paused room on boot

**Files:** `src/lib/activeRoom.ts`

- [ ] **Step 1: Add the paused guard in tryRestoreActiveRoom.** In `src/lib/activeRoom.ts`, after the `phase === 'finished'` handling (~line 142-145) and before the session-id / navigation logic, add:
```ts
  // A paused room is "parked": never auto-navigate into it on boot/focus. The
  // lobby's frozen-room card is the only path back — the user opts in there.
  // (Do NOT clearActiveRoom — the room is valid; the lobby card reads it from
  // the server via get_my_active_room.)
  if (snapshot.room.phase === 'paused') {
    return null;
  }
```

- [ ] **Step 2: Typecheck.**
Run:
```bash
npx tsc --noEmit 2>&1 | grep -iE "activeRoom" || echo "OK: activeRoom typechecks"
```
Expected: `OK: activeRoom typechecks`.

- [ ] **Step 3: Commit.**
```bash
git add src/lib/activeRoom.ts
git commit -m "fix(freeze): do not auto-enter a paused room on boot (lobby card only)"
```

---

## Task 5: Update freeze smoke for the styled modal + full gate

**Files:** `tests/smoke/freeze-game.spec.ts`

- [ ] **Step 1: Replace the native-dialog accept with a modal-button tap.** In `tests/smoke/freeze-game.spec.ts`:
- Remove the line `pageA.on('dialog', (d) => d.accept());` (no native dialog now).
- After `await tap(pageA, 'btn-freeze-game', …)`, add a tap on the styled modal's confirm button before asserting the overlay:
```ts
    await tap(pageA, 'btn-confirm-modal', 10_000);
```
(Use the existing `tap` helper. The freeze button now opens `ConfirmModal` (testID `confirm-modal`, confirm button `btn-confirm-modal`); tapping it runs `pauseGame`.)

- [ ] **Step 2: Run the freeze spec.** Confirm dev server:
```bash
lsof -i :8081 >/dev/null 2>&1 && echo "8081 up" || echo "8081 DOWN — ask the user"
curl -s -o /dev/null -w "edge: %{http_code}\n" -X OPTIONS http://127.0.0.1:54321/functions/v1/game-action --max-time 5
```
If down → report BLOCKED. If up:
```bash
HEADLESS=1 npx playwright test tests/smoke/freeze-game.spec.ts 2>&1 | tail -15
```
Expected: 1 passed. (If the modal confirm button isn't found, the dispatchEvent-style tap may be needed for the RN-web Pressable — reuse the pattern already in this spec for the freeze button; check how the spec taps btn-freeze-game and mirror it for btn-confirm-modal.)

- [ ] **Step 3: Full smoke gate.** Run:
```bash
npm run smoke 2>&1 | grep -E "passed|failed|Tests:|Test Suites:|orphan" | tail -15
```
Expected: jest + all smoke + desktop green; no orphans. (If a leave/logo smoke flow now fails because it expected a native confirm, update it to tap `btn-confirm-modal` — but most leave flows in smoke either don't confirm or the test drives them differently; investigate any failure.)

- [ ] **Step 4: Commit.**
```bash
git add tests/smoke/freeze-game.spec.ts
git commit -m "test(smoke): tap styled confirm modal instead of native dialog"
```

---

## Task 6: Finish the branch

- [ ] **Step 1: Invoke `superpowers:finishing-a-development-branch`.** Deploy note: **client-only** — ships via frontend (Vercel) on push to main; no migration / no edge deploy.

---

## Self-Review

- **Spec §1 (styled ConfirmModal + imperative confirm + mount + swaps)** → Task 1 (modal/service/mount) + Task 2 (swaps). ✅
- **Spec §2 (counter excludes self via get_my_session_id)** → Task 3. ✅
- **Spec §3 (no auto-enter paused on boot)** → Task 4. ✅
- **Spec i18n (common.cancel/confirm reuse)** → Task 1 Step 1 (verify existing; no new keys, they exist). ✅
- **Spec testing (smoke taps modal button)** → Task 5. ✅
- **Type consistency:** `confirm(opts)` signature (`{title,body,confirmLabel,cancelLabel,danger?}`) defined Task 1, called identically in Task 2 (freeze/leave/raw). `ConfirmModal` props match `ConfirmRoot`'s usage. `useConfirmStore`/`ConfirmRoot`/`confirm` names consistent. testIDs `confirm-modal`/`btn-confirm-modal`/`btn-cancel-modal` defined Task 1, used in Task 5. `get_my_session_id` (existing RPC) used Task 3. ✅
- **Placeholder scan:** Task 2 Step 3/4 say "read each block to capture the title/body it builds" + "mirror the existing tap pattern" (Task 5) — bounded reads against named files/lines because the exact `msg` text and the spec's existing tap mechanism depend on current file state; each names the file + line + the shape to produce. Flagged for the implementer. No TBD/TODO. ✅
