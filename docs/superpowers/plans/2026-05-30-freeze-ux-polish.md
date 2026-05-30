# Freeze UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a freeze confirmation dialog, host-vs-player paused messaging, "auto-close" terminology, and a "вернулись N из M" returned-players counter on the lobby paused card — polishing the shipped host-freeze feature.

**Architecture:** Pure client + i18n (no server/migration changes; one extra read RPC `get_room_state` from the lobby card for the counter). A `freezeWithConfirm` helper (mirrors `leaveWithConfirm`) gates the Freeze button via `window.confirm`. `PausedOverlay` branches title/body on `isHost`. The lobby card fetches the paused room snapshot to count live lineup members.

**Tech Stack:** Expo React Native + TypeScript, i18next, Zustand, gameClient (Supabase edge/RPC), Jest (TS units), Playwright smoke.

**Spec:** `docs/superpowers/specs/2026-05-30-freeze-ux-polish-design.md`

**Branch:** `feat/freeze-ux-polish` (created; spec committed there).

**Env notes:** memory-constrained 24GB Mac — do NOT run `sanity`/`demo`; a single `npm run smoke` is fine (needs `:8081` + local edge up). `node -e` for i18n checks. `npx tsc --noEmit` for typecheck (ignore pre-existing Deno-edge tsc errors).

---

## File Structure
- `src/i18n/locales/{en,ru,es,fr}.json` — rename `freeze.autoCancelIn`→`autoCloseIn` (reword to auto-close); reword `freeze.pausedTitle`/`pausedBody` (player-specific); add `confirmTitle`, `confirmBody`, `pausedTitleHost`, `pausedBodyHost`, `returnedCount`.
- `src/screens/LobbyScreen.tsx` — use `autoCloseIn`; add the returned-counter (fetch snapshot, compute, render).
- `src/lib/freezeWithConfirm.ts` (new) — confirm-then-pause helper.
- `src/screens/GameTableScreen.tsx`, `src/components/betting/BettingPhase.tsx` — Freeze button → `freezeWithConfirm`.
- `src/components/PausedOverlay.tsx` — branch title/body on `isHost`.
- `tests/smoke/freeze-game.spec.ts` — accept the `window.confirm` dialog before tapping Freeze.

---

## Task 1: i18n — auto-close terminology + new freeze copy

**Files:** `src/i18n/locales/en.json`, `ru.json`, `es.json`, `fr.json`; `src/screens/LobbyScreen.tsx`

- [ ] **Step 1: Rewrite the `freeze` namespace in each locale.**
Replace the existing `freeze` block in each file with the full set below (keys identical across locales; rename `autoCancelIn`→`autoCloseIn`; reword `pausedTitle`/`pausedBody` to player-specific; add the 5 new keys). Keep the other 7 keys' values as they are.

