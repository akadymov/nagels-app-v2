# Web Push Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wake the player in their browser with a system-level notification on six in-game events (game start, your bid, your turn, hand end, player joined, game over), even when the tab is backgrounded or minimized.

**Architecture:** Pure-function `detectTransitions(prev, next, actor, action_kind)` lives in `_shared/push/transitions.ts` and is the single source of truth for "what events fired". Wire layer `notifyPush` mirrors `sendTelegram` — fans out to all `push_subscriptions` rows for each recipient's `auth_user_id`, swallows errors, never blocks the action. Service Worker `public/sw.js` is extended with `push` and `notificationclick` handlers. Two new edge functions handle subscribe/unsubscribe.

**Tech Stack:** Supabase Edge Functions (Deno), Web Push (VAPID), `npm:web-push@3` from Deno, RN-Web Service Worker, React (RN-Web) hook.

**Spec:** `docs/superpowers/specs/2026-05-06-web-push-notifications-design.md`

**Spec amendment in this plan:** the push payload carries both `room_id` (server-side bookkeeping) and `room_code` (client-side deeplink). The Service Worker's notification click navigates to `/join/${room_code}`, matching the existing Telegram-link join flow. The spec described `room_id` only.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `supabase/migrations/022_push_subscriptions.sql` | Create | Table + RLS for browser push subscriptions. |
| `supabase/functions/_shared/push/transitions.ts` | Create | Pure detector: `(prev, next, actor, action_kind) → PushEvent[]`. |
| `supabase/functions/_shared/__tests__/push-transitions.test.ts` | Create | Deno tests for every detector rule and anti-case. |
| `supabase/functions/_shared/push/i18n.ts` | Create | EN/RU/ES `{title, body}` per event, server-side localization. |
| `supabase/functions/_shared/__tests__/push-i18n.test.ts` | Create | Smoke tests: every event×lang returns non-empty `{title, body}`. |
| `supabase/functions/_shared/push/notifyPush.ts` | Create | Wire layer: resolves recipients, fetches subs, web-push fan-out. |
| `supabase/functions/push-subscribe/index.ts` | Create | Edge function: upsert a subscription for `auth.uid()`. |
| `supabase/functions/push-unsubscribe/index.ts` | Create | Edge function: delete a subscription by endpoint. |
| `supabase/functions/game-action/index.ts` | Modify | Build `prev` snapshot, run detector, fire `notifyPush` for each event after the action commits. |
| `public/sw.js` | Modify | Add `push` and `notificationclick` listeners; keep passthrough intact. |
| `src/lib/heartbeat.ts` | Modify | Skip ticks while `document.visibilityState !== 'visible'`. |
| `src/lib/push/iosGate.ts` | Create | One pure helper: `getPushPlatformState()` returning `'unsupported' \| 'ios-needs-pwa' \| 'ok'`. |
| `src/lib/push/usePushSubscribe.ts` | Create | React hook: state machine + permission flow + subscribe/unsubscribe + lang sync. |
| `src/screens/SettingsScreen.tsx` | Modify | Add Notifications section with on/off `OptionPills`. |
| `src/App.tsx` | Modify | Listen for `kind:'push:navigate'` `postMessage` from SW; route into the room via existing join-by-code flow. |
| `src/screens/WaitingRoomScreen.tsx` | Modify | First-time auto-prompt on `waiting → betting` (calls hook's `requestEnable()`). |

---

## Task 1: Migration `022_push_subscriptions.sql`

**Files:**
- Create: `supabase/migrations/022_push_subscriptions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 022_push_subscriptions.sql
-- Browser-side Web Push endpoints, one row per browser instance.
-- Bound to auth_user_id (stable across rooms), NOT session_id (transient).

CREATE TABLE public.push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL,
  p256dh        TEXT NOT NULL,
  auth_secret   TEXT NOT NULL,
  lang          TEXT NOT NULL DEFAULT 'en',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (endpoint)
);

CREATE INDEX idx_push_subs_user ON public.push_subscriptions(auth_user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_subs_owner_all ON public.push_subscriptions
  FOR ALL
  USING (auth.uid() = auth_user_id)
  WITH CHECK (auth.uid() = auth_user_id);
```

- [ ] **Step 2: Apply locally and verify**

Run:
```bash
supabase db push
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" -c "\d public.push_subscriptions"
```

Expected: psql shows the four required columns plus `lang`, `created_at`, `last_used_at`. `\dp public.push_subscriptions` shows `push_subs_owner_all` policy.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/022_push_subscriptions.sql
git commit -m "feat(push): add push_subscriptions table"
```

---

## Task 2: Pure event detector + tests

**Files:**
- Create: `supabase/functions/_shared/__tests__/push-transitions.test.ts`
- Create: `supabase/functions/_shared/push/transitions.ts`

The detector takes `prev` (the snapshot before the action), `next` (after), the `actor`, and the `action_kind`. It returns an array of events. Pure — no I/O, no clocks, no randomness. Tests build hand-crafted snapshots. We TDD it: tests first (red), implementation (green).

- [ ] **Step 1: Create the test file (will fail to import)**

Create `supabase/functions/_shared/__tests__/push-transitions.test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { detectTransitions } from '../push/transitions.ts';
import type { RoomSnapshot, ActorContext } from '../types.ts';

function emptySnap(): RoomSnapshot {
  return {
    room: null, players: [], current_hand: null,
    hand_scores: [], current_trick: null, last_closed_trick: null,
    score_history: [], my_hand: [],
  };
}
function room(id: string, code: string, host_session_id: string, phase = 'waiting') {
  return { id, code, host_session_id, phase, current_hand_id: null,
           player_count: 4, max_cards: 10, version: 1, created_at: '2026-05-06T00:00:00Z' };
}
function player(seat: number, session_id: string, display_name: string) {
  return { seat_index: seat, session_id, display_name,
           is_ready: true, is_connected: true, last_seen_at: '2026-05-06T00:00:00Z' };
}
function hand(phase: 'betting' | 'playing' | 'scoring' | 'closed', current_seat: number) {
  return { id: 'h1', room_id: 'r1', hand_number: 1, cards_per_player: 5,
           trump_suit: 'S', starting_seat: 0, current_seat, phase,
           deck_seed: 'x', started_at: '2026-05-06T00:00:00Z',
           closed_at: phase === 'closed' ? '2026-05-06T00:01:00Z' : null };
}
const ACTOR: ActorContext = { auth_user_id: 'u1', session_id: 's1', display_name: 'Akula' };

Deno.test('game_start fires when current_hand transitions null → set', () => {
  const prev = { ...emptySnap(),
    room: room('r1', 'AB12CD', 's-host', 'waiting'),
    players: [player(0, 's-host', 'Host'), player(1, 's2', 'B'), player(2, 's3', 'C'), player(3, 's4', 'D')],
  };
  const next = { ...prev,
    room: { ...prev.room!, phase: 'playing' },
    current_hand: hand('betting', 0),
  };
  const events = detectTransitions(prev, next, ACTOR, 'start_game');
  assertEquals(events.length, 1);
  assertEquals(events[0].type, 'game_start');
  assertEquals((events[0] as any).recipients.sort(), ['s-host', 's2', 's3', 's4']);
});

Deno.test('your_bid fires for the seated session when current_seat changes in betting', () => {
  const players = [player(0, 'sA', 'A'), player(1, 'sB', 'B')];
  const prev = { ...emptySnap(), room: room('r1', 'AB12CD', 'sA', 'playing'),
    players, current_hand: hand('betting', 0) };
  const next = { ...prev, current_hand: hand('betting', 1) };
  const events = detectTransitions(prev, next, ACTOR, 'place_bet');
  assertEquals(events.map(e => e.type), ['your_bid']);
  assertEquals((events[0] as any).recipient, 'sB');
});

Deno.test('your_turn fires for the seated session when current_seat changes in playing', () => {
  const players = [player(0, 'sA', 'A'), player(1, 'sB', 'B')];
  const prev = { ...emptySnap(), room: room('r1', 'AB12CD', 'sA', 'playing'),
    players, current_hand: hand('playing', 0) };
  const next = { ...prev, current_hand: hand('playing', 1) };
  const events = detectTransitions(prev, next, ACTOR, 'play_card');
  assertEquals(events.map(e => e.type), ['your_turn']);
  assertEquals((events[0] as any).recipient, 'sB');
});

Deno.test('your_turn does NOT fire when current_seat is unchanged (snapshot replay)', () => {
  const players = [player(0, 'sA', 'A'), player(1, 'sB', 'B')];
  const prev = { ...emptySnap(), room: room('r1', 'AB12CD', 'sA', 'playing'),
    players, current_hand: hand('playing', 1) };
  const next = { ...prev };
  const events = detectTransitions(prev, next, ACTOR, 'play_card');
  assertEquals(events, []);
});

Deno.test('hand_end fires when phase transitions to closed', () => {
  const players = [player(0, 'sA', 'A'), player(1, 'sB', 'B')];
  const prev = { ...emptySnap(), room: room('r1', 'AB12CD', 'sA', 'playing'),
    players, current_hand: hand('scoring', 0) };
  const next = { ...prev, current_hand: hand('closed', 0),
    hand_scores: [
      { hand_id: 'h1', session_id: 'sA', bet: 2, taken_tricks: 2, hand_score: 12 },
      { hand_id: 'h1', session_id: 'sB', bet: 1, taken_tricks: 0, hand_score: -1 },
    ],
  };
  const events = detectTransitions(prev, next, ACTOR, 'play_card');
  assertEquals(events.length, 1);
  assertEquals(events[0].type, 'hand_end');
  assertEquals((events[0] as any).recipients.sort(), ['sA', 'sB']);
});

Deno.test('player_joined fires for join_room (prev null), recipient is host only', () => {
  const next = { ...emptySnap(),
    room: room('r1', 'AB12CD', 's-host', 'waiting'),
    players: [player(0, 's-host', 'Host'), player(1, 's-new', 'NewGuy')],
  };
  const actor: ActorContext = { auth_user_id: 'u-new', session_id: 's-new', display_name: 'NewGuy' };
  const events = detectTransitions(null, next, actor, 'join_room');
  assertEquals(events.length, 1);
  assertEquals(events[0].type, 'player_joined');
  assertEquals((events[0] as any).recipient, 's-host');
  assertEquals((events[0] as any).joiner_name, 'NewGuy');
});

Deno.test('player_joined does NOT fire when host themselves rejoins (no length change)', () => {
  const players = [player(0, 's-host', 'Host'), player(1, 's2', 'B')];
  const prev = { ...emptySnap(), room: room('r1', 'AB12CD', 's-host', 'waiting'), players };
  const next = { ...prev };
  const events = detectTransitions(prev, next, ACTOR, 'ready');
  assertEquals(events, []);
});

Deno.test('game_end fires when room.phase transitions to finished', () => {
  const players = [player(0, 'sA', 'A'), player(1, 'sB', 'B')];
  const prev = { ...emptySnap(), room: room('r1', 'AB12CD', 'sA', 'playing'), players };
  const next = { ...prev, room: { ...prev.room!, phase: 'finished' },
    score_history: [
      { hand_number: 1, closed_at: 'x',
        scores: [
          { hand_id: 'h1', session_id: 'sA', bet: 2, taken_tricks: 2, hand_score: 22 },
          { hand_id: 'h1', session_id: 'sB', bet: 0, taken_tricks: 1, hand_score: -1 },
        ] },
    ],
  };
  const events = detectTransitions(prev, next, ACTOR, 'play_card');
  assertEquals(events.length, 1);
  assertEquals(events[0].type, 'game_end');
  assertEquals((events[0] as any).winner_session_id, 'sA');
});

Deno.test('create_room emits no events (prev null, action_kind create_room)', () => {
  const next = { ...emptySnap(),
    room: room('r1', 'AB12CD', 's-host', 'waiting'),
    players: [player(0, 's-host', 'Host')],
  };
  const events = detectTransitions(null, next, ACTOR, 'create_room');
  assertEquals(events, []);
});
```

- [ ] **Step 2: Run the tests; verify they fail to load**

Run:
```bash
deno test supabase/functions/_shared/__tests__/push-transitions.test.ts
```

Expected: import error, "Module not found: ../push/transitions.ts".

- [ ] **Step 3: Implement `transitions.ts`**

Create `supabase/functions/_shared/push/transitions.ts`:

```ts
import type { RoomSnapshot, ActorContext } from '../types.ts';

export type PushEvent =
  | { type: 'game_start';     room_id: string; room_code: string; recipients: string[] }
  | { type: 'your_bid';       room_id: string; room_code: string; recipient: string }
  | { type: 'your_turn';      room_id: string; room_code: string; recipient: string;
                              hand_id: string; trick_number: number }
  | { type: 'hand_end';       room_id: string; room_code: string; recipients: string[];
                              hand_number: number;
                              scores: Array<{ session_id: string; hand_score: number }> }
  | { type: 'player_joined';  room_id: string; room_code: string; recipient: string;
                              joiner_name: string }
  | { type: 'game_end';       room_id: string; room_code: string; recipients: string[];
                              winner_session_id: string };

export type ActionKind =
  | 'create_room' | 'join_room' | 'leave_room' | 'ready' | 'start_game'
  | 'place_bet'   | 'play_card' | 'continue_hand' | 'request_timeout' | 'restart_game';

function seatToSession(snap: RoomSnapshot, seat: number): string | null {
  return snap.players.find((p) => p.seat_index === seat)?.session_id ?? null;
}

function allSessionIds(snap: RoomSnapshot): string[] {
  return snap.players.map((p) => p.session_id);
}

export function detectTransitions(
  prev: RoomSnapshot | null,
  next: RoomSnapshot,
  actor: ActorContext,
  action_kind: ActionKind,
): PushEvent[] {
  const events: PushEvent[] = [];
  if (!next.room) return events;
  const room_id = next.room.id;
  const room_code = next.room.code;

  // player_joined — prev may be null (join_room first time room visible to actor)
  if (action_kind === 'join_room') {
    const host = next.room.host_session_id;
    if (host !== actor.session_id) {
      const joiner = next.players.find((p) => p.session_id === actor.session_id);
      if (joiner) {
        events.push({
          type: 'player_joined',
          room_id, room_code,
          recipient: host,
          joiner_name: joiner.display_name,
        });
      }
    }
    return events;
  }

  // create_room — never emits push events (the host is the only person there).
  if (action_kind === 'create_room' || !prev) return events;

  // game_start: current_hand transitioned null → set
  if (prev.current_hand === null && next.current_hand !== null) {
    events.push({
      type: 'game_start',
      room_id, room_code,
      recipients: allSessionIds(next),
    });
  }

  // game_end: room.phase transitioned to 'finished'
  if (prev.room?.phase !== 'finished' && next.room.phase === 'finished') {
    const totals = new Map<string, number>();
    for (const h of next.score_history) {
      for (const s of h.scores) {
        totals.set(s.session_id, (totals.get(s.session_id) ?? 0) + s.hand_score);
      }
    }
    let winner: string = next.players[0]?.session_id ?? '';
    let max = -Infinity;
    for (const [sid, total] of totals) {
      if (total > max) { max = total; winner = sid; }
    }
    events.push({
      type: 'game_end',
      room_id, room_code,
      recipients: allSessionIds(next),
      winner_session_id: winner,
    });
  }

  // hand_end: current_hand.phase transitioned !closed → closed
  const prevPhase = prev.current_hand?.phase ?? null;
  const nextPhase = next.current_hand?.phase ?? null;
  if (prevPhase !== 'closed' && nextPhase === 'closed') {
    events.push({
      type: 'hand_end',
      room_id, room_code,
      recipients: allSessionIds(next),
      hand_number: next.current_hand!.hand_number,
      scores: next.hand_scores
        .filter((s) => s.hand_id === next.current_hand!.id)
        .map((s) => ({ session_id: s.session_id, hand_score: s.hand_score })),
    });
  }

  // your_bid / your_turn: current_seat changed in betting/playing phase
  if (prev.current_hand && next.current_hand
      && prev.current_hand.current_seat !== next.current_hand.current_seat) {
    const recipient = seatToSession(next, next.current_hand.current_seat);
    if (recipient) {
      if (next.current_hand.phase === 'betting') {
        events.push({ type: 'your_bid', room_id, room_code, recipient });
      } else if (next.current_hand.phase === 'playing') {
        events.push({
          type: 'your_turn',
          room_id, room_code,
          recipient,
          hand_id: next.current_hand.id,
          trick_number: next.current_trick?.trick_number ?? 0,
        });
      }
    }
  }

  return events;
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run:
```bash
deno test supabase/functions/_shared/__tests__/push-transitions.test.ts
```

Expected: `ok | 9 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/push/transitions.ts \
        supabase/functions/_shared/__tests__/push-transitions.test.ts
git commit -m "feat(push): pure event detector with TDD coverage"
```

---

## Task 3: i18n strings (`_shared/push/i18n.ts`) + smoke tests

**Files:**
- Create: `supabase/functions/_shared/__tests__/push-i18n.test.ts`
- Create: `supabase/functions/_shared/push/i18n.ts`

EN copy is normative. RU/ES are best-effort short strings — refine in copy review later.

- [ ] **Step 1: Write the test**

Create `supabase/functions/_shared/__tests__/push-i18n.test.ts`:

```ts
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
```

- [ ] **Step 2: Implement `i18n.ts`**

Create `supabase/functions/_shared/push/i18n.ts`:

```ts
import type { PushEvent } from './transitions.ts';

export type Lang = 'en' | 'ru' | 'es';

/** Optional context the wire layer can pass to bodies that need names. */
export interface FormatContext {
  /** session_id of the recipient — used by hand_end to look up their score. */
  recipient_session_id?: string;
  /** Resolved display name of the winner — used by game_end body. */
  winner_name?: string;
}

interface Out { title: string; body: string }

const STRINGS: Record<Lang, {
  game_start:    () => Out;
  your_bid:      () => Out;
  your_turn:     () => Out;
  hand_end:      (p: { score: number }) => Out;
  player_joined: (p: { name: string }) => Out;
  game_end:      (p: { you_won: boolean; winner: string }) => Out;
}> = {
  en: {
    game_start:    () => ({ title: '🎮 Game starting',  body: 'The hand is being dealt.' }),
    your_bid:      () => ({ title: '🎯 Your bid',       body: 'Time to call your tricks.' }),
    your_turn:     () => ({ title: '♠ Your turn',       body: 'Play a card.' }),
    hand_end:      (p) => ({ title: '📊 Hand finished', body: `${p.score >= 0 ? '+' : ''}${p.score} this hand.` }),
    player_joined: (p) => ({ title: '👋 New player',    body: `${p.name} joined your room.` }),
    game_end:      (p) => ({ title: '🏁 Game over',     body: p.you_won ? 'You won!' : `${p.winner} won.` }),
  },
  ru: {
    game_start:    () => ({ title: '🎮 Игра началась',  body: 'Раздача в процессе.' }),
    your_bid:      () => ({ title: '🎯 Твоя ставка',    body: 'Время называть взятки.' }),
    your_turn:     () => ({ title: '♠ Твой ход',        body: 'Сходи картой.' }),
    hand_end:      (p) => ({ title: '📊 Раздача сыграна', body: `${p.score >= 0 ? '+' : ''}${p.score} в раздаче.` }),
    player_joined: (p) => ({ title: '👋 Новый игрок',   body: `${p.name} зашёл в твою комнату.` }),
    game_end:      (p) => ({ title: '🏁 Игра окончена', body: p.you_won ? 'Ты победил!' : `Победил ${p.winner}.` }),
  },
  es: {
    game_start:    () => ({ title: '🎮 Empieza la partida', body: 'Repartiendo cartas.' }),
    your_bid:      () => ({ title: '🎯 Tu apuesta',         body: 'Hora de cantar tus bazas.' }),
    your_turn:     () => ({ title: '♠ Tu turno',            body: 'Juega una carta.' }),
    hand_end:      (p) => ({ title: '📊 Mano terminada',    body: `${p.score >= 0 ? '+' : ''}${p.score} esta mano.` }),
    player_joined: (p) => ({ title: '👋 Nuevo jugador',     body: `${p.name} entró a tu sala.` }),
    game_end:      (p) => ({ title: '🏁 Fin del juego',     body: p.you_won ? '¡Ganaste!' : `Ganó ${p.winner}.` }),
  },
};

export function formatPushBody(
  event: PushEvent,
  lang: Lang,
  ctx: FormatContext = {},
): { title: string; body: string } {
  const dict = STRINGS[lang] ?? STRINGS.en;
  switch (event.type) {
    case 'game_start':    return dict.game_start();
    case 'your_bid':      return dict.your_bid();
    case 'your_turn':     return dict.your_turn();
    case 'hand_end': {
      const score = event.scores.find((s) => s.session_id === ctx.recipient_session_id)?.hand_score ?? 0;
      return dict.hand_end({ score });
    }
    case 'player_joined': return dict.player_joined({ name: event.joiner_name });
    case 'game_end': {
      const you_won = event.winner_session_id === ctx.recipient_session_id;
      return dict.game_end({ you_won, winner: ctx.winner_name ?? 'Anon' });
    }
  }
}
```

- [ ] **Step 3: Run tests, verify all 18 pass**

Run:
```bash
deno test supabase/functions/_shared/__tests__/push-i18n.test.ts
```

Expected: `ok | 18 passed | 0 failed` (3 langs × 6 events).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/push/i18n.ts \
        supabase/functions/_shared/__tests__/push-i18n.test.ts
git commit -m "feat(push): server-side i18n for notification bodies"
```

---

## Task 4: Wire layer `notifyPush.ts`

**Files:**
- Create: `supabase/functions/_shared/push/notifyPush.ts`

Single primitive — fans out one event to N subscriptions. Mirrors `sendTelegram` (no automated tests; manual smoke later via the deployed function).

- [ ] **Step 1: Implement `notifyPush.ts`**

Create `supabase/functions/_shared/push/notifyPush.ts`:

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import type { PushEvent } from './transitions.ts';
import { formatPushBody, type Lang } from './i18n.ts';

const TG_TIMEOUT_MS = 3_000;
const VISIBILITY_THRESHOLD_MS = 15_000;

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  lang: string;
  auth_user_id: string;
}

function vapidConfigured(): boolean {
  return !!Deno.env.get('VAPID_PUBLIC_KEY')
      && !!Deno.env.get('VAPID_PRIVATE_KEY')
      && !!Deno.env.get('VAPID_SUBJECT');
}

function configureVapid() {
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!,
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  );
}

function recipientsOf(event: PushEvent): string[] {
  return 'recipients' in event ? event.recipients : [event.recipient];
}

function tagFor(event: PushEvent): string {
  switch (event.type) {
    case 'your_turn':     return `nagels-turn-${event.room_id}`;
    case 'your_bid':      return `nagels-bid-${event.room_id}`;
    case 'game_start':
    case 'game_end':      return `nagels-game-${event.room_id}`;
    case 'hand_end':      return `nagels-hand-${event.room_id}-${event.hand_number}`;
    case 'player_joined': return `nagels-join-${event.room_id}-${event.recipient}`;
  }
}

/**
 * Fire-and-forget push for one event. Never throws.
 */
export async function notifyPush(
  svc: SupabaseClient,
  event: PushEvent,
): Promise<void> {
  if (!vapidConfigured()) return;        // dev / preview path — no-op
  configureVapid();

  let recipients = recipientsOf(event);

  // Visibility filter — your_turn only.
  if (event.type === 'your_turn' && recipients.length > 0) {
    try {
      const { data } = await svc
        .from('room_players')
        .select('session_id, last_seen_at')
        .in('session_id', recipients);
      const cutoff = Date.now() - VISIBILITY_THRESHOLD_MS;
      const stale = new Set<string>(
        (data ?? [])
          .filter((r: any) => Date.parse(r.last_seen_at) < cutoff)
          .map((r: any) => r.session_id),
      );
      recipients = recipients.filter((sid) => stale.has(sid));
    } catch (err) {
      console.warn(`[push] visibility lookup threw: ${(err as Error).message}`);
    }
  }
  if (recipients.length === 0) return;

  // Resolve auth_user_id and winner display name (for game_end).
  let winner_name: string | undefined;
  if (event.type === 'game_end') {
    const { data } = await svc
      .from('room_players')
      .select('session_id, display_name')
      .eq('session_id', event.winner_session_id)
      .maybeSingle();
    winner_name = (data as any)?.display_name;
  }

  const { data: sessionRows, error: sessErr } = await svc
    .from('room_sessions')
    .select('id, auth_user_id')
    .in('id', recipients);
  if (sessErr) {
    console.warn(`[push] room_sessions lookup failed: ${sessErr.message}`);
    return;
  }
  const sessionToUser = new Map<string, string>();
  for (const r of (sessionRows ?? []) as Array<{ id: string; auth_user_id: string }>) {
    sessionToUser.set(r.id, r.auth_user_id);
  }
  const userIds = [...new Set([...sessionToUser.values()])];
  if (userIds.length === 0) return;

  const { data: subs, error: subsErr } = await svc
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_secret, lang, auth_user_id')
    .in('auth_user_id', userIds);
  if (subsErr) {
    console.warn(`[push] subscriptions lookup failed: ${subsErr.message}`);
    return;
  }

  const userToSession = new Map<string, string>();
  for (const [sid, uid] of sessionToUser) userToSession.set(uid, sid);

  await Promise.all(((subs ?? []) as SubscriptionRow[]).map(async (sub) => {
    const sid = userToSession.get(sub.auth_user_id);
    if (!sid) return;
    const { title, body } = formatPushBody(event, (sub.lang as Lang) || 'en', {
      recipient_session_id: sid,
      winner_name,
    });
    const payload = JSON.stringify({
      title, body,
      tag: tagFor(event),
      room_id: event.room_id,
      room_code: event.room_code,
      type: event.type,
    });
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), TG_TIMEOUT_MS);
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_secret } },
        payload,
        // npm:web-push doesn't accept AbortSignal; the timer kills the inflight
        // fetch via an Error thrown from setTimeout below.
      );
      clearTimeout(timer);
      await svc.from('push_subscriptions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('endpoint', sub.endpoint);
    } catch (err: any) {
      const status: number | undefined = err?.statusCode;
      if (status === 404 || status === 410) {
        await svc.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        return;
      }
      console.warn(`[push] sendNotification failed: status=${status ?? '<none>'} name=${err?.name ?? 'unknown'}`);
    }
  }));
}
```

- [ ] **Step 2: Type-check the file**

Run:
```bash
deno check supabase/functions/_shared/push/notifyPush.ts
```

Expected: clean check (downloads npm:web-push types on first run).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/push/notifyPush.ts
git commit -m "feat(push): wire layer with VAPID fan-out and visibility filter"
```

---

## Task 5: Edge function `push-subscribe`

**Files:**
- Create: `supabase/functions/push-subscribe/index.ts`

Reads JWT, upserts the subscription row by endpoint.

- [ ] **Step 1: Write the function**

Create `supabase/functions/push-subscribe/index.ts`:

```ts
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
    console.warn(`[push-subscribe] upsert failed: ${error.message}`);
    return jsonResponse({ ok: false, error: 'internal_error' }, 500);
  }

  return jsonResponse({ ok: true });
});
```

- [ ] **Step 2: Type-check**

Run:
```bash
deno check supabase/functions/push-subscribe/index.ts
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/push-subscribe/index.ts
git commit -m "feat(push): edge function push-subscribe"
```

---

## Task 6: Edge function `push-unsubscribe`

**Files:**
- Create: `supabase/functions/push-unsubscribe/index.ts`

- [ ] **Step 1: Write the function**

Create `supabase/functions/push-unsubscribe/index.ts`:

```ts
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
    console.warn(`[push-unsubscribe] delete failed: ${error.message}`);
    return jsonResponse({ ok: false, error: 'internal_error' }, 500);
  }
  return jsonResponse({ ok: true });
});
```

- [ ] **Step 2: Type-check**

```bash
deno check supabase/functions/push-unsubscribe/index.ts
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/push-unsubscribe/index.ts
git commit -m "feat(push): edge function push-unsubscribe"
```

---

## Task 7: Wire detector + notifyPush into `game-action/index.ts`

**Files:**
- Modify: `supabase/functions/game-action/index.ts`

We build `prev` snapshot before dispatch (only if room_id is known and the action is not `create_room`/`join_room`), pass `(prev, next, actor, kind)` to the detector, and fire `notifyPush` per event after the broadcast.

- [ ] **Step 1: Add imports at the top**

Replace the import block (lines 1-23) so it reads (additions: `buildSnapshot`, detector, notifyPush):

```ts
/**
 * Nägels Online — Server-Authoritative Game Action
 *
 * Single endpoint. All game mutations go through this function.
 * Pipeline: JWT verify → advisory lock → action handler → snapshot →
 * broadcast → response.
 */

