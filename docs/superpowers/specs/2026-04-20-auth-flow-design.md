# Auth Flow — Design Spec

## Goal
Full auth flow: registration, login, guest play, profile management, guest-to-email conversion.

## Screens

### 1. Auth Screen (full-screen, from Welcome)
Two tabs: Sign In / Create Account.

**Sign In tab:**
- Email input
- Password input
- "Forgot Password?" link → sends reset email via Supabase
- "Sign In" button
- "Continue as Guest" link at bottom

**Create Account tab:**
- Nickname input
- Email input
- Password input
- "Create Account" button
- "Continue as Guest" link at bottom

**Forgot Password (inline state):**
- Email input
- "Send Reset Link" button
- Success message: "Check your email"
- "Back to Sign In" link

### 2. Profile Screen (from Settings)
- Avatar: colored circle with initial (default) or preset icon
- Nickname (editable, save button)
- Email (display only)
- Avatar picker: grid of ~12 preset emojis (optional, user can skip)
- Logout button

**Default avatar:** random color circle + first letter of nickname. Generated on account creation, stored in user_metadata.

### 3. Post-game Prompt (guests only)
- After game over: "Save your progress?" modal
- "Create Account" → Auth Screen (Create tab)
- "Maybe Later" → dismiss

## Data Storage (Supabase user_metadata)
- `display_name`: string (nickname)
- `avatar`: string | null (emoji or null for default)
- `avatar_color`: string (hex color, randomly assigned on creation)

## Navigation
- Welcome → "Sign In / Register" → Auth Screen
- Welcome → "Play as Guest" → Lobby (anonymous)
- Lobby → Settings → Profile Screen  
- Game Over (guest) → prompt → Auth Screen

## Existing Code to Reuse
- `authService.ts`: signInWithEmail, signUpWithEmail, linkEmailToAnonymous, resetPasswordForEmail
- `authStore.ts`: user, isGuest, displayName
- `AuthModal.tsx`: existing modal (will be replaced by full-screen Auth Screen)

## Files to Create
- `src/screens/AuthScreen.tsx`
- `src/screens/ProfileScreen.tsx`

## Files to Modify
- `src/navigation/AppNavigator.tsx` — add Auth and Profile routes
- `src/screens/WelcomeScreen.tsx` — connect Sign In button
- `src/screens/SettingsScreen.tsx` — add Profile link
- `src/screens/GameTableScreen.tsx` — post-game guest prompt

## i18n Keys Needed
- auth.forgotPassword, auth.sendResetLink, auth.resetSent, auth.backToSignIn
- profile.title, profile.editNickname, profile.chooseAvatar, profile.logout
- profile.saveProgress, profile.maybeLater