EN (`en.json`):
```json
"freeze": {
  "button": "Freeze game",
  "resume": "Resume game",
  "kill": "End game",
  "toLobby": "To lobby",
  "pausedTitle": "Game frozen by host",
  "pausedBody": "You can return to this room from your lobby if the host resumes the game.",
  "pausedTitleHost": "Game frozen",
  "pausedBodyHost": "Your room is waiting in your lobby — gather the players and resume there. Auto-closes after 48 hours.",
  "waitingFor": "Waiting for: {{names}}",
  "returnedCount": "{{n}} of {{total}} back",
  "lobbyCard": "Frozen game {{code}}",
  "autoCloseIn": "Auto-closes in {{time}}",
  "resumeDisabled": "Everyone must be back to resume",
  "confirmTitle": "Freeze the game?",
  "confirmBody": "The game pauses. Everyone can step away and come back; you resume once the full lineup is back. The frozen room stays in your lobby and auto-closes after 48 hours if not resumed."
}
```
RU (`ru.json`):
```json
"freeze": {
  "button": "Заморозить партию",
  "resume": "Продолжить партию",
  "kill": "Завершить партию",
  "toLobby": "В лобби",
  "pausedTitle": "Партия заморожена хостом",
  "pausedBody": "В эту комнату можно вернуться через лобби, если хост возобновит партию.",
  "pausedTitleHost": "Партия заморожена",
  "pausedBodyHost": "Комната ждёт тебя в лобби — собери игроков заново и продолжи там. Автозакрытие через 48 часов.",
  "waitingFor": "Ждём: {{names}}",
  "returnedCount": "Вернулись {{n}} из {{total}}",
  "lobbyCard": "Замороженная партия {{code}}",
  "autoCloseIn": "Автозакрытие через {{time}}",
  "resumeDisabled": "Для продолжения нужен весь состав",
  "confirmTitle": "Заморозить партию?",
  "confirmBody": "Партия встанет на паузу. Все смогут отойти и вернуться; продолжишь, когда соберётся весь состав. Замороженная комната будет в твоём лобби и закроется автоматически через 48 часов, если её не возобновить."
}
```
ES (`es.json`):
```json
"freeze": {
  "button": "Congelar partida",
  "resume": "Reanudar partida",
  "kill": "Finalizar partida",
  "toLobby": "Al vestíbulo",
  "pausedTitle": "Partida congelada por el anfitrión",
  "pausedBody": "Puedes volver a esta sala desde tu vestíbulo si el anfitrión reanuda la partida.",
  "pausedTitleHost": "Partida congelada",
  "pausedBodyHost": "Tu sala te espera en el vestíbulo — reúne a los jugadores y reanuda ahí. Se cierra automáticamente tras 48 horas.",
  "waitingFor": "Esperando a: {{names}}",
  "returnedCount": "{{n}} de {{total}} de vuelta",
  "lobbyCard": "Partida congelada {{code}}",
  "autoCloseIn": "Se cierra en {{time}}",
  "resumeDisabled": "Deben estar todos para reanudar",
  "confirmTitle": "¿Congelar la partida?",
  "confirmBody": "La partida se pausa. Todos pueden alejarse y volver; reanudas cuando esté todo el grupo. La sala congelada queda en tu vestíbulo y se cierra automáticamente tras 48 horas si no se reanuda."
}
```
FR (`fr.json`):
```json
"freeze": {
  "button": "Geler la partie",
  "resume": "Reprendre la partie",
  "kill": "Terminer la partie",
  "toLobby": "Au salon",
  "pausedTitle": "Partie gelée par l'hôte",
  "pausedBody": "Vous pouvez revenir dans ce salon depuis votre lobby si l'hôte reprend la partie.",
  "pausedTitleHost": "Partie gelée",
  "pausedBodyHost": "Votre salon vous attend dans le lobby — rassemblez les joueurs et reprenez là-bas. Fermeture automatique au bout de 48 heures.",
  "waitingFor": "En attente de : {{names}}",
  "returnedCount": "{{n}} sur {{total}} de retour",
  "lobbyCard": "Partie gelée {{code}}",
  "autoCloseIn": "Fermeture auto dans {{time}}",
  "resumeDisabled": "Tout le monde doit être là pour reprendre",
  "confirmTitle": "Geler la partie ?",
  "confirmBody": "La partie se met en pause. Chacun peut s'éloigner et revenir ; vous reprenez quand tout le monde est là. Le salon gelé reste dans votre lobby et se ferme automatiquement au bout de 48 heures s'il n'est pas repris."
}
```

- [ ] **Step 2: Update the lobby consumer of the renamed key.**
In `src/screens/LobbyScreen.tsx` (~line 506) change `t('freeze.autoCancelIn', ...)` → `t('freeze.autoCloseIn', ...)`:
```tsx
              {t('freeze.autoCloseIn', { time: pausedRoomTimeStr })}
```

