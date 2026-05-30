import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult, RoomSnapshot } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

function empty(): RoomSnapshot {
  return {
    room: null, players: [], spectators: [], current_hand: null,
    hand_scores: [], current_trick: null, last_closed_trick: null,
    score_history: [], my_hand: [],
  } as unknown as RoomSnapshot;
}

// Host-only. Freezes an in-play game: room.phase -> 'paused', records paused_at
// (always stamped now(), so pausing the game AGAIN later — after a resume
// returned it to 'playing' — starts a fresh 48h TTL, never an accumulated one)
// and paused_lineup (the session_ids that must all be back+live before resume).
export async function pauseGame(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'pause_game' }>,
): Promise<ActionResult> {
  const { data: room } = await svc
    .from('rooms')
    .select('id, version, host_session_id, phase')
    .eq('id', action.room_id)
    .maybeSingle();
  if (!room) return { ok: false, error: 'room_not_found', state: empty(), version: 0 };
  if (room.host_session_id !== actor.session_id)
    return { ok: false, error: 'not_host', state: empty(), version: 0 };
  if (room.phase !== 'playing')
    return { ok: false, error: 'not_in_play', state: empty(), version: 0 };

  const { data: rps } = await svc
    .from('room_players')
    .select('session_id')
    .eq('room_id', room.id);
  const lineup = (rps ?? []).map((r: { session_id: string }) => r.session_id);

  const newVersion = (room.version ?? 0) + 1;
  await svc.from('rooms').update({
    phase: 'paused',
    paused_at: new Date().toISOString(),
    paused_lineup: lineup,
    version: newVersion,
  }).eq('id', room.id);

  await svc.from('game_events').insert({
    room_id: room.id, session_id: actor.session_id, kind: 'game_paused', payload: {},
  });

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: newVersion };
}