import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import type { Action, ActionResult, ActorContext, RoomSnapshot } from '../_shared/types.ts';
import { authenticate, makeServiceClient } from './auth.ts';
import { broadcastStateChanged } from './broadcast.ts';
import { buildSnapshot } from './snapshot.ts';
import { detectTransitions, type ActionKind } from '../_shared/push/transitions.ts';
import { notifyPush } from '../_shared/push/notifyPush.ts';

import { createRoom }     from './actions/createRoom.ts';
import { joinRoom }       from './actions/joinRoom.ts';
import { leaveRoom }      from './actions/leaveRoom.ts';
import { setReady }       from './actions/ready.ts';
import { startGame }      from './actions/startGame.ts';
import { placeBet }       from './actions/placeBet.ts';
import { playCard }       from './actions/playCard.ts';
import { continueHand }   from './actions/continueHand.ts';
import { requestTimeout } from './actions/requestTimeout.ts';
import { restartGame }    from './actions/restartGame.ts';
```

- [ ] **Step 2: Insert `prev` snapshot fetch and post-action notification**

Replace the body of `Deno.serve` (everything from `if (req.method === 'OPTIONS')` through the closing `});`) with:

```ts
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST')   return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);

  let body: { display_name?: string; action: Action };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }

  let actor: ActorContext;
  try {
    actor = await authenticate(req, body.display_name ?? null);
  } catch {
    return jsonResponse({ ok: false, error: 'auth_failed' }, 401);
  }

  const svc = makeServiceClient();
  const action = body.action;
  const room_id = (action as any).room_id ?? null;

  // Snapshot of room state BEFORE the action — needed by the push detector.
  // Skipped for create_room (room doesn't exist yet) and join_room (we don't
  // have a stable room_id at this point; the detector handles join_room with
  // prev=null using actor + action_kind).
  let prev: RoomSnapshot | null = null;
  if (room_id && action.kind !== 'create_room' && action.kind !== 'join_room') {
    try {
      prev = await buildSnapshot(svc, room_id, actor.session_id);
    } catch (err) {
      console.warn('[game-action] prev snapshot failed (push detector will skip):', err);
    }
  }

  let result: ActionResult;
  try {
    if (action.kind === 'create_room') {
      result = await createRoom(svc, actor, action);
    } else if (action.kind === 'join_room') {
      result = await joinRoom(svc, actor, action);
    } else {
      switch (action.kind) {
        case 'leave_room':      result = await leaveRoom(svc, actor, action); break;
        case 'ready':           result = await setReady(svc, actor, action); break;
        case 'start_game':      result = await startGame(svc, actor, action); break;
        case 'place_bet':       result = await placeBet(svc, actor, action); break;
        case 'play_card':       result = await playCard(svc, actor, action); break;
        case 'continue_hand':   result = await continueHand(svc, actor, action); break;
        case 'request_timeout': result = await requestTimeout(svc, actor, action); break;
        case 'restart_game':    result = await restartGame(svc, actor, action); break;
        default:                throw new Error('unknown_action');
      }
    }
  } catch (err) {
    console.error('[game-action] handler threw:', err);
    return jsonResponse({ ok: false, error: 'internal_error' }, 500);
  }

  if (result.ok && room_id) {
    void broadcastStateChanged(svc, room_id, result.version).catch((e) =>
      console.error('[game-action] broadcast failed:', e),
    );
  }

  // Fire-and-forget Web Push for every event the action triggered.
  // notifyPush never throws; it's awaited only so AbortControllers and any
  // 410-cleanup deletes finish before the request context tears down.
  if (result.ok) {
    try {
      const events = detectTransitions(prev, result.state, actor, action.kind as ActionKind);
      for (const ev of events) {
        await notifyPush(svc, ev);
      }
    } catch (err) {
      console.warn('[game-action] push detection threw:', err);
    }
  }

  return jsonResponse({ ...result, me_session_id: actor.session_id });
});
```

- [ ] **Step 3: Type-check**

```bash
deno check supabase/functions/game-action/index.ts
```

Expected: clean.

- [ ] **Step 4: Re-run all push tests to confirm no regressions**

```bash
deno test supabase/functions/_shared/__tests__/
```

Expected: telegram tests + push transitions + push i18n all green.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/game-action/index.ts
git commit -m "feat(push): fire push notifications from game-action"
```

