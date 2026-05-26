# Nägels Online — Security & Privacy Audit

**Date:** 2026-05-26
**Scope:** secrets, PII, RLS, SECURITY DEFINER hygiene, client-trust boundary, CORS, logs, recently-shipped features.

## CRITICAL findings
None. No service-role keys, bot tokens, or password secrets are committed; `.gitignore` correctly excludes `.env*`. The deployed `EXPO_PUBLIC_SUPABASE_ANON_KEY` decodes to an `anon` role JWT — safe to ship.

## HIGH findings

### H1. `switch_role` RPC granted to `anon`
`supabase/migrations/20260524000000_switch_role.sql:142`. The function correctly checks `auth.uid() IS NULL → auth_failed`, so the `GRANT … TO anon` is currently a no-op, but granting executable privileges to anonymous role is a defense-in-depth regression vs. peer RPCs (all `TO authenticated` only).
**Fix:** `REVOKE EXECUTE … FROM anon;`

### H2. `lookup_rating_recipient` is a low-cost email-existence oracle
`supabase/migrations/20260525000000_rating_transfers.sql:22-86`. Any authenticated user can probe whether any arbitrary email belongs to a registered Nägels account (`{found:true|false}`) and pull display name + avatar. No rate limit.
**Fix:** add per-`auth.uid()` rate limit (e.g. 30 lookups / 10 min) using a new `rpc_throttle` table.

### H3. PII (full email address) logged to client console
`src/lib/supabase/authService.ts:96,128,155`. `console.log('[AuthService] Signed in as', data.user.email)` writes the user's email into browser devtools and any remote log sink that captures `console`. Observable on shared/managed devices.
**Fix:** log `data.user.id` only, or mask: `email.replace(/(.).+(@)/, '$1***$2')`.

## MEDIUM findings

### M1. CORS wildcard on edge function
`supabase/functions/_shared/cors.ts:2`. `Access-Control-Allow-Origin: *` lets any origin POST to `game-action`. JWT verification still protects mutations (no cookies = low CSRF risk), but weakens defense in depth.
**Fix:** echo only `https://nigels.online`, `https://*.vercel.app`, `http://localhost:8081`.

### M2. `feedback` table accepts unauthenticated inserts with FK to `auth.users`
`supabase/migrations/20260516185139_remote_schema_baseline.sql:1412`. Policy `feedback_insert_anyone … WITH CHECK (true)` allows anon writes. No rate limit, no validation that `player_id` matches `auth.uid()`.
**Fix:** `WITH CHECK (player_id IS NULL OR player_id = auth.uid())` + per-IP rate-limit trigger.

### M3. `adminGrantTelegram` does not validate target user existence
`supabase/functions/game-action/actions/adminGrantTelegram.ts:22-25`. Upsert succeeds for any UUID; the FK violation surfaces as generic 500. Operational not security, but worth a pre-check.
**Fix:** select from `auth.users` first; return `{error:'user_not_found'}` cleanly.

### M4. `release-announce.txt` untracked in repo root
Content is benign release notes, no secrets. Risk is "accidentally `git add .`".
**Fix:** add `release-*.txt` to `.gitignore` or move under `docs/releases/`.

## LOW findings

### L1. `search_auth_users_by_email` uses unescaped `ILIKE`
`supabase/migrations/20260523000003_stakes_search_auth_users.sql:13`. Doesn't escape `%`/`_`. Admin-only, low impact.
**Fix:** escape with `replace(replace(p_q, '\', '\\'), '%', '\%')` + `ESCAPE '\'`.

### L2. Telegram message body uses client-supplied `display_name`
`supabase/functions/game-action/actions/createRoom.ts:140`. HTML-escaped, so no injection — but a user can impersonate any name in the Telegram announce.
**Fix:** read `display_name` from `room_sessions` row, not from request body.

### L3. Auth flow stores session JWT in plaintext localStorage
Standard Supabase pattern; acceptable. Worth noting in threat model that local malware can grab the JWT.

### L4. `get_my_active_room` returns room without checking kick state
If a session row lingers in `room_players` after host-kick (race), the kicked user could re-discover. UX bug, not privilege leak.
**Fix:** verify with `leaveRoom`/host-kick paths that seat row is fully deleted.

## Audited and clean

- Secret hygiene: `.env*` properly gitignored; no `service_role`/bot-token/private VAPID in `src/`, `supabase/`, `scripts/`, or git history.
- All 36 `SECURITY DEFINER` functions across migrations set `search_path = public, pg_catalog`.
- `get_auth_user_info`, `search_auth_users_by_email` correctly `REVOKE FROM anon, authenticated, PUBLIC` (service-role only).
- `transfer_rating` correctness: `auth.uid()` gate, self-transfer rejected, amount ≥ 1, deterministic lock order, atomic update+journal. **Cannot drain another user's balance.**
- `telegram_announce_allowlist` privilege escalation: RLS enabled + zero policies + mutations only via admin actions gated on `isAdminEmail`. Server-side gate in `createRoom.isCallerAllowedToAnnounce` refuses client-supplied `announce: true` without permission.
- Edge action auth: `auth.ts:authenticate` verifies Bearer JWT via `userClient.auth.getUser(token)`. `actor.session_id` is server-derived from `auth_user_id`.
- RLS table coverage: all 15 user-data tables have `ENABLE ROW LEVEL SECURITY`.
- Telegram secret handling: `TELEGRAM_BOT_TOKEN` from `Deno.env`, never logged. `sendTelegram` redacts bot-token-shaped substrings from error messages.
- HTTPS: no plain `http://` requests in `src/` (only localhost dev URLs).
- Admin-action consistency: all `admin_*` call `isAdminEmail(au?.email, ADMIN_EMAILS)` before state change.
- Client trust on game state: all score/balance/rating mutations through SQL RPCs — no client-supplied deltas accepted.

## Top three to action this week
1. **H2** rate-limit `lookup_rating_recipient`
2. **H3** stop logging user email
3. **H1** revoke `switch_role` from anon
