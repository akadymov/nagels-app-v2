import {
  getDealerSeat,
  getPlayOrder,
  suitGlyph,
  suitLabelKey,
  BriefingPlayer,
} from '../handBriefing';

const mkPlayers = (n: number): BriefingPlayer[] =>
  Array.from({ length: n }, (_, i) => ({
    session_id: `s${i}`,
    display_name: `P${i}`,
    seat_index: i,
  }));

describe('getDealerSeat', () => {
  it('is the seat after the starting seat (mod N)', () => {
    expect(getDealerSeat(2, 4)).toBe(3);
    expect(getDealerSeat(3, 4)).toBe(0);
    expect(getDealerSeat(0, 4)).toBe(1);
    expect(getDealerSeat(0, 2)).toBe(1);
    expect(getDealerSeat(1, 2)).toBe(0);
    expect(getDealerSeat(5, 6)).toBe(0);
  });
});

describe('getPlayOrder', () => {
  it('starts at the first player and steps counter-clockwise', () => {
    const order = getPlayOrder(mkPlayers(4), 2);
    expect(order.map((p) => p.seat_index)).toEqual([2, 1, 0, 3]);
  });
  it('ends on the dealer', () => {
    const players = mkPlayers(4);
    const order = getPlayOrder(players, 2);
    expect(order[order.length - 1].seat_index).toBe(getDealerSeat(2, players.length));
  });
  it('wraps correctly from seat 0', () => {
    expect(getPlayOrder(mkPlayers(3), 0).map((p) => p.seat_index)).toEqual([0, 2, 1]);
  });
  it('returns [] for no players', () => {
    expect(getPlayOrder([], 0)).toEqual([]);
  });
});

describe('suit helpers', () => {
  it('maps glyphs and returns empty for notrump', () => {
    expect(suitGlyph('spades')).toBe('♠');
    expect(suitGlyph('hearts')).toBe('♥');
    expect(suitGlyph('diamonds')).toBe('♦');
    expect(suitGlyph('clubs')).toBe('♣');
    expect(suitGlyph('notrump')).toBe('');
  });
  it('builds the i18n label key from the trumps namespace', () => {
    expect(suitLabelKey('hearts')).toBe('trumps.hearts');
    expect(suitLabelKey('notrump')).toBe('trumps.notrump');
  });
});
