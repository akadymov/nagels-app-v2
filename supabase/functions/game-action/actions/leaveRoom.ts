import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult, RoomSnapshot } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

function emptySnapshot(): RoomSnapshot {
  return {
    room: null, players: [], current_hand: null,
    hand_scores: [], current_trick: null, score_history: [], my_hand: [],
  };
}

export async function leaveRoom(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'leave_room' }>,
): Promise<ActionResult> {
  const { data: room } = await svc
    .from('rooms')
    .select('id, host_session_id, phase, version')
    .eq('id', action.room_id)
    .maybeSingle();
  if (!room) return { ok: false, error: 'unknown_room', state: emptySnapshot(), version: 0 };

  // Determine who is being removed: caller (default) or the target (host kick).
  const target = action.target_session_id ?? actor.session_id;
  if (target !== actor.session_id && room.host_session_id !== actor.session_id) {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: false, error: 'host_only', state: snapshot, version: snapshot.room?.version ?? 0 };
  }
  if (target === room.host_session_id && actor.session_id !== room.host_session_id) {
    // Cannot kick the host; they must explicitly leave themselves.
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: false, error: 'cannot_kick_host', state: snapshot, version: snapshot.room?.version ?? 0 };
  }

  await svc.from('room_players')
    .delete()
    .eq('room_id', room.id)
    .eq('session_id', target);

  // The "host left" branch only applies when the host is leaving themselves.
  const isHostLeaving = target === room.host_session_id;

  // If the host leaves, the room is closed for everyone — no host transfer.
  // Other clients see room.phase = 'finished' and clear their active-room
  // reference; they can freely join or create new rooms.
  if (isHostLeaving) {
    const { data: remaining } = await svc
      .from('room_players')
      .select('session_id')
      .eq('room_id', room.id)
      .limit(1);
    if (!remaining || remaining.length === 0) {
      // Empty — drop the room entirely.
      await svc.from('rooms').delete().eq('id', room.id);
      return { ok: true, state: emptySnapshot(), version: 0 };
    }
    await svc.from('rooms').update({
      phase: 'finished',
      version: (room.version ?? 0) + 1,
    }).eq('id', room.id);

    await svc.from('game_events').insert({
      room_id: room.id, session_id: actor.session_id,
      kind: 'host_left', payload: {},
    });

    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: true, state: snapshot, version: snapshot.room?.version ?? 0 };
  }

  await svc.from('game_events').insert({
    room_id: room.id, session_id: actor.session_id,
    kind: target === actor.session_id ? 'leave_room' : 'kick_player',
    payload: target === actor.session_id ? {} : { target_session_id: target },
  });

  const newVersion = (room.version ?? 0) + 1;
  await svc.from('rooms').update({ version: newVersion }).eq('id', room.id);

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: newVersion };
}
