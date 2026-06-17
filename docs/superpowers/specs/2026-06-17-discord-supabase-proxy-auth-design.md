# Route Supabase through the Discord proxy in Activity mode

Date: 2026-06-17
Branch: feat/discord-activity
Status: design approved, pending spec review

## Problem

Inside a Discord Activity the Supabase **session does not work**: the auth
token refresh (`/auth/v1/token?grant_type=refresh_token`) hits the **direct**
host `https://<ref>.supabase.co` and is **CSP-blocked** (hard block in browser
Discord; on desktop the session never restores). Result: the user is
effectively unauthenticated → rating won't load, create-room silently bails,
bots won't start. The same account on `nigels.online` (normal web) works fine,
so the backend and the friend-invite feature are healthy — only the in-Activity
Supabase connection is broken.

Root cause: `src/lib/supabase/client.ts` builds the client with the **direct**
`EXPO_PUBLIC_SUPABASE_URL` and no custom `fetch`. Routing into the Discord proxy
relies entirely on `patchUrlMappings` monkeypatching the global `fetch`. The
realtime WebSocket is created late (after the patch) so it works; but gotrue's
`autoRefreshToken` fires the token-refresh fetch **early** — before/around the
patch — so it uses the unpatched direct URL and is CSP-blocked.

## Goal

In a Discord Activity, all Supabase traffic (auth + REST + realtime) goes
through the Discord proxy **by construction**, independent of `patchUrlMappings`
timing — so the session works. Zero behavior change outside Discord.

## Key fact (verified in the SDK)

`@discord/embedded-app-sdk`'s `matchAndRewriteURL` (`utils/url.mjs`) rewrites a
direct call `https://<target>/<path>` to
`${window.location.host}` + `${prefix}` + `/<path>`. With our mapping prefix
`DISCORD_SUPABASE_PREFIX = '/supabase'` (`src/lib/discord/mappings.ts`), that is
**`${window.location.origin}/supabase/<path>`** — note: **no `.proxy` segment**.
Realtime already works today via exactly this rewritten base, so pointing the
client's base URL there explicitly matches the proven path.

## Design

### 1. A single resolver: `resolveSupabaseUrl()`

New exported helper in `src/lib/supabase/client.ts`:

```ts
import { isDiscordActivity } from '../discord/context';
import { DISCORD_SUPABASE_PREFIX } from '../discord/mappings';

export function resolveSupabaseUrl(): string {
  if (isDiscordActivity() && typeof window !== 'undefined') {
    return `${window.location.origin}${DISCORD_SUPABASE_PREFIX}`; // e.g. https://<app>.discordsays.com/supabase
  }
  return process.env.EXPO_PUBLIC_SUPABASE_URL || '';
}
```

- `isDiscordActivity()` is synchronous and stable for the whole session
  (`frame_id` / `*.discordsays.com` check), so the URL is correct regardless of
  when the client is first created — this removes the timing fragility.
- Reuses `DISCORD_SUPABASE_PREFIX` so the client, the `patchUrlMappings`
  config, and the Developer Portal URL Mapping all agree on `/supabase`.
- Non-Discord (web and native): returns the existing `EXPO_PUBLIC_SUPABASE_URL`
  unchanged.

### 2. Use it where the base URL is consumed

- `src/lib/supabase/client.ts` — `getSupabaseClient()` calls
  `createClient(resolveSupabaseUrl(), supabaseAnonKey, { ... })` instead of the
  module-level direct `supabaseUrl`. This routes auth + REST + realtime through
  the proxy in Activity mode. (The `isSupabaseConfigured()` check still gates on
  the env vars being present.)
- `src/lib/discord/bootstrap.ts` — `runAuth()`'s fetch to
  `${supabaseUrl}/functions/v1/discord-auth` uses `resolveSupabaseUrl()` too,
  for consistency (currently direct + relies on the patch).

### 3. Keep `patchUrlMappings`

Leave the existing `applyDiscordUrlMappings()` call. It is harmless and still
catches any stray direct Supabase calls (e.g. third-party code). The fix does
not depend on it anymore, but removing it is out of scope.

## Non-goals (YAGNI)

- No change to the Developer Portal URL Mapping (the `/supabase` → host mapping
  already exists; realtime proves it).
- No removal of `patchUrlMappings`.
- No change to non-Discord behavior, the backend, or the invite feature.

## Affected files

- `src/lib/supabase/client.ts` — add `resolveSupabaseUrl()`; use it in
  `getSupabaseClient()`.
- `src/lib/discord/bootstrap.ts` — use `resolveSupabaseUrl()` in `runAuth()`.
- `src/lib/supabase/__tests__/` (new) — unit test for `resolveSupabaseUrl()`.

## Risks / verification

- **Realtime — low risk.** `patchUrlMappings` already rewrites the realtime WS
  to `wss://<origin>/supabase/realtime/v1` and it works today; the explicit base
  produces the identical URL. Still the one thing to eyeball in Discord.
- **Module-load ordering — resolved by design.** Because `resolveSupabaseUrl()`
  decides the URL at client-creation time from the synchronous
  `isDiscordActivity()`, it no longer matters whether the client is created
  before or after `patchUrlMappings`.
- **Native builds.** `window.location` only dereferenced inside the
  `isDiscordActivity()` branch (web-only), guarded by `typeof window`.
- **Verification:** pure unit test for `resolveSupabaseUrl()` (Discord →
  `${origin}/supabase`; non-Discord → env URL). `npm run ts:check`. Then the
  real check is the user in a live Discord Activity (desktop **and** browser):
  log in → rating shows → create a room → realtime updates flow.
