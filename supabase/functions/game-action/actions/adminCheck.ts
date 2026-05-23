import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext } from '../../_shared/types.ts';
import { isAdminEmail } from '../../_shared/auth/isAdmin.ts';

export async function adminCheck(
  svc: SupabaseClient,
  actor: ActorContext,
): Promise<{ ok: true; is_admin: boolean }> {
  const adminCsv = Deno.env.get('ADMIN_EMAILS') ?? '';
  const { data: sess } = await svc
    .from('room_sessions')
    .select('auth_user_id')
    .eq('id', actor.session_id)
    .maybeSingle();
  if (!sess?.auth_user_id) return { ok: true, is_admin: false };
  // PostgREST does not expose the auth schema — read through SECURITY DEFINER RPC.
  const { data: au } = await svc.rpc('get_auth_user_info', { p_user_id: sess.auth_user_id });
  return { ok: true, is_admin: isAdminEmail(au?.email ?? null, adminCsv) };
}
