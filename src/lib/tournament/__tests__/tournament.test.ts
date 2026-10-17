import {
  shuffleSeating, validateSeating, computeBalance, defaultMaxCards,
  type SeatingParticipant,
} from '..';

function seeded(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}
const people = (n: number, noStakes: number[] = []): SeatingParticipant[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, no_stakes: noStakes.includes(i) }));

describe('shuffleSeating', () => {
  it('balances 14 players over 3 tables as 5/5/4 with no duplicates', () => {
    const r = shuffleSeating({ participants: people(14), stakes: [0, 0, 0] }, seeded(1));
    if (!r.ok) throw new Error(r.reason);
    expect(r.tables.map((t) => t.length).sort()).toEqual([4, 5, 5]);
    expect(new Set(r.tables.flat()).size).toBe(14);
  });

  it('is deterministic for the same rng seed', () => {
    const a = shuffleSeating({ participants: people(10), stakes: [0, 5] }, seeded(7));
    const b = shuffleSeating({ participants: people(10), stakes: [0, 5] }, seeded(7));
    expect(a).toEqual(b);
  });

  it('keeps pins at their table', () => {
    for (let seed = 0; seed < 20; seed++) {
      const r = shuffleSeating(
        { participants: people(10), stakes: [0, 5], pins: { p3: 1, p4: 0 } }, seeded(seed));
      if (!r.ok) throw new Error(r.reason);
      expect(r.tables[1]).toContain('p3');
      expect(r.tables[0]).toContain('p4');
    }
  });

  it('never seats a no-stakes participant at a stake table', () => {
    for (let seed = 0; seed < 50; seed++) {
      const r = shuffleSeating(
        { participants: people(12, [0, 1, 2]), stakes: [5, 0, 10] }, seeded(seed));
      if (!r.ok) throw new Error(r.reason);
      for (const id of ['p0', 'p1', 'p2']) expect(r.tables[1]).toContain(id);
    }
  });

  it('reports no_stakes_capacity when no-stakes people exceed stake-0 seats', () => {
    const r = shuffleSeating(
      { participants: people(12, [0, 1, 2, 3, 4, 5, 6]), stakes: [0, 5] }, seeded(1));
    expect(r).toEqual({ ok: false, reason: 'no_stakes_capacity' });
  });

  it('reports no_stakes_at_stake_table for a pin that breaks the rule', () => {
    const r = shuffleSeating(
      { participants: people(8, [0]), stakes: [0, 5], pins: { p0: 1 } }, seeded(1));
    expect(r).toEqual({ ok: false, reason: 'no_stakes_at_stake_table' });
  });

  it('reports table_too_large when there are more than 6 per table', () => {
    expect(shuffleSeating({ participants: people(13), stakes: [0, 0] }, seeded(1)))
      .toEqual({ ok: false, reason: 'table_too_large' });
  });

  it('reports table_too_small when a table would get fewer than 2', () => {
    expect(shuffleSeating({ participants: people(5), stakes: [0, 0, 0] }, seeded(1)))
      .toEqual({ ok: false, reason: 'table_too_small' });
  });

  it('reports no_tables for an empty stakes array', () => {
    expect(shuffleSeating({ participants: people(4), stakes: [] }))
      .toEqual({ ok: false, reason: 'no_tables' });
  });
});

describe('validateSeating', () => {
  const ps = people(6, [0]);
  it('accepts a valid seating', () => {
    expect(validateSeating([['p0', 'p1', 'p2'], ['p3', 'p4', 'p5']], ps, [0, 5])).toBeNull();
  });
  it('rejects duplicates', () => {
    expect(validateSeating([['p0', 'p1', 'p1'], ['p3', 'p4', 'p5']], ps, [0, 5])).toBe('duplicate');
  });
  it('rejects unknown ids', () => {
    expect(validateSeating([['p0', 'p1', 'zz'], ['p3', 'p4', 'p5']], ps, [0, 5])).toBe('unknown_participant');
  });
  it('rejects no-stakes at a stake table', () => {
    expect(validateSeating([['p1', 'p2', 'p3'], ['p0', 'p4', 'p5']], ps, [0, 5])).toBe('no_stakes_at_stake_table');
  });
  it('rejects tables outside 2..6', () => {
    expect(validateSeating([['p0'], ['p1', 'p2', 'p3', 'p4', 'p5']], ps, [0, 0])).toBe('table_too_small');
  });
});

describe('computeBalance', () => {
  it('is zero-sum per hand and scales with stake', () => {
    const b = computeBalance([
      { hand_id: 'h1', participant_id: 'a', hand_score: 12, stake: 5 },
      { hand_id: 'h1', participant_id: 'b', hand_score: 2, stake: 5 },
      { hand_id: 'h1', participant_id: 'c', hand_score: 1, stake: 5 },
    ]);
    expect(b.a).toBeCloseTo(35);   // (12 - 5) * 5
    expect(b.b).toBeCloseTo(-15);
    expect(b.c).toBeCloseTo(-20);
    expect(b.a + b.b + b.c).toBeCloseTo(0);
  });
  it('stake 0 contributes 0 but still lists the participant', () => {
    const b = computeBalance([
      { hand_id: 'h1', participant_id: 'a', hand_score: 12, stake: 0 },
      { hand_id: 'h1', participant_id: 'b', hand_score: 2, stake: 0 },
    ]);
    expect(b).toEqual({ a: 0, b: 0 });
  });
  it('sums across hands and tables', () => {
    const b = computeBalance([
      { hand_id: 'h1', participant_id: 'a', hand_score: 10, stake: 1 },
      { hand_id: 'h1', participant_id: 'b', hand_score: 0, stake: 1 },
      { hand_id: 'h2', participant_id: 'a', hand_score: 0, stake: 10 },
      { hand_id: 'h2', participant_id: 'c', hand_score: 4, stake: 10 },
    ]);
    expect(b.a).toBeCloseTo(5 - 20);
    expect(b.b).toBeCloseTo(-5);
    expect(b.c).toBeCloseTo(20);
  });
});

describe('defaultMaxCards', () => {
  it('uses the largest table, capped at 10', () => {
    expect(defaultMaxCards([4, 4])).toBe(10);
    expect(defaultMaxCards([4, 6])).toBe(8);
    expect(defaultMaxCards([5, 5, 4])).toBe(10);
    expect(defaultMaxCards([])).toBe(10);
  });
});
