import { isDiscordActivity } from '../discord/context';
import { DISCORD_SUPABASE_PREFIX } from '../discord/mappings';

/**
 * The Supabase base URL to build the client (and the discord-auth fetch) from.
 *
 * Inside a Discord Activity, return the proxied path on the Activity origin
 * (`${origin}/supabase`) — the exact form `patchUrlMappings` rewrites direct
 * Supabase calls to (and that realtime already uses). This routes auth + REST
 * + realtime through the Discord proxy by construction, so it does not depend
 * on the global `fetch` patch having been applied yet.
 *
 * Everywhere else (web, native), return the direct `EXPO_PUBLIC_SUPABASE_URL`
 * unchanged.
 */
export function resolveSupabaseUrl(): string {
  if (isDiscordActivity() && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${DISCORD_SUPABASE_PREFIX}`;
  }
  return process.env.EXPO_PUBLIC_SUPABASE_URL || '';
}
