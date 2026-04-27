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
    .select('id, version, phase, host_session_id')
    .eq('id', action.room_id)
    .maybeSingle();
  if (!room) return { ok: false, error: 'unknown_room', state: emptySnapshot(), version: 0 };

  // Default: caller toggles their own ready. If `target_session_id` is set and
  // differs from caller, only the host may set someone else's ready state.
  const target = action.target_session_id ?? actor.session_id;
  if (target !== actor.session_id && room.host_session_id !== actor.session_id) {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: false, error: 'host_only', state: snapshot, version: snapshot.room?.version ?? 0 };
  }

  await svc.from('room_players')
    .update({ is_ready: action.is_ready })
    .eq('room_id', room.id)
    .eq('session_id', target);

  await svc.from('game_events').insert({
    room_id: room.id, session_id: actor.session_id,
    kind: target === actor.session_id ? 'ready' : 'force_ready',
    payload: { is_ready: action.is_ready, target_session_id: target },
  });

  const newVersion = (room.version ?? 0) + 1;
  await svc.from('rooms').update({ version: newVersion }).eq('id', room.id);

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: newVersion };
}
