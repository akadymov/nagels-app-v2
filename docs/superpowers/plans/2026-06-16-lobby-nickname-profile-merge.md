# Lobby nickname → profile identity merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the duplicated, unlabeled nickname row from the desktop lobby pane and turn the Profile section's nickname into a labeled, view-mode-with-pencil control unified with the avatar/email identity block.

**Architecture:** Add a `hideNickname` prop to `LobbyScreen` so `DesktopLobbyScreen` can suppress the lobby's bare nickname row (the Profile pane already owns identity). Restructure the `SettingsBody` identity header so avatar + labeled nickname + email read as one block, with the nickname shown as text + a pencil that toggles an inline edit field. Mobile lobby is unchanged.

**Tech Stack:** Expo / React Native + TypeScript, i18next (4 locale JSON files), Zustand. No RN component-test harness exists in this repo, so verification is `npm run ts:check` (typecheck) + `npm run test:lint` + `npm run smoke` + manual eyeball — not jest component tests.

**Spec:** `docs/superpowers/specs/2026-06-16-lobby-nickname-profile-merge-design.md`

---

## File structure

- `src/i18n/locales/{en,ru,es,fr}.json` — add `profile.gameNickname`.
- `src/screens/LobbyScreen.tsx` — add `hideNickname?: boolean` prop; guard the `nicknameRow` block.
- `src/screens/desktop/DesktopLobbyScreen.tsx` — pass `hideNickname` to the left `LobbyScreen`.
- `src/components/SettingsBody.tsx` — add `editingNickname` state, restructure the identity header, remove the old standalone nickname row, add styles.

---

### Task 1: Add `profile.gameNickname` to all locales

**Files:**
- Modify: `src/i18n/locales/en.json` (after `"editNickname"`, ~line 351)
- Modify: `src/i18n/locales/ru.json` (after `"editNickname"`, ~line 354)
- Modify: `src/i18n/locales/es.json` (after `"editNickname"`, ~line 351)
- Modify: `src/i18n/locales/fr.json` (after `"editNickname"`, ~line 346)

- [ ] **Step 1: Add the key in en.json**

In the `"profile"` object, immediately after the `"editNickname": "Nickname",` line, add:

```json
    "gameNickname": "Game nickname",
```

- [ ] **Step 2: Add the key in ru.json**

After `"editNickname": "Никнейм",` add:

```json
    "gameNickname": "Игровой никнейм",
```

- [ ] **Step 3: Add the key in es.json**

After `"editNickname": "Apodo",` add:

```json
    "gameNickname": "Apodo de juego",
```

- [ ] **Step 4: Add the key in fr.json**

After `"editNickname": "Pseudo",` add:

```json
    "gameNickname": "Pseudo de jeu",
```

- [ ] **Step 5: Verify JSON is valid**

Run: `node -e "['en','ru','es','fr'].forEach(l=>require('./src/i18n/locales/'+l+'.json').profile.gameNickname || (()=>{throw new Error('missing '+l)})())" && echo OK`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/ru.json src/i18n/locales/es.json src/i18n/locales/fr.json
git commit -m "i18n(profile): add gameNickname label"
```

---

### Task 2: Add `hideNickname` prop to LobbyScreen

**Files:**
- Modify: `src/screens/LobbyScreen.tsx` — props interface (~47-68), component params (~79-87), nickname row guard (~460-484).

- [ ] **Step 1: Add the prop to the interface**

In `interface LobbyScreenProps`, after the `transparentBackground?: boolean;` field (~line 63), add:

```tsx
  /** Hide the lobby's own nickname row. Desktop wraps this screen
   *  next to the Profile pane, which already owns the nickname, so
   *  the lobby copy would be a duplicate. */
  hideNickname?: boolean;
```

- [ ] **Step 2: Destructure the prop with a default**

In the `LobbyScreen` component params, after `transparentBackground = false,` (~line 86), add:

```tsx
  hideNickname = false,
