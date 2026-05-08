# Google Auth + Guest Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anonymous guests can save their progress via Google OAuth (or existing email) at three calibrated trigger points; the duplicated in-game settings UI is consolidated with the lobby SettingsScreen into a single shared overlay modal first so the new "Save Progress" CTA lives in one place.

**Architecture:** Phase 1 — extract `SettingsBody` from `SettingsScreen`, host it in a global `SettingsModal` mounted at App root, control via a tiny zustand store; replace all settings entry points with a single `useSettingsUIStore.open()` call. Phase 2 — add Google OAuth via Supabase `signInWithOAuth` / `linkIdentity`, gate auto-prompts via AsyncStorage flags, add a "Save Progress" section to `SettingsBody` (anonymous-only).

**Tech Stack:** Expo (React Native Web) + TypeScript + Supabase (Auth + Edge Functions in Deno) + Zustand store + AsyncStorage.

**Spec:** `docs/superpowers/specs/2026-05-08-google-auth-guest-conversion-design.md`

---

## File Structure

| Path | Action | Phase | Responsibility |
|---|---|---|---|
| `src/store/settingsUIStore.ts` | Create | 1 | Zustand `{ visible, open, close }` |
| `src/components/SettingsBody.tsx` | Create | 1 | All settings sections, no chrome |
| `src/components/SettingsModal.tsx` | Create | 1 | Overlay host wrapping `SettingsBody` |
| `src/navigation/AppNavigator.tsx` | Modify | 1 | Drop `Settings` route, mount `<SettingsModal />` |
| `src/screens/LobbyScreen.tsx` | Modify | 1+2 | ⚙️ → `open()`; gate `handleCreateRoom` |
| `src/screens/WaitingRoomScreen.tsx` | Modify | 1 | ⚙️ → `open()` |
| `src/components/betting/BettingPhase.tsx` | Modify | 1 | Delete inline modal, ⚙️ → `open()` |
| `src/screens/GameTableScreen.tsx` | Modify | 1+2 | Delete inline modal; auto-prompt at game-over |
| `src/screens/SettingsScreen.tsx` | Delete | 1 | Body migrated to `SettingsBody` |
| `src/lib/supabase/authService.ts` | Modify | 2 | `signInWithGoogle`, `linkGoogleToAnonymous`, `connectGoogle`, `clearLocalGuestState` |
| `src/lib/auth/promptGate.ts` | Create | 2 | AsyncStorage-backed dismissal flags |
| `src/components/SaveProgressModal.tsx` | Create | 2 | Trigger-aware modal for after-game / before-create |
| `src/screens/AuthScreen.tsx` | Modify | 2 | Google button + divider |
| `src/App.tsx` | Modify | 2 | Collision detection on `onAuthStateChange` |
| `src/i18n/locales/{en,ru,es}.json` | Modify | 2 | `auth.*` + `settings.saveProgress` keys |

---

# Phase 1 — Settings consolidation (refactor)

## Task 1: Zustand UI store for settings visibility

**Files:**
- Create: `src/store/settingsUIStore.ts`

A two-state store. Decoupled from `useSettingsStore` (which holds *values*); this one only tracks whether the modal is visible.

- [ ] **Step 1: Create the store**

```ts
// src/store/settingsUIStore.ts
import { create } from 'zustand';

interface SettingsUIState {
  visible: boolean;
  open: () => void;
  close: () => void;
}

export const useSettingsUIStore = create<SettingsUIState>((set) => ({
  visible: false,
  open: () => set({ visible: true }),
  close: () => set({ visible: false }),
}));
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep settingsUIStore`

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/store/settingsUIStore.ts
git commit -m "feat(settings): zustand store for global settings modal visibility"
```

---

## Task 2: Extract SettingsBody from SettingsScreen

**Files:**
- Create: `src/components/SettingsBody.tsx`
- Reference: `src/screens/SettingsScreen.tsx` (will be deleted in Task 8)

The body of `SettingsScreen` (lines 168–390 — sections PROFILE through LOGOUT) becomes a self-contained component. The outer `<SafeAreaView>` and back-button header stay in the *modal* host (Task 3), not here.

- [ ] **Step 1: Read the full SettingsScreen file**

Run: `wc -l src/screens/SettingsScreen.tsx`

Expected: ~451 lines. Read it once end-to-end before starting the extract — it has its own helpers (`OptionPills`, password reset state, push hook usage) that all need to come along.

- [ ] **Step 2: Create the new file with the props interface**

```tsx
// src/components/SettingsBody.tsx
/**
 * Pure-content settings panel: profile + theme + deck + language + haptics
 * + notifications + install-app + logout. No SafeAreaView, no header — host
 * components (SettingsModal) provide the chrome.
 *
 * onClose: closes the host modal. Called when a section needs to navigate
 * away (e.g., "Reset password" → AuthScreen) so the modal isn't left open
 * underneath.
 *
 * navigation: react-navigation prop, used by sections that route away from
 * settings. Pass it through from the host.
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable, ScrollView, Platform,
} from 'react-native';
import { Spacing, Radius, TextStyles } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { useSettingsStore, type ThemePreference } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';
import { signOut, updateUserMetadata, resetPasswordForEmail, resendConfirmationEmail } from '../lib/supabase/authService';
import { setPlayerName as setPlayerNameInStorage } from '../lib/supabase/auth';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n/config';
import { usePushSubscribe } from '../lib/push/usePushSubscribe';
import { PwaInstallModal } from './PwaInstallModal';
import { isStandalone } from '../lib/pwaInstall';

export interface SettingsBodyProps {
  onClose: () => void;
}

const AVATAR_PRESETS = ['🦈', '🐺', '🦊', '🐻', '🐱', '🎯', '🎲', '🃏', '👑', '💎', '🔥', '⭐', '🏆'];
const AVATAR_COLORS = ['#3380CC', '#CC4D80', '#66B366', '#9966CC', '#CC9933', '#33AAAA', '#CC6633', '#6666CC'];
```

- [ ] **Step 3: Move the OptionPills helper**

In `SettingsScreen.tsx`, the `OptionPills` component is defined just below the imports. Cut-paste the entire definition into `SettingsBody.tsx` directly under the imports. Don't export it.

- [ ] **Step 4: Move all stateful logic into the SettingsBody component**

The export shape:

```tsx
export const SettingsBody: React.FC<SettingsBodyProps> = ({ onClose }) => {
  // Copy verbatim from SettingsScreen body:
  // - useTheme/useTranslation/i18n hooks
  // - useSettingsStore selectors
  // - useAuthStore selectors
  // - usePushSubscribe()
  // - showPwaModal state and pwaInstalled detect
  // - all callbacks (handleSaveProfile, handleLogout, handleResendConfirmation,
  //   handlePasswordReset, handleLanguageChange) — verbatim
  // - all view/setView state (e.g., showResetForm, etc.)
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: Spacing.md, gap: Spacing.md, paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* === PROFILE === */}
      …existing JSX from SettingsScreen lines 168–260…

      {/* === THEME === */}
      …existing JSX…

      {/* === DECK === */}
      …existing JSX…

      {/* === LANGUAGE === */}
      …existing JSX…

      {/* === HAPTICS === */}
      …existing JSX…

      {/* === NOTIFICATIONS === */}
      …existing JSX…

      {/* === INSTALL APP === */}
      …existing JSX…

      {/* === LOGOUT === */}
      …existing JSX…

      <PwaInstallModal visible={showPwaModal} onClose={() => setShowPwaModal(false)} />
    </ScrollView>
  );
};
```

The styles object (`StyleSheet.create({…})` at the bottom of SettingsScreen, ~line 410+) moves to the bottom of `SettingsBody.tsx` unchanged.

**Important:** the original `SafeAreaView` wrapper and the header `<View>` (lines 145–166 of SettingsScreen, with the back button) do *not* come along — those belong to the modal host.

- [ ] **Step 5: Drop unused imports**

After extraction, `SettingsBody.tsx` no longer needs `SafeAreaView`. Remove it.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "SettingsBody|SettingsScreen" | head`

