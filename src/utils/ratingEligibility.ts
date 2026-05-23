import type { User } from '@supabase/supabase-js';

/**
 * UI-level gate: who can interact with stake controls.
 *
 * Real check still happens server-side in setStake / toggleStakeOptin (which
 * verify auth.users.email_confirmed_at directly). The client mirror just
 * decides whether to dim the chips, so we keep it lenient — any signed-in
 * non-guest with a confirmation timestamp on EITHER `email_confirmed_at`
 * (email signup) or `confirmed_at` (Google OAuth, which Supabase populates
 * automatically) qualifies.
 */
export function canPlayForRating(user: User | null, isGuest: boolean): boolean {
  if (isGuest || !user) return false;
  return !!(user.email_confirmed_at || (user as { confirmed_at?: string }).confirmed_at);
}
