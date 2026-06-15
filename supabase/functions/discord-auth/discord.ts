// Pure helpers for the Discord OAuth code-grant. No network here — the edge
// entrypoint does the fetch; these build/parse so they stay unit-testable.

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  email?: string | null;
  verified?: boolean;
}

/** application/x-www-form-urlencoded body for POST https://discord.com/api/oauth2/token */
export function tokenRequestBody(code: string, clientId: string, clientSecret: string): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
  });
}

export function discordAvatarUrl(userId: string, avatarHash: string | null): string | null {
  return avatarHash ? `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png` : null;
}

export function displayNameFrom(u: Pick<DiscordUser, 'username' | 'global_name'>): string {
  return (u.global_name && u.global_name.trim()) || u.username;
}