Expected: no errors related to `SettingsBody.tsx`. SettingsScreen errors at this step are fine — it'll be deleted in Task 8.

- [ ] **Step 7: Commit**

```bash
git add src/components/SettingsBody.tsx
git commit -m "feat(settings): extract SettingsBody from SettingsScreen"
```

---

## Task 3: SettingsModal overlay host

**Files:**
- Create: `src/components/SettingsModal.tsx`

Slide-up bottom-sheet that fills 90%+ of the viewport, scrollable body, ✕ close at top-right. Mirrors `ChatPanel` proportions but covers more height.

- [ ] **Step 1: Create the file**

```tsx
// src/components/SettingsModal.tsx
import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettingsUIStore } from '../store/settingsUIStore';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';
import { Spacing, Radius, TextStyles } from '../constants';
import { SettingsBody } from './SettingsBody';

export const SettingsModal: React.FC = () => {
  const visible = useSettingsUIStore((s) => s.visible);
  const close = useSettingsUIStore((s) => s.close);
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { height } = useWindowDimensions();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={close}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={close} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderColor: colors.glassLight,
              height: height * 0.92,
            },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.glassLight }]}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              {t('settings.title', 'Settings')}
            </Text>
            <Pressable onPress={close} hitSlop={12} testID="settings-modal-close">
              <Text style={[styles.closeX, { color: colors.textMuted }]}>✕</Text>
            </Pressable>
          </View>
          <SettingsBody onClose={close} />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  backdropTap: { ...StyleSheet.absoluteFillObject },
  sheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  title: { ...TextStyles.h3 },
  closeX: { fontSize: 22, fontWeight: '700' },
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "SettingsModal"`

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "feat(settings): SettingsModal overlay host"
```

---

## Task 4: Mount SettingsModal at App root

**Files:**
- Modify: `src/navigation/AppNavigator.tsx`

The modal lives outside `Stack.Navigator` so it floats above any active screen. It renders `null` until `useSettingsUIStore.visible === true`.

- [ ] **Step 1: Find the Stack.Navigator close + GlobalFeedbackOverlay sibling**

Run: `grep -n "GlobalFeedbackOverlay\|</Stack.Navigator>" src/navigation/AppNavigator.tsx`

Expected: finds line ~493 (`</Stack.Navigator>`) and ~494 (`<GlobalFeedbackOverlay />`).

- [ ] **Step 2: Add the import**

Near the other component imports in `AppNavigator.tsx`, add:

```ts
import { SettingsModal } from '../components/SettingsModal';
```

- [ ] **Step 3: Mount alongside GlobalFeedbackOverlay**

Find the block:

```tsx
        </Stack.Navigator>
        <GlobalFeedbackOverlay />
      </AuthProvider>
```

Change to:

```tsx
        </Stack.Navigator>
        <GlobalFeedbackOverlay />
        <SettingsModal />
      </AuthProvider>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "AppNavigator"`

Expected: no output.

- [ ] **Step 5: Smoke test**

Start dev server: `npx expo start --port 8081`. In a browser console while on Welcome:

```js
window.__triggerSettings = () => {
  // Force-open from console for verification.
  // Find via React DevTools or just navigate via Lobby in the next task.
}
```

Skip — easier to verify after Task 5 wires the real entry point.

- [ ] **Step 6: Commit**

```bash
git add src/navigation/AppNavigator.tsx
git commit -m "feat(settings): mount SettingsModal at AppNavigator root"
```

---

## Task 5: Lobby + WaitingRoom ⚙️ open the modal

**Files:**
- Modify: `src/screens/LobbyScreen.tsx`
- Modify: `src/screens/WaitingRoomScreen.tsx`

Replace `props.navigation.navigate('Settings')` with `useSettingsUIStore.getState().open()`.

- [ ] **Step 1: Find the Lobby route wiring**

Run: `grep -n "navigate('Settings')" src/navigation/AppNavigator.tsx`

Expected: ~3 hits (Lobby, WaitingRoom, GameTable wirings).

- [ ] **Step 2: Update Lobby wiring in AppNavigator**

In `src/navigation/AppNavigator.tsx`, find:

```tsx
                  onSettings={() => (props.navigation as any).navigate('Settings')}
```

Replace **all three** occurrences (Lobby, WaitingRoom, GameTable) with:

```tsx
                  onSettings={() => useSettingsUIStore.getState().open()}
