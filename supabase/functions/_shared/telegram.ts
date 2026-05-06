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
