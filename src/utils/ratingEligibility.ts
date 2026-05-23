import type { User } from '@supabase/supabase-js';

export function canPlayForRating(user: User | null, isGuest: boolean): boolean {
  if (isGuest || !user) return false;
  return !!user.email_confirmed_at;
}
