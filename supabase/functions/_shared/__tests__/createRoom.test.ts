import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { shouldSendRoomNotification } from '../../game-action/actions/createRoom.ts';

const base = {
  kind: 'create_room' as const,
  player_count: 4,
  display_name: 'Akula',
};

Deno.test('shouldSendRoomNotification returns true when silent is omitted', () => {
  assertEquals(shouldSendRoomNotification(base), true);
});

Deno.test('shouldSendRoomNotification returns true when silent is false', () => {
  assertEquals(shouldSendRoomNotification({ ...base, silent: false }), true);
});

Deno.test('shouldSendRoomNotification returns false when silent is true', () => {
  assertEquals(shouldSendRoomNotification({ ...base, silent: true }), false);
});
