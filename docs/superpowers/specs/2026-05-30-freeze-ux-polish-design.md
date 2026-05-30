# Freeze UX polish — confirm dialog + host/player paused messaging

Date: 2026-05-30
Status: Approved (design)
Builds on: `docs/superpowers/specs/2026-05-30-host-freeze-game-design.md` (the shipped freeze feature)

## Problem

Two UX gaps in the shipped host-freeze feature:
1. **No confirmation before freezing.** Tapping the ❄️ Freeze button immediately
   pauses the game — an easy misclick with a disruptive effect, and the control
   doesn't explain what freezing does.
2. **The paused overlay shows the same message to everyone.** The host needs
   different guidance ("your room is waiting in the lobby — gather the players
   and resume there") than the other players ("you can return via the lobby if
   the host resumes").

Also: the existing copy says "авто-отмена / auto-cancels", but the room is
actually *closed* (ends, no rating settle) on TTL expiry. The correct term is
**автозакрытие / auto-close**, not cancel.

## Decisions

- **Confirm dialog:** use `window.confirm` via a small `freezeWithConfirm` helper
  — consistent with the existing `leaveWithConfirm` pattern (web/PWA target).
  A branded custom modal was considered and declined (more code; the app already
  uses `window.confirm` for leave/end-game confirmations).
- **Terminology:** "автозакрытие" / "auto-close" everywhere (rename the existing
  `freeze.autoCancelIn` key to `freeze.autoCloseIn`), never "отмена/cancel".

## Changes

### 1. Freeze confirmation (`src/lib/freezeWithConfirm.ts`, new)

A helper mirroring `leaveWithConfirm`:
```ts
export async function freezeWithConfirm(roomId: string, t: TFunction): Promise<boolean> {
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const accepted = window.confirm(`${t('freeze.confirmTitle')}\n\n${t('freeze.confirmBody')}`);
    if (!accepted) return false;
  }
  const result = await gameClient.pauseGame(roomId);
  return result.ok === true;
}
```
The ❄️ Freeze button in **GameTableScreen** and **BettingPhase** changes from
`onPress={() => gameClient.pauseGame(room.id)}` to
`onPress={() => freezeWithConfirm(room.id, t)}`.

### 2. Host vs player paused messaging (`src/components/PausedOverlay.tsx`)

`PausedOverlay` already receives `isHost`. Branch the title/body:
- **Host:** `freeze.pausedTitleHost` + `freeze.pausedBodyHost`. Resume / Kill /
  To-lobby controls unchanged.
- **Player:** existing `freeze.pausedTitle` + `freeze.pausedBody`. To-lobby
  control unchanged.

```tsx
<Text style={styles.title}>{t(isHost ? 'freeze.pausedTitleHost' : 'freeze.pausedTitle')}</Text>
<Text style={styles.body}>{t(isHost ? 'freeze.pausedBodyHost' : 'freeze.pausedBody')}</Text>
```

### 3. i18n (`src/i18n/locales/{en,ru,es,fr}.json`)

- **Rename** `freeze.autoCancelIn` → `freeze.autoCloseIn` (update the only
  consumer: the lobby card in `LobbyScreen.tsx`). Reword to auto-close.
- **Add** `freeze.confirmTitle`, `freeze.confirmBody`, `freeze.pausedTitleHost`,
  `freeze.pausedBodyHost`, `freeze.returnedCount`.

Proposed RU values (EN/ES/FR translated equivalently, keys identical):
```
"autoCloseIn":    "Автозакрытие через {{time}}",
"confirmTitle":   "Заморозить партию?",
"confirmBody":    "Партия встанет на паузу. Все смогут отойти и вернуться; продолжишь, когда соберётся весь состав. Замороженная комната будет в твоём лобби и закроется автоматически через 48 часов, если её не возобновить.",
"pausedTitleHost":"Партия заморожена",
"pausedBodyHost": "Комната ждёт тебя в лобби — собери игроков заново и продолжи там. Автозакрытие через 48 часов.",
"returnedCount":  "Вернулись {{n}} из {{total}}"
```
Existing player keys stay (with any "cancel"→"close" wording fix if present):
```
"pausedTitle":    "Партия заморожена хостом",
"pausedBody":     "В эту комнату можно вернуться через лобби, если хост возобновит партию."
```
EN reference:
```
"autoCloseIn":    "Auto-closes in {{time}}",
"confirmTitle":   "Freeze the game?",
"confirmBody":    "The game pauses. Everyone can step away and come back; you resume once the full lineup is back. The frozen room stays in your lobby and auto-closes after 48 hours if not resumed.",
"pausedTitleHost":"Game frozen",
"pausedBodyHost": "Your room is waiting in your lobby — gather the players and resume there. Auto-closes after 48 hours.",
"returnedCount":  "{{n}} of {{total}} back"
```

### 4. Lobby card returned-players counter ("вернулись N из M")

The host (and any participant) sitting in the lobby with a paused active room
should see how many of the original lineup are back, so the host knows when they
can resume. The lobby paused card (`LobbyScreen.tsx`, from the shipped feature)
currently shows only code + auto-close countdown (from `get_my_active_room`,
which carries no liveness). Add a count line:

- When a paused active room is shown, additionally fetch `get_room_state(room_id)`
  (one RPC, only while the paused card is mounted; refreshed on the same
  focus/interval that drives the countdown).
- Compute `total = paused_lineup.length`; `back = ` count of `paused_lineup`
  session_ids that have a `players[]` row with `last_seen_at` within 30s (the
  same liveness window `resume_game` enforces).
- Render `freeze.returnedCount` → RU "Вернулись {{n}} из {{total}}" /
  EN "{{n}} of {{total}} back". Shown to everyone who sees the card (informational
  for non-hosts; the actionable signal for the host, who resumes when n == total).
- No names (per decision — count only).

### Already satisfied by the shipped feature (verified, NO new work)

These return/resume/access rules the user asked about are already correct in the
shipped `host-freeze` feature — documented here so they are not rebuilt:
- **Any player (incl. host) can leave and return to the paused room anytime** —
  seats are held (the leaveRoom paused short-circuit never deletes the row; the
  "To lobby" control navigates away without `leaveRoom`), and `get_my_active_room`
  returns the paused room (within TTL) so the lobby card brings them back.
- **Only the host can resume** — `resume_game` is host-only.
- **Only original players can be players in a paused room** — `joinRoom.ts`
  rejects any join when `phase !== 'waiting'` (`room_in_progress`), so no new
  player can take a seat; original seats are held.
- **Spectators can reach a paused room** — `join_room_as_spectator` only rejects
  `phase = 'finished'`, so `paused` is permitted.

## Out of scope

- No migration changes. One extra read RPC (`get_room_state`) from the lobby card
  for the counter; no new server actions.
- No branded confirm modal (window.confirm is sufficient and consistent).
- Resume/Kill/lineup/access logic unchanged (already satisfies the requirements
  above).

## Testing

- i18n validity: all 4 locales have the new/renamed keys, identical key sets,
  `{{time}}` placeholder intact in `autoCloseIn`.
- `tsc` clean; `grep` confirms no remaining `autoCancelIn` reference.
- Full `npm run smoke` stays green (the freeze smoke spec taps `btn-freeze-game`
  — now it must accept the `window.confirm`; in headless Playwright `window.confirm`
  returns false by default, so the smoke must auto-accept the dialog
  (`page.on('dialog', d => d.accept())`) before tapping Freeze, or the freeze
  won't fire. Update `tests/smoke/freeze-game.spec.ts` accordingly).
