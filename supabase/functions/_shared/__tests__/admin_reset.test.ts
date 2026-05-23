import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildResetJournalRow } from '../../game-action/actions/adminResetRating.ts';

Deno.test('admin_reset: zero balance → null (skip)', () => {
  assertEquals(buildResetJournalRow('user-1', 0, null), null);
});

Deno.test('admin_reset: positive balance → delta = -balance', () => {
  const row = buildResetJournalRow('user-1', 42, null);
  assertEquals(row, {
    user_id: 'user-1',
    room_id: null,
    reason: 'admin_reset',
    delta: -42,
    base_score: 42,
    mean_score: 0,
    stake: 0,
  });
});

Deno.test('admin_reset: negative balance → delta = -balance (positive)', () => {
  const row = buildResetJournalRow('user-1', -17, null);
  assertEquals(row, {
    user_id: 'user-1',
    room_id: null,
    reason: 'admin_reset',
    delta: 17,
    base_score: -17,
    mean_score: 0,
    stake: 0,
  });
});
