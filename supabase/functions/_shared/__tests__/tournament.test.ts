import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { canActForTable } from '../../game-action/onBehalf.ts';
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
Deno.test('canActForTable: never outside a tournament room', () => {
  assertEquals(canActForTable({ tournament_id: null, host_session_id: 'h' }, null, 'h'), false);
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
