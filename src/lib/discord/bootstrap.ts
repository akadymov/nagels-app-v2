/**
 * Bootstrap Discord Activity integration: route network through the
 * Discord proxy, then bring up the Embedded App SDK. Entirely inert
 * outside a Discord Activity.
 */

import { isDiscordActivity } from './context';
import { buildDiscordMappings } from './mappings';
import { runDiscordAuth, type DiscordProfile } from './auth';

// Discord's iframe parent occasionally never dispatches the READY event
// (slow/flaky mobile clients, parent crash). `sdk.ready()` has no internal
// timeout, so without this the app would hang on the splash forever. On
// timeout we reject, which the App root catches and opens the gate anyway.
const SDK_READY_TIMEOUT_MS = 8000;

let patched = false;
let sdkReady = false;
// SDK instance; typed any to avoid a static import of the browser-only SDK
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let discordSdk: any = null;
let discordProfile: DiscordProfile | null = null;

export function getDiscordProfile(): DiscordProfile | null {
  return discordProfile;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`[Discord] ${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function applyDiscordUrlMappings(): Promise<void> {
  if (patched) return;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const mappings = buildDiscordMappings(supabaseUrl);
  if (mappings.length === 0) {
    // Without mappings every Supabase request (REST + Realtime WS) goes
    // straight to *.supabase.co, which the Discord sandbox CSP blocks —
    // the app will open but all multiplayer calls will fail.
    console.warn('[Discord] No Supabase URL — Supabase calls will fail inside Discord');
    return;
  }
  const { patchUrlMappings } = await import('@discord/embedded-app-sdk');
  patchUrlMappings(mappings);
  patched = true;
  console.log('[Discord] URL mappings applied');
}

async function initDiscordSdk(): Promise<void> {
  if (sdkReady) return;
  const clientId = process.env.EXPO_PUBLIC_DISCORD_CLIENT_ID;
  if (!clientId) {
    console.warn('[Discord] EXPO_PUBLIC_DISCORD_CLIENT_ID not set — skipping SDK init');
    return;
  }
  const { DiscordSDK } = await import('@discord/embedded-app-sdk');
  const sdk = new DiscordSDK(clientId);
  discordSdk = sdk;
  await withTimeout(sdk.ready(), SDK_READY_TIMEOUT_MS, 'sdk.ready()');
  sdkReady = true;
  console.log('[Discord] SDK ready');
}

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
    if (!r.ok) {
      console.warn('[Discord] discord-auth exchange http error', r.status);
      return { ok: false };
    }
    return r.json();
  };
  const setSession = async (s: { access_token: string; refresh_token: string }) => {
    const { getSupabaseClient } = await import('../supabase/client');
    return getSupabaseClient().auth.setSession(s);
  };
  discordProfile = await runDiscordAuth({ sdk: sdk as any, exchange, setSession });
  if (discordProfile) {
    const { useAuthStore } = await import('../../store/authStore');
    useAuthStore.getState().setDisplayName(discordProfile.display_name);

    // Propagate the Discord avatar URL into the local auth store so it is
    // immediately available to GameTableScreen (which reads
    // `authStore.user?.user_metadata?.avatar_url`) before the normal
    // onAuthStateChange callback fires. We fetch the fresh user object from
    // Supabase — it already has `avatar_url` in `user_metadata` because the
    // discord-auth edge function called `admin.auth.admin.updateUserById`
    // with that value before minting the session tokens.
    try {
      const { getSupabaseClient } = await import('../supabase/client');
      const { data: { user: freshUser } } = await getSupabaseClient().auth.getUser();
      if (freshUser) {
        // Force the Discord name + avatar into user_metadata from the profile
        // we already hold, rather than trusting the fetched metadata to carry
        // it — the in-game identity (scoreboard/seats) reads
        // `authStore.user.user_metadata.avatar_url`. Discord users are never
        // anonymous (signed in via the discord-auth edge function).
        const merged = {
          ...freshUser,
          user_metadata: {
            ...(freshUser.user_metadata ?? {}),
            display_name: discordProfile.display_name,
            avatar_url: discordProfile.avatar_url ?? freshUser.user_metadata?.avatar_url ?? null,
          },
        };
        useAuthStore.getState().setUser(merged as typeof freshUser, false);
      } else {
        console.warn('[Discord] getUser returned no user after auth; avatar/name may be missing');
      }
    } catch (e) {
      console.warn('[Discord] failed to refresh user after auth; avatar may be missing', e);
    }
  }
}

/**
 * Run once from the app root. Resolves immediately (no-op) outside Discord.
 * Inside Discord: maps URLs, then awaits the SDK handshake.
 */
export async function bootstrapDiscord(): Promise<void> {
  if (!isDiscordActivity()) return;
  await applyDiscordUrlMappings();
  await initDiscordSdk();
  try {
    await runAuth();
  } catch (e) {
    console.warn('[Discord] runAuth failed, continuing without auth', e);
  }
}

/**
 * Returns the initialized DiscordSDK instance, or null if not yet initialized
 * (outside Discord Activity, or before bootstrapDiscord() has been called).
 */
export function getDiscordSdk() {
  return discordSdk;
}

/**
 * The Discord Activity instance id, shared by every participant of the same
 * launched Activity. Null outside Discord or before the SDK is ready.
 */
export function getDiscordInstanceId(): string | null {
  return discordSdk?.instanceId ?? null;
}
