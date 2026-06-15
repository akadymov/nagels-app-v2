import { diffParticipants } from '../participants';

describe('diffParticipants', () => {
  it('reports ids that were present before but not now', () => {
    const prev = new Set(['a', 'b', 'c']);
    const r = diffParticipants(prev, ['a', 'c']);
    expect(r.left).toEqual(['b']);
    expect([...r.next].sort()).toEqual(['a', 'c']);
  });

  it('reports no departures when everyone stays or joins', () => {
    const prev = new Set(['a']);
    const r = diffParticipants(prev, ['a', 'b']);
    expect(r.left).toEqual([]);
    expect([...r.next].sort()).toEqual(['a', 'b']);
  });

  it('handles an empty previous set', () => {
    const r = diffParticipants(new Set<string>(), ['a']);
    expect(r.left).toEqual([]);
    expect([...r.next]).toEqual(['a']);
  });
});
