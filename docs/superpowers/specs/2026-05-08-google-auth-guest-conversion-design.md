# Google Auth + Guest → Registered Conversion — Design

**Goal:** Anonymous guests can upgrade to a permanent identity via Google OAuth (or existing email/password) without losing their UUID, history, or in-progress state. Conversion is offered at three calibrated moments, all dismissible. As a precondition, the duplicated in-game settings UI is consolidated with the lobby SettingsScreen into a single shared overlay modal — so the new "Save Progress" CTA can live in one place and surface everywhere a gear icon is shown.

**Non-goal:** Replace email/password. Merge two server-side accounts. Apple Sign-In or any other OAuth provider beyond Google.

---

## Background

Today the app signs every fresh visitor in as an anonymous Supabase user (`signInAnonymously`). Email/password upgrade exists via `linkEmailToAnonymous` (uses `auth.updateUser`) — UUID is preserved, all `room_players` / `game_events` rows stay attached. The `AuthScreen` exposes Sign In / Sign Up tabs and a password-reset flow.

What's missing: Google OAuth (no `signInWithOAuth` calls anywhere) and a deliberate "save your progress" moment. Today most guests never visit Settings, so the email upgrade affordance is invisible — the email path exists but converts almost nobody.

Settings UI is currently fragmented in three places:
- `SettingsScreen.tsx` — full-screen route opened from Lobby ⚙️. Has profile, email, theme, deck, language, haptics, push, install-app, logout.
- `BettingPhase.tsx:740` — inline `<Modal>` opened from in-game ⚙️. Subset: read-only display name, language, theme, deck, haptics.
- `GameTableScreen.tsx:1311` — near-identical inline `<Modal>` to BettingPhase. Same subset.

The two in-game modals drift out of sync with SettingsScreen on every change. They have different styling. The user's mental model is "settings is one place, regardless of where I am in the app" — current code violates that. Consolidating is a precondition for adding Save Progress cleanly.

---

## Phase 1: Unified Settings overlay (refactor)

### Architecture

- **Extract** `src/components/SettingsBody.tsx` — pure-content component containing every section currently in `SettingsScreen.tsx` body (profile, password change, email confirmation banner, theme, deck, language, haptics, push notifications, install-app, save-progress (new), logout). No SafeAreaView, no header. Receives `onClose` (used by section-internal navigations like "open AuthScreen").
- **Create** `src/components/SettingsModal.tsx` — overlay host. RN `<Modal animationType="slide" transparent>` wrapping a sheet that fills 90%+ of viewport (similar to ChatPanel pattern, but taller and with internal `<ScrollView>` for the long body). Renders `<SettingsBody onClose={handleClose} />` inside.
- **Create** `src/store/settingsUIStore.ts` — tiny zustand store: `{ visible: boolean, open: () => void, close: () => void }`. Mounted once at App root so any screen can call `useSettingsUIStore.getState().open()`.
- **Mount** `<SettingsModal />` once in `src/App.tsx` (or `AppNavigator.tsx` outside the Stack so it floats over any screen). Modal reads `visible` from the store.

### UI delta

- **`SettingsScreen.tsx`** is removed from `Stack.Navigator` in `AppNavigator.tsx`. Its body migrates into `SettingsBody`.
- **`LobbyScreen.tsx`**: `onSettings` prop call site `props.navigation.navigate('Settings')` → `useSettingsUIStore.getState().open()`. The screen prop chain is preserved for now (still passes `onSettings={() => open()}`); cleanup of unused props happens in the plan if it's clean.
- **`BettingPhase.tsx`**: remove the inline settings modal block (lines ~740-853) and the `showSettingsModal` state. The ⚙️ button calls `useSettingsUIStore.getState().open()` directly. Same change in `GameTableScreen.tsx`.
- **`AuthScreen`** stays a route. Sections inside `SettingsBody` that need to navigate (e.g., "Save Progress" → opens AuthScreen, "Reset password") close the modal first via `onClose`, then call the appropriate navigation.

### Mobile-first ergonomics

- The modal sheet fills the viewport (90%+ height, full width) so it feels like a screen, not a popover. Slide-up animation matches the existing ChatPanel pattern.
- Header inside the sheet has a clear "✕" close button at top-right (44pt touch). Body is `<ScrollView>` so all sections are reachable.
- The 🚪 leave / 🚪 end-game buttons on GameTable already use the same modal-overlay pattern, so the visual vocabulary stays consistent.

### Out-of-scope deletions

- Filtering content per host (lobby vs in-game) is out of scope. Every settings section appears in every context. If a section feels heavy mid-game (e.g., avatar picker), that's a future tweak.

---

## Phase 2: Auth (Google OAuth + Save Progress)

## User flows

### Flow A — Manual conversion via Settings (always available)

User taps any ⚙️ (lobby, betting, gameTable) → unified `SettingsModal` opens. Inside `SettingsBody`, when the user is anonymous, a "Save Progress" section is rendered above Profile with a primary CTA. Tap → modal closes (via `onClose` prop) → app navigates to `AuthScreen`.

