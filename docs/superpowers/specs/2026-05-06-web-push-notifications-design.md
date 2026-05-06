# Web Push Notifications — Design Spec

**Date:** 2026-05-06
**Status:** Draft, awaiting review
**Author:** Brainstormed with Akula

---

## Goal

Wake the player in their browser when something in the game requires attention — even if the tab is in the background, another window is focused, or the device screen is asleep. Six events are pushable: game start, your bid, your turn, hand finished, someone joined your room (host only), game over. Real Web Push (Service Worker + VAPID), not foreground-only Notification API.

## Non-goals

- Native iOS / Android notifications via Expo's `expo-notifications` (FCM/APNs). Web Push only.
- Offline play, cached shells, or any caching beyond the existing pass-through SW.
- Re-engagement / marketing pushes ("come back, your friends are playing"). Only **in-game** events.
- Per-device-type fan-out logic. We push to all subscriptions belonging to the player's `auth_user_id`.
- Native push from PG triggers / pg_net. All push detection lives in `game-action`.

## Architecture

```
[Client – RN-Web / PWA]
  ├─ public/sw.js
  │    ├─ existing: install/activate/fetch passthrough
  │    ├─ NEW: addEventListener('push')             → showNotification(...)
  │    └─ NEW: addEventListener('notificationclick') → focus client / openWindow
  └─ lib/push/usePushSubscribe.ts
       ├─ detects PushManager / Notification support, iOS standalone
       ├─ asks permission on first waiting→betting (auto-prompt) and via Settings toggle
       ├─ subscribes via VAPID public key
       └─ POST /push-subscribe   (upsert) / POST /push-unsubscribe (delete)

[Server – Supabase Edge Functions, Deno]
  ├─ game-action/index.ts
  │    └─ after each successful action:
  │         prevSnapshot, nextSnapshot, actor → detectTransitions(...)
  │              → PushEvent[]
  │         for each event: notifyPush(svc, event)
  │
  ├─ push-subscribe/index.ts        (new edge function)
  └─ push-unsubscribe/index.ts      (new edge function)
  └─ _shared/push/
       ├─ transitions.ts    pure detector — fully unit-tested
       ├─ notifyPush.ts     wire layer: resolves recipients → fetches subs → web-push
       └─ i18n.ts           per-event title/body in en/ru/es

[Storage]
  └─ public.push_subscriptions (new table, migration 022)
```

Pure-function `detectTransitions(prev, next, actor): PushEvent[]` is the heart. All event policy lives there; everything else is plumbing.

## Schema migration (`022_push_subscriptions.sql`)

```sql
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
  FOR ALL USING (auth.uid() = auth_user_id) WITH CHECK (auth.uid() = auth_user_id);
```

Subscriptions are bound to `auth_user_id` (stable for guests via persisted anonymous auth) and **not** to `session_id` (transient — created per join). Deleting an auth user cascades. Edge functions use service-role and bypass RLS.

## Event detection — `_shared/push/transitions.ts`

```ts
export type PushEvent =
  | { type: 'game_start';     room_id: string; recipients: string[] }
  | { type: 'your_bid';       room_id: string; recipient: string }
  | { type: 'your_turn';      room_id: string; recipient: string;
                              hand_id: string; trick_number: number }
  | { type: 'hand_end';       room_id: string; recipients: string[];
                              hand_number: number;
                              scores: Array<{ session_id: string; hand_score: number }> }
  | { type: 'player_joined';  room_id: string; recipient: string; joiner_name: string }
  | { type: 'game_end';       room_id: string; recipients: string[];
                              winner_session_id: string };

export function detectTransitions(
  prev: RoomSnapshot,
  next: RoomSnapshot,
  actor: ActorContext,
): PushEvent[];
```