- [ ] **Step 3: Verify JSON + no stale key.**
Run:
```bash
node -e "const ls=['en','ru','es','fr'].map(l=>require('./src/i18n/locales/'+l+'.json').freeze); const ks=ls.map(f=>Object.keys(f).sort().join(',')); if(new Set(ks).size!==1) throw new Error('key sets differ: '+ks.join(' | ')); ['confirmTitle','confirmBody','pausedTitleHost','pausedBodyHost','returnedCount','autoCloseIn'].forEach(k=>ls.forEach((f,i)=>{if(!f[k]) throw new Error('missing '+k+' in locale#'+i)})); ls.forEach((f,i)=>{if(f.autoCancelIn) throw new Error('stale autoCancelIn in locale#'+i); if(!f.returnedCount.includes('{{n}}')||!f.returnedCount.includes('{{total}}')) throw new Error('returnedCount placeholders missing #'+i); if(!f.autoCloseIn.includes('{{time}}')) throw new Error('autoCloseIn {{time}} missing #'+i)}); console.log('OK: freeze i18n consistent, auto-close renamed, placeholders intact')"
grep -rn "autoCancelIn" src/ && echo "FAIL: stale autoCancelIn reference remains" || echo "OK: no autoCancelIn references in src"
```
Expected: `OK: freeze i18n consistent…` and `OK: no autoCancelIn references in src`.

- [ ] **Step 4: Commit.**
```bash
git add src/i18n/locales/en.json src/i18n/locales/ru.json src/i18n/locales/es.json src/i18n/locales/fr.json src/screens/LobbyScreen.tsx
git commit -m "feat(i18n): freeze auto-close terminology + confirm/host/player/returned copy"
```

---

## Task 2: freezeWithConfirm helper + wire Freeze buttons

**Files:** Create `src/lib/freezeWithConfirm.ts`; modify `src/screens/GameTableScreen.tsx`, `src/components/betting/BettingPhase.tsx`

- [ ] **Step 1: Create the helper.**
Create `src/lib/freezeWithConfirm.ts` (mirrors `src/lib/leaveWithConfirm.ts`):
```ts
import type { TFunction } from 'i18next';
import { gameClient } from './gameClient';

/**
 * Confirm (anti-misclick + explain) then freeze the game. Mirrors
 * leaveWithConfirm. On web/PWA shows window.confirm; if declined, no-op.
 * Returns true iff the pause request succeeded.
 */
export async function freezeWithConfirm(roomId: string, t: TFunction): Promise<boolean> {
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const accepted = window.confirm(`${t('freeze.confirmTitle')}\n\n${t('freeze.confirmBody')}`);
    if (!accepted) return false;
  }
  const result = await gameClient.pauseGame(roomId);
  return result.ok === true;
}
```

- [ ] **Step 2: Wire GameTableScreen's Freeze button.**
In `src/screens/GameTableScreen.tsx`: add the import near the other `../lib/...` imports:
```ts
import { freezeWithConfirm } from '../lib/freezeWithConfirm';
```
Change the Freeze button `onPress` (~line 1250) from:
```tsx
                onPress={async () => { if (room) await gameClient.pauseGame(room.id); }}
```
to:
```tsx
                onPress={async () => { if (room) await freezeWithConfirm(room.id, t); }}
```
(`t` is already in scope from `useTranslation()` in this screen.)

- [ ] **Step 3: Wire BettingPhase's Freeze button.**
In `src/components/betting/BettingPhase.tsx`: add the import near the other `../../lib/...` imports:
```ts
import { freezeWithConfirm } from '../../lib/freezeWithConfirm';
```
Change the Freeze button `onPress` (~line 724) from:
```tsx
                onPress={async () => { if (mpRoom) await gameClient.pauseGame(mpRoom.id); }}
```
to:
```tsx
                onPress={async () => { if (mpRoom) await freezeWithConfirm(mpRoom.id, t); }}
```
(`t` is already in scope in this component.)

- [ ] **Step 4: Typecheck.**
Run:
```bash
npx tsc --noEmit 2>&1 | grep -iE "freezeWithConfirm|GameTableScreen|BettingPhase" || echo "OK: freezeWithConfirm wiring typechecks"
```
Expected: `OK: freezeWithConfirm wiring typechecks`.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/freezeWithConfirm.ts src/screens/GameTableScreen.tsx src/components/betting/BettingPhase.tsx
git commit -m "feat(freeze): confirm dialog before freezing (anti-misclick + explain)"
```

---

## Task 3: Host vs player paused messaging in PausedOverlay

**Files:** `src/components/PausedOverlay.tsx`

- [ ] **Step 1: Branch the title/body on `isHost`.**
In `src/components/PausedOverlay.tsx`, change the title and body lines from:
```tsx
        <Text style={[styles.title, { color: colors.accent }]}>{t('freeze.pausedTitle')}</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{t('freeze.pausedBody')}</Text>