```

Add the store import at the top of the file:

```ts
import { useSettingsUIStore } from '../store/settingsUIStore';
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "AppNavigator"`

Expected: no output.

- [ ] **Step 4: Smoke test**

Restart dev server. Click ⚙️ from Lobby header. Expected: modal slides up from bottom. Tap ✕ or backdrop to close. Open it again — all sections (Profile, Theme, Deck, Language, Haptics, Notifications, Install App, Logout) should render.

If the modal opens but body is blank — check console for JSX errors in `SettingsBody`.

- [ ] **Step 5: Commit**

```bash
git add src/navigation/AppNavigator.tsx
git commit -m "feat(settings): lobby/waiting/game ⚙️ open shared modal"
```

---

## Task 6: Replace inline settings modal in BettingPhase

**Files:**
- Modify: `src/components/betting/BettingPhase.tsx`

Remove the entire inline `<Modal>` block (~lines 740–853 — title "Settings panel for in-game") and the `showSettingsModal` state. The ⚙️ Pressable's `onPress` calls the store's `open()`.

- [ ] **Step 1: Locate the inline modal**

Run: `grep -n "showSettingsModal\|setShowSettingsModal" src/components/betting/BettingPhase.tsx`

Expected: ~5 hits (state declaration, ⚙️ onPress, modal block, close button, close-on-overlay tap).

- [ ] **Step 2: Drop the state declaration**

Find:

```tsx
  const [showSettingsModal, setShowSettingsModal] = useState(false);
```

Delete this line.

- [ ] **Step 3: Update the ⚙️ onPress**

Find:

```tsx
              onPress={() => setShowSettingsModal(true)}
```

Replace with:

```tsx
              onPress={() => useSettingsUIStore.getState().open()}
```

- [ ] **Step 4: Add the store import**

Near the top of the file with the other store imports:

```ts
import { useSettingsUIStore } from '../../store/settingsUIStore';
```

- [ ] **Step 5: Delete the entire inline `<Modal>` block**

Find the block starting around line 740:

```tsx
      <Modal
        visible={showSettingsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSettingsModal(false)}
      >
        … (the entire settings panel) …
      </Modal>
```

Delete this block entirely (verify the closing `</Modal>` is included). Match braces — there's a closing `</View>` immediately before that stays.

- [ ] **Step 6: Drop now-unused styles**

In the StyleSheet at the bottom of `BettingPhase.tsx`, delete these style entries (they were only consumed by the deleted modal):
- `modalOverlay`
- `settingsPanel`
- `settingsPanelTitle`
- `settingsSection`
- `settingsSectionTitle`
- `settingsValue`
- `settingsPills`
- `settingsPill`
- `settingsPillText`
- `settingsCloseBtn`
- `settingsCloseBtnText`

If any are still referenced elsewhere (grep first), keep them. Use `grep -n "styles.settingsPanel\|styles.settingsPill\|styles.settingsCloseBtn" src/components/betting/BettingPhase.tsx` to check before deleting.

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "BettingPhase"`

Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/components/betting/BettingPhase.tsx
git commit -m "refactor(settings): BettingPhase delegates to global SettingsModal"
```

---

## Task 7: Replace inline settings modal in GameTableScreen

**Files:**
- Modify: `src/screens/GameTableScreen.tsx`

Same change as Task 6, applied to `GameTableScreen`.

- [ ] **Step 1: Locate the inline modal**

Run: `grep -n "showSettingsModal\|setShowSettingsModal" src/screens/GameTableScreen.tsx`

Expected: ~5 hits.

- [ ] **Step 2: Apply the same delete + swap pattern as Task 6**

- Delete `const [showSettingsModal, setShowSettingsModal] = useState(false);` (~line 450).
- Replace `onPress={() => setShowSettingsModal(true)}` (~line 882) with `onPress={() => useSettingsUIStore.getState().open()}`.
- Add import: `import { useSettingsUIStore } from '../store/settingsUIStore';`
- Delete the inline `<Modal visible={showSettingsModal} … >` block (~lines 1311 onward), match the closing `</Modal>` carefully.
- Drop now-unused styles (same list as Task 6: `settingsPanel`, `settingsPanelTitle`, etc.). Grep before deleting to avoid removing styles referenced by other modals (the ScoreboardModal block uses `modalOverlay`, `modalButton`, etc. — keep those).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "GameTableScreen"`

Expected: no output.

- [ ] **Step 4: Smoke test**

Restart dev server. Start a solo bot game. Tap ⚙️ on the GameTable. Expected: same modal as in Lobby. Same in BettingPhase. Tap close — modal slides down, game state intact behind.

- [ ] **Step 5: Commit**

```bash
git add src/screens/GameTableScreen.tsx
git commit -m "refactor(settings): GameTableScreen delegates to global SettingsModal"
```

---

## Task 8: Delete SettingsScreen + remove route

**Files:**
- Delete: `src/screens/SettingsScreen.tsx`
- Modify: `src/navigation/AppNavigator.tsx`

After Tasks 5–7, no caller routes to `Settings`. Remove the route and the file.

- [ ] **Step 1: Confirm zero remaining call sites**

Run: `grep -rn "navigate('Settings')\|name=\"Settings\"" src/`

Expected: only one hit — the `<Stack.Screen name="Settings">` block in AppNavigator.tsx that we're about to delete.

- [ ] **Step 2: Delete the Stack.Screen block**

In `src/navigation/AppNavigator.tsx`, find:

```tsx
            <Stack.Screen name="Settings">
              {(props) => (
                <SettingsScreen
                  onBack={() => (props.navigation as any).goBack()}
                  onProfile={() => (props.navigation as any).navigate('Profile')}
                />
              )}
            </Stack.Screen>
```

Delete the entire block.

- [ ] **Step 3: Drop the SettingsScreen import**

In the same file, find and delete:

```ts
import { SettingsScreen } from '../screens/SettingsScreen';
```

- [ ] **Step 4: Delete the file**

