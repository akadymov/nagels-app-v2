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

const TTL_HOURS = 48;
const LIVE_WINDOW_MS = 30_000; // a lineup member counts as present if seen <30s ago

// Host-only. Resumes a paused game once every paused_lineup member has a
// room_players row that is live (last_seen_at within 30s). An over-TTL paused
// room is converted to 'finished' (no settle) instead.
export async function resumeGame(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'resume_game' }>,
): Promise<ActionResult> {
  const { data: room } = await svc
    .from('rooms')
    .select('id, version, host_session_id, phase, paused_at, paused_lineup')
    .eq('id', action.room_id)
    .maybeSingle();
  if (!room) return { ok: false, error: 'room_not_found', state: empty(), version: 0 };
  if (room.host_session_id !== actor.session_id)
    return { ok: false, error: 'not_host', state: empty(), version: 0 };
  if (room.phase !== 'paused')
    return { ok: false, error: 'not_paused', state: empty(), version: 0 };

  // TTL: an over-48h pause is abandoned (no settle), not resumed.
  // pausedMs is 0/NaN when paused_at is missing/unparseable (shouldn't happen in
  // normal flow); both are falsy, so we skip the TTL check and attempt resume —
  // the safe direction (never abandon on bad data).
  const pausedMs = room.paused_at ? Date.parse(room.paused_at as string) : 0;
  if (pausedMs && Date.now() - pausedMs > TTL_HOURS * 3600_000) {
    const v = (room.version ?? 0) + 1;
    await svc.from('rooms').update({ phase: 'finished', version: v }).eq('id', room.id);
    await svc.from('game_events').insert({
      room_id: room.id, session_id: actor.session_id, kind: 'game_abandoned', payload: { reason: 'ttl' },
    });
    return { ok: false, error: 'game_abandoned',
             state: await buildSnapshot(svc, room.id, actor.session_id), version: v };
  }

  // Every lineup member must have a live room_players row.
  const lineup = (room.paused_lineup ?? []) as string[];
  const { data: rps } = await svc
    .from('room_players')
    .select('session_id, last_seen_at')
    .eq('room_id', room.id);
  const liveSet = new Set(
    (rps ?? [])
      .filter((r: { last_seen_at: string }) => Date.now() - Date.parse(r.last_seen_at) < LIVE_WINDOW_MS)
      .map((r: { session_id: string }) => r.session_id),
  );
  const missing = lineup.filter((sid) => !liveSet.has(sid));
  if (missing.length > 0) {
    return { ok: false, error: 'lineup_incomplete',
             state: await buildSnapshot(svc, room.id, actor.session_id), version: room.version ?? 0 };
  }

  const newVersion = (room.version ?? 0) + 1;
  await svc.from('rooms').update({
    phase: 'playing', paused_at: null, paused_lineup: null, version: newVersion,
  }).eq('id', room.id);

  await svc.from('game_events').insert({
    room_id: room.id, session_id: actor.session_id, kind: 'game_resumed', payload: {},
  });

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: newVersion };
}
