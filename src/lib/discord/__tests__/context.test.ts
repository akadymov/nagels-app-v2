import { detectDiscordActivity } from '../context';

describe('detectDiscordActivity', () => {
  it('is true when a frame_id query param is present', () => {
    expect(detectDiscordActivity({ search: '?frame_id=abc&instance_id=1', hostname: 'localhost' })).toBe(true);
  });

  it('is true when hosted under discordsays.com', () => {
    expect(detectDiscordActivity({ search: '', hostname: '123456789.discordsays.com' })).toBe(true);
  });

  it('is false for a normal web host with no frame_id', () => {
    expect(detectDiscordActivity({ search: '?room=xyz', hostname: 'nigels.online' })).toBe(false);
  });

  it('is false for an empty location', () => {
    expect(detectDiscordActivity({ search: '', hostname: '' })).toBe(false);
  });
});
