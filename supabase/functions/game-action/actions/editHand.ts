import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult, RoomSnapshot } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';
import { canActForTable } from '../onBehalf.ts';

/** Seat-keyed edit entries → session-keyed RPC entries; null if malformed. */
export function toSessionEntries(
  entries: unknown,
  seatToSession: Map<number, string>,
): Array<{ session_id: string; bet: number; taken: number }> | null {
  if (!Array.isArray(entries)) return null;
  const out: Array<{ session_id: string; bet: number; taken: number }> = [];
  for (const e of entries) {
    const { seat, bet, taken } = (e ?? {}) as Record<string, unknown>;
    if (![seat, bet, taken].every((v) => Number.isInteger(v))) return null;
    const session_id = seatToSession.get(seat as number);
    if (!session_id) return null;
    out.push({ session_id, bet: bet as number, taken: taken as number });
  }
  return out;
}

export async function editHand(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'edit_hand' }>,
): Promise<ActionResult> {
  const { data: room } = await svc.from('rooms')
    .select('tournament_id, host_session_id, mode, stake').eq('id', action.room_id).maybeSingle();
  const { data: t } = room?.tournament_id
    ? await svc.from('tournaments').select('admin_session_id').eq('id', room.tournament_id).maybeSingle()
    : { data: null };
  if (!room || !canActForTable(room, t?.admin_session_id ?? null, actor.session_id)) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'not_recorder', state: s, version: s.room?.version ?? 0 };
  }
  // Rating stakes settle from these rows; outside a tournament, history
  // stays as the players entered it while a stake is set.
  if (!room.tournament_id && (room.stake ?? 0) > 0) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'stake_room', state: s, version: s.room?.version ?? 0 };
  }

  const { data: seats } = await svc.from('room_players')
    .select('seat_index, session_id').eq('room_id', action.room_id);
  const entries = toSessionEntries(
    action.entries,
    new Map((seats ?? []).map((r: any) => [r.seat_index as number, r.session_id as string])),
  );
  if (!entries) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'invalid_entries', state: s, version: s.room?.version ?? 0 };
  }

  const { data, error } = await svc.rpc('edit_hand_action', {
    p_room_id: action.room_id, p_hand_id: action.hand_id, p_entries: entries,
    p_actor_session_id: actor.session_id,
  });
  if (error) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id).catch(() => ({} as RoomSnapshot));
    return { ok: false, error: 'rpc_failed', state: s, version: s.room?.version ?? 0 };
  }
  const result = data as ActionResult;
  result.state = await buildSnapshot(svc, action.room_id, actor.session_id);
  return result;
}
