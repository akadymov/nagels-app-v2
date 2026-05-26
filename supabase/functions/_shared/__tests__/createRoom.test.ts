import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { shouldSendByFlags } from '../../game-action/actions/createRoom.ts';

Deno.test('shouldSendByFlags returns false when silent omitted and announce omitted', () => {
  assertEquals(shouldSendByFlags({}), false);
});

Deno.test('shouldSendByFlags returns false when announce false', () => {
  assertEquals(shouldSendByFlags({ silent: false, announce: false }), false);
});

Deno.test('shouldSendByFlags returns true when silent false and announce true', () => {
  assertEquals(shouldSendByFlags({ silent: false, announce: true }), true);
});

Deno.test('shouldSendByFlags returns false when silent true even if announce true', () => {
  assertEquals(shouldSendByFlags({ silent: true, announce: true }), false);
});

Deno.test('shouldSendByFlags returns true when silent omitted and announce true', () => {
  assertEquals(shouldSendByFlags({ announce: true }), true);
});
