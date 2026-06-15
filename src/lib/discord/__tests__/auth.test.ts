import { runDiscordAuth } from '../auth';

const profile = { display_name: 'N', avatar_url: null, discord_id: 'd1' };

function makeDeps(overrides = {}) {
  return {
    sdk: {
      commands: {
        authorize: jest.fn().mockResolvedValue({ code: 'the-code' }),
        authenticate: jest.fn().mockResolvedValue({}),
      },
    },
    exchange: jest.fn().mockResolvedValue({
      ok: true,
      supabase: { access_token: 'at', refresh_token: 'rt' },
      discord_access_token: 'dat',
      profile,
    }),
    setSession: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('runDiscordAuth', () => {
  it('authorizes, exchanges, sets the session, authenticates, returns the profile', async () => {
    const d = makeDeps();
    const result = await runDiscordAuth(d as any);
    expect(d.sdk.commands.authorize).toHaveBeenCalled();
    expect(d.exchange).toHaveBeenCalledWith('the-code');
    expect(d.setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' });
    expect(d.sdk.commands.authenticate).toHaveBeenCalledWith({ access_token: 'dat' });
    expect(result).toEqual(profile);
  });

  it('returns null and does not throw when the exchange fails', async () => {
    const d = makeDeps({ exchange: jest.fn().mockResolvedValue({ ok: false }) });
    const result = await runDiscordAuth(d as any);
    expect(result).toBeNull();
    expect(d.setSession).not.toHaveBeenCalled();
  });
});