Run: `git rm src/screens/SettingsScreen.tsx`

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "SettingsScreen|AppNavigator"`

Expected: no output.

- [ ] **Step 6: Smoke test**

Restart dev server. Verify ⚙️ from Lobby still opens the modal. Verify deep-link `nigels.online/settings` (if any) doesn't 404 — there is no `/settings` path mapping in `linking` config, so this isn't a regression.

- [ ] **Step 7: Commit**

```bash
git add src/navigation/AppNavigator.tsx
git commit -m "refactor(settings): drop SettingsScreen route, modal is the only entry"
```

---

# Phase 2 — Auth (Google OAuth + Save Progress)

## Task 9: Configure Google OAuth in Supabase (USER GATE)

**Files:** none — operator action.

This must be done before client code can complete OAuth. Akula performs this in the Supabase dashboard + Google Cloud Console.

- [ ] **Step 1: Enable Google in Supabase**

In Supabase Dashboard → Authentication → Providers → Google → Enable.

- [ ] **Step 2: Set up Google OAuth client**

In Google Cloud Console → APIs & Services → Credentials → Create OAuth 2.0 Client (Web application):
- **Authorized JavaScript origins:**
  - `https://nigels.online`
  - `http://localhost:8081`
- **Authorized redirect URIs:**
  - The Supabase-provided callback URL shown on the Google provider page (looks like `https://<project-ref>.supabase.co/auth/v1/callback`)

- [ ] **Step 3: Paste credentials into Supabase**

Copy Client ID + Client Secret from Google Cloud Console → paste into Supabase's Google provider config → Save.

- [ ] **Step 4 (no commit)**

Operator task — no code change.

---

## Task 10: authService Google methods

**Files:**
- Modify: `src/lib/supabase/authService.ts`

Add three exports: `signInWithGoogle`, `linkGoogleToAnonymous`, `connectGoogle` (smart dispatcher), plus `clearLocalGuestState` for the collision-switch path.

- [ ] **Step 1: Find the existing exports**

Run: `grep -n "^export" src/lib/supabase/authService.ts`

Expected: ~7 exports — `signInAnonymously`, `signInWithEmail`, `signUpWithEmail`, `linkEmailToAnonymous`, `resendConfirmationEmail`, `updateUserMetadata`, etc.

- [ ] **Step 2: Add the new helpers at the bottom of the file**

```ts
// ============================================================
// GOOGLE OAUTH
// ============================================================

/**
 * Sign in via Google OAuth. Redirects to Google's consent page; resolution
 * comes back via the URL hash on return, consumed by Supabase's auto
 * detection. Use this for fresh sign-in (not for anonymous→Google upgrade,
 * which preserves UUID — see linkGoogleToAnonymous).
 *
 * Returns immediately. The post-redirect session change fires through
 * onAuthStateChange and is picked up by existing listeners.
 */
export async function signInWithGoogle(): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Multiplayer not configured');
  const supabase = getSupabaseClient();
  const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (error) throw new Error(friendlyAuthError(error.message));
}

/**
 * Link a Google identity to the current anonymous session. UUID preserved,
 * so all room_players / game_events history stays attached. After return,
 * user.is_anonymous becomes false. Same redirect mechanism as
 * signInWithGoogle.
 */
export async function linkGoogleToAnonymous(): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Multiplayer not configured');
  const supabase = getSupabaseClient();
  const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
  const { error } = await supabase.auth.linkIdentity({
    provider: 'google',
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (error) throw new Error(friendlyAuthError(error.message));
}

/**
 * Smart dispatcher: links Google for anonymous users (preserves UUID),
 * adds Google as an extra identity for already-registered users.
 */
export async function connectGoogle(): Promise<void> {
  const user = await getCurrentUser();
  if (user && (user as any).is_anonymous) {
    await linkGoogleToAnonymous();
  } else {
    await signInWithGoogle();
  }
}

/**
 * Wipe local guest-only AsyncStorage so a collision-switch (signing in as
 * an existing different user) starts fresh on this device. Only data
 * tied to *this device's session* is wiped — server-side rows (rooms,
 * scores) belong to the previous UUID and stay untouched.
 */
export async function clearLocalGuestState(): Promise<void> {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  // Delete everything that's per-device-guest. Keep auth-prompt dismissals
  // because they encode user *preference* (don't nag me again) and survive
  // identity changes.
  await Promise.all([
    AsyncStorage.removeItem('active_room_id_v1'),
    AsyncStorage.removeItem('player_name'),
  ]);
}
```

- [ ] **Step 3: Add the import for `getCurrentUser`**

`getCurrentUser` may already be imported (used by `linkEmailToAnonymous`). If not, add at the top:

```ts
import { getCurrentUser } from './authService';  // self-import not OK
```

If `getCurrentUser` is in this same file (check with `grep -n "export.*getCurrentUser" src/lib/supabase/authService.ts`), no import needed — call it directly.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "authService"`

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/authService.ts
git commit -m "feat(auth): signInWithGoogle, linkGoogleToAnonymous, connectGoogle helpers"
```

---

## Task 11: Google button in AuthScreen

**Files:**
- Modify: `src/screens/AuthScreen.tsx`

Add a primary Google button above the email form, with an "or" divider.

- [ ] **Step 1: Locate the form mount point**

Run: `grep -n "TextInput\|email\|password\|tab === 'signIn'\|tab === 'signUp'" src/screens/AuthScreen.tsx | head -20`

Find where the email TextInput is rendered (typically inside both signIn and signUp tab branches).

- [ ] **Step 2: Add the import**

In `src/screens/AuthScreen.tsx`, near the other authService imports:

```ts
import { connectGoogle } from '../lib/supabase/authService';
```

- [ ] **Step 3: Add the handler**

Inside the component, alongside `handleSignIn` / `handleSignUp`:

```tsx
const handleGoogle = useCallback(async () => {
  setErrorMsg('');
  try {
    await connectGoogle();
    // Resolution comes via the redirect; nothing to do here on success.
  } catch (err) {
    setErrorMsg((err as Error).message ?? 'Google sign-in failed');
  }
}, []);
```

- [ ] **Step 4: Add the button JSX above the form**

Find the form container (the `<View>` that wraps the email TextInput in the "form" branch). Above it, add:

