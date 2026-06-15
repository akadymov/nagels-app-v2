// Deterministic per-user password (HMAC-SHA256) used only server-side to obtain
// a Supabase session via signInWithPassword. Never returned to the client.

export async function derivePassword(userId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`discord-auth:${userId}`));
  // hex-encode → stable, URL-safe, > 32 chars
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
