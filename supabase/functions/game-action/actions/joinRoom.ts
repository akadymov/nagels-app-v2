import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult, RoomSnapshot } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

function emptySnapshot(): RoomSnapshot {
  return {
    room: null, players: [], current_hand: null,
    hand_scores: [], current_trick: null, score_history: [], my_hand: [],
  };
}

export async function joinRoom(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'join_room' }>,
): Promise<ActionResult> {
  const { data: room, error: rErr } = await svc
    .from('rooms')
    .select('id, phase, player_count, version')
    .eq('code', action.code.toUpperCase())
    .maybeSingle();
  if (rErr) throw rErr;
  if (!room) {
    return { ok: false, error: 'unknown_room', state: emptySnapshot(), version: 0 };
  }
  if (room.phase !== 'waiting') {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: false, error: 'room_in_progress', state: snapshot, version: snapshot.room?.version ?? 0 };
  }

  const { data: existing } = await svc
    .from('room_players')
    .select('seat_index')
    .eq('room_id', room.id)
    .eq('session_id', actor.session_id)
    .maybeSingle();
  if (existing) {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: true, state: snapshot, version: snapshot.room?.version ?? 0 };
  }

  const { data: occupied } = await svc
    .from('room_players')
    .select('seat_index')
    .eq('room_id', room.id);
  const taken = new Set((occupied ?? []).map((r: any) => r.seat_index));
  let seat = -1;
  for (let i = 0; i < room.player_count; i++) if (!taken.has(i)) { seat = i; break; }
  if (seat === -1) {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: false, error: 'room_full', state: snapshot, version: snapshot.room?.version ?? 0 };
  }

  await svc
    .from('room_sessions')
    .update({ display_name: actor.display_name })
    .eq('id', actor.session_id);

  const { error: ipErr } = await svc.from('room_players').insert({
    room_id: room.id,
    session_id: actor.session_id,
    seat_index: seat,
    is_ready: false,
  });
  if (ipErr) {
    const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
    return { ok: false, error: 'seat_taken', state: snapshot, version: snapshot.room?.version ?? 0 };
  }

  await svc.from('game_events').insert({
    room_id: room.id, session_id: actor.session_id,
    kind: 'join_room', payload: { seat_index: seat },
  });

  const newVersion = (room.version ?? 0) + 1;
  await svc.from('rooms').update({ version: newVersion }).eq('id', room.id);

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: newVersion };
}