```tsx
<Pressable
  onPress={handleGoogle}
  style={[styles.googleBtn, { backgroundColor: '#ffffff', borderColor: colors.glassLight }]}
  testID="auth-google"
>
  <Text style={styles.googleBtnText}>{`G  ${t('auth.continueWithGoogle')}`}</Text>
</Pressable>
<View style={styles.divider}>
  <View style={[styles.dividerLine, { backgroundColor: colors.glassLight }]} />
  <Text style={[styles.dividerText, { color: colors.textMuted }]}>{t('auth.or', 'or')}</Text>
  <View style={[styles.dividerLine, { backgroundColor: colors.glassLight }]} />
</View>
```

(The "G" prefix is a placeholder. Akula can swap to an SVG/icon later.)

- [ ] **Step 5: Add the styles**

In the `StyleSheet.create({…})` block at the bottom:

```ts
googleBtn: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  paddingVertical: Spacing.md,
  borderRadius: Radius.md,
  borderWidth: 1,
  marginBottom: Spacing.md,
},
googleBtnText: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },
divider: {
  flexDirection: 'row',
  alignItems: 'center',
  marginVertical: Spacing.md,
  gap: Spacing.sm,
},
dividerLine: { flex: 1, height: 1 },
dividerText: { fontSize: 12, fontWeight: '500' },
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "AuthScreen"`

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/screens/AuthScreen.tsx
git commit -m "feat(auth): Google button + or-divider above email form in AuthScreen"
```

---

## Task 12: promptGate module

**Files:**
- Create: `src/lib/auth/promptGate.ts`

AsyncStorage-backed dismissal flags. Each trigger has its own key.

- [ ] **Step 1: Create the file**

```ts
// src/lib/auth/promptGate.ts
/**
 * Dismissal-flag gate for the "Save Progress" auto-prompts.
 *
 * The auto-prompts fire once per trigger per device. After the user takes
 * any action in the modal (Google / Email / Maybe later / Continue as guest /
 * backdrop tap), the relevant flag is set and the trigger never fires
 * again. Sign-in clears all flags so a future sign-out → guest cycle
 * starts fresh.
 *
 * Manual entry from Settings → "Save Progress" is unaffected.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCurrentUser } from '../supabase/authService';

const KEY_AFTER_GAME = 'auth_prompt_after_game_dismissed_v1';
const KEY_BEFORE_CREATE = 'auth_prompt_before_create_dismissed_v1';

async function isGuest(): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    return !!user && (user as { is_anonymous?: boolean }).is_anonymous === true;
  } catch {
    // No auth → behave as guest so nothing prompts.
    return true;
  }
}

export async function shouldShowAfterGame(): Promise<boolean> {
  if (!(await isGuest())) return false;
  return (await AsyncStorage.getItem(KEY_AFTER_GAME)) !== '1';
}

export async function shouldShowBeforeCreateRoom(): Promise<boolean> {
  if (!(await isGuest())) return false;
  return (await AsyncStorage.getItem(KEY_BEFORE_CREATE)) !== '1';
}

export async function markDismissed(trigger: 'afterGame' | 'beforeCreate'): Promise<void> {
  await AsyncStorage.setItem(
    trigger === 'afterGame' ? KEY_AFTER_GAME : KEY_BEFORE_CREATE,
    '1',
  );
}

export async function clearAllDismissals(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(KEY_AFTER_GAME),
    AsyncStorage.removeItem(KEY_BEFORE_CREATE),
  ]);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "promptGate"`

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/promptGate.ts
git commit -m "feat(auth): promptGate for after-game / before-create dismissal flags"
```

---

## Task 13: SaveProgressModal component

**Files:**
- Create: `src/components/SaveProgressModal.tsx`

Trigger-aware modal. Two primary buttons (Google, Email), one dismiss. Title/body switch by trigger.

- [ ] **Step 1: Create the file**

```tsx
// src/components/SaveProgressModal.tsx
import React, { useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { Spacing, Radius, TextStyles } from '../constants';
import { connectGoogle } from '../lib/supabase/authService';
import { markDismissed } from '../lib/auth/promptGate';

export type SaveProgressTrigger = 'afterGame' | 'beforeCreate';

export interface SaveProgressModalProps {
  visible: boolean;
  trigger: SaveProgressTrigger;
  onResolved: () => void; // called after any user action (or dismiss)
  onUseEmail: () => void; // host navigates to AuthScreen
}

export const SaveProgressModal: React.FC<SaveProgressModalProps> = ({
  visible, trigger, onResolved, onUseEmail,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);

  const titleKey = trigger === 'afterGame'
    ? 'auth.savePromptAfterGameTitle'
    : 'auth.savePromptBeforeCreateTitle';
  const bodyKey = trigger === 'afterGame'
    ? 'auth.savePromptAfterGameBody'
    : 'auth.savePromptBeforeCreateBody';
  const dismissKey = trigger === 'afterGame' ? 'auth.maybeLater' : 'auth.continueAsGuest';

  const handleGoogle = async () => {
    setBusy(true);
    try {
      await markDismissed(trigger);
      await connectGoogle();
      // Redirect happens; onResolved fires on return via host's onAuthStateChange.
      onResolved();
    } catch {
      onResolved();
    } finally {
      setBusy(false);
    }
  };
  const handleEmail = async () => {
    await markDismissed(trigger);
    onUseEmail();
    onResolved();
  };
  const handleDismiss = async () => {
    await markDismissed(trigger);
    onResolved();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={handleDismiss}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={handleDismiss} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t(titleKey)}</Text>
          <ScrollView style={styles.body}>
            <Text style={[styles.bodyText, { color: colors.textSecondary }]}>{t(bodyKey)}</Text>
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              onPress={handleDismiss}
              style={[styles.secondaryBtn, { borderColor: colors.glassLight }]}
              testID="save-progress-dismiss"
            >
              <Text style={[styles.secondaryBtnText, { color: colors.textMuted }]}>{t(dismissKey)}</Text>
            </Pressable>
            <Pressable
              onPress={handleEmail}
              disabled={busy}
              style={[styles.secondaryBtn, { borderColor: colors.glassLight }]}
              testID="save-progress-email"
            >
              <Text style={[styles.secondaryBtnText, { color: colors.textPrimary }]}>{t('auth.useEmail')}</Text>
            </Pressable>
            <Pressable
              onPress={handleGoogle}
              disabled={busy}
              style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: busy ? 0.5 : 1 }]}
              testID="save-progress-google"
            >
              <Text style={styles.primaryBtnText}>{t('auth.continueWithGoogle')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: Spacing.lg },
  backdropTap: { ...StyleSheet.absoluteFillObject },
  sheet: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.lg, maxHeight: '85%' },
  title: { ...TextStyles.h3, marginBottom: Spacing.sm },
  body: { maxHeight: 220 },
  bodyText: { ...TextStyles.body, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg, justifyContent: 'flex-end', flexWrap: 'wrap' },
  primaryBtn: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderRadius: Radius.md, alignItems: 'center' },
  primaryBtnText: { color: '#ffffff', fontWeight: '700' },
  secondaryBtn: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center' },
  secondaryBtnText: { fontWeight: '600' },
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "SaveProgressModal"`

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/SaveProgressModal.tsx
git commit -m "feat(auth): SaveProgressModal with trigger-aware copy"
```

---

## Task 14: Save Progress section in SettingsBody

**Files:**
- Modify: `src/components/SettingsBody.tsx`

Add a new section above Profile, visible only when `user?.is_anonymous`. Tapping closes the modal and navigates to `AuthScreen` (so the user can pick Google or email).

- [ ] **Step 1: Add navigation prop**

`SettingsBody` doesn't currently receive `navigation`. Two options: receive it as a prop, or use `useNavigation()` from React Navigation. Use the latter to keep the prop interface clean.

In `SettingsBody.tsx`, add the import:

```ts
import { useNavigation } from '@react-navigation/native';
```

Inside the component, add:

```tsx
const navigation = useNavigation<any>();
```

- [ ] **Step 2: Detect anonymous-ness**

The component already reads `user` from `useAuthStore`. Add:

```tsx
const isAnonymous = !!user && (user as { is_anonymous?: boolean }).is_anonymous === true;
```

- [ ] **Step 3: Add the new section JSX**

Just inside the top of the `<ScrollView>` body (before the existing `{/* === PROFILE === */}` block), insert:

```tsx
{isAnonymous && (
  <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
    <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
      {t('auth.saveProgressTitle', 'Save your progress')}
    </Text>
    <Text style={[styles.sectionDesc, { color: colors.textMuted }]}>
      {t('auth.saveProgressDesc', 'Sign in to keep your stats, friends, and history across devices.')}
    </Text>
    <Pressable
      onPress={() => {
        onClose();
        navigation.navigate('Auth');
      }}
      style={[styles.saveBtn, { backgroundColor: colors.accent, alignSelf: 'flex-start', paddingHorizontal: Spacing.lg }]}
      testID="settings-save-progress"
    >
      <Text style={styles.saveBtnText}>{t('auth.saveProgress', 'Save progress')}</Text>
    </Pressable>
  </View>
)}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "SettingsBody"`

Expected: no output.

- [ ] **Step 5: Smoke test**

Restart dev server. Open the modal as an anonymous user — the new section should be at the top. Click "Save progress" — modal closes and AuthScreen opens.

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsBody.tsx
git commit -m "feat(auth): Save Progress section in SettingsBody for anonymous users"
```

