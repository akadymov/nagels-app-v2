import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult, RoomSnapshot } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

function emptySnapshot(): RoomSnapshot {
  return {
    room: null, players: [], current_hand: null,
    hand_scores: [], current_trick: null, score_history: [], my_hand: [],
  };
}

export async function setReady(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'ready' }>,
): Promise<ActionResult> {
  const { data: room } = await svc
    .from('rooms')
    .select('id, version, phase')
    .eq('id', action.room_id)
    .maybeSingle();
  if (!room) return { ok: false, error: 'unknown_room', state: emptySnapshot(), version: 0 };

  await svc.from('room_players')
    .update({ is_ready: action.is_ready })
    .eq('room_id', room.id)
    .eq('session_id', actor.session_id);

  await svc.from('game_events').insert({
    room_id: room.id, session_id: actor.session_id,
    kind: 'ready', payload: { is_ready: action.is_ready },
  });

  const newVersion = (room.version ?? 0) + 1;
  await svc.from('rooms').update({ version: newVersion }).eq('id', room.id);

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: newVersion };
}
