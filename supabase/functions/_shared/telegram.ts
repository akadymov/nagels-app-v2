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
  const chatId = opts.chatId || Deno.env.get('TELEGRAM_CHAT_ID');
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
    const raw = err instanceof Error ? err.message : String(err);
    // Bot tokens look like 123456789:AAGm... — they ride in the URL path,
    // so any fetch error string referring to the URL leaks the token.
    const msg = raw.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<redacted>');
    console.warn(`[telegram] sendMessage threw: ${name}: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

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
