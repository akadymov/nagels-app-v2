import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action } from '../../_shared/types.ts';
import { validateSeating, STAKE_CHIPS, MAX_TABLE } from '../../_shared/engine/tournament.ts';
import { generateCode } from './createRoom.ts';
import { startGame } from './startGame.ts';
import { buildSnapshot } from '../snapshot.ts';
import { broadcastTournamentChanged } from '../broadcast.ts';

type R = Record<string, unknown> & { ok: boolean; error?: string };

export function isTournamentAdmin(
  t: { admin_session_id: string | null; table_secret: string },
  actorSessionId: string,
  secret?: string,
): boolean {
  return t.admin_session_id === actorSessionId || (!!secret && secret === t.table_secret);
}

/** Tournament rooms never reach Telegram or Web Push (spec: Notifications). */
export function shouldNotify(room: { tournament_id?: string | null } | null | undefined): boolean {
  return !room?.tournament_id;
}

function cleanParticipants(list: Array<{ display_name: string; no_stakes: boolean }>) {
  const out = list
    .map((p) => ({ display_name: (p.display_name ?? '').trim().slice(0, 24), no_stakes: !!p.no_stakes }))
    .filter((p) => p.display_name.length > 0);
  const names = new Set(out.map((p) => p.display_name.toLowerCase()));
  if (out.length < 2 || names.size !== out.length || out.length > MAX_TABLE * 6) return null;
  return out;
}

async function loadTournament(svc: SupabaseClient, id: string) {
  const { data } = await svc.from('tournaments')
    .select('id, code, admin_session_id, table_secret, max_cards, current_tour, version')
    .eq('id', id).maybeSingle();
  return data as null | {
    id: string; code: string; admin_session_id: string | null; table_secret: string;
    max_cards: number; current_tour: number; version: number;
  };
}

async function bump(svc: SupabaseClient, t: { id: string; version: number }, patch: Record<string, unknown> = {}) {
  const version = t.version + 1;
  await svc.from('tournaments').update({ ...patch, version }).eq('id', t.id);
  void broadcastTournamentChanged(svc, t.id, version).catch((e) =>
    console.error('[tournament] broadcast failed:', e));
}

export async function tournamentCreate(
  svc: SupabaseClient, actor: ActorContext,
  action: Extract<Action, { kind: 'tournament_create' }>,
): Promise<R> {
  const participants = cleanParticipants(action.participants);
  if (!participants) return { ok: false, error: 'invalid_participants' };
  const max_cards = Math.max(1, Math.min(10, Math.floor(action.max_cards || 10)));
  const secret = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

  let row: { id: string; code: string } | null = null;
  for (let attempt = 0; attempt < 5 && !row; attempt++) {
    const { data, error } = await svc.from('tournaments').insert({
      code: generateCode(), name: (action.name ?? '').trim().slice(0, 40) || 'Tournament',
      admin_session_id: actor.session_id, max_cards, table_secret: secret,
    }).select('id, code').single();
    if (!error) row = data as any;
    else if ((error as any).code !== '23505') throw error;
  }
  if (!row) throw new Error('could_not_allocate_code');

  const { error: pErr } = await svc.from('tournament_participants')
    .insert(participants.map((p) => ({ ...p, tournament_id: row!.id })));
  if (pErr) throw pErr;

  return { ok: true, tournament_id: row.id, code: row.code, secret };
}

export async function tournamentUpdateParticipants(
  svc: SupabaseClient, actor: ActorContext,
  action: Extract<Action, { kind: 'tournament_update_participants' }>,
): Promise<R> {
  const t = await loadTournament(svc, action.tournament_id);
  if (!t) return { ok: false, error: 'unknown_tournament' };
  if (!isTournamentAdmin(t, actor.session_id, action.secret)) return { ok: false, error: 'not_admin' };
  const participants = cleanParticipants(action.participants);
  if (!participants) return { ok: false, error: 'invalid_participants' };

  // Upsert by name: existing participants keep their id (and their balance history).
  const { data: existing } = await svc.from('tournament_participants')
    .select('id, display_name').eq('tournament_id', t.id);
  const byName = new Map((existing ?? []).map((p: any) => [p.display_name.toLowerCase(), p.id]));
  for (const p of participants) {
    const id = byName.get(p.display_name.toLowerCase());
    if (id) await svc.from('tournament_participants').update({ no_stakes: p.no_stakes, display_name: p.display_name }).eq('id', id);
    else await svc.from('tournament_participants').insert({ ...p, tournament_id: t.id });
  }
  // Removing someone who already played would erase their history; only drop never-seated ones.
  const keep = new Set(participants.map((p) => p.display_name.toLowerCase()));
  for (const p of existing ?? []) {
    if (keep.has((p as any).display_name.toLowerCase())) continue;
    const { count } = await svc.from('room_sessions')
      .select('id', { count: 'exact', head: true }).eq('tournament_participant_id', (p as any).id);
    if ((count ?? 0) === 0) await svc.from('tournament_participants').delete().eq('id', (p as any).id);
  }
  await bump(svc, t);
  return { ok: true };
}

export async function tournamentSetMaxCards(
  svc: SupabaseClient, actor: ActorContext,
  action: Extract<Action, { kind: 'tournament_set_max_cards' }>,
): Promise<R> {
  const t = await loadTournament(svc, action.tournament_id);
  if (!t) return { ok: false, error: 'unknown_tournament' };
  if (!isTournamentAdmin(t, actor.session_id, action.secret)) return { ok: false, error: 'not_admin' };
  const max_cards = Math.max(1, Math.min(10, Math.floor(action.max_cards)));
  await bump(svc, t, { max_cards });
  return { ok: true };
}

