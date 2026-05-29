/**
 * Nägels Online - Auth Service
 *
 * Wraps Supabase Auth for:
 *   - Anonymous sign-in (guest play, no registration required)
 *   - Email/password sign-in and sign-up (persistent accounts)
 *   - Linking an anonymous session to a real email account
 *   - Sign-out
 *
 * IMPORTANT: Anonymous sign-in requires "Allow anonymous sign-ins" to be
 * enabled in the Supabase dashboard under Authentication → Providers → Anonymous.
 * If it is not enabled, anonymous sign-in fails gracefully and the app falls back
 * to the legacy device-ID based guest session.
 */

import { Platform } from 'react-native';
import type { User } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from './client';

// ============================================================
// REDIRECT URL HELPER
// ============================================================

/**
 * Returns the base URL of the running app.
 *
 * Priority:
 *   1. EXPO_PUBLIC_APP_URL env variable (set this in production .env)
 *   2. window.location.origin on web (picks up Grokony / any host automatically)
 *   3. nagels:// deep-link scheme for native
 */
function getAppUrl(): string {
  // Explicit override — highest priority
  const envUrl = process.env.EXPO_PUBLIC_APP_URL;
  if (envUrl) return envUrl.replace(/\/$/, '');

  // Web: use the actual browser host — works on any deployment automatically
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin;
  }

  // Native: use custom scheme (for deep-link after email confirm)
  return 'nagels://';
}

// ============================================================
// ANONYMOUS AUTH
// ============================================================

/**
 * Sign in anonymously via Supabase Auth.
 * Returns the new (or existing, if already anonymous) User, or null on failure.
 *
 * Requires "Allow anonymous sign-ins" in the Supabase dashboard.
 */
export async function signInAnonymously(): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInAnonymously();

    if (error) {
      // Not enabled in dashboard — caller falls back to device-ID session
      console.warn('[AuthService] Anonymous sign-in failed:', error.message);
      return null;
    }

    console.log('[AuthService] Anonymous sign-in OK, uid:', data.user?.id);
    return data.user ?? null;
  } catch (err) {
    console.error('[AuthService] signInAnonymously threw:', err);
    return null;
  }
}

// ============================================================
// EMAIL AUTH
// ============================================================

/**
 * Sign in with email + password.
 * Throws a localised error string on failure so the UI can display it.
 */
export async function signInWithEmail(email: string, password: string): Promise<User> {
  if (!isSupabaseConfigured()) throw new Error('Multiplayer not configured');

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    throw new Error(friendlyAuthError(error.message));
  }
  if (!data.user) throw new Error('Sign-in failed');

  console.log('[AuthService] Signed in as', data.user.id);
  return data.user;
}

/**
 * Create a new account with email + password.
 * displayName is stored in user_metadata so it survives across devices.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string
): Promise<User> {
  if (!isSupabaseConfigured()) throw new Error('Multiplayer not configured');

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      // emailRedirectTo tells Supabase where to send the user after clicking the
      // confirmation link — must match a URL in the Supabase redirect allowlist.
      emailRedirectTo: `${getAppUrl()}/auth/callback`,
    },
  });

  if (error) {
    throw new Error(friendlyAuthError(error.message));
  }
  if (!data.user) throw new Error('Sign-up failed');

  console.log('[AuthService] Signed up as', data.user.id);
  return data.user;
}

/**
 * Link the current anonymous session to an email + password account.
 * After this call the user keeps the same UUID but gains a real identity.
 * All their room history is preserved because player_id stays the same.
 *
 * NOTE: This uses updateUser which is the correct approach for upgrading
 * an anonymous user in Supabase Auth v2.
 */
export async function linkEmailToAnonymous(email: string, password: string, displayName?: string): Promise<User> {
  if (!isSupabaseConfigured()) throw new Error('Multiplayer not configured');

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.updateUser({
    email,
    password,
    data: displayName ? { display_name: displayName } : undefined,
  });

  if (error) {
    throw new Error(friendlyAuthError(error.message));
  }
  if (!data.user) throw new Error('Link failed');

  console.log('[AuthService] Anonymous session linked to', data.user.id);
  return data.user;
}

// ============================================================
// RESEND CONFIRMATION
// ============================================================

/**
 * Resend email confirmation for a user.
 */
export async function resendConfirmationEmail(email: string): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Multiplayer not configured');

  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
  });

  if (error) {
    throw new Error(friendlyAuthError(error.message));
  }
}

// ============================================================
// UPDATE USER METADATA
// ============================================================

/**
 * Update user metadata (display_name, avatar, avatar_color).
 */
export async function updateUserMetadata(data: Record<string, any>): Promise<User> {
  if (!isSupabaseConfigured()) throw new Error('Multiplayer not configured');

  const supabase = getSupabaseClient();
  const { data: result, error } = await supabase.auth.updateUser({ data });

  if (error) {
    throw new Error(friendlyAuthError(error.message));
  }
  if (!result.user) throw new Error('Update failed');
  return result.user;
}

// ============================================================
// PASSWORD RESET
// ============================================================

/**
 * Set or change the password on the currently authenticated user.
 * Works for Google-only accounts to "add" a password without going
 * through the email reset loop. After success, the user can sign in
 * with either email+password or Google.
 */
export async function setUserPassword(newPassword: string): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Multiplayer not configured');
  if (newPassword.length < 6) throw new Error('auth.passwordTooShort');

  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(friendlyAuthError(error.message));
}

