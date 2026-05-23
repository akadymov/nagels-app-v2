import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { isAdminEmail } from '../auth/isAdmin.ts';

Deno.test('isAdminEmail: empty allow-list rejects everyone', () => {
  assertEquals(isAdminEmail('a@b.com', ''), false);
  assertEquals(isAdminEmail('a@b.com', undefined), false);
  assertEquals(isAdminEmail(null, 'a@b.com'), false);
});

Deno.test('isAdminEmail: exact match wins', () => {
  assertEquals(isAdminEmail('a@b.com', 'a@b.com'), true);
});

Deno.test('isAdminEmail: comma-separated list, trimmed', () => {
  assertEquals(isAdminEmail('c@d.com', ' a@b.com , c@d.com ,e@f.com'), true);
});

Deno.test('isAdminEmail: case-insensitive', () => {
  assertEquals(isAdminEmail('Akhmed.Kadymov@gmail.com', 'akhmed.kadymov@gmail.com'), true);
});

Deno.test('isAdminEmail: not in list rejects', () => {
  assertEquals(isAdminEmail('x@y.com', 'a@b.com,c@d.com'), false);
});