```
to:
```tsx
        <Text style={[styles.title, { color: colors.accent }]}>
          {t(isHost ? 'freeze.pausedTitleHost' : 'freeze.pausedTitle')}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {t(isHost ? 'freeze.pausedBodyHost' : 'freeze.pausedBody')}
        </Text>
```
Leave everything else (waitingFor, Resume/Kill/ToLobby controls) unchanged.

- [ ] **Step 2: Typecheck.**
Run:
```bash
npx tsc --noEmit 2>&1 | grep -iE "PausedOverlay" || echo "OK: PausedOverlay typechecks"
```
Expected: `OK: PausedOverlay typechecks`.

- [ ] **Step 3: Commit.**
```bash
git add src/components/PausedOverlay.tsx
git commit -m "feat(freeze): host vs player paused-overlay messaging"
```

---

## Task 4: Lobby "вернулись N из M" returned counter

**Files:** `src/screens/LobbyScreen.tsx`

The lobby paused card currently shows code + auto-close countdown from
`getMyActiveRoom()`. Extend it to also fetch the room snapshot and show how many
of the original lineup are back (live within 30s).

- [ ] **Step 1: Extend `PausedRoomInfo` + `fetchPausedRoom` to compute the count.**
In `src/screens/LobbyScreen.tsx`, find the `PausedRoomInfo` type (it holds `room_id/code/paused_at`) and add two fields: `back: number; total: number;`. Then in `fetchPausedRoom` (~line 166), after confirming the room is paused, fetch the snapshot and compute live lineup count. Replace the `setPausedRoom({ room_id, code, paused_at })` call with:
```ts
      if (active?.phase === 'paused' && active.paused_at) {
        let back = 0, total = 0;
        try {
          const { getSupabaseClient } = await import('../lib/supabase/client');
          const { data: snap } = await getSupabaseClient().rpc('get_room_state', { p_room_id: active.room_id });
          const lineup: string[] = (snap?.room?.paused_lineup ?? []) as string[];
          const players: Array<{ session_id: string; last_seen_at: string }> = (snap?.players ?? []) as any[];
          const LIVE_MS = 30_000;
          total = lineup.length;
          back = lineup.filter((sid) => {
            const p = players.find((x) => x.session_id === sid);
            return !!p && (Date.now() - Date.parse(p.last_seen_at)) < LIVE_MS;
          }).length;
        } catch { /* counter is best-effort; fall back to 0/0 (hidden) */ }
        setPausedRoom({ room_id: active.room_id, code: active.code, paused_at: active.paused_at, back, total });
      } else {
        setPausedRoom(null);
      }
```
(If `getSupabaseClient` is already imported at the top of the file, use that import instead of the dynamic one — grep first: `grep -n "getSupabaseClient" src/screens/LobbyScreen.tsx`.)

- [ ] **Step 2: Render the counter line on the card.**
In the paused card JSX (near the `autoCloseIn` line ~506), add a count line that shows only when `total > 0`:
```tsx
            {pausedRoom.total > 0 && (
              <Text style={[styles.pausedCardSub, { color: colors.textMuted }]}>
                {t('freeze.returnedCount', { n: pausedRoom.back, total: pausedRoom.total })}
              </Text>
            )}
