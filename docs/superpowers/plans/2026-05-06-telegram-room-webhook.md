# Telegram Room Webhook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Post a one-shot Telegram channel message with a Join button every time a host creates a multiplayer room, so a small friend group can pile in without out-of-band coordination.

**Architecture:** New `supabase/functions/_shared/telegram.ts` with a wire layer (`sendTelegram`) and a room-event wrapper (`notifyNewRoom`) reading bot token + chat id from Edge Function secrets. The existing `createRoom` action awaits `notifyNewRoom` after a successful insert; the helper itself swallows every error so a Telegram failure can never block room creation. One-shot only, no `message_id` persistence, no live updates.

**Tech Stack:** Supabase Edge Functions (Deno), TypeScript, Telegram Bot API (`sendMessage`), `console.warn` for failures.

**Spec:** `docs/superpowers/specs/2026-05-06-telegram-room-webhook-design.md`

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `supabase/functions/_shared/telegram.ts` | Create | Pure helpers (`escapeHtml`, `buildJoinUrl`, `formatRoomMessage`), wire layer (`sendTelegram`), event wrapper (`notifyNewRoom`). |
| `supabase/functions/_shared/__tests__/telegram.test.ts` | Create | Deno tests for the pure helpers — escaping, message body, URL composition. No HTTP. |
| `supabase/functions/game-action/actions/createRoom.ts` | Modify | Capture the `code` of the row that won the insert race, then `await notifyNewRoom(...)` before returning the snapshot. |

The Telegram wire layer lives in `_shared` so future events (game-finished, daily summary) reuse it without copy-paste. `createRoom` is the only call site for this plan.

---

## Task 1: TDD `escapeHtml`, `buildJoinUrl`, `formatRoomMessage`

**Files:**
- Create: `supabase/functions/_shared/__tests__/telegram.test.ts`
- Create: `supabase/functions/_shared/telegram.ts`

These three helpers are pure and trivial to test, and they own the only logic in the module that can silently corrupt output (HTML escaping, URL assembly). The wire layer in later tasks has no testable logic worth mocking.

- [ ] **Step 1: Write the failing test file**

Create `supabase/functions/_shared/__tests__/telegram.test.ts`:

```ts
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
  // Operators set PUBLIC_APP_ORIGIN by hand; a stray trailing slash
  // would otherwise yield '...//join/...' which technically works but
  // looks wrong in the channel preview.
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
deno test supabase/functions/_shared/__tests__/telegram.test.ts
```

Expected: errors of the form "Module not found: ../telegram.ts" (or "no such file"). All six tests fail to even load — that is the failing state we want.

- [ ] **Step 3: Implement `telegram.ts` with just the pure helpers**

Create `supabase/functions/_shared/telegram.ts`:

```ts
/**
 * Telegram bot integration for Nägels Online edge functions.
 *
 * Layered:
 *   - Pure helpers (escapeHtml, buildJoinUrl, formatRoomMessage) — testable.
 *   - Wire layer (sendTelegram) — single Telegram primitive.
 *   - Event wrappers (notifyNewRoom, …) — one per notification type.
 */

export interface RoomNotification {
  /** Free text from auth metadata. Will be HTML-escaped before use. */
  hostName: string;
  /** 6-char room code from the alphabet [A-Z2-9]. */
  roomCode: string;
  /** Origin used to build the absolute join URL, e.g. https://nigels.online */
  appOrigin: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildJoinUrl(appOrigin: string, roomCode: string): string {
  const origin = appOrigin.replace(/\/+$/, '');
  return `${origin}/join/${roomCode}`;
}

export function formatRoomMessage(n: RoomNotification): string {
  // Russian by design — the channel is RU. Per-host language is an
  // explicit non-goal of the current spec.
  return `🎮 <b>${escapeHtml(n.hostName)}</b> собирает стол на nigels.online`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
deno test supabase/functions/_shared/__tests__/telegram.test.ts
```

Expected: `ok | 6 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/telegram.ts supabase/functions/_shared/__tests__/telegram.test.ts
git commit -m "feat(telegram): add HTML-escape, join URL, and room message formatter"
```

---

## Task 2: Add the `sendTelegram` wire layer

**Files:**
- Modify: `supabase/functions/_shared/telegram.ts` (append wire layer)

The wire layer is the only place that touches `api.telegram.org`. It reads the bot token and (optionally) chat id from env, applies a 3-second AbortController timeout, and swallows every error path with a `console.warn`. No tests — the spec explicitly chose manual smoke-testing over HTTP mocking for this layer.

- [ ] **Step 1: Append the `sendTelegram` function**

Add to the end of `supabase/functions/_shared/telegram.ts`:

