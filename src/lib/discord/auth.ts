// Client-side Discord auth flow, dependency-injected for testability.

export interface DiscordProfile {
  display_name: string;
  avatar_url: string | null;
  discord_id: string;
}

export interface DiscordAuthDeps {
  sdk: {
    commands: {
      authorize: (opts: any) => Promise<{ code: string }>;
      authenticate: (opts: { access_token: string }) => Promise<unknown>;
    };
  };
  exchange: (code: string) => Promise<{
    ok: boolean;
    supabase?: { access_token: string; refresh_token: string };
    discord_access_token?: string;
    profile?: DiscordProfile;
  }>;
  setSession: (s: { access_token: string; refresh_token: string }) => Promise<unknown>;
}

export async function runDiscordAuth(deps: DiscordAuthDeps): Promise<DiscordProfile | null> {
  try {
    const { code } = await deps.sdk.commands.authorize({
      client_id: process.env.EXPO_PUBLIC_DISCORD_CLIENT_ID,
      response_type: 'code',
      scope: ['identify', 'email'],
      prompt: 'none',
    });
    const res = await deps.exchange(code);
    if (!res.ok || !res.supabase || !res.discord_access_token || !res.profile) return null;
    await deps.setSession(res.supabase);
    await deps.sdk.commands.authenticate({ access_token: res.discord_access_token });
    return res.profile;
  } catch (e) {
    console.warn('[Discord] auth flow failed', e);
    return null;
  }
}
