import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { decideResolution } from '../../discord-auth/resolve.ts';

const profile = { discord_id: 'd1', email: 'a@b.com', verified: true, display_name: 'N', avatar_url: null };

Deno.test('verified email matches an existing user → link to it', () => {
  const r = decideResolution(profile, { userByEmail: { id: 'u1' }, userByDiscord: null });
  assertEquals(r, { kind: 'link', userId: 'u1' });
});

Deno.test('verified email, no existing user → create with email', () => {
  const r = decideResolution(profile, { userByEmail: null, userByDiscord: null });
  assertEquals(r, { kind: 'create', email: 'a@b.com' });
});

Deno.test('no/unverified email but discord_id known → reuse that user', () => {
  const r = decideResolution(
    { ...profile, email: null, verified: false },
    { userByEmail: null, userByDiscord: { id: 'u9' } },
  );
  assertEquals(r, { kind: 'reuse', userId: 'u9' });
});

Deno.test('no email, no discord match → create emailless', () => {
  const r = decideResolution(
    { ...profile, email: null, verified: false },
    { userByEmail: null, userByDiscord: null },
  );
  assertEquals(r, { kind: 'create', email: null });
});

Deno.test('unverified email is ignored (not used for linking)', () => {
  const r = decideResolution(
    { ...profile, verified: false },
    { userByEmail: { id: 'u1' }, userByDiscord: null },
  );
  assertEquals(r, { kind: 'create', email: null });
});

Deno.test('email user and discord user both found but different → email wins (discord orphaned)', () => {
  const r = decideResolution(profile, { userByEmail: { id: 'u1' }, userByDiscord: { id: 'u2' } });
  assertEquals(r, { kind: 'link', userId: 'u1' });
});