```ts
export interface SendOptions {
  /** Override the default chat. Falls back to env TELEGRAM_CHAT_ID. */
  chatId?: string;
  /** HTML-formatted body. Caller is responsible for escaping any user input. */
  htmlText: string;
  /** Passed through to Telegram as `reply_markup`. */
  replyMarkup?: unknown;
  /** Default true. Telegram's link previews would expand the join URL into a card. */
  disablePreview?: boolean;
}

const TG_TIMEOUT_MS = 3_000;

/**
 * Single Telegram primitive. Returns void; every failure (missing token,
 * timeout, non-2xx response, parse error) is caught and logged via
 * console.warn. Never re-throws — callers can `await` without try/catch.
 *
 * Logs the HTTP status and Telegram's `description` field on failure. Does
 * NOT log the bot token, the chat id, or the message body, even on error.
 */
export async function sendTelegram(opts: SendOptions): Promise<void> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = opts.chatId ?? Deno.env.get('TELEGRAM_CHAT_ID');
  if (!token || !chatId) {
    // Dev / preview path — no secrets configured. Silently no-op so
    // `npm run demo` and local supabase functions serve work without TG.
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TG_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: opts.htmlText,
          parse_mode: 'HTML',
          disable_web_page_preview: opts.disablePreview ?? true,
          reply_markup: opts.replyMarkup,
        }),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      let description: string | undefined;
      try {
        const body = await res.json() as { description?: string };
        description = body?.description;
      } catch { /* body wasn't JSON */ }
      console.warn(`[telegram] sendMessage failed: status=${res.status} description=${description ?? '<none>'}`);
    }
  } catch (err) {
    // AbortError on timeout, TypeError on network failure.
    const name = err instanceof Error ? err.name : 'unknown';
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[telegram] sendMessage threw: ${name}: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: Re-run the helper tests to confirm nothing broke**

Run:
```bash
deno test supabase/functions/_shared/__tests__/telegram.test.ts
```

Expected: still `ok | 6 passed | 0 failed`. (We added new exports to the same file but didn't change existing ones.)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/telegram.ts
git commit -m "feat(telegram): add sendTelegram wire layer with 3s timeout"
```

---

## Task 3: Add the `notifyNewRoom` event wrapper

**Files:**
- Modify: `supabase/functions/_shared/telegram.ts` (append event wrapper)

Glue between `formatRoomMessage` + `buildJoinUrl` and `sendTelegram`. This is the function `createRoom` will call.

- [ ] **Step 1: Append `notifyNewRoom`**

Add to the end of `supabase/functions/_shared/telegram.ts`:

```ts
/**
 * Post the "new room" notification to the configured Telegram channel.
 * One-shot — does not store message_id and never updates the post.
 *
 * Errors are caught inside sendTelegram; this function never throws.
 */
export async function notifyNewRoom(n: RoomNotification): Promise<void> {
  const joinUrl = buildJoinUrl(n.appOrigin, n.roomCode);
  await sendTelegram({
    htmlText: formatRoomMessage(n),
    replyMarkup: {
      inline_keyboard: [[{ text: 'Join', url: joinUrl }]],
    },
  });
}
```

- [ ] **Step 2: Re-run the tests**

Run:
```bash
deno test supabase/functions/_shared/__tests__/telegram.test.ts
```

Expected: still `ok | 6 passed | 0 failed`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/telegram.ts
git commit -m "feat(telegram): add notifyNewRoom event wrapper"
```

---

## Task 4: Wire `notifyNewRoom` into `createRoom`

**Files:**
- Modify: `supabase/functions/game-action/actions/createRoom.ts`

The current insert loop (`for (let attempt = 0; attempt < 5 && !inserted; attempt++)`) declares `code` inside the loop scope, so it is unreachable after the loop. Two-line fix: include `code` in the row's `.select(...)`, then read it from `inserted` before calling `notifyNewRoom`.

- [ ] **Step 1: Make the inserted row carry its code, and call `notifyNewRoom`**

Replace the body of `createRoom` (the section starting at the insert loop and ending at `return { ok: true, ... }`) so it reads:

```ts
  let inserted: { id: string; version: number; code: string } | null = null;
  for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
    const code = generateCode();
    const { data, error } = await svc
      .from('rooms')
      .insert({
        code,
        host_session_id: actor.session_id,
        player_count: action.player_count,
        max_cards: action.max_cards ?? 10,
        phase: 'waiting',
      })
      .select('id, version, code')
      .single();
    if (!error) {
      inserted = data as any;
      break;
    }
    if ((error as any).code !== '23505') throw error;
  }
  if (!inserted) throw new Error('could_not_allocate_code');

  const { error: rpErr } = await svc.from('room_players').insert({
    room_id: inserted.id,
    session_id: actor.session_id,
    seat_index: 0,
    is_ready: true,
  });
  if (rpErr) throw rpErr;

  await svc.from('game_events').insert({
    room_id: inserted.id,
    session_id: actor.session_id,
    kind: 'create_room',
    payload: { player_count: action.player_count, max_cards: action.max_cards ?? 10 },
  });

  await svc.from('rooms').update({ version: inserted.version + 1 }).eq('id', inserted.id);

  const snapshot = await buildSnapshot(svc, inserted.id, actor.session_id);

  // Fire-and-forget Telegram notification. notifyNewRoom never throws —
  // a bad token, missing chat id, or TG outage cannot block room creation.
  // Awaited only so the AbortController inside sendTelegram has time to
  // run before the edge-function request context is torn down.
  await notifyNewRoom({
    hostName: actor.display_name,
    roomCode: inserted.code,
    appOrigin: Deno.env.get('PUBLIC_APP_ORIGIN') ?? 'https://nigels.online',
  });

  return { ok: true, state: snapshot, version: inserted.version + 1 };
