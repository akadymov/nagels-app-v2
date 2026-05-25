import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action } from '../../_shared/types.ts';
import { isAdminEmail } from '../../_shared/auth/isAdmin.ts';

interface Row {
  id: string;
  email: string | null;
  display_name: string | null;
  balance: number;
}

export async function adminSearchUsers(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'admin_search_users' }>,
): Promise<{ ok: boolean; error?: string; rows?: Row[] }> {
  const adminCsv = Deno.env.get('ADMIN_EMAILS') ?? '';
  const { data: sess } = await svc
    .from('room_sessions')
    .select('auth_user_id')
    .eq('id', actor.session_id)
    .maybeSingle();
  if (!sess?.auth_user_id) return { ok: false, error: 'not_admin' };
  // PostgREST doesn't expose the auth schema — go through SECURITY DEFINER RPCs.
  const { data: au } = await svc.rpc('get_auth_user_info', { p_user_id: sess.auth_user_id });
  if (!isAdminEmail(au?.email ?? null, adminCsv)) return { ok: false, error: 'not_admin' };

  const q = (action.q ?? '').trim().toLowerCase();
  if (q.length < 2) return { ok: true, rows: [] };

  const { data: matchesRaw } = await svc.rpc('search_auth_users_by_email', { p_q: q });
  const matches = Array.isArray(matchesRaw) ? matchesRaw : [];
  const ids = matches.map((m: { id: string }) => m.id);
  if (ids.length === 0) return { ok: true, rows: [] };

  const { data: ratings } = await svc
    .from('user_ratings')
    .select('user_id, balance')
    .in('user_id', ids);
  const balanceByUser = new Map<string, number>(
    (ratings ?? []).map((r: { user_id: string; balance: number }) => [r.user_id, r.balance]),
  );

  // room_sessions.auth_user_id is UNIQUE — at most one row per user, no sort needed.
  const { data: sessions } = await svc
    .from('room_sessions')
    .select('auth_user_id, display_name')
    .in('auth_user_id', ids);
  const nameByUser = new Map<string, string>();
  for (const s of sessions ?? []) {
    const uid = (s as { auth_user_id: string }).auth_user_id;
    nameByUser.set(uid, (s as { display_name: string }).display_name);
  }

  const rows: Row[] = matches.map((m: { id: string; email: string | null }) => ({
    id: m.id,
    email: m.email,
    display_name: nameByUser.get(m.id) ?? null,
    balance: balanceByUser.get(m.id) ?? 0,
  }));

  return { ok: true, rows };
}
