/**
 * Bootstrap Discord Activity integration: route network through the
 * Discord proxy, then bring up the Embedded App SDK. Entirely inert
 * outside a Discord Activity.
 */

import { isDiscordActivity } from './context';
import { buildDiscordMappings } from './mappings';

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

/**
 * Run once from the app root. Resolves immediately (no-op) outside Discord.
 * Inside Discord: maps URLs, then awaits the SDK handshake.
 */
export async function bootstrapDiscord(): Promise<void> {
  if (!isDiscordActivity()) return;
  await applyDiscordUrlMappings();
  await initDiscordSdk();
}

/**
 * Returns the initialized DiscordSDK instance, or null if not yet initialized
 * (outside Discord Activity, or before bootstrapDiscord() has been called).
 */
export function getDiscordSdk() {
  return discordSdk;
}
