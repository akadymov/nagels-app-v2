import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action } from '../../_shared/types.ts';
import { isAdminEmail } from '../../_shared/auth/isAdmin.ts';

export async function adminGrantTelegram(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'admin_grant_telegram' }>,
): Promise<{ ok: boolean; error?: string }> {
  const adminCsv = Deno.env.get('ADMIN_EMAILS') ?? '';
  const { data: sess } = await svc
    .from('room_sessions')
    .select('auth_user_id')
    .eq('id', actor.session_id)
    .maybeSingle();
  if (!sess?.auth_user_id) return { ok: false, error: 'not_admin' };
  const { data: au } = await svc.rpc('get_auth_user_info', { p_user_id: sess.auth_user_id });
  if (!isAdminEmail(au?.email ?? null, adminCsv)) {
    return { ok: false, error: 'not_admin' };
  }

  const { error } = await svc
    .from('telegram_announce_allowlist')
    .upsert({ user_id: action.target_user_id, granted_by: sess.auth_user_id }, { onConflict: 'user_id' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