---

## Task 15: Auto-prompt after first completed game

**Files:**
- Modify: `src/screens/GameTableScreen.tsx`

When the game-over scorecard is rendered (`ScoreboardModal` shown with finished state), check `shouldShowAfterGame()`. If true, mount `SaveProgressModal({ trigger: 'afterGame' })`.

- [ ] **Step 1: Find the game-over render path**

Run: `grep -n "ScoreboardModal\|gameOver\|isViewingScores\|phase === 'finished'" src/screens/GameTableScreen.tsx | head -10`

Identify the boolean that becomes true when the game is over (not when the user manually opens scoreboard mid-game). Look for `room.phase === 'finished'` or similar.

- [ ] **Step 2: Add state for the prompt**

Inside `GameTableScreen` component, alongside the other useState hooks:

```tsx
const [showSavePrompt, setShowSavePrompt] = useState(false);
```

- [ ] **Step 3: Add the trigger effect**

After the other top-level effects:

```tsx
useEffect(() => {
  // Fires once on the transition into "game over" state. Multi-game
  // sessions only see this on the first finished game (subsequent
  // game-overs are gated by the dismissed flag).
  if (room?.phase !== 'finished') return;
  let cancelled = false;
  void (async () => {
    const { shouldShowAfterGame } = await import('../lib/auth/promptGate');
    if (!cancelled && (await shouldShowAfterGame())) {
      setShowSavePrompt(true);
    }
  })();
  return () => { cancelled = true; };
}, [room?.phase]);
```

- [ ] **Step 4: Mount the modal in JSX**

At the bottom of GameTableScreen's JSX (alongside the other modals), add:

```tsx
<SaveProgressModal
  visible={showSavePrompt}
  trigger="afterGame"
  onResolved={() => setShowSavePrompt(false)}
  onUseEmail={() => {
    setShowSavePrompt(false);
    (props as any).navigation?.navigate('Auth');
  }}
/>
```

If `navigation` isn't directly available in scope, add `useNavigation` similar to Task 14.

- [ ] **Step 5: Add the import**

```ts
import { SaveProgressModal } from '../components/SaveProgressModal';
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "GameTableScreen"`

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/screens/GameTableScreen.tsx
git commit -m "feat(auth): auto-prompt Save Progress after first finished game"
```

---

## Task 16: Auto-prompt before creating multiplayer room

**Files:**
- Modify: `src/screens/LobbyScreen.tsx`

Soft prompt — never blocks. If the user picks Google or Email, sign-in starts; if they pick Continue as Guest or dismiss, room creation proceeds immediately.

- [ ] **Step 1: Add state**

In `LobbyScreen`, alongside `isCreating` and the PWA modal state:

```tsx
const [showCreateSavePrompt, setShowCreateSavePrompt] = useState(false);
const pendingCreateRef = useRef(false);
```

Add to imports:

```ts
import { useRef } from 'react';
import { SaveProgressModal } from '../components/SaveProgressModal';
import { shouldShowBeforeCreateRoom } from '../lib/auth/promptGate';
```

- [ ] **Step 2: Wrap handleCreateRoom**

Find the existing `handleCreateRoom` callback. Refactor it to:

```tsx
const performCreateRoom = useCallback(async () => {
  // (the existing body of handleCreateRoom — moved here verbatim)
  …
}, [/* same deps as before */]);

