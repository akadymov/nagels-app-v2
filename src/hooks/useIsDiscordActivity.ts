/**
 * True when the app runs inside a Discord Activity. Mirrors the
 * `useIsDesktop` hook form for call-site consistency. Discord context is
 * fixed for the session, so this is a thin wrapper over `isDiscordActivity()`
 * — no internal state needed. False on native/SSR and in the smoke browser.
 */
import { isDiscordActivity } from '../lib/discord/context';

export function useIsDiscordActivity(): boolean {
  return isDiscordActivity();
}
