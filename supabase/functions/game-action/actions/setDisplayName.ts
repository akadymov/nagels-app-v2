import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult, RoomSnapshot } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

function emptySnapshot(): RoomSnapshot {
  return {
    room: null, players: [], spectators: [], current_hand: null,
    hand_scores: [], current_trick: null, score_history: [], my_hand: [],
  };
}

const MAX_LEN = 20;

export async function setDisplayName(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'set_display_name' }>,
): Promise<ActionResult> {
  const name = (action.display_name ?? '').trim().slice(0, MAX_LEN);
  if (!name) {
    return { ok: false, error: 'invalid_name', state: emptySnapshot(), version: 0 };
  }

  await svc
    .from('room_sessions')
    .update({ display_name: name })
    .eq('id', actor.session_id);

  if (!action.room_id) {
    return { ok: true, state: emptySnapshot(), version: 0 };
  }

  const { data: room } = await svc
    .from('rooms')
    .select('id, version')
    .eq('id', action.room_id)
    .maybeSingle();
  if (!room) {
    return { ok: true, state: emptySnapshot(), version: 0 };
  }

  const newVersion = (room.version ?? 0) + 1;
  await svc.from('rooms').update({ version: newVersion }).eq('id', room.id);

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: newVersion };
}
