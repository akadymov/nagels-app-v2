import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { tokenRequestBody, discordAvatarUrl, displayNameFrom, type DiscordUser } from './discord.ts';
import { decideResolution, type ResolveProfile } from './resolve.ts';
import { derivePassword } from './mint.ts';

const DISCORD_API = 'https://discord.com/api';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions(req);
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, req);

  const clientId = Deno.env.get('EXPO_PUBLIC_DISCORD_CLIENT_ID')!;
  const clientSecret = Deno.env.get('DISCORD_CLIENT_SECRET')!;
  const signingSecret = Deno.env.get('DISCORD_AUTH_SIGNING_SECRET')!;
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  let code: string;
  try {
    code = (await req.json()).code;
    if (!code) throw new Error('no code');
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400, req);
  }

  // 1. Exchange the code for a Discord access token.
  const tokRes = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenRequestBody(code, clientId, clientSecret),
  });
  if (!tokRes.ok) return jsonResponse({ ok: false, error: 'discord_exchange_failed' }, 401, req);
  const discordAccessToken = (await tokRes.json()).access_token as string;

  // 2. Fetch the Discord profile.
  const meRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${discordAccessToken}` },
  });
  if (!meRes.ok) return jsonResponse({ ok: false, error: 'discord_profile_failed' }, 401, req);
  const du = (await meRes.json()) as DiscordUser;

  const profile: ResolveProfile = {
    discord_id: du.id,
    email: du.email ?? null,
    verified: du.verified ?? false,
    display_name: displayNameFrom(du),
    avatar_url: discordAvatarUrl(du.id, du.avatar),
  };

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // 3. Lookups (by verified email, and by discord_id stored in user_metadata).
  const usableEmail = profile.email && profile.verified ? profile.email : null;
  let userByEmail: { id: string } | null = null;
  if (usableEmail) {
    const { data } = await admin.rpc('find_user_id_by_email', { p_email: usableEmail });
    if (data) userByEmail = { id: data as string };
  }
  const { data: discordHit } = await admin.rpc('find_user_id_by_discord', { p_discord_id: profile.discord_id });
  const userByDiscord = discordHit ? { id: discordHit as string } : null;

  // 4. Decide and execute.
  const decision = decideResolution(profile, { userByEmail, userByDiscord });
  const meta = {
    display_name: profile.display_name,
    avatar_url: profile.avatar_url,
    discord_id: profile.discord_id,
    discord_username: du.username,
  };

  let userId: string;
  if (decision.kind === 'create') {
    const { data, error } = await admin.auth.admin.createUser({
      email: decision.email ?? undefined,
      email_confirm: !!decision.email,
      user_metadata: meta,
    });
    if (error || !data.user) return jsonResponse({ ok: false, error: 'create_failed' }, 500, req);
    userId = data.user.id;
  } else {
    userId = decision.userId;
    await admin.auth.admin.updateUserById(userId, { user_metadata: meta });
  }

  // 5. Mint a session: set the deterministic password, sign in server-side.
  const password = await derivePassword(userId, signingSecret);
  await admin.auth.admin.updateUserById(userId, { password });
  const { data: meUser } = await admin.auth.admin.getUserById(userId);
  const email = meUser?.user?.email;
  if (!email) {
    // emailless users can't password-sign-in; give them a synthetic internal email.
    const synthetic = `discord_${profile.discord_id}@users.nagels.internal`;
    await admin.auth.admin.updateUserById(userId, { email: synthetic, email_confirm: true });
  }
  const signEmail = email ?? `discord_${profile.discord_id}@users.nagels.internal`;
  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data: session, error: signErr } = await anon.auth.signInWithPassword({ email: signEmail, password });
  if (signErr || !session.session) return jsonResponse({ ok: false, error: 'mint_failed' }, 500, req);

  return jsonResponse({
    ok: true,
    supabase: { access_token: session.session.access_token, refresh_token: session.session.refresh_token },
    discord_access_token: discordAccessToken,
    profile: { display_name: profile.display_name, avatar_url: profile.avatar_url, discord_id: profile.discord_id },
  }, 200, req);
});
