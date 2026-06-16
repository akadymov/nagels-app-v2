import { invokeDiscordInvite } from '../invite';

jest.mock('../bootstrap', () => ({ getDiscordSdk: jest.fn() }));
import { getDiscordSdk } from '../bootstrap';

describe('invokeDiscordInvite', () => {
  it('returns no_sdk when the SDK is absent', async () => {
    (getDiscordSdk as jest.Mock).mockReturnValue(null);
    expect(await invokeDiscordInvite()).toEqual({ ok: false, error: 'no_sdk' });
  });
  it('opens the invite dialog when the SDK is present', async () => {
    const openInviteDialog = jest.fn().mockResolvedValue(undefined);
    (getDiscordSdk as jest.Mock).mockReturnValue({ commands: { openInviteDialog } });
    expect(await invokeDiscordInvite()).toEqual({ ok: true });
    expect(openInviteDialog).toHaveBeenCalledTimes(1);
  });
  it('returns the error when the dialog rejects', async () => {
    const openInviteDialog = jest.fn().mockRejectedValue(new Error('no_permission'));
    (getDiscordSdk as jest.Mock).mockReturnValue({ commands: { openInviteDialog } });
    expect(await invokeDiscordInvite()).toEqual({ ok: false, error: 'no_permission' });
  });
});
