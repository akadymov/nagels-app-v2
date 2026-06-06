import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { authenticate, makeServiceClient } from '../game-action/auth.ts';

Deno.serve(async (req: Request) => {
  const respond = (body: unknown, status = 200) => jsonResponse(body, status, req);
  const preflight = () => handleOptions(req);

  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST')   return respond({ ok: false, error: 'method_not_allowed' }, 405);

  let body: { endpoint?: string };
  try { body = await req.json(); }
  catch { return respond({ ok: false, error: 'invalid_json' }, 400); }
  if (!body.endpoint) return respond({ ok: false, error: 'invalid_body' }, 400);

  let actor;
  try { actor = await authenticate(req, null); }
  catch { return respond({ ok: false, error: 'auth_failed' }, 401); }

  const svc = makeServiceClient();
  const { error } = await svc.from('push_subscriptions')
    .delete()
    .eq('endpoint', body.endpoint)
    .eq('auth_user_id', actor.auth_user_id);

  if (error) {
    console.warn(`[push-unsubscribe] delete failed: code=${error.code ?? '<none>'}`);
    return respond({ ok: false, error: 'internal_error' }, 500);
  }
  return respond({ ok: true });
});
