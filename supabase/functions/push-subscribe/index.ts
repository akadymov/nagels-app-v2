import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { authenticate, makeServiceClient } from '../game-action/auth.ts';

interface SubscribeBody {
  endpoint?: string;
  p256dh?: string;
  auth_secret?: string;
  lang?: string;
}

const ALLOWED_LANGS = new Set(['en', 'ru', 'es']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST')   return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);

  let body: SubscribeBody;
  try { body = await req.json(); }
  catch { return jsonResponse({ ok: false, error: 'invalid_json' }, 400); }

  if (!body.endpoint || !body.p256dh || !body.auth_secret) {
    return jsonResponse({ ok: false, error: 'invalid_body' }, 400);
  }
  const lang = body.lang && ALLOWED_LANGS.has(body.lang) ? body.lang : 'en';

  let actor;
  try { actor = await authenticate(req, null); }
  catch { return jsonResponse({ ok: false, error: 'auth_failed' }, 401); }

  const svc = makeServiceClient();
  const { error } = await svc.from('push_subscriptions').upsert({
    auth_user_id: actor.auth_user_id,
    endpoint: body.endpoint,
    p256dh: body.p256dh,
    auth_secret: body.auth_secret,
    lang,
    last_used_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });

  if (error) {
    console.warn(`[push-subscribe] upsert failed: code=${error.code ?? '<none>'}`);
    return jsonResponse({ ok: false, error: 'internal_error' }, 500);
  }

  return jsonResponse({ ok: true });
});