---

## Task 8: Service Worker — `push` and `notificationclick` handlers

**Files:**
- Modify: `public/sw.js`

Append two listeners. Do not touch the existing install/activate/fetch passthrough.

- [ ] **Step 1: Append handlers to `public/sw.js`**

Add to the bottom of `public/sw.js` (after the existing `fetch` listener):

```js
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { return; }
  const { title, body, tag, room_id, room_code, type } = payload || {};
  if (!title) return;
  event.waitUntil(self.registration.showNotification(title, {
    body: body || '',
    tag,
    icon: '/icons/icon.svg',
    badge: '/icons/icon.svg',
    data: { room_id, room_code, type },
    renotify: type !== 'your_turn',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const room_code = data.room_code;
  const target = room_code ? `/join/${room_code}` : '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const ours = all.find((c) => new URL(c.url).origin === self.location.origin);
    if (ours) {
      await ours.focus();
      ours.postMessage({ kind: 'push:navigate', room_code, room_id: data.room_id });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
```

- [ ] **Step 2: Verify SW still serves locally**

Start the dev server, open the site, in DevTools → Application → Service Workers, confirm `sw.js` is "activated and is running". Push payload reception is tested end-to-end in Task 12.

- [ ] **Step 3: Commit**

```bash
git add public/sw.js
git commit -m "feat(push): SW push and notificationclick handlers"
```