```

- [ ] **Step 2: Add the import at the top of the file**

At the top of `supabase/functions/game-action/actions/createRoom.ts`, add (alongside the other imports):

```ts
import { notifyNewRoom } from '../../_shared/telegram.ts';
```

- [ ] **Step 3: Verify no other imports moved by re-running the helper tests**

Run:
```bash
deno test supabase/functions/_shared/__tests__/telegram.test.ts
```

Expected: still `ok | 6 passed | 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/game-action/actions/createRoom.ts
git commit -m "feat(rooms): post Telegram notification when a room is created"
```

---

## Task 5: Operator runbook — bot, channel admin, secrets

This task does **not** touch code. It is the manual one-time setup the operator (Akula) runs after the code lands. List it as a checklist so subagent-driven execution doesn't try to automate it.

- [ ] **Step 1: Create the bot via BotFather**

In Telegram, DM `@BotFather`:
```
/newbot
```
Provide a display name (e.g. `Nägels Online`) and a username (e.g. `nagels_online_bot`). Copy the token from BotFather's reply — it looks like `123456:ABC-DEF1234ghIklzyx57W2v1u123ew11`.

- [ ] **Step 2: Add the bot as a channel admin**

Open the target Telegram channel (`-1001244338572`). Settings → Administrators → Add Administrator → search by the bot's username from Step 1 → grant **Post Messages** and nothing else.

- [ ] **Step 3: Set the three Edge Function secrets**

From the project root, with the Supabase CLI authenticated to the linked project:

```bash
supabase secrets set \
  TELEGRAM_BOT_TOKEN=<paste-token-from-step-1> \
  TELEGRAM_CHAT_ID=-1001244338572 \
  PUBLIC_APP_ORIGIN=https://nigels.online
```

Verify they registered:
```bash
supabase secrets list | grep -E 'TELEGRAM_|PUBLIC_APP_ORIGIN'
```

Expected: three lines listing the names (values are not displayed).

---

## Task 6: Deploy and smoke-test in production

- [ ] **Step 1: Deploy the edge function**

```bash
supabase functions deploy game-action
```

Expected: `Deployed Functions on project ...: game-action`.

- [ ] **Step 2: Smoke-test from the live site**

In a browser at `https://nigels.online`:
1. Sign in or continue as guest with a recognisable display name.
2. Click "Create room", choose any player count.
3. Within ~2 seconds, a message should appear in the Telegram channel: `🎮 <b>{hostName}</b> собирает стол на nigels.online` with a `Join` button.
4. Tap **Join** in Telegram — it should open `https://nigels.online/join/<code>` and drop you into the same waiting room.

- [ ] **Step 3: If the message did not arrive**

Inspect the function logs:
```bash
supabase functions logs game-action --tail 50
```
Look for `[telegram]` warnings. The most common causes (with what to check):
- `[telegram] sendMessage failed: status=401` — bot token is wrong or revoked. Re-run BotFather, regenerate, re-set the secret.
- `[telegram] sendMessage failed: status=400 description=Bad Request: chat not found` — `TELEGRAM_CHAT_ID` is wrong. The `-100…` prefix is required for supergroup/channel ids; verify by forwarding any channel message to `@JsonDumpBot` and reading `chat.id`.
- `[telegram] sendMessage failed: status=403 description=Bot is not a member of the channel chat` — Step 2 of the runbook was skipped or removed. Re-add the bot as admin with Post Messages permission.
- No `[telegram]` log line at all — `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` is unset (the helper silently no-ops in that case). Re-run `supabase secrets list` to confirm.

---

## Self-Review (post-write check)

Spec coverage:
- Architecture (inline call from `createRoom`) → Task 4. ✓
- `_shared/telegram.ts` with wire + event layers → Tasks 1, 2, 3. ✓
- Three env vars (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `PUBLIC_APP_ORIGIN`) → Task 5. ✓
- 3-second timeout, no retries, swallowed errors → Task 2 (`TG_TIMEOUT_MS`, try/catch around fetch). ✓
- Russian, minimum-text message format with Join button → Task 1 (`formatRoomMessage`) + Task 3 (`notifyNewRoom`). ✓
- HTML escape of host name → Task 1 (`escapeHtml`, used by `formatRoomMessage`). ✓
- No-op when secrets are unset (so `npm run demo` keeps working) → Task 2 (early return in `sendTelegram`). ✓
- Deno test for `formatRoomMessage` covering escaping and URL → Task 1 covers escaping and host-name interpolation; URL composition is split into the testable `buildJoinUrl` helper. ✓
- Smoke-test runbook → Task 6. ✓
- BotFather + channel-admin instructions → Task 5. ✓
