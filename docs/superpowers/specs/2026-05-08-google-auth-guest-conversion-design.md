# Google Auth + Guest → Registered Conversion — Design

**Goal:** Anonymous guests can upgrade to a permanent identity via Google OAuth (or existing email/password) without losing their UUID, history, or in-progress state. Conversion is offered at three calibrated moments, all dismissible.

**Non-goal:** Replace email/password. Merge two server-side accounts. Apple Sign-In or any other OAuth provider beyond Google.

---

## Background

Today the app signs every fresh visitor in as an anonymous Supabase user (`signInAnonymously`). Email/password upgrade exists via `linkEmailToAnonymous` (uses `auth.updateUser`) — UUID is preserved, all `room_players` / `game_events` rows stay attached. The `AuthScreen` exposes Sign In / Sign Up tabs and a password-reset flow.

What's missing: Google OAuth (no `signInWithOAuth` calls anywhere) and a deliberate "save your progress" moment. Today most guests never visit Settings, so the email upgrade affordance is invisible — the email path exists but converts almost nobody.

---

## User flows

### Flow A — Manual conversion via Settings (always available)

User opens Settings → Profile section. If anonymous: visible "Save Progress" CTA opens `AuthScreen`. If already registered: section shows email + sign-out, as today.

`AuthScreen` gains a primary Google button above the email form. Tap → `linkGoogleToAnonymous()` (Supabase `auth.linkIdentity({ provider: 'google' })`) → redirect to Google → return → user's session is now linked. Same UUID.

If the user is *not* anonymous (somehow opened AuthScreen while signed in already with email), the Google button calls `signInWithGoogle()` instead — adds Google as an additional identity to the existing account.

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
- `SettingsScreen.tsx`: in Profile section, if anonymous, show "Save Progress" button below the avatar/nickname row. Wires to existing AuthScreen navigation.
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

| Path | Action |
|---|---|
| `src/lib/supabase/authService.ts` | Modify — add `signInWithGoogle`, `linkGoogleToAnonymous`, `connectGoogle`, `clearLocalGuestState` |
| `src/lib/auth/promptGate.ts` | Create |
| `src/components/SaveProgressModal.tsx` | Create |
| `src/screens/AuthScreen.tsx` | Modify — Google button + divider |
| `src/screens/SettingsScreen.tsx` | Modify — "Save Progress" CTA for anonymous users |
| `src/screens/LobbyScreen.tsx` | Modify — gate `handleCreateRoom` |
| `src/screens/GameTableScreen.tsx` | Modify — auto-prompt on first scorecard render |
| `src/i18n/locales/{en,ru,es}.json` | Modify — `auth.*` keys |
| `src/App.tsx` or auth listener module | Modify — collision detection on `onAuthStateChange` |

No server / migration / edge function changes.