---

## Task 9: Visibility-aware heartbeat

**Files:**
- Modify: `src/lib/heartbeat.ts`

The 15-second visibility filter in `notifyPush` only works if the heartbeat actually stops while the tab is hidden. Add a single guard around `ping()`.

- [ ] **Step 1: Update `useHeartbeat`**

Replace the `useEffect` body in `src/lib/heartbeat.ts` with:

```ts
  useEffect(() => {
    if (!roomId) return;
    const supabase = getSupabaseClient();

    const ping = async () => {
      // Only tick while the tab is visible. notifyPush keys "user is here"
      // off room_players.last_seen_at; if heartbeats keep firing in a hidden
      // tab the visibility filter for your_turn becomes a no-op.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try {
        await supabase.rpc('heartbeat', { p_room_id: roomId });
      } catch {
        // fire-and-forget
      }
    };

    void ping();
    const id = setInterval(ping, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [roomId]);
```

- [ ] **Step 2: Manual smoke**

In dev: open the app, join a room, open DevTools → Network. Hide the tab (switch tabs). Confirm `rpc/heartbeat` requests stop within ~10 s. Switch back; confirm they resume.

- [ ] **Step 3: Commit**

```bash
git add src/lib/heartbeat.ts
git commit -m "feat(push): heartbeat skips ticks while tab hidden"
```