| Event | Trigger condition |
|---|---|
| `game_start` | `prev.current_hand === null && next.current_hand !== null` |
| `your_bid` | `next.current_hand.phase === 'betting'` AND `prev.current_seat !== next.current_seat`. Recipient = `players[seat === current_seat].session_id`. |
| `your_turn` | `next.current_hand.phase === 'playing'` AND `prev.current_seat !== next.current_seat`. Same recipient resolution. |
| `hand_end` | `prev.current_hand.phase !== 'closed' && next.current_hand.phase === 'closed'`. Recipients = all `players[].session_id`. |
| `player_joined` | `next.players.length > prev.players.length`. Recipient = host_session_id. Joiner name from new seat's display name. |
| `game_end` | `prev.room.phase !== 'finished' && next.room.phase === 'finished'`. Recipients = all players. |

Pure logic, no I/O. Deno tests feed snapshot fixtures and assert returned events. Each rule = one or two tests; ~10–12 tests total.

**Anti-cases (must not fire):**
- `player_joined` when an existing player reconnects (`is_connected` flips, but `players.length` unchanged).
- `your_turn` repeated for the same seat from a snapshot replay (`prev.current_seat === next.current_seat`).
- `hand_end` when transitioning `betting → playing` (`closed_at` only set on `closed` phase).

## Wire layer — `_shared/push/notifyPush.ts`

```ts
export async function notifyPush(
  svc: SupabaseClient,
  event: PushEvent,
): Promise<void>
```

Mirrors `sendTelegram`: single primitive, swallows every error, never re-throws. Steps:

1. **Resolve recipients** — array of `session_id` (the event already says who).
2. **Visibility check (only `your_turn`)** — `SELECT last_seen_at FROM room_players WHERE session_id = ANY($1)`. If `now() - last_seen_at < 15s` → recipient is currently on the tab → skip. The other five events ignore visibility because they are infrequent and worth surfacing regardless.
3. **Resolve auth_user_ids** — `SELECT auth_user_id FROM room_sessions WHERE id = ANY($1)`.
4. **Fetch subscriptions** — `SELECT endpoint, p256dh, auth_secret, lang FROM push_subscriptions WHERE auth_user_id = ANY($1)`. Multi-device: one user, N rows, send to all.
5. **Localize** — `formatPushBody(event, lang, ctx) → { title, body }` from `_shared/push/i18n.ts`.
6. **Send** — `npm:web-push@3` (Deno can `import webpush from 'npm:web-push@3'`). VAPID-sign and ECDH-encrypt. 3-second `AbortController` timeout per endpoint.
7. **On 410 / 404** → `DELETE FROM push_subscriptions WHERE endpoint = $1`. On other errors → `console.warn` (status only — never log keys, endpoint, body).
8. **On success** → `UPDATE push_subscriptions SET last_used_at = now() WHERE endpoint = $1`.

**Secrets (Supabase Edge Function env):**
```
VAPID_PUBLIC_KEY      # also exposed to client as EXPO_PUBLIC_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY     # never leaves the edge function
VAPID_SUBJECT         # mailto:akhmed.kadymov@gmail.com
```

Generated once via `npx web-push generate-vapid-keys` and saved with `supabase secrets set`.

## i18n strings (`_shared/push/i18n.ts`)

Three locales, six events, plain functions returning `{title, body}`. Body may take params (score, joiner name, winner). Sample:

```ts
export const PUSH_STRINGS = {
  en: {
    game_start:    () => ({ title: '🎮 Game starting',  body: 'The hand is being dealt.' }),
    your_bid:      () => ({ title: '🎯 Your bid',       body: 'Time to call your tricks.' }),
    your_turn:     () => ({ title: '♠ Your turn',       body: 'Play a card.' }),
    hand_end:      (p) => ({ title: '📊 Hand finished', body: `${p.score >= 0 ? '+' : ''}${p.score} this hand.` }),
    player_joined: (p) => ({ title: '👋 New player',    body: `${p.name} joined your room.` }),
    game_end:      (p) => ({ title: '🏁 Game over',     body: p.you_won ? 'You won!' : `${p.winner_name} won.` }),
  },
  ru: { /* … */ },
  es: { /* … */ },
};
```