`AuthScreen` gains a primary Google button above the email form. Tap → `linkGoogleToAnonymous()` (Supabase `auth.linkIdentity({ provider: 'google' })`) → redirect to Google → return → user's session is now linked. Same UUID.

If the user is *not* anonymous (somehow opened AuthScreen while signed in already with email), the Google button calls `signInWithGoogle()` instead — adds Google as an additional identity to the existing account.

When user is registered, the "Save Progress" section is hidden; existing email + sign-out section is shown instead.

### Flow B — Auto-prompt after first completed game

Hook: `GameTableScreen` renders the final scorecard at game end. The scorecard component, when shown, checks `promptGate.shouldShowAfterGame()`. If true → mount `SaveProgressModal({ trigger: 'afterGame' })`.

Modal copy: "🎉 Game over! Want to save your progress?" Two primary buttons: "Continue with Google" / "Use email". One dismiss button: "Maybe later".

Suppression: any of the three buttons (including dismiss) sets `auth_prompt_after_game_dismissed_v1` in AsyncStorage. Auto-prompt never re-fires at this trigger after the first interaction. Settings entry stays available.

### Flow C — Auto-prompt before creating a multiplayer room

Hook: `LobbyScreen.handleCreateRoom`. Before the `gameClient.createRoom` call, check `promptGate.shouldShowBeforeCreateRoom()`. If true → show `SaveProgressModal({ trigger: 'beforeCreate' })` and *defer* the room creation behind one of the three button actions.

Modal copy: "Save your progress before creating a room — friends will recognize you across devices." Buttons: "Continue with Google" / "Use email" / "Continue as guest".

If the user picks Google or Email, sign-in completes first, then `handleCreateRoom` resumes. If the user picks "Continue as guest" or dismisses (backdrop tap), `handleCreateRoom` resumes immediately and `auth_prompt_before_create_dismissed_v1` is set. Auto-prompt never re-fires at this trigger after the first interaction.

This is a soft prompt — never blocks the create action. Aligns with project principle "guest-first, no registration required to play".

### Flow D — Existing-account collision

User on a fresh device signs in via any of the flows above. Supabase OAuth callback returns `identity_already_exists` (Google identity is already attached to another Supabase user).

Response: confirm dialog — "Switch to your existing Nägels account? Your guest data on this device (display name, avatar, room state, push subscription) will be replaced."

If user accepts: call `signOut()` to drop the anonymous session, then `signInWithGoogle()` (not link). The pre-existing Supabase user becomes the active session. Local AsyncStorage is wiped via existing `clearActiveRoom()` plus a new `clearLocalGuestState()` helper that resets player_name and avatar settings.

If user declines: cancel — anonymous session remains, no changes.

---

## Architecture

### Supabase configuration (operator action — Akula)

1. Supabase Dashboard → Auth → Providers → enable Google.
2. Google Cloud Console → APIs & Services → Credentials → create OAuth 2.0 client.
   - Authorized JavaScript origins: `https://nigels.online`, `http://localhost:8081`.
   - Authorized redirect URIs: the Supabase-provided callback URL (`https://<project>.supabase.co/auth/v1/callback`).
3. Paste client ID + secret back into Supabase.
4. No DB migrations.

### Client code

**New module — `src/lib/supabase/authService.ts` additions:**