/**
 * Send a password reset email.
 */
export async function resetPasswordForEmail(email: string): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Multiplayer not configured');

  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getAppUrl()}/reset-password`,
  });

  if (error) {
    throw new Error(friendlyAuthError(error.message));
  }
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================

/**
 * Get the currently authenticated Supabase user (null if not signed in).
 */
export async function getCurrentUser(): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the current session without a network round-trip.
 * Use this for fast startup checks.
 */
export async function getLocalSession() {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase.auth.getSession();
    return data.session ?? null;
  } catch {
    return null;
  }
}

/**
 * Sign out the current user.
 * After sign-out, call getGuestSession() to create a fresh anonymous session.
 *
 * `scope`:
 *   - 'global' (default): also revokes the session on the server (auth-lock
 *     held longer; network round-trip).
 *   - 'local' : only wipes local storage. Use when you're about to immediately
 *     start a new auth flow on the same tick — the server-side revoke would
 *     fight for the same lock and one of the operations gets killed with
 *     "lock broken by another request with the 'steal' option".
 */
export async function signOut(scope: 'global' | 'local' = 'global'): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signOut({ scope });
  if (error) {
    console.error('[AuthService] Sign-out error:', error.message);
  } else {
    console.log('[AuthService] Signed out (scope:', scope, ')');
  }
}

/**
 * Subscribe to auth state changes.
 * Returns an unsubscribe function — call it on component unmount.
 */
export function onAuthStateChange(
  callback: (user: User | null, isGuest: boolean, event?: string) => void
): () => void {
  if (!isSupabaseConfigured()) return () => {};

  const supabase = getSupabaseClient();
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user ?? null;
    // is_anonymous can lag after linkIdentity completes (Supabase keeps the
    // flag set on the local session object until the JWT is refreshed), so
    // also treat the user as non-guest if they have ANY identity attached
    // (Google / email / etc).
    const hasIdentity = !!user && (user.identities?.length ?? 0) > 0;
    const isGuest = !user || (!!user.is_anonymous && !hasIdentity);
    // Successful upgrade from anonymous → registered: reset auto-prompt
    // dismissal flags so a future sign-out → guest cycle starts fresh.
    if (user && !user.is_anonymous) {
      void import('../auth/promptGate')
        .then(({ clearAllDismissals }) => clearAllDismissals())
        .catch(() => {});

      // Backfill display_name from the OAuth identity (Google: full_name /
      // name / given_name) when the user has no display_name yet — e.g.
      // anon → Google upgrade, or a fresh Google sign-up. Then sync the
      // newly named user into public.room_sessions so the server-side
      // copy (visible to other players) matches.
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const current = (meta.display_name as string | undefined)?.trim();
      if (!current || current === 'Guest') {
        // Prefer given_name so we end up with "Akhmed", not "Akhmed Kadymov".
        // Fall back to first token of name/full_name when Google didn't
        // provide a separate given_name (rare but possible).
        const firstToken = (s: string | undefined) => s?.trim().split(/\s+/)[0];
        const fromOAuth =
          (meta.given_name as string | undefined)?.trim()
          || firstToken(meta.name as string | undefined)
          || firstToken(meta.full_name as string | undefined);
        if (fromOAuth && fromOAuth.trim()) {
          void (async () => {
            try {
              await supabase.auth.updateUser({ data: { display_name: fromOAuth.trim() } });
              await supabase.rpc('sync_my_display_name');
            } catch (err) {
              console.warn('[AuthService] display_name backfill failed:', err);
            }
          })();
        }
      }
    }
    callback(user, isGuest, event);
  });

  return () => subscription.unsubscribe();
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Map Supabase error messages to user-friendly strings.
 */
function friendlyAuthError(message: string): string {
  if (message.includes('Invalid login credentials')) return 'auth.wrongCredentials';
  if (message.includes('Email not confirmed')) return 'auth.emailNotConfirmed';
  if (message.includes('User already registered')) return 'auth.emailInUse';
  if (message.includes('Password should be')) return 'auth.weakPassword';
  if (message.includes('Unable to validate email')) return 'auth.invalidEmail';
  if (message.includes('rate limit')) return 'auth.rateLimited';
  return message;
}

// ============================================================
// GOOGLE OAUTH
// ============================================================

/**
 * Sign in via Google OAuth. Redirects to Google's consent page; resolution
 * comes back via the URL hash on return. Use this for fresh sign-in (not for
 * anonymous→Google upgrade — see linkGoogleToAnonymous).
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
 * user.is_anonymous becomes false.
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
 * starts a fresh OAuth sign-in for non-anonymous (or absent) sessions.
 */
export async function connectGoogle(): Promise<void> {
  const user = await getCurrentUser();
  if (user && (user as { is_anonymous?: boolean }).is_anonymous) {
    await linkGoogleToAnonymous();
  } else {
    await signInWithGoogle();
  }
}

/**
 * Wipe local guest-only AsyncStorage so a collision-switch (signing in as
 * an existing different user) starts fresh on this device. Server-side rows
 * tied to the previous UUID are untouched. Auth-prompt dismissal flags are
 * preserved because they encode user *preference*, not identity-bound data.
 */
export async function clearLocalGuestState(): Promise<void> {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await Promise.all([
    AsyncStorage.removeItem('active_room_id_v1'),
    AsyncStorage.removeItem('player_name'),
  ]);
}
