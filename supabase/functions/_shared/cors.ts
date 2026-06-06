// Defense-in-depth CORS for the edge functions.
//
// JWT verification is the real guard on every mutation (no cookies → low CSRF
// surface), but we still echo only known origins instead of a blanket `*`.
// Unknown origins fall back to the canonical prod origin, so a stray cross-site
// fetch never sees its own origin reflected.
//
// `req` is threaded in explicitly — module-level mutable origin state is unsafe
// under Fluid Compute, which reuses instances across concurrent requests.

const ALLOWED_ORIGINS = new Set([
  'https://nigels.online',
  'http://localhost:8081',
  'http://localhost:8082', // isolated test Expo (sanity / demo:record)
]);

// Vercel preview deploys: https://<anything>.vercel.app
const VERCEL_PREVIEW = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

const DEFAULT_ORIGIN = 'https://nigels.online';

function resolveOrigin(req?: Request): string {
  const origin = req?.headers.get('Origin') ?? '';
  if (ALLOWED_ORIGINS.has(origin) || VERCEL_PREVIEW.test(origin)) return origin;
  return DEFAULT_ORIGIN;
}

export function corsHeaders(req?: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': resolveOrigin(req),
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // Cache key must vary by origin since the allow-origin header is dynamic.
    'Vary': 'Origin',
  };
}

export function handleOptions(req?: Request): Response {
  return new Response('ok', { headers: corsHeaders(req) });
}

export function jsonResponse(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}