```
(Reuse the card's existing sub-text style — the implementer used `pausedCardSub`; confirm the actual style name in the file and reuse it.) The countdown `setInterval` (30s) already bumps `ttlTick` and re-renders; the count refreshes on the same focus/interval path because `fetchPausedRoom` runs on focus. Optionally also call `fetchPausedRoom` inside the 30s interval so the count refreshes live — add `void fetchPausedRoom();` inside the existing interval callback alongside `setTtlTick`.

- [ ] **Step 3: Typecheck.**
Run:
```bash
npx tsc --noEmit 2>&1 | grep -iE "LobbyScreen" || echo "OK: LobbyScreen counter typechecks"
```
Expected: `OK: LobbyScreen counter typechecks`.

- [ ] **Step 4: Commit.**
```bash
git add src/screens/LobbyScreen.tsx
git commit -m "feat(freeze): lobby paused card shows 'N of M back' counter"
```

---

## Task 5: Smoke spec accepts the confirm dialog + full gate

**Files:** `tests/smoke/freeze-game.spec.ts`

The freeze smoke taps `btn-freeze-game`, which now triggers `window.confirm`. In
headless Playwright an unhandled `confirm` auto-dismisses (returns false) → the
freeze never fires. Register a dialog auto-accept so the flow proceeds.

- [ ] **Step 1: Auto-accept dialogs on the host page before tapping Freeze.**
In `tests/smoke/freeze-game.spec.ts`, add a dialog handler on the host page (`pageA`) right after it's created (before the freeze tap):
```ts
    pageA.on('dialog', (d) => d.accept());
```
(Place it near the other `pageA` setup. This makes `window.confirm` from the Freeze button resolve to true so `freezeWithConfirm` proceeds to `pauseGame`.)

- [ ] **Step 2: Run the freeze smoke spec.**
First confirm the dev server is up:
```bash
lsof -i :8081 >/dev/null 2>&1 && echo "8081 up" || echo "8081 DOWN — ask the user"
curl -s -o /dev/null -w "edge: %{http_code}\n" -X OPTIONS http://127.0.0.1:54321/functions/v1/game-action --max-time 5
```
If down, report BLOCKED (don't start :8081). If up, run:
```bash
HEADLESS=1 npx playwright test tests/smoke/freeze-game.spec.ts 2>&1 | tail -15
```
Expected: 1 passed. (If it fails because the overlay never appears, the dialog handler isn't accepting — verify it's registered on the page that taps Freeze.)

- [ ] **Step 3: Full smoke gate.**
Run:
```bash
npm run smoke 2>&1 | grep -E "passed|failed|Tests:|Test Suites:|orphan" | tail -15
```
Expected: jest + all smoke (incl. freeze) + desktop green; no orphan testIDs.

- [ ] **Step 4: Commit.**
```bash
git add tests/smoke/freeze-game.spec.ts
git commit -m "test(smoke): accept window.confirm before freezing"
```

---

## Task 6: Finish the branch

- [ ] **Step 1: Invoke `superpowers:finishing-a-development-branch`.**
Deploy note to relay: this is a **client-only** change (no migration, no edge) — it ships via the frontend (Vercel) on push to main; no `supabase db push` / `functions deploy` needed.

---

## Self-Review

- **Spec §1 (freezeWithConfirm, window.confirm)** → Task 2. ✅
- **Spec §2 (host/player paused messaging)** → Task 3 + Task 1 (the copy). ✅
- **Spec §3 (i18n: autoCancelIn→autoCloseIn rename + new keys + LobbyScreen consumer)** → Task 1. ✅
- **Spec §4 (lobby returned counter N/M)** → Task 4 + `returnedCount` key in Task 1. ✅
- **Spec testing note (smoke must accept window.confirm)** → Task 5 Step 1. ✅
- **"Already satisfied" items (access/return/resume)** → no tasks (correctly — already shipped). ✅
- **Type consistency:** `freezeWithConfirm(roomId, t)` defined Task 2, called identically in both screens. `freeze.*` keys identical across Tasks 1/3/4. `pausedRoom.back/total` added in Task 4 Step 1, consumed in Step 2. `returnedCount` uses `{{n}}`/`{{total}}` in Task 1 + Task 4. `autoCloseIn` renamed in Task 1, consumed in Task 1 Step 2 (LobbyScreen). ✅
- **Placeholder scan:** Task 4 has two "grep/confirm the actual style/import name" notes — bounded lookups against a named file (the style name + getSupabaseClient import depend on current file state), not vague directives. Flagged for the implementer to read. ✅
