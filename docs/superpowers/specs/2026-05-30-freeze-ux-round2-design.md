# Freeze UX round 2 — styled confirm modal, counter-excludes-self, no auto-enter paused

Date: 2026-05-30
Status: Approved (design)
Builds on: the shipped host-freeze feature + `2026-05-30-freeze-ux-polish-design.md`

## Problem

Three follow-ups after the first freeze-UX polish shipped:
1. **Native `window.confirm` for freeze (and leave/end-game) looks foreign in-game.** Replace it with a styled, branded in-app modal — for the freeze confirmation AND the existing leave/end-game confirmations.
2. **The lobby "вернулись N из M" counter counts the viewer themselves.** A host sitting in the lobby has a briefly-fresh `last_seen_at`, so they appear "back" even though they're in the lobby, not the room. The viewer of the lobby card is by definition not in the room and must not be counted.
3. **On boot the host is auto-redirected into the paused room.** `tryRestoreActiveRoom` navigates straight into a paused room. The desired flow: land in the lobby, see the frozen-room card, and tap it to return — the lobby card is the ONLY path back into a paused room.

All three are **client-only** (no migration, no edge): #2 reuses the existing `get_my_session_id` RPC.

## 1. Styled confirm modal replacing window.confirm

Architecture: an imperative `confirm()` backed by a single mounted styled modal, so the many existing `window.confirm` call sites swap with a one-line change and keep their imperative `await` shape.

- **`src/components/ConfirmModal.tsx`** (new): presentational modal mirroring `PwaInstallModal` (`<Modal transparent animationType="fade" onRequestClose>` + dimmed backdrop + brand card). Props: `{ visible, title, body, confirmLabel, cancelLabel, danger?, onConfirm, onCancel }`. `danger` tints the confirm button with `colors.error` (for End-game/Leave). testIDs: `confirm-modal`, `btn-confirm-modal`, `btn-cancel-modal`.
- **`src/lib/confirmDialog.ts`** (new): a module singleton holding the current request + a subscriber, exposing `confirm(opts: { title; body; confirmLabel?; cancelLabel?; danger? }): Promise<boolean>`. Calling it sets the pending request (resolving any prior one as `false`) and returns a promise resolved by the modal's confirm (`true`) / cancel/dismiss (`false`). A `<ConfirmRoot>` component subscribes and renders `ConfirmModal`.
- **Mount `<ConfirmRoot>` once** near the app root in `src/App.tsx` (top level, so it overlays all screens including modals/overlays).
- **Swap call sites** from `window.confirm(...)` to `await confirm({...})`:
  - `src/lib/freezeWithConfirm.ts` — `confirm({ title: t('freeze.confirmTitle'), body: t('freeze.confirmBody'), confirmLabel: t('freeze.button'), cancelLabel: t('common.cancel') })`.
  - `src/lib/leaveWithConfirm.ts` — `confirm({ title: t(titleKey), body: t(bodyKey), confirmLabel: t('common.leave'|'common.end'), cancelLabel: t('common.cancel'), danger: true })`.
  - The raw `window.confirm` leave/end-game prompts in `GameTableScreen.tsx` (~225, ~255) and `BettingPhase.tsx` (~331) — same swap to `await confirm({...})`.
- **Out of scope:** `window.confirm` in `AdminRatingBlock.tsx` and `StakeSelector.tsx` (admin-reset / guest-hint, not leave/end-game) — left as-is; optional later.
- **Non-DOM/SSR guard:** `confirm()` works in any RN context (the modal is a React component). The old `typeof window.confirm === 'function'` guards are removed in the swapped helpers (the styled modal replaces them); if no `ConfirmRoot` is mounted (shouldn't happen), `confirm()` resolves `false` after a tick rather than hanging.

## 2. Lobby returned-counter excludes the viewer

In `src/screens/LobbyScreen.tsx`'s `fetchPausedRoom` (added in round 1):
- Also fetch the viewer's own session id via the existing `get_my_session_id` RPC
  (`getSupabaseClient().rpc('get_my_session_id')`), once, alongside the
  `get_room_state` fetch.
- Compute over OTHER lineup members only:
  `others = paused_lineup.filter(sid => sid !== mySessionId)`;
  `total = others.length`; `back = others.filter(live within 30s).length`.
- Render `freeze.returnedCount` only when `total > 0`.
- Result: the host (or any viewer) sitting in the lobby is never counted as
  "back"; the counter shows how many of the OTHER original players are present.

## 3. No auto-enter into a paused room on boot

In `src/lib/activeRoom.ts` `tryRestoreActiveRoom`, after the existing
`phase === 'finished'` handling (~line 145) and before the navigation logic, add:
```ts
  // A paused room is "parked": never auto-navigate into it on boot/focus.
  // The lobby's frozen-room card is the only path back — the user opts in there.
  if (snapshot.room.phase === 'paused') {
    return null;
  }
```
Effect: on boot/focus the user lands on the default screen (lobby), where the
frozen-room card (round 1) surfaces the paused room via `get_my_active_room`, and
tapping it runs the existing in-card return path (get_room_state → applySnapshot →
subscribeRoom → navigate GameTable). Do NOT `clearActiveRoom()` here — the room is
valid and parked; the lobby card reads it from the server, not the cache.

## i18n

The native `window.confirm` had no custom button labels (OS-provided OK/Cancel),
so the styled modal needs explicit confirm/cancel labels. Grep first for existing
equivalents (`grep -rn "\"cancel\"\|\"confirm\"\|common\." src/i18n/locales/en.json`)
and reuse them if present; otherwise add a `common` namespace with these keys
(× EN/RU/ES/FR, identical key sets):
- `common.cancel` — RU "Отмена" / EN "Cancel" / ES "Cancelar" / FR "Annuler"
- `common.confirm` — RU "Подтвердить" / EN "Confirm" / ES "Confirmar" / FR "Confirmer"

Label mapping at the call sites:
- Freeze: `confirmLabel = t('freeze.button')` ("Заморозить партию"), `cancelLabel = t('common.cancel')`.
- Leave/end-game (`leaveWithConfirm` + the raw GameTable/BettingPhase prompts):
  `confirmLabel = t('common.confirm')`, `cancelLabel = t('common.cancel')`, `danger: true`.
  (The descriptive title/body already explain the action via the existing
  `multiplayer.*ConfirmTitle/Body` keys the leave flow passes — unchanged.)

`freeze.confirmTitle`/`confirmBody` already exist (round 1). All locales keep
identical key sets.

## Testing

- `tsc` clean.
- i18n: 4 locales identical key sets incl. any new `common.*` labels.
- Smoke: `tests/smoke/freeze-game.spec.ts` — REMOVE the `pageA.on('dialog', accept)`
  (no native dialog anymore); after tapping `btn-freeze-game`, tap the styled
  modal's `btn-confirm-modal`, then assert `paused-overlay`. Update + run.
- Full `npm run smoke` green (the leave/logo flows that other smoke specs exercise
  now go through the styled modal — verify those specs still pass; if a smoke taps
  a leave/logo control and expected a native confirm, it must now tap
  `btn-confirm-modal`).
- Manual (user): re-open the site as host with a paused room → land in lobby (NOT
  auto-entered), see the card with correct "N of M" (self not counted), tap →
  return.

## Out of scope
- No migration / edge changes (client-only; ships via Vercel).
- Admin-reset / stakes-guest-hint `window.confirm` (not leave/end-game).
- Converting `leaveWithConfirm`'s multi-context copy is preserved as-is (same
  title/body keys, now shown in the styled modal).