Final RU/ES copy is a separate small task in the implementation plan; English strings are normative for the spec.

## Service Worker — `public/sw.js` (extension)

Adds two listeners on top of the existing passthrough. Does not break installability.

```js
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { return; }
  const { title, body, tag, room_id, type } = payload;
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    icon: '/icons/icon.svg',
    badge: '/icons/icon.svg',
    data: { room_id, type },
    renotify: type !== 'your_turn',  // your_turn replaces silently
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { room_id } = event.notification.data || {};
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const ours = all.find((c) => new URL(c.url).origin === self.location.origin);
    if (ours) {
      await ours.focus();
      ours.postMessage({ kind: 'push:navigate', room_id });
      return;
    }
    await self.clients.openWindow(`/?room=${room_id}`);
  })());
});
```

**Tag strategy** — controls "stack vs replace" in the notification shade:

| Event | Tag |
|---|---|
| `your_turn` | `nagels-turn-${room_id}` |
| `your_bid` | `nagels-bid-${room_id}` |
| `game_start` / `game_end` | `nagels-game-${room_id}` |
| `hand_end` | `nagels-hand-${room_id}-${hand_number}` |
| `player_joined` | `nagels-join-${room_id}-${session_id}` |

Client app listens for `kind:'push:navigate'` `postMessage` events at the navigation root and routes to the room.

## Client hook — `lib/push/usePushSubscribe.ts`

State machine:

```ts
type PushState =
  | 'unsupported'        // no SW / PushManager / Notification
  | 'ios-needs-pwa'      // iOS Safari, not in standalone display mode
  | 'denied'
  | 'default'            // permission not yet asked
  | 'subscribed'
  | 'pending';
```

iOS gate:
```ts
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as any).standalone === true;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
if (isIOS && !isStandalone) return 'ios-needs-pwa';
```

**Permission UX (B + C):**