const handleCreateRoom = useCallback(async () => {
  // Pre-flight: ask the gate if we should show the auto-prompt.
  // Only the first create per anonymous device sees the prompt.
  const showPrompt = await shouldShowBeforeCreateRoom();
  if (showPrompt) {
    pendingCreateRef.current = true;
    setShowCreateSavePrompt(true);
    return; // The modal's onResolved will continue the flow.
  }
  await performCreateRoom();
}, [performCreateRoom]);
```

- [ ] **Step 3: Mount the modal in the return JSX**

Above the closing `</SafeAreaView>` (alongside the existing `<PwaInstallModal>`):

```tsx
<SaveProgressModal
  visible={showCreateSavePrompt}
  trigger="beforeCreate"
  onResolved={async () => {
    setShowCreateSavePrompt(false);
    if (pendingCreateRef.current) {
      pendingCreateRef.current = false;
      await performCreateRoom();
    }
  }}
  onUseEmail={() => {
    pendingCreateRef.current = false;
    setShowCreateSavePrompt(false);
    (props as any).navigation?.navigate?.('Auth');
  }}
/>
```

If `props.navigation` isn't reachable here, use `useNavigation()` (see Task 14 for the pattern). LobbyScreen already takes navigation through callbacks (e.g., `onSettings`); the simplest path is to add a new optional `navigation` prop or use the hook.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "LobbyScreen"`

Expected: no output.

- [ ] **Step 5: Smoke test**

Restart dev server as anonymous guest. From Lobby, tap "Create Room". Expected: SaveProgressModal slides up. Tap "Continue as guest" → modal closes, room creation proceeds, you land in WaitingRoom. Try again — no modal this time (dismissed flag is set).

- [ ] **Step 6: Commit**

```bash
git add src/screens/LobbyScreen.tsx
git commit -m "feat(auth): auto-prompt Save Progress before first multiplayer create"
```

---

## Task 17: Collision detection on auth state change

**Files:**
- Modify: `src/App.tsx` (or the auth listener module if one exists)

When OAuth callback returns and the user attempted to *link* but the Google identity is already attached to another Supabase user, Supabase returns an error. Detect it and present the collision confirm.

- [ ] **Step 1: Find existing auth listener**

Run: `grep -rn "onAuthStateChange" src/lib/ src/App.tsx`

Identify the existing handler. The collision detection hooks in here.

- [ ] **Step 2: Add a hash-error detector at App boot**

Supabase reports OAuth errors as URL hash params on return: `#error=...&error_description=...`. The `identity_already_exists` case shows up as `error_code=identity_already_exists`. Add this near the existing SW / push setup block in `App.tsx`:

```ts
useEffect(() => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const hash = window.location.hash;
  if (!hash || !hash.includes('error')) return;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const errCode = params.get('error_code') || params.get('error');
  if (errCode !== 'identity_already_exists') return;

  // Strip the hash so a refresh doesn't re-prompt.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);

  void (async () => {
    const accept = window.confirm(
      // English-only here — i18n.t isn't ready at this boot point.
      // The dialog is rare and intentionally simple.
      'This Google account is already linked to a different Nägels profile.\n\n' +
      'Switch to the existing profile? Your guest data on this device will be replaced.',
    );
    if (!accept) return;
    const { signOut, signInWithGoogle, clearLocalGuestState } = await import('./lib/supabase/authService');
    await signOut();
    await clearLocalGuestState();
    await signInWithGoogle();
  })();
}, []);
```

