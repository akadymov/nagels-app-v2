# Telegram Room Webhook — Design

**Status:** approved (brainstorming) — awaiting implementation plan
**Author:** Akula + Claude
**Date:** 2026-05-06

## Goal

When a host creates a multiplayer room, post a single message to a private Telegram channel so the ~10-person friend group sees a join link and can pile in. The room itself is unaware of Telegram; this is a unidirectional notification with no back-channel.

## Scope

- Multiplayer rooms only. Bot/single-player games never reach the `createRoom` edge function and so never trigger a notification — that is the natural boundary, not a check we add.
- One message per room, sent at room creation. No live updates as players join, no closing-state edits.
- Russian-language text. The channel is Russian-speaking; per-host localization is out of scope and can be added later if needed.

## Non-goals

- No back-channel from Telegram into the app (e.g. no slash commands, no `/start` flow).
- No record of which message corresponds to which room. We do not store `message_id`.
- No retries, no delivery guarantees. A dropped notification is acceptable.
- No support for posting to multiple channels.

## Architecture

Inline call inside the existing `createRoom` edge-function action. After the room row, the seat 0 `room_players` row, the `game_events` event, the `version` bump, and `buildSnapshot` have all succeeded, fire a single fire-and-forget `fetch` to `api.telegram.org` and return the snapshot.

```
client → game-action (action=create_room)
  └─ createRoom.ts
       ├─ insert rooms / room_players / game_events  (existing)
       ├─ bump version                                (existing)
       ├─ buildSnapshot                               (existing)
       ├─ notifyTelegram(host_name, code)             ← new, awaited but
       │                                                 swallows errors
       └─ return { ok:true, state, version }
```

`notifyTelegram` is `await`ed but treated as fire-and-forget at the type level — it always resolves to `void`, never throws. The await exists only because Supabase Edge Functions terminate the request context once the handler resolves, which would orphan an in-flight `fetch`; awaiting keeps the runtime alive long enough for the 3-second `AbortController` to do its job. Every failure path inside `notifyTelegram` is caught and surfaced as a `console.warn`.

## Components

### `supabase/functions/_shared/telegram.ts` (new)

```ts
export interface RoomNotification {
  hostName: string;        // free text from auth metadata, must be HTML-escaped
  roomCode: string;        // 6-char alphabet [A-Z2-9]
  appOrigin: string;       // e.g. "https://nigels.online"
}

export function formatRoomMessage(n: RoomNotification): string {
  // Returns HTML-formatted text for Telegram parse_mode=HTML.
  // HTML-escapes hostName.
}

export async function notifyNewRoom(n: RoomNotification): Promise<void> {
  // Reads TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID from Deno.env.
  // If either is missing → return (no warn — this is the dev/preview path).
  // Otherwise POST to api.telegram.org/bot<TOKEN>/sendMessage with:
  //   chat_id, text=formatRoomMessage(n), parse_mode='HTML',
  //   disable_web_page_preview=true,
  //   reply_markup={inline_keyboard: [[{ text:'Join', url:joinUrl }]]}
  // 3s AbortController timeout. Catches all errors; logs status code and
  // Telegram-returned `description` field on non-200, never the token.
}
```

### `supabase/functions/game-action/actions/createRoom.ts` (edited)

After `buildSnapshot`, before `return`:

```ts
const appOrigin = Deno.env.get('PUBLIC_APP_ORIGIN') ?? 'https://nigels.online';
await notifyNewRoom({
  hostName: actor.display_name,   // ActorContext guarantees this is a string
  roomCode: code,                 // captured from the successful insert
  appOrigin,
});
```

(The current loop overwrites `code` on retries; we read the final value from the loop variable in the success branch. The implementation plan will detail this.)

### Message format (final, Russian, minimal — option A from brainstorming)

```
🎮 <b>{hostName}</b> собирает стол на nigels.online
```
plus an inline keyboard with one button labeled `Join` linking to `{appOrigin}/join/{roomCode}`.

`disable_web_page_preview=true` so the message stays a single visual line in the channel.

## Configuration

Three Edge-Function secrets, all set via `supabase secrets set`:

| Name | Example | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `123456:ABC-DEF…` | BotFather token. Read by edge function only — never shipped to the client bundle. |
| `TELEGRAM_CHAT_ID`   | `-1001244338572`  | Target channel. Negative `-100…` form because the channel is a private supergroup. |
| `PUBLIC_APP_ORIGIN`  | `https://nigels.online` | Used to build the absolute join URL inside the function (no `window.location` in Deno). |

Setup runbook (one-time, performed manually by the operator):

1. Telegram → DM `@BotFather` → `/newbot` → choose name and username → copy token.
2. In the Telegram channel: settings → Administrators → Add bot → grant **Post Messages** only.
3. Local terminal:
   ```bash
   supabase secrets set \
     TELEGRAM_BOT_TOKEN=<token-from-step-1> \
     TELEGRAM_CHAT_ID=-1001244338572 \
     PUBLIC_APP_ORIGIN=https://nigels.online
   supabase functions deploy game-action
   ```
4. Smoke-test: open `nigels.online`, create a multiplayer room, confirm the post appears in the channel within ~2 seconds and the **Join** button opens the right URL.

If `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` is missing, `notifyNewRoom` returns silently. This keeps `npm run demo` (Playwright two-player demo) working in environments without the secrets.

## Error handling

- 3-second `AbortController` timeout on the `fetch`. After timeout, log and return.
- Catch all errors: network, abort, non-2xx response. On non-2xx, parse `{ ok, error_code, description }` from the Telegram response and log only those — never the token, never the message text.
- No retries. A failed notification is a missed broadcast, not a system failure.
- Errors are surfaced via `console.warn` so they show up in `supabase functions logs game-action` (and in the Supabase dashboard "Logs" view).

## Security

- Bot token lives only in Edge Function env. The client never sees it; the bundle never references it. We do not pass it through any Postgres column or RPC.
- The host's display name is HTML-escaped before being interpolated into the `parse_mode=HTML` body. Without this, a name like `Akula <script>` would be rejected by Telegram's parser, and a more crafted name could break formatting in adjacent posts.
- Channel ID is not a secret per se, but is environment-bound (`TELEGRAM_CHAT_ID`) so a different deployment (preview, staging) can target a different channel without code changes.

## Testing

- Deno unit test for `formatRoomMessage`: covers HTML-escaping of `<`, `>`, `&`, `"`, `'` in `hostName`, and confirms the join URL is built correctly from `appOrigin` + `roomCode`. Lives under `supabase/functions/_shared/__tests__/telegram.test.ts`.
- No HTTP mocks for `sendMessage`. The remote integration is verified once manually after the first deploy via the smoke-test in the runbook above.
- Existing `createRoom` tests are unaffected — they exercise the action under conditions where `TELEGRAM_BOT_TOKEN` is unset, and the new code path no-ops in that case.

## Open follow-ups (not in scope of this spec)

- Per-host language for the message text. Today's choice is RU-only.
- Optional "Closing" edit when the room transitions to `playing` or `cancelled`. Would require persisting `message_id` per room and listening to the room state change. Defer until a real signal demands it.
- Posting end-of-game results to the same channel. Distinct trigger, distinct message — would be a separate notification event, not a refit of this one.
