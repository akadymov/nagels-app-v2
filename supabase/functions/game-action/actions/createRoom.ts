import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult, RoomSnapshot } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';
import { notifyNewRoom } from '../../_shared/telegram.ts';

function generateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

const ROOMS_PER_HOUR_LIMIT = 10;
const ROOMS_PER_HOUR_WINDOW_MS = 60 * 60 * 1000;

function emptySnapshot(): RoomSnapshot {
  return {
    room: null, players: [], current_hand: null,
    hand_scores: [], current_trick: null, last_closed_trick: null,
    score_history: [], my_hand: [],
  };
}

export async function createRoom(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'create_room' }>,
): Promise<ActionResult> {
  // Throttle: a single session can't create more than ROOMS_PER_HOUR_LIMIT
  // rooms in any rolling hour. Counts kind='create_room' events on
  // game_events for the current session in the last 60 min — no new
  // table or migration needed; the events table already records every
  // creation. Caps abusive automation while letting humans (and the
  // demo, ~1 room/run) breathe.
  const since = new Date(Date.now() - ROOMS_PER_HOUR_WINDOW_MS).toISOString();
  const { count: recentCount } = await svc
    .from('game_events')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', actor.session_id)
    .eq('kind', 'create_room')
    .gte('created_at', since);
  if ((recentCount ?? 0) >= ROOMS_PER_HOUR_LIMIT) {
    return {
      ok: false,
      error: 'too_many_rooms',
      state: emptySnapshot(),
      version: 0,
    };
  }

  let inserted: { id: string; version: number; code: string } | null = null;
  for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
    const code = generateCode();
    const { data, error } = await svc
      .from('rooms')
      .insert({
        code,
        host_session_id: actor.session_id,
        player_count: action.player_count,
        max_cards: action.max_cards ?? 10,
        phase: 'waiting',
      })
      .select('id, version, code')
      .single();
    if (!error) {
      inserted = data as any;
      break;
    }
    if ((error as any).code !== '23505') throw error;
  }
  if (!inserted) throw new Error('could_not_allocate_code');

  const { error: rpErr } = await svc.from('room_players').insert({
    room_id: inserted.id,
    session_id: actor.session_id,
    seat_index: 0,
    is_ready: true,
  });
  if (rpErr) throw rpErr;

  await svc.from('game_events').insert({
    room_id: inserted.id,
    session_id: actor.session_id,
    kind: 'create_room',
    payload: { player_count: action.player_count, max_cards: action.max_cards ?? 10 },
  });

  await svc.from('rooms').update({ version: inserted.version + 1 }).eq('id', inserted.id);

  const snapshot = await buildSnapshot(svc, inserted.id, actor.session_id);

  // Fire-and-forget Telegram notification. notifyNewRoom never throws —
  // a bad token, missing chat id, or TG outage cannot block room creation.
  // Awaited only so the AbortController inside sendTelegram has time to
  // run before the edge-function request context is torn down.
  await notifyNewRoom({
    hostName: actor.display_name,
    roomCode: inserted.code,
    appOrigin: Deno.env.get('PUBLIC_APP_ORIGIN') ?? 'https://nigels.online',
  });

  return { ok: true, state: snapshot, version: inserted.version + 1 };
}
