import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

const MAX_PLAYERS = 6;

/**
 * Scorekeeper rooms: the host seats a player who has no phone. The seat is
 * a proxy session (no auth user), always ready; the host records its bets
 * and tricks (see onBehalf.ts). Removed with the regular host kick.
 */
export async function addOfflinePlayer(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'add_offline_player' }>,
): Promise<ActionResult> {
  const fail = async (error: string): Promise<ActionResult> => {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error, state: s, version: s.room?.version ?? 0 };
  };

  const { data: room } = await svc.from('rooms')
    .select('id, host_session_id, phase, mode, tournament_id, player_count, version')
    .eq('id', action.room_id).maybeSingle();
  if (!room) return fail('unknown_room');
  if (room.host_session_id !== actor.session_id) return fail('host_only');
  if (room.mode !== 'scorekeeper' || room.tournament_id) return fail('not_scorekeeper');
  if (room.phase !== 'waiting') return fail('room_in_progress');

  const name = (action.display_name ?? '').trim().slice(0, 24);
  if (!name) return fail('invalid_name');

  const { data: seated } = await svc.from('room_players')
    .select('seat_index, room_sessions!inner(display_name)').eq('room_id', room.id);
  const rows = (seated ?? []) as any[];
  if (rows.some((r) => (r.room_sessions?.display_name ?? '').toLowerCase() === name.toLowerCase())) {
    return fail('name_taken');
  }
  // Grow the table up to the max when the host's target size is full.
  const taken = new Set(rows.map((r) => r.seat_index as number));
  let seat = -1;
  for (let i = 0; i < room.player_count; i++) if (!taken.has(i)) { seat = i; break; }
  let playerCount = room.player_count;
  if (seat === -1) {
    if (room.player_count >= MAX_PLAYERS) return fail('room_full');
    seat = room.player_count;
    playerCount = room.player_count + 1;
  }

  const { data: session, error: sErr } = await svc.from('room_sessions')
    .insert({ display_name: name }).select('id').single();
  if (sErr) throw sErr;

  const { error: rpErr } = await svc.from('room_players').insert({
    room_id: room.id, session_id: session.id, seat_index: seat, is_ready: true,
  });
  if (rpErr) {
    await svc.from('room_sessions').delete().eq('id', session.id);
    return fail('seat_taken');
  }

  await svc.from('game_events').insert({
    room_id: room.id, session_id: actor.session_id,
    kind: 'add_offline_player', payload: { seat_index: seat, session_id: session.id },
  });

  const version = (room.version ?? 0) + 1;
  await svc.from('rooms').update({ player_count: playerCount, version }).eq('id', room.id);

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version };
}
