/**
 * Detect whether the app is running inside a Discord Activity.
 *
 * Discord launches Activities with a `frame_id` query param and serves
 * them from `<client_id>.discordsays.com`. Either signal is sufficient.
 */

export interface LocationLike {
  search: string;
  hostname: string;
}

/**
 * Pure detection — testable without a real `window`.
 *
 * Either signal is treated as sufficient (OR), matching how the SDK itself
 * keys off `frame_id`. In a real Activity both are present (served from
 * `*.discordsays.com` with a `frame_id`), so this is robust. The tradeoff:
 * a hand-crafted/shared link carrying `?frame_id=...` on a non-Discord host
 * would mis-detect — an obscure footgun we accept for reliable detection
 * during the first Activity test.
 */
export function detectDiscordActivity(loc: LocationLike): boolean {
  try {
    const params = new URLSearchParams(loc.search);
    if (params.get('frame_id')) return true;
  } catch {
    // ignore malformed search strings
  }
  return loc.hostname.endsWith('.discordsays.com');
}

/** Runtime check against the real browser location. False on native / SSR. */
export function isDiscordActivity(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  return detectDiscordActivity(window.location);
}