(Keep this English-only — `i18next` may not be initialised yet at boot.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "App.tsx"`

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(auth): detect identity_already_exists OAuth error and offer switch"
```

---

## Task 18: i18n keys

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/es.json`

EN copy is normative. RU/ES translated alongside.

- [ ] **Step 1: Add EN keys**

In `src/i18n/locales/en.json`, find the `auth` section. Add at the bottom:

```jsonc
"continueWithGoogle": "Continue with Google",
"useEmail": "Use email",
"or": "or",
"saveProgress": "Save progress",
"saveProgressTitle": "Save your progress",
"saveProgressDesc": "Sign in to keep your stats, friends, and history across devices.",
"savePromptAfterGameTitle": "🎉 Game over!",
"savePromptAfterGameBody": "Want to save your progress? Sign in to keep your stats and history across devices.",
"savePromptBeforeCreateTitle": "Save your progress?",
"savePromptBeforeCreateBody": "Sign in so friends can recognize you across devices, and your stats follow you.",
"maybeLater": "Maybe later",
"continueAsGuest": "Continue as guest",
"collisionTitle": "Switch to existing account?",
"collisionBody": "This Google account is already linked to a different Nägels profile. Local guest data on this device will be replaced.",
"switchAccount": "Switch"
```

- [ ] **Step 2: Add RU keys**

In `src/i18n/locales/ru.json`, in the `auth` section:

```jsonc
"continueWithGoogle": "Войти через Google",
"useEmail": "Через email",
"or": "или",
"saveProgress": "Сохранить прогресс",
"saveProgressTitle": "Сохрани прогресс",
"saveProgressDesc": "Войди, чтобы статистика, друзья и история сохранились между устройствами.",
"savePromptAfterGameTitle": "🎉 Игра окончена!",
"savePromptAfterGameBody": "Хочешь сохранить прогресс? Войди, чтобы статистика и история работали на всех твоих устройствах.",
"savePromptBeforeCreateTitle": "Сохранить прогресс?",
"savePromptBeforeCreateBody": "Войди, чтобы друзья тебя узнавали с любого устройства, а статистика была твоей.",
"maybeLater": "Не сейчас",
"continueAsGuest": "Продолжить как гость",
"collisionTitle": "Переключиться на существующий аккаунт?",
"collisionBody": "Этот Google уже привязан к другому профилю Nägels. Локальные данные гостя на этом устройстве будут заменены.",
"switchAccount": "Переключиться"
```

- [ ] **Step 3: Add ES keys**

In `src/i18n/locales/es.json`, in the `auth` section:

```jsonc
"continueWithGoogle": "Continuar con Google",
"useEmail": "Usar correo",
"or": "o",
"saveProgress": "Guardar progreso",
"saveProgressTitle": "Guarda tu progreso",
"saveProgressDesc": "Inicia sesión para conservar estadísticas, amigos e historial entre dispositivos.",
"savePromptAfterGameTitle": "🎉 ¡Partida terminada!",
"savePromptAfterGameBody": "¿Quieres guardar tu progreso? Inicia sesión para que tus estadísticas y tu historial te sigan entre dispositivos.",
"savePromptBeforeCreateTitle": "¿Guardar tu progreso?",
"savePromptBeforeCreateBody": "Inicia sesión para que tus amigos te reconozcan en cualquier dispositivo y tus estadísticas viajen contigo.",
"maybeLater": "Más tarde",
"continueAsGuest": "Continuar como invitado",
"collisionTitle": "¿Cambiar a la cuenta existente?",
"collisionBody": "Esta cuenta de Google ya está vinculada a otro perfil de Nägels. Los datos locales de invitado en este dispositivo serán reemplazados.",
"switchAccount": "Cambiar"
```

- [ ] **Step 4: Validate JSON**

Run: `node -e "['en','ru','es'].forEach(l => JSON.parse(require('fs').readFileSync('src/i18n/locales/'+l+'.json')))"`

Expected: no output. If it throws, fix the trailing comma / quote.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/ru.json src/i18n/locales/es.json
git commit -m "feat(auth): i18n strings for Google + Save Progress + collision"
```

---

## Task 19: Clear dismissals on sign-in

**Files:**
- Modify: `src/lib/supabase/auth.ts` (or wherever the auth-state listener lives)

When `onAuthStateChange` reports a non-anonymous user (sign-in completed), call `clearAllDismissals()` so future sign-out → guest cycle starts fresh.

- [ ] **Step 1: Find the auth listener**

Run: `grep -n "onAuthStateChange" src/lib/supabase/auth.ts src/store/authStore.ts | head`

Identify where session changes are handled.

- [ ] **Step 2: Add the clear call**

Wherever the listener detects a transition from anonymous → non-anonymous (or any sign-in), add:

```ts
import { clearAllDismissals } from '../auth/promptGate';
// inside the handler:
if (session?.user && !session.user.is_anonymous) {
  void clearAllDismissals().catch(() => {});
}
```

(Path adjust based on actual file location — promptGate is at `src/lib/auth/promptGate.ts`.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "auth\.ts|authStore"`

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/auth.ts  # or wherever the change landed
git commit -m "feat(auth): clear prompt dismissals on successful sign-in"
```

---

## Task 20: Full-flow smoke test (USER GATE)

**Files:** none — manual verification.

- [ ] **Step 1: Settings consolidation regression**

Open dev server. Verify:
1. Lobby ⚙️ opens the new modal with all sections (Profile, Theme, Deck, Language, Haptics, Notifications, Install App, Logout).
2. Inside a solo bot game, BettingPhase ⚙️ opens the same modal.
3. GameTable ⚙️ same.
4. Modal looks consistent across all three contexts.
5. Closing the modal returns to the underlying screen with state intact.
6. Theme/language change inside the modal applies immediately to the screen behind.

- [ ] **Step 2: Manual Save Progress from Settings (anonymous)**

As an anonymous user, open Settings. Expected: "Save your progress" section visible at top. Tap "Save progress" → modal closes, AuthScreen opens. Click Google button → redirected to Google. After consent → returned to lobby, no longer anonymous, "Save your progress" section is gone.

- [ ] **Step 3: After-game prompt**

Play a solo bot game to completion. Expected: SaveProgressModal slides up after game over, copy says "🎉 Game over!". Dismiss. Play another game — no prompt this time.

- [ ] **Step 4: Before-create-room prompt**

Reset the dismissal flag manually (`AsyncStorage.removeItem('auth_prompt_before_create_dismissed_v1')`) or wipe all storage. As anonymous, tap "Create Room". Expected: prompt slides up. Tap "Continue as guest" → room is created. Try again — no prompt.

- [ ] **Step 5: Collision flow**

On a fresh device / browser, after creating a guest profile, tap Save Progress and pick Google with an account already linked to another Nägels profile (i.e., one used during step 2 above). Expected: confirm dialog says the account is taken; tapping Switch wipes local guest state and signs you into the existing profile.

- [ ] **Step 6: i18n switch**

In Settings, switch language between EN/RU/ES. Open SaveProgressModal in each. Expected: copy translates correctly.

- [ ] **Step 7: Mobile Safari + iOS PWA**

Install the PWA on iPhone (per the Task 9-style flow already in production). From PWA, tap Save Progress → Google → consent → return. Expected: PWA reopens (manifest start_url) with new session.

- [ ] **Step 8 (no commit)**

Manual test only. If any step fails, file in BACKLOG and decide whether to fix in this branch or follow up.

---

## Self-review

**Spec coverage:**
- Phase 1 — settings consolidation → Tasks 1–8. ✓
- Phase 2 Flow A (manual via Settings) → Tasks 11 + 14. ✓
- Phase 2 Flow B (after-game) → Task 15. ✓
- Phase 2 Flow C (before-create-room) → Task 16. ✓
- Phase 2 Flow D (collision) → Task 17. ✓
- promptGate logic → Task 12. ✓ Cleared on sign-in → Task 19. ✓
- i18n keys → Task 18. ✓
- Operator step (Supabase Google config) → Task 9. ✓
- Manual smoke → Task 20. ✓

**Placeholder scan:** No "TBD" / "TODO". Two acceptable hedges:
- Task 11 Step 4 "G prefix is a placeholder" — explicit; engineer can swap to a real Google G icon later.
- Task 17 collision uses English-only confirm at boot because i18n isn't initialised yet — explicit reasoning given.

**Type consistency:** `connectGoogle` signature `(): Promise<void>` consistent across Tasks 10, 11, 13. `markDismissed` takes `'afterGame' | 'beforeCreate'` consistently. `SettingsBodyProps.onClose` signature stable. `SaveProgressModalProps` shape matches between Task 13 (definition) and Task 15/16 (consumers).

**Out-of-scope (per spec):** Apple Sign-In, server-side merge, multi-device session reconciliation, Telegram Mini App identity. None of these block the flow.