1. **Auto-prompt on first `waiting → betting`** — if `state === 'default'` AND `auth.users.raw_user_meta_data.notifications_enabled !== false` (i.e. user hasn't explicitly turned it off), call `Notification.requestPermission()`, then `subscribe()` on grant. Persisting `notifications_enabled` in user metadata avoids re-prompting in future sessions.
2. **Settings toggle** — pick up the existing settings screen pattern (`avatar`, `avatar_color` already live in `raw_user_meta_data`). Toggle on → permission flow + subscribe; off → unsubscribe + clear `notifications_enabled`. If `state === 'denied'`, the toggle shows a helper line: "Enable in browser site settings". If `state === 'ios-needs-pwa'`, the toggle is disabled with the message "Install to home screen first."

Subscribe call:
```ts
const reg = await navigator.serviceWorker.ready;
const sub = await reg.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: urlBase64ToUint8Array(EXPO_PUBLIC_VAPID_PUBLIC_KEY),
});
const j = sub.toJSON();
await supabase.functions.invoke('push-subscribe', {
  body: { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth_secret: j.keys.auth, lang: i18n.language },
});
```

**Language sync** — one `useEffect` on `i18n.language`. If `state === 'subscribed'`, re-POST `/push-subscribe` with the same endpoint; the server upserts and updates `lang`.

## Edge functions

### `push-subscribe`
- Reads JWT, resolves `auth.uid()`. Rejects unauthenticated requests.
- Validates body shape (`endpoint`, `p256dh`, `auth_secret`, `lang ∈ {en, ru, es}`).
- `INSERT … ON CONFLICT (endpoint) DO UPDATE SET p256dh=…, auth_secret=…, lang=…, last_used_at=now()`.

### `push-unsubscribe`
- Reads JWT.
- Body: `{ endpoint }`.
- `DELETE FROM push_subscriptions WHERE endpoint = $1 AND auth_user_id = auth.uid()`.

Both functions are tiny — no shared logic worth abstracting beyond JWT parsing already in `_shared/auth.ts`.

## Visibility heartbeat (already partly there)

The existing `room_players.last_seen_at` heartbeat pings on every snapshot fetch. We tighten the client side: heartbeat only ticks while `document.visibilityState === 'visible'`. When the user backgrounds the tab, `last_seen_at` goes stale; after 15 seconds the server treats them as "away" and starts pushing `your_turn`. On return, the next visible heartbeat pulls them back to "active".

This is the entire throttling mechanism for `your_turn` (Q3 = B). No additional state on the server.

## Error handling

| Failure | Behavior |
|---|---|
| `notifyPush` throws | Caught inside; `console.warn`; never blocks the action. |
| `web-push` returns 410 / 404 | `DELETE` the subscription row. |
| `web-push` returns 429 / 5xx | `console.warn` with status; do not retry. |
| VAPID secrets missing | `notifyPush` early-returns silently (mirrors the Telegram dev-path no-op). |
| `push-subscribe` body invalid | 400 with a generic message; no PII / endpoint echoed. |
| Service Worker `push` payload not JSON | Listener returns silently; no notification shown. |

## Testing

- **`detectTransitions` (Deno tests)** — ~10–12 tests with hand-built `RoomSnapshot` fixtures. Covers each rule and the listed anti-cases.
- **`formatPushBody` (Deno tests)** — one test per locale × event for shape (`{title, body}` non-empty). Smoke level, not pixel-perfect copy review.
- **`notifyPush` (no tests)** — wire layer, manually smoke-tested. Same call as Telegram.
- **Client hook (no automated tests)** — manual verification on real devices: Android Chrome (incl. backgrounded tab), Desktop Firefox/Chrome, iOS Safari standalone PWA.

## Operator runbook (post-merge)

1. `npx web-push generate-vapid-keys` → save **public** and **private** keys.
2. `supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:akhmed.kadymov@gmail.com`.
3. Add `EXPO_PUBLIC_VAPID_PUBLIC_KEY` to `.env` (and Vercel env if web-only is deployed there).
4. Apply migration `022_push_subscriptions.sql` via `supabase db push`.
5. `supabase functions deploy game-action push-subscribe push-unsubscribe`.
6. Smoke-test:
   - Desktop Chrome: open site, create room, start a game, switch to other tab → first `your_turn` notification within 15 s of leaving the tab.
   - iOS Safari standalone PWA: install to home screen, open from icon, run same flow.

## Open questions / explicit deferrals

- **Final RU/ES copy.** Spec leaves placeholders; copy review happens during plan implementation (small task before merging i18n.ts).
- **Native (Expo) push.** Out of scope — separate spec when iOS App Store / Play Store distribution begins.
- **Subscription TTL cleanup.** Cron-pruning rows with `last_used_at` older than 30 days will piggyback on existing `020_ttl_cleanup.sql`. Tracked separately, not in this plan.
- **Per-event mute.** No UI — global toggle only. Per-event control is a YAGNI feature; revisit if users ask.

## Self-review

- ✅ All six events specified, each with trigger, recipients, tag.
- ✅ Permission UX matches Q2 (B + C): auto-prompt on first game start + Settings toggle.
- ✅ `your_turn` throttling matches Q3 (B): visibility-heartbeat-driven, no extra server state.
- ✅ i18n matches Q4 (A): server-side localization stored at subscribe time.
- ✅ Architecture matches Approach 2: pure detector + central `notifyPush`, no logic in DB triggers, no logic in individual action handlers.
- ✅ iOS PWA gate handled with explicit user-facing message.
- ✅ Multi-device handled (subs keyed by `auth_user_id`, fan-out to all).
- ✅ Error path never blocks game-action (mirrors Telegram).
- ✅ No PII / secrets logged on failure.
