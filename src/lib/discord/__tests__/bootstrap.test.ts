import { bootstrapDiscord } from '../bootstrap';
import { isDiscordActivity } from '../context';

// Mock the context gate so we can drive both branches deterministically
// (jest runs in a node env where the real gate is always false).
jest.mock('../context', () => ({ isDiscordActivity: jest.fn() }));

// Replace the browser-only SDK entirely — the real package never loads.
const patchUrlMappings = jest.fn();
const ready = jest.fn().mockResolvedValue(undefined);
class FakeDiscordSDK {
  constructor(public clientId: string) {}
  ready = ready;
}
jest.mock('@discord/embedded-app-sdk', () => ({
  patchUrlMappings: (...args: unknown[]) => patchUrlMappings(...args),
  DiscordSDK: FakeDiscordSDK,
}));

const mockedIsDiscord = isDiscordActivity as jest.MockedFunction<typeof isDiscordActivity>;

describe('bootstrapDiscord', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('is a no-op outside a Discord Activity — never touches the SDK', async () => {
    mockedIsDiscord.mockReturnValue(false);
    await expect(bootstrapDiscord()).resolves.toBeUndefined();
    expect(patchUrlMappings).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
  });

  it('applies Supabase URL mappings then awaits SDK ready inside a Discord Activity', async () => {
    mockedIsDiscord.mockReturnValue(true);
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://abcde.supabase.co';
    process.env.EXPO_PUBLIC_DISCORD_CLIENT_ID = 'client-123';

    await bootstrapDiscord();

    expect(patchUrlMappings).toHaveBeenCalledWith([{ prefix: '/supabase', target: 'abcde.supabase.co' }]);
    expect(ready).toHaveBeenCalledTimes(1);
  });
});