export async function tournamentStartTour(
  svc: SupabaseClient, actor: ActorContext,
  action: Extract<Action, { kind: 'tournament_start_tour' }>,
): Promise<R> {
  const t = await loadTournament(svc, action.tournament_id);
  if (!t) return { ok: false, error: 'unknown_tournament' };
  if (!isTournamentAdmin(t, actor.session_id, action.secret)) return { ok: false, error: 'not_admin' };

  const stakes = action.tables.map((x) => x.stake);
  if (stakes.some((s) => !(STAKE_CHIPS as readonly number[]).includes(s))) return { ok: false, error: 'bad_stake' };

  const { data: parts } = await svc.from('tournament_participants')
    .select('id, display_name, no_stakes').eq('tournament_id', t.id);
  const seating = action.tables.map((x) => x.seats);
  const err = validateSeating(seating, (parts ?? []) as any, stakes);
  if (err) return { ok: false, error: err };

  // Refuse to start over an unfinished tour (double-tap / two admins).
  if (t.current_tour > 0) {
    const { count } = await svc.from('rooms').select('id', { count: 'exact', head: true })
      .eq('tournament_id', t.id).eq('tour_number', t.current_tour).neq('phase', 'finished');
    if ((count ?? 0) > 0 && !action.force) return { ok: false, error: 'tour_in_progress' };
  }

  const tour = t.current_tour + 1;
  // Same max_cards for every table in a tour: clamp by the largest table.
  const tourMaxCards = Math.min(10, t.max_cards, ...seating.map((s) => Math.floor(52 / s.length)));

  // Claim the tour first (compare-and-swap) so concurrent / retried calls can't
  // create a second set of rooms.
  const claimedVersion = t.version + 1;
  const { data: claimed } = await svc.from('tournaments')
    .update({ current_tour: tour, version: claimedVersion })
    .eq('id', t.id).eq('current_tour', t.current_tour).select('id');
  if (!claimed || claimed.length === 0) return { ok: false, error: 'tour_in_progress' };

  const nameById = new Map((parts ?? []).map((p: any) => [p.id, p.display_name]));
  const rooms: Array<{ table_number: number; room_id: string }> = [];
  const createdSessionIds: string[] = [];

  try {
    for (let i = 0; i < seating.length; i++) {
      const seats = seating[i];
      const { data: sessions, error: sErr } = await svc.from('room_sessions')
        .insert(seats.map((pid) => ({ display_name: nameById.get(pid), tournament_participant_id: pid })))
        .select('id, tournament_participant_id');
      if (sErr) throw sErr;
      for (const s of sessions ?? []) createdSessionIds.push((s as any).id);
      const sessionByPid = new Map((sessions ?? []).map((s: any) => [s.tournament_participant_id, s.id]));

      let room: { id: string } | null = null;
      for (let attempt = 0; attempt < 5 && !room; attempt++) {
        const { data, error } = await svc.from('rooms').insert({
          code: generateCode(), host_session_id: actor.session_id,
          player_count: seats.length, max_cards: tourMaxCards, mode: 'scorekeeper', phase: 'waiting',
          tournament_id: t.id, tour_number: tour, table_number: i + 1, stake: stakes[i],
        }).select('id').single();
        if (!error) room = data as any;
        else if ((error as any).code !== '23505') throw error;
      }
      if (!room) throw new Error('could_not_allocate_code');
      rooms.push({ table_number: i + 1, room_id: room.id });

      const { error: rpErr } = await svc.from('room_players').insert(
        seats.map((pid, seat) => ({ room_id: room!.id, session_id: sessionByPid.get(pid), seat_index: seat, is_ready: true })));
      if (rpErr) throw rpErr;

      const started = await startGame(svc, actor, { kind: 'start_game', room_id: room.id });
      if (!started.ok) throw new Error(`start_game_failed:${started.error}`);
    }
  } catch (e) {
    // Roll back everything this call created, then release the tour.
    try {
      await svc.from('rooms').delete().eq('tournament_id', t.id).eq('tour_number', tour);
      if (createdSessionIds.length) await svc.from('room_sessions').delete().in('id', createdSessionIds);
      await svc.from('tournaments').update({ current_tour: t.current_tour, version: claimedVersion + 1 })
        .eq('id', t.id).eq('current_tour', tour);
    } catch (rbErr) {
      console.error('[tournament] start_tour rollback failed:', rbErr);
    }
    throw e;
  }

  void broadcastTournamentChanged(svc, t.id, claimedVersion).catch((e) =>
    console.error('[tournament] broadcast failed:', e));
  return { ok: true, tour_number: tour, rooms };
}

export async function tournamentClaimTable(
  svc: SupabaseClient, actor: ActorContext,
  action: Extract<Action, { kind: 'tournament_claim_table' }>,
): Promise<R> {
  const { data: t } = await svc.from('tournaments')
    .select('id, table_secret, current_tour, version').eq('code', action.code.toUpperCase()).maybeSingle();
  if (!t) return { ok: false, error: 'unknown_tournament' };
  if (action.secret !== t.table_secret) return { ok: false, error: 'bad_secret' };

  const { data: room } = await svc.from('rooms').select('id, version, host_session_id')
    .eq('tournament_id', t.id).eq('tour_number', t.current_tour).eq('table_number', action.table_number)
    .maybeSingle();
  if (!room) return { ok: false, error: 'no_such_table' };

  // Idempotent for the current host; a second phone takes over (dead-phone recovery).
  if (room.host_session_id !== actor.session_id) {
    await svc.from('rooms').update({
      host_session_id: actor.session_id, table_claimed: true, version: room.version + 1,
    }).eq('id', room.id);
  } else {
    await svc.from('rooms').update({ table_claimed: true }).eq('id', room.id);
  }
  const state = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, room_id: room.id, state, version: state.room?.version ?? 0 };
}
