import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { escapeHtml, buildJoinUrl, formatRoomMessage } from '../telegram.ts';

Deno.test('escapeHtml escapes the five HTML specials', () => {
  assertEquals(escapeHtml('<a href="x">A&B</a>'),
    '&lt;a href=&quot;x&quot;&gt;A&amp;B&lt;/a&gt;');
  assertEquals(escapeHtml("it's"), 'it&#39;s');
});

Deno.test('escapeHtml leaves plain text untouched', () => {
  assertEquals(escapeHtml('Akula'), 'Akula');
  assertEquals(escapeHtml('Игрок 42'), 'Игрок 42');
});

Deno.test('buildJoinUrl concatenates origin and code', () => {
  assertEquals(
    buildJoinUrl('https://nigels.online', 'AB12CD'),
    'https://nigels.online/join/AB12CD',
  );
});

Deno.test('buildJoinUrl strips a trailing slash from origin', () => {
  assertEquals(
    buildJoinUrl('https://nigels.online/', 'AB12CD'),
    'https://nigels.online/join/AB12CD',
  );
});

Deno.test('formatRoomMessage HTML-escapes the host name', () => {
  const text = formatRoomMessage({
    hostName: 'Akula <script>',
    roomCode: 'AB12CD',
    appOrigin: 'https://nigels.online',
  });
  assertStringIncludes(text, '<b>Akula &lt;script&gt;</b>');
});

Deno.test('formatRoomMessage mentions the public domain in the body', () => {
  const text = formatRoomMessage({
    hostName: 'Akula',
    roomCode: 'AB12CD',
    appOrigin: 'https://nigels.online',
  });
  assertStringIncludes(text, 'nigels.online');
  assertStringIncludes(text, '<b>Akula</b>');
});
