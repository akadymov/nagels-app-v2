# Discord Auth — Unified Persistent Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inside a Discord Activity, identify the player from Discord, resolve them to a single persistent Supabase account (unified by verified email), and unlock the authenticated Discord SDK features — no second login.

**Architecture:** A new Deno edge function `discord-auth` exchanges the SDK `authorize()` code server-side (Discord client secret + Supabase service role), resolves/links a Supabase user by verified email (else by `discord_id`), mints a Supabase session, and returns it plus the Discord access token. A Discord-gated client module runs `authorize → exchange → setSession → authenticate` inside `bootstrapDiscord()`. Everything is gated by `isDiscordActivity()`; web/PWA auth is untouched.

**Tech Stack:** Deno edge functions (Supabase), `@supabase/supabase-js@2`, Discord Embedded App SDK v2.5.0, jest (client, ts-jest) + Deno.test (edge), TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-15-discord-auth-unified-account-design.md`

**Branch:** continue on `feat/discord-activity`.

**Risk-first ordering:** the pure decision/derivation logic (Tasks 1–3a) is built and unit-tested first; the session-mint mechanism (the #1 risk) is proven in the manual deploy step (Task 7) with a magic-link fallback documented.

---

## File Structure

- Create: `supabase/functions/discord-auth/index.ts` — the edge entrypoint (Deno.serve).
- Create: `supabase/functions/discord-auth/discord.ts` — pure Discord OAuth helpers (token-exchange request builder, profile/avatar mappers).
- Create: `supabase/functions/discord-auth/resolve.ts` — pure user-resolution decision logic.
- Create: `supabase/functions/discord-auth/mint.ts` — pure password-derivation for the session mint.
- Create: `supabase/functions/_shared/__tests__/discord-resolve.test.ts`, `discord-helpers.test.ts` — Deno tests.
- Create: `src/lib/discord/auth.ts` — client flow (authorize → exchange → setSession → authenticate → profile).
- Create: `src/lib/discord/__tests__/auth.test.ts` — jest test.
- Modify: `src/lib/discord/bootstrap.ts` — run the auth flow after the SDK is ready; fallback on failure.
- Modify: identity wiring + Discord-gated hiding of the in-app auth/nickname editor (exact files located in Task 6).

---

## Task 1: Discord OAuth pure helpers

**Files:**
- Create: `supabase/functions/discord-auth/discord.ts`
- Test: `supabase/functions/_shared/__tests__/discord-helpers.test.ts`

- [ ] **Step 1: Write the failing Deno test**

```ts
// supabase/functions/_shared/__tests__/discord-helpers.test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { tokenRequestBody, discordAvatarUrl, displayNameFrom } from '../../discord-auth/discord.ts';

Deno.test('tokenRequestBody builds an x-www-form-urlencoded grant', () => {
  const body = tokenRequestBody('the-code', 'cid', 'secret');
  assertEquals(body.get('grant_type'), 'authorization_code');
  assertEquals(body.get('code'), 'the-code');
  assertEquals(body.get('client_id'), 'cid');
  assertEquals(body.get('client_secret'), 'secret');
});

Deno.test('discordAvatarUrl builds a CDN url, or null when no avatar', () => {
  assertEquals(discordAvatarUrl('123', 'abc'), 'https://cdn.discordapp.com/avatars/123/abc.png');
  assertEquals(discordAvatarUrl('123', null), null);
});