- `signInWithGoogle(): Promise<void>` — calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })`. Returns immediately; resolution comes via the redirect.
- `linkGoogleToAnonymous(): Promise<void>` — calls `supabase.auth.linkIdentity({ provider: 'google' })`. Same redirect-based completion.
- Branching helper `connectGoogle()` reads `getCurrentUser().is_anonymous` and dispatches to the right call.

**New module — `src/lib/auth/promptGate.ts`:**

```
shouldShowAfterGame(): Promise<boolean>
shouldShowBeforeCreateRoom(): Promise<boolean>
markDismissed(trigger: 'afterGame' | 'beforeCreate'): Promise<void>
clearAllDismissals(): Promise<void>  // called after sign-in
```

Logic: returns `false` if user is non-anonymous OR if dismissed flag is set. Stored in AsyncStorage under `auth_prompt_<trigger>_dismissed_v1`.

**New component — `src/components/SaveProgressModal.tsx`:**

Single shared modal, parameterized by `trigger` prop. Renders trigger-specific title/body via i18n. Three callback props: `onGoogle`, `onEmail`, `onDismiss`. Mounts as RN `<Modal>` similar to `PwaInstallModal`.

**OAuth return handling:**

Supabase JS client auto-detects the OAuth code in the URL hash on page load and exchanges it for a session, then fires `onAuthStateChange`. Existing auth listeners in `AppNavigator` and `App.tsx` already react to this — no new routing needed.

After sign-in, `clearAllDismissals()` runs to reset prompt state for any future sign-out → guest cycle.

**Collision detection:**

Supabase returns specific error codes after OAuth callback. Listen in `onAuthStateChange` for the relevant error event (or check `user_already_linked` in the URL hash error params). Show the collision confirm dialog and orchestrate `signOut → signInWithGoogle`.

### UI changes

- `AuthScreen.tsx`: add Google button + "or" divider above the email form. Same UI on Sign In and Sign Up tabs.
- `SettingsBody.tsx` (new from Phase 1): conditional "Save Progress" section above Profile, visible only for anonymous users. Tap closes the modal (`onClose`) and navigates to AuthScreen.
- `LobbyScreen.tsx`: gate `handleCreateRoom` behind `SaveProgressModal` when `promptGate.shouldShowBeforeCreateRoom()` returns true.
- `GameTableScreen.tsx` (or wherever the final scorecard renders): on first render of game-over scorecard, check `promptGate.shouldShowAfterGame()` and mount `SaveProgressModal`.

### i18n keys (en/ru/es)

```
auth.continueWithGoogle
auth.useEmail
auth.savePromptAfterGameTitle / Body
auth.savePromptBeforeCreateTitle / Body
auth.maybeLater
auth.continueAsGuest
auth.collisionTitle / Body
auth.switchAccount / cancel
auth.saveProgress  // settings button
```

---

## Data model

No DB migrations. Identity-linking is handled entirely by Supabase Auth.

AsyncStorage additions:
- `auth_prompt_after_game_dismissed_v1` — string `'1'` once dismissed, absent otherwise.
- `auth_prompt_before_create_dismissed_v1` — same shape.

Both wiped on successful sign-in so a future sign-out → guest cycle starts fresh.

---

## Edge cases

- **OAuth cancelled mid-redirect:** User closes the Google page or hits browser back. No callback, no state change. Anonymous session intact. No special handling.
- **Network failure during link:** Supabase returns error; existing `friendlyAuthError` mapper used. User can retry.
- **Already-linked Google identity (collision):** Flow D handles. Local guest data is replaced.
- **Linking when user already has an email identity:** Allowed. User now has both email and Google as identities on the same UUID. Either can sign in next time.
- **Sign-out:** Existing `signOut` flow unchanged. After sign-out, the next page load gets a fresh anonymous session via the existing `signInAnonymously` bootstrap. Prompt-dismissed flags persist across sign-out so we don't re-prompt the same person ten minutes later.
- **iOS standalone PWA:** `signInWithOAuth` redirects to Google. iOS standalone PWA opens this in Safari, OAuth completes, redirect URL hits the manifest `start_url` which re-launches the PWA. Session is restored via Supabase's hash detection on the new launch. Tested per-deploy.
- **In-app browser (Telegram/etc.):** Google blocks OAuth in many in-app browsers. Show clear error and direct user to open in Safari/Chrome. Reuses existing `isInAppBrowser()` helper from `pwaInstall.ts`.
- **Active multiplayer room when collision-switching:** Force `gameClient.leaveRoom` and `clearActiveRoom` before `signOut`, so the previous identity exits the room cleanly. New identity boots into Lobby.

---

## Out of scope

- Apple Sign-In, GitHub, Discord — possible follow-ups, same architecture.
- Server-side account merge (combining two pre-existing Supabase users into one).
- Multi-device "active session" management — first-time-Google-on-second-device just switches the local device.
- Telegram Mini App identity — separate problem.

---

## Files touched

### Phase 1 — settings consolidation
| Path | Action |
|---|---|
| `src/components/SettingsBody.tsx` | Create — extract every section from `SettingsScreen` body |
| `src/components/SettingsModal.tsx` | Create — overlay host (RN Modal + sheet + ScrollView wrapping `SettingsBody`) |
| `src/store/settingsUIStore.ts` | Create — zustand `{ visible, open, close }` |
| `src/screens/SettingsScreen.tsx` | Delete — body migrated, no callers after route removal |
| `src/navigation/AppNavigator.tsx` | Modify — drop `Settings` route, mount `<SettingsModal />` once outside Stack |
| `src/screens/LobbyScreen.tsx` | Modify — `onSettings` calls `useSettingsUIStore.getState().open()` |
| `src/screens/WaitingRoomScreen.tsx` | Modify — same swap |
| `src/components/betting/BettingPhase.tsx` | Modify — delete inline settings modal, ⚙️ calls `open()` |
| `src/screens/GameTableScreen.tsx` | Modify — delete inline settings modal, ⚙️ calls `open()` |

### Phase 2 — auth
| Path | Action |
|---|---|
| `src/lib/supabase/authService.ts` | Modify — add `signInWithGoogle`, `linkGoogleToAnonymous`, `connectGoogle`, `clearLocalGuestState` |
| `src/lib/auth/promptGate.ts` | Create |
| `src/components/SaveProgressModal.tsx` | Create |
| `src/components/SettingsBody.tsx` | Modify — add "Save Progress" section for anonymous users |
| `src/screens/AuthScreen.tsx` | Modify — Google button + divider |
| `src/screens/LobbyScreen.tsx` | Modify — gate `handleCreateRoom` |
| `src/screens/GameTableScreen.tsx` | Modify — auto-prompt on first scorecard render |
| `src/i18n/locales/{en,ru,es}.json` | Modify — `auth.*` keys |
| `src/App.tsx` or auth listener module | Modify — collision detection on `onAuthStateChange` |

No server / migration / edge function changes.