```

- [ ] **Step 3: Guard the nickname row**

Wrap the existing nickname `<View style={[styles.nicknameRow, ...]}>...</View>` block (lines ~461-484) so it only renders when not hidden. Change:

```tsx
        {/* Nickname */}
        <View style={[styles.nicknameRow, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
```

to:

```tsx
        {/* Nickname — hidden on desktop, where the Profile pane owns it */}
        {!hideNickname && (
        <View style={[styles.nicknameRow, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
```

and add a closing `)}` immediately after that block's closing `</View>` (the one before `{afterNickname}`):

```tsx
        </View>
        )}

        {afterNickname}
```

- [ ] **Step 4: Typecheck**

Run: `npm run ts:check`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/screens/LobbyScreen.tsx
git commit -m "feat(lobby): add hideNickname prop to LobbyScreen"
```

---

### Task 3: Pass `hideNickname` from DesktopLobbyScreen

**Files:**
- Modify: `src/screens/desktop/DesktopLobbyScreen.tsx:47`

- [ ] **Step 1: Pass the prop**

Change the left-pane render (line ~47) from:

```tsx
          <LobbyScreen {...lobbyProps} hideAuthCta hideLogoHeader transparentBackground />
```

to:

```tsx
          <LobbyScreen {...lobbyProps} hideAuthCta hideLogoHeader transparentBackground hideNickname />
```

- [ ] **Step 2: Typecheck**

Run: `npm run ts:check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/screens/desktop/DesktopLobbyScreen.tsx
git commit -m "feat(desktop): drop duplicate nickname from lobby pane"
```

---

### Task 4: Restructure SettingsBody identity header (view mode + pencil)

**Files:**
- Modify: `src/components/SettingsBody.tsx` — state (~135), identity JSX (308-347), styles (710-719).

- [ ] **Step 1: Add the editing state**

After `const [showSetPassword, setShowSetPassword] = useState(false);` (~line 132), add:

```tsx
  const [editingNickname, setEditingNickname] = useState(false);
```

- [ ] **Step 2: Replace the avatarRow + old nickname row**

Replace the whole block from `<View style={styles.avatarRow}>` (line ~308) through the end of the `{!hideNickname && ( ... )}` nickname row block (line ~347) with:

```tsx
            <View style={styles.avatarRow}>
              <UserAvatar
                avatarUrl={(user?.user_metadata?.avatar_url as string | undefined) ?? null}
                emoji={selectedAvatar}
                fallback={initial}
                backgroundColor={avatarColor}
                size={56}
                textSize={28}
              />
              <View style={{ flex: 1 }}>
                {!hideNickname && (
                  <>
                    <Text style={[styles.identityLabel, { color: colors.textMuted }]}>
                      {t('profile.gameNickname', 'Game nickname')}
                    </Text>
                    {editingNickname ? (
                      <View style={styles.nicknameRow}>
                        <TextInput
                          style={[styles.input, { backgroundColor: colors.surfaceSecondary, color: colors.textPrimary, borderColor: colors.glassLight, flex: 1 }]}
                          value={nickname}
                          onChangeText={setNickname}
                          maxLength={20}
                          autoCapitalize="words"
                          autoFocus
                          placeholder={String(t('profile.editNickname', 'Nickname'))}
                          placeholderTextColor={colors.textMuted}
                          testID="settings-nickname"
                        />
                        <Pressable
                          style={[styles.saveBtn, { backgroundColor: colors.accent }]}
                          onPress={async () => { await handleSaveProfile(); setEditingNickname(false); }}
                          testID="settings-save"
                        >
                          <Text style={styles.saveBtnText}>{t('common.done', 'Save')}</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        style={styles.nameViewRow}
                        onPress={() => setEditingNickname(true)}
                        testID="btn-edit-nickname"
                        accessibilityRole="button"
                        accessibilityLabel={String(t('profile.editNickname', 'Nickname'))}
                      >
                        <Text style={[styles.nameText, { color: colors.textPrimary }]} numberOfLines={1}>
                          {nickname || displayName || String(t('profile.editNickname', 'Nickname'))}
                        </Text>
                        <Text style={[styles.editPencil, { color: colors.accent }]}>✎</Text>
                      </Pressable>
                    )}
                  </>
                )}
                {isLoggedIn && (
                  <>
                    <Text style={[styles.emailText, { color: colors.textMuted, marginTop: 4 }]}>{user?.email}</Text>
                    {!user?.email_confirmed_at && (
                      <Pressable onPress={handleResendConfirmation}>
                        <Text style={[styles.resendLink, { color: colors.warning }]}>
                          ⚠ {t('auth.resendConfirmation', 'Resend confirmation')}
                        </Text>
                      </Pressable>
                    )}
                  </>
                )}
              </View>
            </View>
```

Note: this removes the standalone `{!hideNickname && (<View style={styles.nicknameRow}>...)}` block entirely — its TextInput/Save now live inside the identity header's edit state. The `{!hasGoogleIdentity(user) && ( ... choose avatar ... )}` block that followed stays exactly where it is, directly after this.

- [ ] **Step 3: Update avatarRow alignment and add new styles**

In the `StyleSheet.create` block, change `avatarRow` (line ~710) from:

```tsx
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
```

to:

```tsx
  avatarRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, marginBottom: Spacing.md },
```

Then, immediately after the `nicknameRow:` style (line ~716), add:

```tsx
  identityLabel: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  nameViewRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 44 },
  nameText: { flex: 1, fontSize: 16, fontWeight: '600' },
  editPencil: { fontSize: 16 },
```

- [ ] **Step 4: Typecheck**

Run: `npm run ts:check`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsBody.tsx
git commit -m "feat(profile): labeled view-mode nickname with pencil edit"
```

---

### Task 5: Sync testID tracking and run the gate

**Files:**
- Modify: `tests/TEST_TODO.md` (auto-section, via tooling)

- [ ] **Step 1: Update the testID TODO for the new id**

Run: `npm run test:lint -- --update-todo`
Expected: exit 0; `tests/TEST_TODO.md` now lists `btn-edit-nickname`. Note: `settings-nickname` / `settings-save` remain (now behind the pencil). No active test taps them directly (confirmed: they appear only in TEST_TODO.md, not in any spec), so gating them changes no test.

- [ ] **Step 2: Run the smoke gate**

Precondition: the `:8081` dev server must be running (`lsof -i :8081`). If empty, stop and surface to the user — do not start it for them.

Run: `npm run smoke`
Expected: jest unit + 9 smoke + 2 desktop-layout pass; no new Telegram notification appears.

- [ ] **Step 3: Manual eyeball**

- Desktop (viewport ≥ 1024px): left lobby pane has NO nickname row; right Profile pane shows the "Игровой никнейм" label, the name as text with a ✎, and tapping ✎ swaps to input + Save which persists.
- Mobile lobby: the bare nickname row is still present and editable.

- [ ] **Step 4: Commit the TODO update**

```bash
git add tests/TEST_TODO.md
git commit -m "test(lint): track btn-edit-nickname testID"
```

---

## Self-review

- **Spec coverage:** Goal 1 (drop desktop duplicate) → Tasks 2–3. Goal 2 (labeled, editable, unified nickname) → Tasks 1 + 4. Non-goal (mobile untouched) → enforced by `hideNickname` defaulting false in Task 2. i18n (Task 1) covers the four locale files that exist (spec said EN/RU/ES; FR added too since the file exists and would otherwise miss the key). testID handling → Task 5.
- **Placeholders:** none — every code step shows the exact code.
- **Type consistency:** `hideNickname` (LobbyScreen prop) and `editingNickname`/`setEditingNickname` (SettingsBody state) are used consistently; existing `handleSaveProfile`, `nickname`, `displayName`, `selectedAvatar`, `avatarColor`, `initial`, `isLoggedIn` are all already defined in SettingsBody. New styles `identityLabel`, `nameViewRow`, `nameText`, `editPencil` are defined in Task 4 Step 3 and referenced only in Task 4 Step 2.
