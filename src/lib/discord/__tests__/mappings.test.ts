import { buildDiscordMappings, DISCORD_SUPABASE_PREFIX } from '../mappings';

describe('buildDiscordMappings', () => {
  it('maps the Supabase host under the supabase prefix', () => {
    const mappings = buildDiscordMappings('https://abcde.supabase.co');
    expect(mappings).toEqual([{ prefix: DISCORD_SUPABASE_PREFIX, target: 'abcde.supabase.co' }]);
  });

  it('strips any path/port and keeps just the host', () => {
    const mappings = buildDiscordMappings('https://abcde.supabase.co/rest/v1');
    expect(mappings[0].target).toBe('abcde.supabase.co');
  });

  it('returns an empty array for a blank url', () => {
    expect(buildDiscordMappings('')).toEqual([]);
  });
});
