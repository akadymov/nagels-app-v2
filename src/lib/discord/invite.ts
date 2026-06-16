import { getDiscordSdk } from './bootstrap';

export type InviteResult = { ok: true } | { ok: false; error: string };

/**
 * Open Discord's native "invite friends to this Activity" dialog. We cannot
 * pick a specific friend — Discord owns that UI. Returns a result instead of
 * throwing so callers can show a toast.
 */
export async function invokeDiscordInvite(): Promise<InviteResult> {
  const sdk = getDiscordSdk();
  if (!sdk) return { ok: false, error: 'no_sdk' };
  try {
    await sdk.commands.openInviteDialog();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'invite_failed' };
  }
}