---

## Task 10: iOS gate + `usePushSubscribe` hook

**Files:**
- Create: `src/lib/push/iosGate.ts`
- Create: `src/lib/push/usePushSubscribe.ts`

- [ ] **Step 1: Implement iOS gate**

Create `src/lib/push/iosGate.ts`:

```ts
export type PushPlatformState = 'unsupported' | 'ios-needs-pwa' | 'ok';

export function getPushPlatformState(): PushPlatformState {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS) {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;
    if (!standalone) return 'ios-needs-pwa';
  }
  return 'ok';
}
```

- [ ] **Step 2: Implement the hook**

Create `src/lib/push/usePushSubscribe.ts`:

```ts
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getSupabaseClient } from '../supabase/client';
import { getPushPlatformState } from './iosGate';

export type PushState =
  | 'unsupported' | 'ios-needs-pwa'
  | 'denied' | 'default' | 'subscribed' | 'pending';

const VAPID_PUB = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;

function urlB64ToUint8Array(b64: string): Uint8Array {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getActiveEndpoint(): Promise<string | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}

interface UsePushSubscribe {
  state: PushState;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

export function usePushSubscribe(): UsePushSubscribe {
  const { i18n } = useTranslation();
  const [state, setState] = useState<PushState>('default');

  // Initial state probe.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const platform = getPushPlatformState();
      if (platform !== 'ok') { if (!cancelled) setState(platform); return; }
      const perm = Notification.permission;
      if (perm === 'denied') { if (!cancelled) setState('denied'); return; }
      if (perm === 'default') { if (!cancelled) setState('default'); return; }
      const ep = await getActiveEndpoint();
      if (!cancelled) setState(ep ? 'subscribed' : 'default');
    })();
    return () => { cancelled = true; };
  }, []);

  const subscribeToServer = useCallback(async (endpoint: string, p256dh: string, auth: string) => {
    const supabase = getSupabaseClient();
    await supabase.functions.invoke('push-subscribe', {
      body: { endpoint, p256dh, auth_secret: auth, lang: i18n.language || 'en' },
    });
  }, [i18n.language]);

  const enable = useCallback(async () => {
    if (!VAPID_PUB) { console.warn('[push] EXPO_PUBLIC_VAPID_PUBLIC_KEY missing'); return; }
    if (state === 'unsupported' || state === 'ios-needs-pwa') return;
    setState('pending');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'default'); return; }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(VAPID_PUB),
      });
      const j: any = sub.toJSON();
      await subscribeToServer(j.endpoint, j.keys.p256dh, j.keys.auth);
      setState('subscribed');
    } catch (err) {
      console.warn('[push] enable failed:', err);
      setState('default');
    }
  }, [state, subscribeToServer]);

  const disable = useCallback(async () => {
    setState('pending');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await getSupabaseClient().functions.invoke('push-unsubscribe', { body: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setState(Notification.permission === 'denied' ? 'denied' : 'default');
    } catch (err) {
      console.warn('[push] disable failed:', err);
      setState('subscribed');
    }
  }, []);

  // Re-register on language change to keep `lang` column current.
  useEffect(() => {
    if (state !== 'subscribed') return;
    (async () => {
      const sub = (await (await navigator.serviceWorker.ready).pushManager.getSubscription());
      if (!sub) return;
      const j: any = sub.toJSON();
      await subscribeToServer(j.endpoint, j.keys.p256dh, j.keys.auth);
    })().catch((e) => console.warn('[push] lang resync failed:', e));
  }, [i18n.language, state, subscribeToServer]);

  return { state, enable, disable };
}
```

