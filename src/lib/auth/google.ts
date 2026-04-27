/**
 * Nägels Online - Google Identity Linking
 *
 * Helpers for linking / unlinking a Google account to the current Supabase
 * Auth identity (anonymous or email). After successful linking,
 * `auth.users.is_anonymous` flips to false and `auth.identities` gains a
 * Google entry. The `auth.users.id` does NOT change — all `room_sessions`,
 * `game_events`, and `hand_scores` rows keyed on `auth_user_id` are preserved.
 */

import { getSupabaseClient } from '../supabase/client';

/**
 * Link the current Supabase Auth identity (anonymous or email) to a Google
 * account. Opens the browser / in-app OAuth flow; on return Supabase emits
 * SIGNED_IN. Subscribe to onAuthStateChange to react.
 */
export async function linkGoogle(): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.linkIdentity({
    provider: 'google',
    options: {
      redirectTo: `${process.env.EXPO_PUBLIC_APP_URL ?? ''}/auth/callback`,
    },
  });
  if (error) throw error;
}

/**
 * Unlink the Google identity from the current user. No-op if the user
 * doesn't currently have a Google identity attached.
 */
export async function unlinkGoogle(): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const googleIdentity = user?.identities?.find((i) => i.provider === 'google');
  if (!googleIdentity) return;
  const { error } = await supabase.auth.unlinkIdentity(googleIdentity);
  if (error) throw error;
}

/**
 * Check whether the given user has a linked Google identity.
 */
export function hasGoogleIdentity(
  user: { identities?: Array<{ provider: string }> } | null,
): boolean {
  return Boolean(user?.identities?.some((i) => i.provider === 'google'));
}
