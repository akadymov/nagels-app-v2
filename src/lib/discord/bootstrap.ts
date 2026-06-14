/**
 * Bootstrap Discord Activity integration: route network through the
 * Discord proxy, then bring up the Embedded App SDK. Entirely inert
 * outside a Discord Activity.
 */

import { isDiscordActivity } from './context';
import { buildDiscordMappings } from './mappings';

let patched = false;
let sdkReady = false;

async function applyDiscordUrlMappings(): Promise<void> {
  if (patched) return;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const mappings = buildDiscordMappings(supabaseUrl);
  if (mappings.length === 0) {
    console.warn('[Discord] No Supabase URL — skipping URL mappings');
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
  await sdk.ready();
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
