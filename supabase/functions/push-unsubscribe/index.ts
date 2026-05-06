import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { authenticate, makeServiceClient } from '../game-action/auth.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST')   return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);

  let body: { endpoint?: string };
  try { body = await req.json(); }
  catch { return jsonResponse({ ok: false, error: 'invalid_json' }, 400); }
  if (!body.endpoint) return jsonResponse({ ok: false, error: 'invalid_body' }, 400);

  let actor;
  try { actor = await authenticate(req, null); }
  catch { return jsonResponse({ ok: false, error: 'auth_failed' }, 401); }

  const svc = makeServiceClient();
  const { error } = await svc.from('push_subscriptions')
    .delete()
    .eq('endpoint', body.endpoint)
    .eq('auth_user_id', actor.auth_user_id);

  if (error) {
    console.warn(`[push-unsubscribe] delete failed: code=${error.code ?? '<none>'}`);
    return jsonResponse({ ok: false, error: 'internal_error' }, 500);
  }
  return jsonResponse({ ok: true });
});
