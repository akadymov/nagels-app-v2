import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action } from '../../_shared/types.ts';
import { isAdminEmail } from '../../_shared/auth/isAdmin.ts';

export interface ResetRow {
  user_id: string;
  room_id: null;
  reason: 'admin_reset';
  delta: number;
  base_score: number;
  mean_score: 0;
  stake: 0;
}

export function buildResetJournalRow(
  user_id: string,
  balance: number,
  _meta: null,
): ResetRow | null {
  if (balance === 0) return null;
  return {
    user_id,
    room_id: null,
    reason: 'admin_reset',
    delta: -balance,
    base_score: balance,
    mean_score: 0,
    stake: 0,
  };
}

async function ensureAdmin(svc: SupabaseClient, actor: ActorContext): Promise<boolean> {
  const adminCsv = Deno.env.get('ADMIN_EMAILS') ?? '';
  const { data: sess } = await svc
    .from('room_sessions')
    .select('auth_user_id')
    .eq('id', actor.session_id)
    .maybeSingle();
  if (!sess?.auth_user_id) return false;
  const { data: au } = await svc
    .schema('auth')
    .from('users')
    .select('email')
    .eq('id', sess.auth_user_id)
    .maybeSingle();
  return isAdminEmail(au?.email ?? null, adminCsv);
}

export async function adminResetRating(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'admin_reset_rating' }>,
): Promise<{ ok: boolean; error?: string; affected?: number }> {
  if (!(await ensureAdmin(svc, actor))) return { ok: false, error: 'not_admin' };

  const { data: r } = await svc
    .from('user_ratings')
    .select('balance')
    .eq('user_id', action.target_user_id)
    .maybeSingle();
  const balance = r?.balance ?? 0;
  const row = buildResetJournalRow(action.target_user_id, balance, null);
  if (!row) return { ok: true, affected: 0 };

  await svc.from('rating_events').insert(row);
  await svc
    .from('user_ratings')
    .upsert({ user_id: action.target_user_id, balance: 0, updated_at: new Date().toISOString() });
  return { ok: true, affected: 1 };
}

export async function adminResetAllRatings(
  svc: SupabaseClient,
  actor: ActorContext,
): Promise<{ ok: boolean; error?: string; affected?: number }> {
  if (!(await ensureAdmin(svc, actor))) return { ok: false, error: 'not_admin' };

  const { data: rows } = await svc
    .from('user_ratings')
    .select('user_id, balance')
    .neq('balance', 0);

  const journal = (rows ?? [])
    .map((r: { user_id: string; balance: number }) =>
      buildResetJournalRow(r.user_id, r.balance, null))
    .filter((x: ResetRow | null): x is ResetRow => x !== null);

  if (journal.length === 0) return { ok: true, affected: 0 };

  await svc.from('rating_events').insert(journal);
  await svc
    .from('user_ratings')
    .update({ balance: 0, updated_at: new Date().toISOString() })
    .neq('balance', 0);

  return { ok: true, affected: journal.length };
}
