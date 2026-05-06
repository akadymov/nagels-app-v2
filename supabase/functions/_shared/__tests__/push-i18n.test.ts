import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { formatPushBody, type Lang } from '../push/i18n.ts';
import type { PushEvent } from '../push/transitions.ts';

const LANGS: Lang[] = ['en', 'ru', 'es'];

const SAMPLES: PushEvent[] = [
  { type: 'game_start',    room_id: 'r1', room_code: 'AB12CD', recipients: ['sA'] },
  { type: 'your_bid',      room_id: 'r1', room_code: 'AB12CD', recipient: 'sA' },
  { type: 'your_turn',     room_id: 'r1', room_code: 'AB12CD', recipient: 'sA',
                           hand_id: 'h1', trick_number: 3 },
  { type: 'hand_end',      room_id: 'r1', room_code: 'AB12CD', recipients: ['sA'],
                           hand_number: 1,
                           scores: [{ session_id: 'sA', hand_score: 22 }] },
  { type: 'player_joined', room_id: 'r1', room_code: 'AB12CD', recipient: 'sA',
                           joiner_name: 'NewGuy' },
  { type: 'game_end',      room_id: 'r1', room_code: 'AB12CD', recipients: ['sA'],
                           winner_session_id: 'sA' },
];

for (const lang of LANGS) {
  for (const ev of SAMPLES) {
    Deno.test(`formatPushBody returns non-empty title/body for ${ev.type} in ${lang}`, () => {
      const out = formatPushBody(ev, lang, { recipient_session_id: 'sA', winner_name: 'Akula' });
      assertEquals(typeof out.title, 'string');
      assertEquals(typeof out.body, 'string');
      if (out.title.length === 0) throw new Error(`empty title for ${ev.type}/${lang}`);
      if (out.body.length === 0)  throw new Error(`empty body for ${ev.type}/${lang}`);
    });
  }
}
