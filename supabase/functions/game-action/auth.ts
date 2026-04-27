import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext } from '../_shared/types.ts';

export function makeServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

export async function authenticate(
  req: Request,
  defaultDisplayName: string | null,
): Promise<ActorContext> {
  const auth = req.headers.get('Authorization');
  if (!auth) throw new Error('auth_failed');

  const token = auth.replace(/^Bearer\s+/i, '');

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: u, error } = await userClient.auth.getUser(token);
  if (error || !u?.user) throw new Error('auth_failed');

  const auth_user_id = u.user.id;
  const display_name = defaultDisplayName ?? u.user.user_metadata?.display_name ?? 'Guest';

  const svc = makeServiceClient();
  const { data: existing } = await svc
    .from('room_sessions')
    .select('id, display_name')
    .eq('auth_user_id', auth_user_id)
    .maybeSingle();

  if (existing) {
    return { auth_user_id, session_id: existing.id, display_name: existing.display_name };
  }

  const { data: created, error: e2 } = await svc
    .from('room_sessions')
    .insert({ auth_user_id, display_name })
    .select('id, display_name')
    .single();
  if (e2) throw new Error('auth_failed');

  return { auth_user_id, session_id: created.id, display_name: created.display_name };
}
