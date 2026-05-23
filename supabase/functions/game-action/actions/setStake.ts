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

// Any positive integer up to 999. UI offers presets + a free-form input;
// the server bound matches the DB CHECK constraint.
const MAX_STAKE = 999;

export async function setStake(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'set_stake' }>,
): Promise<ActionResult> {
  if (!Number.isInteger(action.stake) || action.stake < 0 || action.stake > MAX_STAKE) {
    return { ok: false, error: 'invalid_stake', state: empty(), version: 0 };
  }

  const { data: room } = await svc
    .from('rooms')
    .select('id, version, host_session_id, stake_locked')
    .eq('id', action.room_id)
    .maybeSingle();
  if (!room) {
    return { ok: false, error: 'room_not_found', state: empty(), version: 0 };
  }
  if (room.host_session_id !== actor.session_id) {
    return { ok: false, error: 'not_host', state: empty(), version: 0 };
  }
  if (room.stake_locked) {
    return { ok: false, error: 'stake_locked', state: empty(), version: 0 };
  }

  // Eligibility: host's auth user must have a confirmed email when stake > 0.
  if (action.stake > 0) {
    const { data: meSess } = await svc
      .from('room_sessions')
      .select('auth_user_id')
      .eq('id', actor.session_id)
      .maybeSingle();
    if (!meSess?.auth_user_id) {
      return { ok: false, error: 'not_eligible_to_set_stake', state: empty(), version: 0 };
    }
    const { data: au } = await svc
      .schema('auth')
      .from('users')
      .select('email_confirmed_at')
      .eq('id', meSess.auth_user_id)
      .maybeSingle();
    if (!au?.email_confirmed_at) {
      return { ok: false, error: 'not_eligible_to_set_stake', state: empty(), version: 0 };
    }
  }

  const newVersion = (room.version ?? 0) + 1;
  await svc.from('rooms').update({ stake: action.stake, version: newVersion }).eq('id', room.id);
  // Changing the terms invalidates everyone's opt-in.
  await svc.from('room_players').update({ opt_in_stake: false }).eq('room_id', room.id);

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: newVersion };
}
