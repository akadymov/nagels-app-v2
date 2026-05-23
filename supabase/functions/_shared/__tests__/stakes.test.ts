import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { computeSettlement } from '../engine/stakes.ts';

Deno.test('stakes: empty input returns empty deltas', () => {
  assertEquals(computeSettlement([], 5), []);
});

Deno.test('stakes: single player gets delta 0', () => {
  const r = computeSettlement([{ user_id: 'a', score: 42 }], 5);
  assertEquals(r, [{ user_id: 'a', delta: 0 }]);
});

Deno.test('stakes: stake 0 always yields delta 0', () => {
  const r = computeSettlement(
    [{ user_id: 'a', score: 10 }, { user_id: 'b', score: 30 }],
    0,
  );
  assertEquals(r, [{ user_id: 'a', delta: 0 }, { user_id: 'b', delta: 0 }]);
});

Deno.test('stakes: 2 players, stake 1, integer mean, sums to 0', () => {
  const r = computeSettlement(
    [{ user_id: 'a', score: 10 }, { user_id: 'b', score: 30 }],
    1,
  );
  // mean=20 → a: -10, b: +10
  assertEquals(r, [{ user_id: 'a', delta: -10 }, { user_id: 'b', delta: 10 }]);
});

Deno.test('stakes: 4 players, stake 5, sums to 0', () => {
  const r = computeSettlement(
    [
      { user_id: 'a', score: 10 },
      { user_id: 'b', score: 20 },
      { user_id: 'c', score: 30 },
      { user_id: 'd', score: 40 },
    ],
    5,
  );
  const sum = r.reduce((s, x) => s + x.delta, 0);
  assertEquals(sum, 0);
  // mean=25; a:-75 b:-25 c:+25 d:+75
  assertEquals(r.find((x) => x.user_id === 'a')!.delta, -75);
  assertEquals(r.find((x) => x.user_id === 'd')!.delta, 75);
});

Deno.test('stakes: rounding drift is absorbed by largest-|delta| player', () => {
  // 3 players with scores that produce a non-integer mean × stake.
  // mean = 100/3 ≈ 33.333. Stake 1. Raw deltas: a:-3, b:-1, c:+5 → sum=+1 drift.
  // Server must absorb the +1 into the largest |delta| (c) so sum=0.
  const r = computeSettlement(
    [
      { user_id: 'a', score: 30 },
      { user_id: 'b', score: 32 },
      { user_id: 'c', score: 38 },
    ],
    1,
  );
  const sum = r.reduce((s, x) => s + x.delta, 0);
  assertEquals(sum, 0);
});

Deno.test('stakes: deterministic ordering — result keyed by user_id input order', () => {
  const r = computeSettlement(
    [
      { user_id: 'b', score: 30 },
      { user_id: 'a', score: 10 },
    ],
    1,
  );
  assertEquals(r.map((x) => x.user_id), ['b', 'a']);
});
