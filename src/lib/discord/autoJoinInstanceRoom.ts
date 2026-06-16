import { getDiscordInstanceId } from './bootstrap';
import { isDiscordActivity } from './context';
import { gameClient } from '../gameClient';
import { getActiveRoom, setActiveRoom } from '../activeRoom';
import { subscribeRoom } from '../realtimeBroadcast';
import { useRoomStore } from '../../store/roomStore';

type InstanceRoom = { room_id: string; code: string; phase: string; player_count: number; seats_taken: number };

/** Pure: should a fresh arrival take a seat, or watch? */
export function decideAutoJoinRole(
  room: { phase: string; player_count: number; seats_taken: number },
): 'player' | 'spectator' {
  if (room.phase === 'waiting' && room.seats_taken < room.player_count) return 'player';
  return 'spectator';
}

export type AutoJoinResult =
  | { joined: false; reason: 'not_discord' | 'no_instance' | 'no_room' | 'already_in_room' | 'failed' }
  | { joined: true; room_id: string; code: string; role: 'player' | 'spectator'; phase: string };

// Server errors that mean "the seat is gone" → retry as spectator.
const SEAT_LOST = new Set(['room_full', 'room_in_progress', 'seat_taken']);

/**
 * Once-per-launch: if we're in a Discord Activity, have no active room, and the
 * Activity instance already has an open room, join it (player if a seat is
 * free, else spectator). Returns a result; navigation is the caller's job.
 */
export async function maybeAutoJoinInstanceRoom(displayName: string): Promise<AutoJoinResult> {
  if (!isDiscordActivity()) return { joined: false, reason: 'not_discord' };
  // Don't yank back a user who deliberately left the room this session.
  // getActiveRoom() is async (returns Promise<string | null>) — must await.
  if (await getActiveRoom()) return { joined: false, reason: 'already_in_room' };

  const instanceId = getDiscordInstanceId();
  if (!instanceId) return { joined: false, reason: 'no_instance' };

  const room: InstanceRoom | null = await gameClient.getActiveRoomForInstance(instanceId);
  if (!room) return { joined: false, reason: 'no_room' };

  let role = decideAutoJoinRole(room);

  if (role === 'player') {
    const res = await gameClient.joinRoom(displayName, room.code);
    if (!res.ok) {
      const err = (res as any).error as string | undefined;
      if (!err || !SEAT_LOST.has(err)) return { joined: false, reason: 'failed' };
      role = 'spectator'; // lost the last seat to a concurrent arrival
    } else {
      await setActiveRoom(res.state.room?.id ?? room.room_id, room.code, 'player');
      subscribeRoom(room.room_id);
      return { joined: true, room_id: room.room_id, code: room.code, role: 'player', phase: room.phase };
    }
  }

  // Spectator path (either decided up-front or after losing the seat).
  const spec = await gameClient.joinRoomAsSpectator(room.code);
  if (!spec.ok) return { joined: false, reason: 'failed' };
  useRoomStore.getState().applySnapshot(spec.state, Number((spec.state as any)?.room?.version ?? 0));
  useRoomStore.getState().setIsSpectator(true);
  await setActiveRoom(room.room_id, room.code, 'spectator');
  subscribeRoom(room.room_id);
  return { joined: true, room_id: room.room_id, code: room.code, role: 'spectator', phase: room.phase };
}