- [ ] **Step 3: Type-check**

Run:
```bash
npx tsc --noEmit
```

Expected: no errors in `src/lib/push/*`. (Project-wide tsc may surface unrelated noise — only the new files should be free of fresh errors.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/push/iosGate.ts src/lib/push/usePushSubscribe.ts
git commit -m "feat(push): client hook + iOS PWA gate"
```

---

## Task 11: Settings toggle

**Files:**
- Modify: `src/screens/SettingsScreen.tsx`

Mirror the existing Haptics section's `OptionPills` pattern. Show a helper line for `denied` and `ios-needs-pwa` states.

- [ ] **Step 1: Wire the hook into `SettingsScreen`**

Add the import alongside the others near the top:

```ts
import { usePushSubscribe } from '../lib/push/usePushSubscribe';
```

Inside the component (alongside `hapticsEnabled`), call the hook:

```ts
const push = usePushSubscribe();
```

After the `=== HAPTICS ===` `<View>` (around line 328) and before `=== LOGOUT ===`, add:

```tsx
{/* === NOTIFICATIONS === */}
<View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
  <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
    {t('settings.notifications', 'Notifications')}
  </Text>
  <Text style={[styles.sectionDesc, { color: colors.textMuted }]}>
    {t('settings.notificationsDesc', 'Wake me when it is my turn or the game starts.')}
  </Text>
  <OptionPills
    options={[
      { key: 'on',  label: t('settings.on',  'On') },
      { key: 'off', label: t('settings.off', 'Off') },
    ]}
    selected={push.state === 'subscribed' ? 'on' : 'off'}
    onSelect={(key) => { void (key === 'on' ? push.enable() : push.disable()); }}
    accentColor={colors.accent} textColor={colors.textSecondary} bgColor={colors.surfaceSecondary}
    testIDPrefix="notifications"
  />
  {push.state === 'denied' && (
    <Text style={[styles.sectionDesc, { color: colors.textMuted, marginTop: Spacing.sm }]}>
      {t('settings.notificationsDenied', 'Enable notifications in your browser site settings, then come back.')}
    </Text>
  )}
  {push.state === 'ios-needs-pwa' && (
    <Text style={[styles.sectionDesc, { color: colors.textMuted, marginTop: Spacing.sm }]}>
      {t('settings.notificationsPwa', 'Add this site to your home screen first (Share → Add to Home Screen).')}
    </Text>
  )}
  {push.state === 'unsupported' && (
    <Text style={[styles.sectionDesc, { color: colors.textMuted, marginTop: Spacing.sm }]}>
      {t('settings.notificationsUnsupported', 'Your browser does not support push notifications.')}
    </Text>
  )}
</View>
```

- [ ] **Step 2: Add i18n strings**

In each of `src/locales/en.json`, `src/locales/ru.json`, `src/locales/es.json`, add the following keys under `settings`:

```jsonc
"notifications": "Notifications",        // ru: "Уведомления"   es: "Notificaciones"
"notificationsDesc": "...",              // see EN above; localize for ru/es
"notificationsDenied": "...",
"notificationsPwa": "...",
"notificationsUnsupported": "..."
```

EN values are normative. RU/ES translations: short and in voice with the rest of `settings.*`. Use the English wording above as the source of truth.

- [ ] **Step 3: Verify in dev**

Run `npx expo start --port 8081`. Navigate to Settings; confirm:
- Section renders with on/off pills.
- Tapping On triggers the browser permission prompt (Chrome desktop).
- After granting and tapping Off, tapping On again re-subscribes without prompting.

- [ ] **Step 4: Commit**

```bash
git add src/screens/SettingsScreen.tsx src/locales/*.json
git commit -m "feat(push): settings toggle for notifications"
```

---

## Task 12: Auto-prompt on first `waiting → betting` + SW navigation listener

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/screens/WaitingRoomScreen.tsx`

Two small effects:
1. Listen for `kind:'push:navigate'` `postMessage` from the SW and route into the room (App-level).
2. On the first `waiting → betting` transition the user observes, auto-call `push.enable()` if state is `default` (WaitingRoom-level — easier to detect transitions there from the snapshot).

- [ ] **Step 1: Add SW message listener in `src/App.tsx`**

Inside `App` (or whichever component already mounts navigation; pick the same place where deep-link join logic already lives), add a `useEffect`:

```ts
useEffect(() => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const handler = (event: MessageEvent) => {
    const msg = event.data;
    if (msg?.kind !== 'push:navigate') return;
    if (typeof msg.room_code !== 'string') return;
    // Reuse the existing deep-link join path. The Telegram link uses the same
    // shape (`/join/<code>`) and triggers the same handler.
    window.location.assign(`/join/${msg.room_code}`);
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}, []);
```

If `App.tsx` is wrapped by other providers and the navigation already lives in `AppNavigator`, place this effect there instead. The only requirement is that it runs once at app boot and doesn't depend on a specific screen being mounted.

- [ ] **Step 2: Add auto-prompt in `WaitingRoomScreen.tsx`**

Inside `WaitingRoomScreen`, near the existing `useHeartbeat` hook, add:

```ts
import { usePushSubscribe } from '../lib/push/usePushSubscribe';
import { useRef } from 'react';
// …
const push = usePushSubscribe();
const phase = useRoomStore((s) => s.snapshot?.room?.phase);
const askedRef = useRef(false);

useEffect(() => {
  if (askedRef.current) return;
  if (phase !== 'playing') return;          // we entered a started game
  if (push.state !== 'default') return;     // already subscribed / denied / unsupported
  askedRef.current = true;
  void push.enable();
}, [phase, push]);
```

We piggyback on `room.phase` flipping to `'playing'` (the `start_game` action sets it). `askedRef` ensures we only ask once per WaitingRoom mount — if the user denies, the Settings toggle is the recovery path.

- [ ] **Step 3: Smoke test**

In dev: create a room with two browsers, mark both ready, click Start. Confirm the browser permission prompt appears for the user who hasn't enabled notifications yet. Grant; confirm a notification fires when the other browser plays a card and your seat becomes `current_seat` (with your tab in the background).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/screens/WaitingRoomScreen.tsx
git commit -m "feat(push): auto-prompt at game start + SW navigation listener"
```

---

## Task 13: Operator runbook (manual, no code)

This task is the one-time setup you (Akula) run after the code lands. List as a checklist so subagent-driven execution doesn't try to automate it.

- [ ] **Step 1: Generate VAPID keys**

```bash
npx web-push generate-vapid-keys
```

Output: a `Public Key` and `Private Key` (base64-url). Copy both.

- [ ] **Step 2: Set Edge Function secrets**

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY=<paste-public-key> \
  VAPID_PRIVATE_KEY=<paste-private-key> \
  VAPID_SUBJECT=mailto:akhmed.kadymov@gmail.com
```

Verify:
```bash
supabase secrets list | grep VAPID_
```
Expected: three lines.

- [ ] **Step 3: Set the public key in client env**

Add to `.env` at project root:

```
EXPO_PUBLIC_VAPID_PUBLIC_KEY=<paste-public-key>
```

If web is deployed via Vercel, also set this in the Vercel dashboard (Project Settings → Environment Variables → both Preview and Production).

- [ ] **Step 4: Apply migration to remote**

```bash
supabase db push
```

Expected: `Applying migration 022_push_subscriptions.sql` → success.

- [ ] **Step 5: Deploy edge functions**

```bash
supabase functions deploy game-action push-subscribe push-unsubscribe
```

Expected: three "Deployed" lines.

- [ ] **Step 6: Smoke-test from production**

1. Open `https://nigels.online` in desktop Chrome. Sign in or continue as guest.
2. Settings → Notifications → On. Grant the permission prompt.
3. Open the same site in another browser (or another guest profile). Use the Telegram-style join link or paste the room code.
4. Back in Chrome, switch to a different tab.
5. From the other browser, ready up and start. Within ~3 s your Chrome should show:
   - "🎮 Game starting" notification.
6. From the other browser, place bids until it is your turn. Wait 15 s (heartbeat staleness) — within ~3 s of your seat becoming current, "♠ Your turn" arrives.
7. Tap the notification → Chrome focuses, lands on the room.

- [ ] **Step 7: If notifications never arrive, inspect logs**

```bash
supabase functions logs game-action --tail 50
supabase functions logs push-subscribe --tail 20
```

Common failure modes:
- `[push] sendNotification failed: status=401` — VAPID key mismatch. Re-set secrets, redeploy.
- `[push] sendNotification failed: status=410` — subscription expired (already auto-deleted). Re-enable in Settings.
- No `[push]` log line at all — `VAPID_*` secrets are unset (helper silently no-ops). Re-run `supabase secrets list`.
- `push-subscribe` returning 401 — `Authorization` header isn't reaching the function; confirm `supabase.functions.invoke` is being called from a client with a logged-in session.

---

## Self-review

Spec coverage:
- Six push events with triggers (game_start, your_bid, your_turn, hand_end, player_joined, game_end) → Task 2 detector covers all six. ✓
- Architecture (Approach 2: pure detector + central wire layer) → Task 2 + Task 4 + Task 7. ✓
- `push_subscriptions` table with RLS, keyed by `auth_user_id`, `endpoint` unique → Task 1. ✓
- Two edge functions for subscribe/unsubscribe → Tasks 5, 6. ✓
- Server-side i18n storing `lang` per subscription → Task 3 (i18n) + Task 5 (subscribe stores `lang`) + Task 10 (hook posts current `i18n.language`). ✓
- Service Worker `push` and `notificationclick` handlers extending the existing passthrough → Task 8. ✓
- Tag strategy (replace vs stack) → Task 4 `tagFor()` and Task 8 `data.tag`. ✓
- Permission UX B+C: auto-prompt on first `waiting → betting` + Settings toggle → Tasks 11, 12. ✓
- Visibility-aware `your_turn` debounce via `last_seen_at` heartbeat → Task 9 (heartbeat) + Task 4 (15-s filter in `notifyPush`). ✓
- iOS standalone-PWA gate → Task 10 (`iosGate.ts`) + Task 11 (settings helper line). ✓
- Multi-device fan-out (one user, N rows) → Task 4 (`auth_user_id IN (...)` query). ✓
- 410 / 404 cleanup → Task 4 (`statusCode === 404 || 410 → DELETE row`). ✓
- VAPID secret management + operator runbook → Task 13. ✓
- Spec amendment (room_code in payload for navigation) → declared in plan header; implemented in Task 2 detector, Task 4 wire, Task 8 SW. ✓

Placeholder scan: no "TBD" / "TODO" / unspecified steps. All code blocks complete. RU/ES localization strings for `settings.notifications*` keys are explicitly delegated to Task 11 Step 2 with EN as normative source.

Type consistency: `PushEvent` shape declared in Task 2, used identically in Tasks 3, 4, 7. `usePushSubscribe` returns `{state, enable, disable}` in Task 10, consumed identically in Tasks 11, 12. `formatPushBody(event, lang, ctx)` signature consistent across Tasks 3 and 4.
