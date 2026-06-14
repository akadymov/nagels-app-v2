import { useIsDiscordActivity } from '../useIsDiscordActivity';

describe('useIsDiscordActivity', () => {
  it('returns false outside a Discord Activity (jest node env, no window)', () => {
    expect(useIsDiscordActivity()).toBe(false);
  });
});
