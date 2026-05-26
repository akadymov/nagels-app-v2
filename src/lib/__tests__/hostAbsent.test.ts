import { isHostAbsent, HOST_STALE_MS } from '../hostAbsent';

const NOW = Date.parse('2026-05-26T10:00:00Z');
const FRESH = new Date(NOW - 5_000).toISOString();                  //  5s ago
const STALE = new Date(NOW - HOST_STALE_MS - 1_000).toISOString();  // 10m + 1s ago

describe('isHostAbsent', () => {
  it('returns false when room is null', () => {
    expect(isHostAbsent({ room: null, players: [] }, NOW)).toBe(false);
  });

  it('returns false when room has no host_session_id', () => {
    expect(isHostAbsent({
      room: { host_session_id: null } as any,
      players: [{ session_id: 'p1', last_seen_at: FRESH } as any],
    }, NOW)).toBe(false);
  });

  it('returns false when host is present and heartbeat is fresh', () => {
    expect(isHostAbsent({
      room: { host_session_id: 'host-1' } as any,
      players: [
        { session_id: 'host-1', last_seen_at: FRESH } as any,
        { session_id: 'p2', last_seen_at: FRESH } as any,
      ],
    }, NOW)).toBe(false);
  });

  it('returns true when host_session_id is set but absent from players', () => {
    expect(isHostAbsent({
      room: { host_session_id: 'host-1' } as any,
      players: [{ session_id: 'p2', last_seen_at: FRESH } as any],
    }, NOW)).toBe(true);
  });

  it('returns true when players list is empty but host_session_id is set', () => {
    expect(isHostAbsent({
      room: { host_session_id: 'host-1' } as any,
      players: [],
    }, NOW)).toBe(true);
  });

  it('returns true when host row exists but heartbeat is stale', () => {
    expect(isHostAbsent({
      room: { host_session_id: 'host-1' } as any,
      players: [{ session_id: 'host-1', last_seen_at: STALE } as any],
    }, NOW)).toBe(true);
  });

  it('returns false when host last_seen_at is missing (tolerates undefined)', () => {
    expect(isHostAbsent({
      room: { host_session_id: 'host-1' } as any,
      players: [{ session_id: 'host-1' } as any],
    }, NOW)).toBe(false);
  });

  it('returns false when host last_seen_at is unparseable', () => {
    expect(isHostAbsent({
      room: { host_session_id: 'host-1' } as any,
      players: [{ session_id: 'host-1', last_seen_at: 'not-a-date' } as any],
    }, NOW)).toBe(false);
  });
});
