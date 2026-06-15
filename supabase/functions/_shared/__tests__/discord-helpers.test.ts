import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { tokenRequestBody, discordAvatarUrl, displayNameFrom } from '../../discord-auth/discord.ts';

Deno.test('tokenRequestBody builds an x-www-form-urlencoded grant', () => {
  const body = tokenRequestBody('the-code', 'cid', 'secret');
  assertEquals(body.get('grant_type'), 'authorization_code');
  assertEquals(body.get('code'), 'the-code');
  assertEquals(body.get('client_id'), 'cid');
  assertEquals(body.get('client_secret'), 'secret');
});

Deno.test('discordAvatarUrl builds a CDN url, or null when no avatar', () => {
  assertEquals(discordAvatarUrl('123', 'abc'), 'https://cdn.discordapp.com/avatars/123/abc.png');
  assertEquals(discordAvatarUrl('123', null), null);
});

Deno.test('displayNameFrom prefers global_name, falls back to username', () => {
  assertEquals(displayNameFrom({ username: 'u', global_name: 'Global' }), 'Global');
  assertEquals(displayNameFrom({ username: 'u', global_name: null }), 'u');
});

import { derivePassword } from '../../discord-auth/mint.ts';

Deno.test('derivePassword is deterministic and depends on user + secret', async () => {
  const a = await derivePassword('user-1', 'secret');
  const b = await derivePassword('user-1', 'secret');
  const c = await derivePassword('user-2', 'secret');
  assertEquals(a, b);
  assertEquals(a === c, false);
  assertEquals(a.length >= 32, true);
});
