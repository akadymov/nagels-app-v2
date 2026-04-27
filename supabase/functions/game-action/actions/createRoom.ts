import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';

function generateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export async function createRoom(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'create_room' }>,
): Promise<ActionResult> {
  let inserted: { id: string; version: number } | null = null;
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
      .select('id, version')
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
  return { ok: true, state: snapshot, version: inserted.version + 1 };
}
