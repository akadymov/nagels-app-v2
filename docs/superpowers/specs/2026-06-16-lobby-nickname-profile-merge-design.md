# Lobby nickname → profile identity merge

Date: 2026-06-16
Branch: feat/discord-activity
Status: design approved, pending spec review

## Problem

On the desktop lobby (`DesktopLobbyScreen`, viewport ≥ 1024px) the player's
nickname is rendered **twice**:

- Left pane (`LobbyScreen`) shows a bare `nicknameRow` — a 28px avatar plus an
  unlabeled text input (`LobbyScreen.tsx:460-484`). With no label it reads as a
  confusing duplicate of the avatar, and its purpose is unclear.
- Right pane (`SettingsBody`) shows the full Profile section, which already
  carries the avatar (56px), email, an always-visible nickname input with a
  Save button, Google link status, rating and history
  (`SettingsBody.tsx:299-537`).

So on desktop the name is editable in two places, and the lobby copy is the
worse of the two — unlabeled and detached from the rest of the identity data.

## Goals

1. Remove the duplicate bare nickname row from the desktop lobby pane so the
   Profile pane is the single owner of identity.
2. In the Profile section, make the nickname obviously a *game nickname* and
   obviously editable, and visually unify it with the surrounding identity data
   (avatar, email, Google status).

## Non-goals (YAGNI)

- The **mobile** lobby keeps its bare `nicknameRow`. On mobile the Profile
  section lives behind the gear (⚙ → SettingsBody), so the lobby row is the
  only fast, guest-first place to set a name before playing. Leave it untouched.
- No change to name save / room-propagation logic (`handleSaveProfile`,
  `setPlayerName`, `gameClient.setDisplayName`).
- No change to the rating, history, theme, or any other SettingsBody section.

## Design

### 1. Desktop lobby — drop the duplicate

Add an optional `hideNickname?: boolean` prop to `LobbyScreen`, alongside the
existing `hideAuthCta`, `hideLogoHeader`, `transparentBackground`. When true,
the `nicknameRow` block (`LobbyScreen.tsx:460-484`) is not rendered. The
`afterNickname` slot and everything below stay as they are.

`DesktopLobbyScreen` passes `hideNickname` to the left `LobbyScreen` instance.
Mobile and any other caller that omits the prop keep the current behavior.

### 2. Profile identity block — view mode + pencil

Today `SettingsBody` renders two separate rows:

- `avatarRow` — avatar (56px) + email + resend-confirmation link
  (`SettingsBody.tsx:308-329`).
- `nicknameRow` — an always-visible `TextInput` + Save button
  (`SettingsBody.tsx:331-346`).

Restructure into one identity header:

- Avatar (56px) on the left.
- Right column:
  - small caption label **"Игровой никнейм"** (`profile.gameNickname`);
  - the name itself, default rendered as **text + a pencil ✎ affordance**;
  - email (when logged in) below the name;
  - the email confirmation warning / resend link stays where it is, under the
    email.
- Google link status / button stays below the identity header, unchanged.

Editing affordance:

- Default state shows the name as text with a pencil button
  (`testID="btn-edit-nickname"`).
- Tapping the pencil flips a local `editingNickname` boolean to `true`, which
  swaps the text for the existing `TextInput` (`testID="settings-nickname"`)
  plus the Save button (`testID="settings-save"`).
- Save calls the existing `handleSaveProfile` and then sets `editingNickname`
  back to `false`. No change to what Save does.

The `hideNickname` prop already on `SettingsBody` keeps its current meaning
(suppress the nickname entirely); it is independent of the new
`LobbyScreen.hideNickname`.

### 3. i18n

Add `profile.gameNickname` to all three locales:

- RU: "Игровой никнейм"
- EN: "Game nickname"
- ES: "Apodo de juego"

### 4. testIDs and tests

- Preserve `settings-nickname` and `settings-save`. They now appear only after
  the pencil is tapped.
- Add `btn-edit-nickname` (new testID → run `npm run test:lint --update-todo`
  and surface it).
- Any existing test that taps `settings-nickname` / `settings-save` directly
  must first tap `btn-edit-nickname`. Audit `tests/` for those references and
  update the affected specs as part of implementation.

## Affected files

- `src/screens/LobbyScreen.tsx` — add `hideNickname` prop + guard the row.
- `src/screens/desktop/DesktopLobbyScreen.tsx` — pass `hideNickname`.
- `src/components/SettingsBody.tsx` — restructure identity header, add
  view-mode + pencil toggle.
- `src/locales/*` (en, ru, es) — add `profile.gameNickname`.
- `tests/` — update any spec that drives `settings-nickname` / `settings-save`.

## Verification

- `npm run smoke` before calling it ready (per CLAUDE.md gate).
- `npm run test:lint` after the testID change; `--update-todo` for the new id.
- Eyeball the desktop two-pane layout (≥1024px): no nickname in the left pane,
  labeled view-mode nickname with working pencil in the right pane.
- Eyeball the mobile lobby: bare nickname row still present and working.