Deno.test('displayNameFrom prefers global_name, falls back to username', () => {
  assertEquals(displayNameFrom({ username: 'u', global_name: 'Global' }), 'Global');
  assertEquals(displayNameFrom({ username: 'u', global_name: null }), 'u');
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `deno test supabase/functions/_shared/__tests__/discord-helpers.test.ts`
Expected: FAIL — module `../../discord-auth/discord.ts` not found.

- [ ] **Step 3: Implement**

```ts
// supabase/functions/discord-auth/discord.ts
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
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `deno test supabase/functions/_shared/__tests__/discord-helpers.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/discord-auth/discord.ts supabase/functions/_shared/__tests__/discord-helpers.test.ts
git commit -m "feat(discord-auth): pure Discord OAuth helpers"
```

---

## Task 2: User-resolution decision logic

**Files:**
- Create: `supabase/functions/discord-auth/resolve.ts`
- Test: `supabase/functions/_shared/__tests__/discord-resolve.test.ts`

The pure decision: given the Discord profile and the results of two admin lookups
(an existing user with the verified email, and an existing user already carrying
this `discord_id`), decide what to do. No Supabase calls here.

- [ ] **Step 1: Write the failing Deno test**

```ts
// supabase/functions/_shared/__tests__/discord-resolve.test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { decideResolution } from '../../discord-auth/resolve.ts';

const profile = { discord_id: 'd1', email: 'a@b.com', verified: true, display_name: 'N', avatar_url: null };

Deno.test('verified email matches an existing user → link to it', () => {
  const r = decideResolution(profile, { userByEmail: { id: 'u1' }, userByDiscord: null });
  assertEquals(r, { kind: 'link', userId: 'u1' });
});

Deno.test('verified email, no existing user → create with email', () => {
  const r = decideResolution(profile, { userByEmail: null, userByDiscord: null });
  assertEquals(r, { kind: 'create', email: 'a@b.com' });
});

Deno.test('no/unverified email but discord_id known → reuse that user', () => {
  const r = decideResolution(
    { ...profile, email: null, verified: false },
    { userByEmail: null, userByDiscord: { id: 'u9' } },
  );
  assertEquals(r, { kind: 'reuse', userId: 'u9' });
});

Deno.test('no email, no discord match → create emailless', () => {
  const r = decideResolution(
    { ...profile, email: null, verified: false },
    { userByEmail: null, userByDiscord: null },
  );
  assertEquals(r, { kind: 'create', email: null });
});

Deno.test('unverified email is ignored (not used for linking)', () => {
  const r = decideResolution(
    { ...profile, verified: false },
    { userByEmail: { id: 'u1' }, userByDiscord: null },
  );
  assertEquals(r, { kind: 'create', email: null });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `deno test supabase/functions/_shared/__tests__/discord-resolve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// supabase/functions/discord-auth/resolve.ts
// Pure resolution: maps (discord profile + lookup results) → an action the
// edge entrypoint executes against the Supabase admin API. No I/O here.

export interface ResolveProfile {
  discord_id: string;
  email: string | null;
  verified: boolean;
  display_name: string;
  avatar_url: string | null;
}

export interface Lookups {
  userByEmail: { id: string } | null;
  userByDiscord: { id: string } | null;
}

export type Resolution =
  | { kind: 'link'; userId: string }     // existing email-user: attach discord_id
  | { kind: 'reuse'; userId: string }    // existing discord-user: just sign in
  | { kind: 'create'; email: string | null };

export function decideResolution(p: ResolveProfile, l: Lookups): Resolution {
  const usableEmail = p.email && p.verified ? p.email : null;
  if (usableEmail && l.userByEmail) return { kind: 'link', userId: l.userByEmail.id };
  if (usableEmail) return { kind: 'create', email: usableEmail };
  if (l.userByDiscord) return { kind: 'reuse', userId: l.userByDiscord.id };
  return { kind: 'create', email: null };
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `deno test supabase/functions/_shared/__tests__/discord-resolve.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/discord-auth/resolve.ts supabase/functions/_shared/__tests__/discord-resolve.test.ts
git commit -m "feat(discord-auth): pure user-resolution decision logic"
```

---

## Task 3: Session-mint password derivation

**Files:**
- Create: `supabase/functions/discord-auth/mint.ts`
- Test: `supabase/functions/_shared/__tests__/discord-helpers.test.ts` (append)

The mint uses a deterministic, server-only password per user so a real
access+refresh pair can be obtained via `signInWithPassword`. The derivation must
be pure and stable.

- [ ] **Step 1: Append the failing test**

Add to `supabase/functions/_shared/__tests__/discord-helpers.test.ts`:

```ts
import { derivePassword } from '../../discord-auth/mint.ts';

Deno.test('derivePassword is deterministic and depends on user + secret', async () => {
  const a = await derivePassword('user-1', 'secret');
  const b = await derivePassword('user-1', 'secret');
  const c = await derivePassword('user-2', 'secret');
  assertEquals(a, b);
  assertEquals(a === c, false);
  assertEquals(a.length >= 32, true);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `deno test supabase/functions/_shared/__tests__/discord-helpers.test.ts`
Expected: FAIL — `derivePassword` not found.

- [ ] **Step 3: Implement**

```ts
// supabase/functions/discord-auth/mint.ts
// Deterministic per-user password (HMAC-SHA256) used only server-side to obtain
// a Supabase session via signInWithPassword. Never returned to the client.

export async function derivePassword(userId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`discord-auth:${userId}`));
  // hex-encode → stable, URL-safe, > 32 chars
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `deno test supabase/functions/_shared/__tests__/discord-helpers.test.ts`
Expected: PASS (4 tests total in this file).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/discord-auth/mint.ts supabase/functions/_shared/__tests__/discord-helpers.test.ts
git commit -m "feat(discord-auth): deterministic mint password derivation"
```

---

## Task 4: `discord-auth` edge entrypoint

**Files:**
- Create: `supabase/functions/discord-auth/index.ts`

Assembles the pure helpers with the real network + Supabase admin calls. Not
unit-tested (network + admin); verified by `deno check` and the manual deploy in
Task 7. Reuses the established CORS helper.

- [ ] **Step 1: Write the entrypoint**

```ts
// supabase/functions/discord-auth/index.ts
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
```

- [ ] **Step 2: Add the two lookup RPCs (migration)**

Create `supabase/migrations/<timestamp>_discord_auth_lookups.sql` (use a timestamp later than the latest existing migration):

```sql
-- Service-role-only helpers for discord-auth: resolve an auth user by verified
-- email or by the discord_id stored in user_metadata. SECURITY DEFINER so the
-- edge function (service role) can read auth.users without broad grants.
create or replace function public.find_user_id_by_email(p_email text)
returns uuid language sql security definer set search_path = '' as $$
  select id from auth.users where email = p_email and email_confirmed_at is not null limit 1;
$$;

create or replace function public.find_user_id_by_discord(p_discord_id text)
returns uuid language sql security definer set search_path = '' as $$
  select id from auth.users where raw_user_meta_data->>'discord_id' = p_discord_id limit 1;
$$;

revoke execute on function public.find_user_id_by_email(text) from anon, authenticated;
revoke execute on function public.find_user_id_by_discord(text) from anon, authenticated;
```

- [ ] **Step 3: Verify it type-checks under Deno**

Run: `deno check supabase/functions/discord-auth/index.ts`
Expected: no type errors (network/Supabase types resolve from esm.sh). If `deno check` flags remote-type resolution, run `deno cache supabase/functions/discord-auth/index.ts` first.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/discord-auth/index.ts supabase/migrations/*_discord_auth_lookups.sql
git commit -m "feat(discord-auth): edge entrypoint — exchange, resolve, mint session"
```

---

## Task 5: Client auth module

**Files:**
- Create: `src/lib/discord/auth.ts`
- Test: `src/lib/discord/__tests__/auth.test.ts`

`runDiscordAuth` orchestrates the client side. The SDK and Supabase client are
injected so it's testable in jest's node env.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/discord/__tests__/auth.test.ts
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
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- src/lib/discord/__tests__/auth.test.ts`
Expected: FAIL — module `../auth` not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/discord/auth.ts
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
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm run test:unit -- src/lib/discord/__tests__/auth.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/discord/auth.ts src/lib/discord/__tests__/auth.test.ts
git commit -m "feat(discord): client Discord auth flow (authorize/exchange/setSession/authenticate)"
```

---

## Task 6: Wire auth into bootstrap + apply profile + hide in-app auth in Discord

**Files:**
- Modify: `src/lib/discord/bootstrap.ts`
- Modify: identity/profile wiring + Discord-gated auth-UI hiding (locate exact sites — see steps)

- [ ] **Step 1: Build the `exchange` + `setSession` concretes and run auth in bootstrap**

In `src/lib/discord/bootstrap.ts`, after `initDiscordSdk()` resolves, add a step that runs the auth flow. Add this function and call it from `bootstrapDiscord()`:

```ts
import { runDiscordAuth, type DiscordProfile } from './auth';
import { getSupabaseClient } from '../supabase/client';

let discordProfile: DiscordProfile | null = null;
export function getDiscordProfile() { return discordProfile; }

async function runAuth(): Promise<void> {
  const sdk = getDiscordSdk();
  if (!sdk) return;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  const exchange = async (code: string) => {
    const r = await fetch(`${supabaseUrl}/functions/v1/discord-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ code }),
    });
    return r.json();
  };
  const setSession = (s: { access_token: string; refresh_token: string }) =>
    getSupabaseClient().auth.setSession(s);
  discordProfile = await runDiscordAuth({ sdk: sdk as any, exchange, setSession });
}
```

Then in `bootstrapDiscord()`, after `await initDiscordSdk();` add `await runAuth();`. (The `fetch` to the Supabase functions URL is rewritten by `patchUrlMappings` → same-origin Discord proxy, so no CORS issue. A failed/null auth leaves the existing anonymous-session path intact — do NOT throw.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `src/lib/discord/bootstrap.ts`.

- [ ] **Step 3: Apply the Discord profile to the in-game identity**

Find where the guest nickname/avatar are stored client-side (start at `src/store/settingsStore.ts` — locate the field that feeds `displayName` passed into `gameClient.postAction`). When `getDiscordProfile()` is non-null, set that nickname field to `profile.display_name` and the avatar to `profile.avatar_url` once, on bootstrap completion (e.g., in the App splash-gate `.finally`, gated by `isDiscordActivity()`). Read the store's setter names first; do not invent them.

- [ ] **Step 4: Hide the in-app auth + nickname editor in Discord**

Locate the in-app sign-in entry points and the profile/nickname editor (grep for the Google sign-in button and the nickname input — e.g. in `WelcomeScreen.tsx`, the settings/profile UI, and `promptGate.ts`). Gate them off with `useIsDiscordActivity()` / `isDiscordActivity()` so no second login or name edit is offered inside Discord. Surface each gated site in the implementer report so the controller can confirm none was missed.

- [ ] **Step 5: Typecheck + unit + lint**

Run: `npx tsc --noEmit && npm run test:unit && npm run test:lint`
Expected: clean; no new testID orphans.

- [ ] **Step 6: Commit**

```bash
git add src/lib/discord/bootstrap.ts <profile/identity files> <auth-hiding files>
git commit -m "feat(discord): run auth in bootstrap, apply Discord profile, hide in-app login in Discord"
```

---

## Task 7: Deploy + secrets + portal + verify (manual)

The #1-risk session mint is proven here. No commit unless fixes are needed.

- [ ] **Step 1: Configure Discord OAuth2 (Developer Portal)**

App → OAuth2: confirm the client secret is available; add the redirect/URL the SDK uses (Activities use the SDK code grant — confirm no extra redirect URI is needed, or add `https://<client_id>.discordsays.com` if the portal requires one). Ensure scopes `identify` and `email` are allowed.

- [ ] **Step 2: Apply the migration + deploy the function (PROD Supabase)**

```bash
supabase db push                       # applies *_discord_auth_lookups.sql
supabase functions deploy discord-auth
```
(Targets PROD Supabase `evcaqgmkdlqesqisjfyh`, which the Activity proxies to.)

- [ ] **Step 3: Set the edge secrets**

```bash
supabase secrets set DISCORD_CLIENT_SECRET=<from portal> DISCORD_AUTH_SIGNING_SECRET=<random 32+ bytes>
```
(`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` / `EXPO_PUBLIC_DISCORD_CLIENT_ID` are already present as function env or must be set the same way.)

- [ ] **Step 4: Rebuild the tunnel build and verify in Discord**

Rebuild `dist/` (the existing tunnel loop) and launch the Activity. Verify:
- at most ONE Discord consent screen on first launch, then NO in-app login;
- play a hand; relaunch the Activity → same identity, rating persists;
- open the same Activity on a second device with the same Discord account → same account/rating;
- the ➕ invite button now opens the native dialog (authenticate succeeded);
- if you also sign in on the web with the matching Google email, it is the same account/rating.

- [ ] **Step 5: If the mint mechanism fails**

If `signInWithPassword` minting doesn't yield a usable session on this Supabase version, switch `index.ts` step 5 to the magic-link fallback: `admin.generateLink({ type: 'magiclink', email })` → verify the OTP server-side to obtain a session, returning those tokens. Re-deploy and re-verify. Commit the change.

---

## Final verification (before any merge toward prod)

- [ ] `deno test supabase/functions/_shared/__tests__/discord-resolve.test.ts supabase/functions/_shared/__tests__/discord-helpers.test.ts` — all green.
- [ ] `npm run smoke` — web path unchanged (everything `isDiscordActivity()`-gated; web still uses anonymous/guest + Google). Run once the local Supabase + memory situation allows.
- [ ] Update the Privacy Policy draft (Discord email now processed for account unification) — part of the existing "Update legal drafts before verification" backlog item.

## Notes for the implementer

- All client behavior is `isDiscordActivity()`-gated; web/PWA auth is byte-for-byte unchanged.
- Do not stage the unrelated WIP (`tests/TEST_TODO.md`, untracked `scripts/`, `assets/marketing/`).
- The tunnel test rig (serve :5050 + cloudflared) is the manual-verification surface; prod is intentionally untouched until the Vercel quota is resolved.
- New edge env vars: `DISCORD_CLIENT_SECRET`, `DISCORD_AUTH_SIGNING_SECRET`. New RPCs: `find_user_id_by_email`, `find_user_id_by_discord` (service-role only).
