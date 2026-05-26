import { isHostAbsent } from '../hostAbsent';

describe('isHostAbsent', () => {
  it('returns false when room is null', () => {
    expect(isHostAbsent({ room: null, players: [] })).toBe(false);
  });

  it('returns false when room has no host_session_id', () => {
    expect(isHostAbsent({
      room: { host_session_id: null } as any,
      players: [{ session_id: 'p1' } as any],
    })).toBe(false);
  });

  it('returns false when host is present in players', () => {
    expect(isHostAbsent({
      room: { host_session_id: 'host-1' } as any,
      players: [
        { session_id: 'host-1' } as any,
        { session_id: 'p2' } as any,
      ],
    })).toBe(false);
  });

  it('returns true when host_session_id is set but absent from players', () => {
    expect(isHostAbsent({
      room: { host_session_id: 'host-1' } as any,
      players: [{ session_id: 'p2' } as any],
    })).toBe(true);
  });

  it('returns true when players list is empty but host_session_id is set', () => {
    expect(isHostAbsent({
      room: { host_session_id: 'host-1' } as any,
      players: [],
    })).toBe(true);
  });
});
