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

export async function toggleStakeOptin(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'toggle_stake_optin' }>,
): Promise<ActionResult> {
  const { data: room } = await svc
    .from('rooms')
    .select('id, version, stake_locked')
    .eq('id', action.room_id)
    .maybeSingle();
  if (!room) {
    return { ok: false, error: 'room_not_found', state: empty(), version: 0 };
  }
  if (room.stake_locked) {
    return { ok: false, error: 'stake_locked', state: empty(), version: 0 };
  }

  const { data: rp } = await svc
    .from('room_players')
    .select('session_id')
    .eq('room_id', room.id)
    .eq('session_id', actor.session_id)
    .maybeSingle();
  if (!rp) {
    return { ok: false, error: 'not_seated', state: empty(), version: 0 };
  }

  if (action.opted_in) {
    const { data: meSess } = await svc
      .from('room_sessions')
      .select('auth_user_id')
      .eq('id', actor.session_id)
      .maybeSingle();
    if (!meSess?.auth_user_id) {
      return { ok: false, error: 'not_eligible_to_opt_in', state: empty(), version: 0 };
    }
    const { data: au } = await svc
      .schema('auth')
      .from('users')
      .select('email_confirmed_at')
      .eq('id', meSess.auth_user_id)
      .maybeSingle();
    if (!au?.email_confirmed_at) {
      return { ok: false, error: 'not_eligible_to_opt_in', state: empty(), version: 0 };
    }
  }

  const newVersion = (room.version ?? 0) + 1;
  await svc
    .from('room_players')
    .update({ opt_in_stake: action.opted_in })
    .eq('room_id', room.id)
    .eq('session_id', actor.session_id);
  await svc.from('rooms').update({ version: newVersion }).eq('id', room.id);

  const snapshot = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, state: snapshot, version: newVersion };
}
