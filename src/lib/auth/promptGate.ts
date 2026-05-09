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
