jest.mock('../../discord/context', () => ({ isDiscordActivity: jest.fn() }));
import { isDiscordActivity } from '../../discord/context';
import { resolveSupabaseUrl } from '../resolveUrl';

describe('resolveSupabaseUrl', () => {
  const origEnv = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const origWindow = (global as any).window;
  afterEach(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = origEnv;
    (global as any).window = origWindow;
    jest.resetAllMocks();
  });

  it('returns the direct env URL outside Discord', () => {
    (isDiscordActivity as jest.Mock).mockReturnValue(false);
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co';
    expect(resolveSupabaseUrl()).toBe('https://ref.supabase.co');
  });

  it('returns the proxied origin path inside a Discord Activity', () => {
    (isDiscordActivity as jest.Mock).mockReturnValue(true);
    (global as any).window = { location: { origin: 'https://1234.discordsays.com' } };
    expect(resolveSupabaseUrl()).toBe('https://1234.discordsays.com/supabase');
  });

  it('falls back to the env URL in Discord if window is unavailable', () => {
    (isDiscordActivity as jest.Mock).mockReturnValue(true);
    (global as any).window = undefined;
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co';
    expect(resolveSupabaseUrl()).toBe('https://ref.supabase.co');
  });
});
