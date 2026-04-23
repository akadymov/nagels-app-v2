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

  console.log('[AuthService] Signed in as', data.user.email);
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

  console.log('[AuthService] Signed up as', data.user.email);
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

  console.log('[AuthService] Anonymous session linked to', data.user.email);
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
 */
export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('[AuthService] Sign-out error:', error.message);
  } else {
    console.log('[AuthService] Signed out');
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
    const isGuest = !user || !!user.is_anonymous;
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
