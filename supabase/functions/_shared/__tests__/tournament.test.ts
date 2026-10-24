import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { canActForTable, stakeBlocksProxy } from '../../game-action/onBehalf.ts';
import { computeBalance, validateSeating } from '../engine/tournament.ts';

Deno.test('canActForTable: host of a tournament room may act', () => {
  assertEquals(canActForTable({ tournament_id: 't', host_session_id: 'h' }, 'a', 'h'), true);
});
Deno.test('canActForTable: tournament admin may act', () => {
  assertEquals(canActForTable({ tournament_id: 't', host_session_id: 'h' }, 'a', 'a'), true);
});
Deno.test('canActForTable: stranger may not act', () => {
  assertEquals(canActForTable({ tournament_id: 't', host_session_id: 'h' }, 'a', 'x'), false);
});
Deno.test('canActForTable: never in a standard room', () => {
  assertEquals(canActForTable({ tournament_id: null, host_session_id: 'h' }, null, 'h'), false);
  assertEquals(canActForTable({ tournament_id: null, host_session_id: 'h', mode: 'standard' }, null, 'h'), false);
});
Deno.test('canActForTable: host of a scorekeeper room may act, others not', () => {
  assertEquals(canActForTable({ tournament_id: null, host_session_id: 'h', mode: 'scorekeeper' }, null, 'h'), true);
  assertEquals(canActForTable({ tournament_id: null, host_session_id: 'h', mode: 'scorekeeper' }, null, 'x'), false);
});
Deno.test('stakeBlocksProxy: only real other players in a staked regular room', () => {
  const real = { session_id: 'p', has_account: true };
  const offline = { session_id: 'o', has_account: false };
  assertEquals(stakeBlocksProxy({ tournament_id: null, stake: 5 }, real, 'h'), true);
  assertEquals(stakeBlocksProxy({ tournament_id: null, stake: 5 }, offline, 'h'), false);
  assertEquals(stakeBlocksProxy({ tournament_id: null, stake: 5 }, { session_id: 'h', has_account: true }, 'h'), false);
  assertEquals(stakeBlocksProxy({ tournament_id: null, stake: 0 }, real, 'h'), false);
  assertEquals(stakeBlocksProxy({ tournament_id: 't', stake: 5 }, real, 'h'), false);
});
Deno.test('engine runs under deno (shared with jest)', () => {
  assertEquals(validateSeating([['a', 'b']], [{ id: 'a', no_stakes: false }, { id: 'b', no_stakes: false }], [0]), null);
  assertEquals(computeBalance([]), {});
});

import { isTournamentAdmin, shouldNotify } from '../../game-action/actions/tournament.ts';

Deno.test('isTournamentAdmin: by session', () => {
  assertEquals(isTournamentAdmin({ admin_session_id: 's', table_secret: 'k' }, 's'), true);
});
Deno.test('isTournamentAdmin: by secret when session lost', () => {
  assertEquals(isTournamentAdmin({ admin_session_id: null, table_secret: 'k' }, 'x', 'k'), true);
});
Deno.test('isTournamentAdmin: wrong secret', () => {
  assertEquals(isTournamentAdmin({ admin_session_id: 's', table_secret: 'k' }, 'x', 'nope'), false);
});
Deno.test('shouldNotify: tournament rooms never notify', () => {
  assertEquals(shouldNotify({ tournament_id: 't' }), false);
  assertEquals(shouldNotify({ tournament_id: null }), true);
  assertEquals(shouldNotify(null), true);
});

import { toSessionEntries } from '../../game-action/actions/editHand.ts';

Deno.test('toSessionEntries maps seats to sessions', () => {
  const m = new Map([[0, 's0'], [1, 's1']]);
  assertEquals(toSessionEntries([{ seat: 0, bet: 1, taken: 2 }, { seat: 1, bet: 0, taken: 0 }], m), [
    { session_id: 's0', bet: 1, taken: 2 }, { session_id: 's1', bet: 0, taken: 0 },
  ]);
});
Deno.test('toSessionEntries rejects unknown seats and non-integers', () => {
  const m = new Map([[0, 's0']]);
  assertEquals(toSessionEntries([{ seat: 5, bet: 1, taken: 1 }], m), null);
  assertEquals(toSessionEntries([{ seat: 0, bet: '1', taken: 1 }], m), null);
  assertEquals(toSessionEntries('nope', m), null);
});
