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

  await svc.from('room_players')
    .delete()
    .eq('room_id', room.id)
    .eq('session_id', actor.session_id);

  if (room.host_session_id === actor.session_id) {
    const { data: remaining } = await svc
      .from('room_players')
      .select('session_id, seat_index')
      .eq('room_id', room.id)
      .order('seat_index', { ascending: true });
    if (!remaining || remaining.length === 0) {
      await svc.from('rooms').delete().eq('id', room.id);
      return { ok: true, state: emptySnapshot(), version: 0 };
    }
    await svc.from('rooms').update({
      host_session_id: remaining[0].session_id,
    }).eq('id', room.id);
  }

  await svc.from('game_events').insert({
    room_id: room.id, session_id: actor.session_id,
    kind: 'leave_room', payload: {},
  });

  const newVersion = (room.version ?? 0) + 1;
  await svc.from('rooms').update({ version: newVersion }).eq('id', room.id);

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: newVersion };
}
