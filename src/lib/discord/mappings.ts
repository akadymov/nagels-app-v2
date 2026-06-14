/**
 * Build the URL-mapping list for the Discord Embedded App SDK's
 * `patchUrlMappings`. The prefix must mirror the Developer Portal config.
 */

export const DISCORD_SUPABASE_PREFIX = '/supabase';

export interface DiscordUrlMapping {
  prefix: string;
  target: string;
}

export function buildDiscordMappings(supabaseUrl: string): DiscordUrlMapping[] {
  if (!supabaseUrl) return [];
  try {
    const host = new URL(supabaseUrl).host;
    return [{ prefix: DISCORD_SUPABASE_PREFIX, target: host }];
  } catch {
    return [];
  }
}
