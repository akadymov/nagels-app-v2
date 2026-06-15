# Discord Auth — Unified Persistent Account (Design)

Date: 2026-06-15
Status: Draft for review
Branch: `feat/discord-activity` (continue)
Follows: `2026-06-14-discord-activity-first-test-design.md`, `2026-06-14-discord-ui-adaptation-design.md`

## Goal

Stop asking a Discord-authenticated user to log in again. When Nägels runs as
a Discord Activity, identify the player from their Discord account, resolve them
to a **single persistent Supabase account** (so rating/stats persist across
sessions and devices), and unlock the Discord SDK features that require an
authenticated session (the native invite dialog, participant APIs). A person who
plays on the web with Google and in Discord should be the **same account** when
their verified email matches.

This is the "full" auth track (chosen over the additive guest-only variant).

## Decisions (locked in brainstorm)

| Topic | Decision |
|---|---|
| Depth | **Full** — persistent account keyed to the Discord identity, not a throwaway guest overlay |
| Cross-surface identity | **Unified by verified email** — Discord links to an existing Supabase user (e.g. a Google account) when the verified email matches; otherwise a new account is created |
| Session model | The player is signed into a **real, stable Supabase user** (its own `user_id` → its own `user_ratings` row), not an anonymous session |
| In-app auth UI in Discord | Hidden — identity comes from Discord; no second login/profile-name prompt |
| Scope of "unify" | Best-effort on verified email match only. No manual account-merge UI, no fuzzy matching |

## Why email is the join key

There is no automatic way to know a Discord user and a Google user are the same
person except a shared, provider-verified email. Discord OAuth (scopes
`identify email`) returns the user's email and a `verified` flag; Google accounts
in Supabase are keyed by email. So the unification rule is the industry-standard
"link accounts with the same verified email." Supabase does this natively for its
own OAuth providers, but our Discord flow is custom (SDK code-grant, not a browser
redirect), so we replicate the rule ourselves in the edge function.

## Architecture

Two cooperating pieces, both gated to Discord; web/PWA auth is untouched.

### 1. `supabase/functions/discord-auth` (new edge function)

Server-side because it needs the Discord **client secret** and the Supabase
**service-role** key — neither can live in the client.

Input (POST, from the Activity client): `{ code }` — the authorization code from
the SDK's `authorize()`.

Steps:
1. **Exchange** `code` with Discord's token endpoint (`client_id` +
   `client_secret`, `grant_type=authorization_code`) → Discord `access_token`.
2. **Fetch profile** from `GET /users/@me` with that token → `discord_id`,
   `username`/`global_name`, `avatar`, `email`, `verified`.
3. **Resolve the Supabase user** (service-role admin client):
   - If `email` present and `verified` → look up an existing auth user by that
     email. If found → this is the account; ensure `discord_id` is recorded in its
     `user_metadata` (link). If not found → create a new user with that email.
   - If no verified email (user declined the email scope) → resolve by
     `discord_id` alone (find a prior Discord-created user with this `discord_id`,
     else create an emailless user). Persistent by `discord_id`, just not unified
     with any Google account.
   - On create/link, set `user_metadata` from the Discord profile (display name,
     avatar URL, `discord_id`, `discord_username`).
4. **Mint a Supabase session** for the resolved user and return its tokens. (See
   "Session minting" — validate the exact mechanism in the plan.)
5. **Return** `{ supabase: { access_token, refresh_token }, discord_access_token,
   profile: { display_name, avatar_url, discord_id } }`.

The function never returns the Discord client secret or the service-role key.

### 2. Client flow (Discord-gated, in the bootstrap path)

Extends `src/lib/discord/` (the existing bootstrap). When `isDiscordActivity()`:
1. `sdk.commands.authorize({ client_id, response_type: 'code', scope: ['identify','email'], prompt: 'none' })` → `code`. (`prompt: 'none'` reuses prior consent so it's silent after the first grant.)
2. POST `code` → `discord-auth` → receive the bundle.
3. `supabase.auth.setSession({ access_token, refresh_token })` → the app is now
   authenticated as the persistent account (replaces the anonymous session used
   elsewhere).
4. `sdk.commands.authenticate({ access_token: discord_access_token })` → unlocks
   the Discord SDK's authenticated commands (invite dialog, participants).
5. Apply the Discord `profile` to the app's identity (display name + avatar) used
   in rooms.

This runs as part of `bootstrapDiscord()` (before networked screens mount, behind
the existing splash gate), so room actions already carry the persistent session.

### Two tokens — keep them distinct

- **Discord access token** — only for `sdk.commands.authenticate()` and Discord
  APIs. Lives in memory; not persisted.
- **Supabase session** — for our backend/RLS, persisted by the Supabase client as
  usual (survives refresh). Refresh handled by Supabase normally.

## Identity / profile wiring

- In Discord, `display_name` + avatar shown to other players come from the Discord
  profile (its `username`/`global_name` and avatar). The in-app nickname editor
  and Google sign-in prompt are hidden in Discord (gated by `isDiscordActivity()`),
  removing the double-login the user complained about.
- Avatars: Discord avatar URLs are on `cdn.discordapp.com`; confirm they load
  inside the Activity CSP (Discord's own domains are generally allowed; add a URL
  mapping only if blocked).
- The ➕ invite button (already built) starts working once `authenticate()` has run.

## Session minting (mechanism to validate in the plan)

Supabase has no public "give me tokens for this user" admin call. The robust,
widely-used pattern: the edge function sets/uses a **deterministic server-only
password** for the resolved user (e.g. `HMAC(user_id, AUTH_SIGNING_SECRET)`), then
performs a server-side `signInWithPassword` to obtain a real access+refresh token
pair, which it returns to the client. The password is never exposed to the client
and is recomputable, so it works across logins. The plan must verify this against
the installed Supabase version and fall back to `admin.generateLink` (magic-link
verify) if needed.

## Error & edge cases

- **User declines `authorize`** → no Discord session; fall back to the current
  anonymous-guest flow inside Discord (they can still play as a guest). Surface
  nothing scary.
- **Declines `email` scope** → persistent by `discord_id`, no Google unification.
- **Unverified Discord email** → treat as no email (don't unify on it).
- **Token exchange / network failure** → log, fall back to anonymous guest; the
  splash gate must still open (don't trap the user — mirror the `sdk.ready()`
  timeout pattern).
- **Email matches an existing user that already has a *different* `discord_id`** →
  keep the existing link; log the anomaly (shouldn't happen in practice).

## Security & privacy

- Linking by **verified** email only (both Discord and the existing account
  verify email), which is the safe, standard account-linking criterion.
- `DISCORD_CLIENT_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are edge-function secrets
  (env), never shipped to the client.
- The `discord-auth` function validates the `code` came from our app and rate-
  limits abuse (reuse the existing `rpc_throttle` pattern or a per-IP guard).
- **Privacy Policy** must be updated: we now process Discord email + profile and
  use email to unify accounts. Fold into the existing "Update legal drafts before
  verification" backlog item.

## Out of scope (separate / later)

- Manual "link my Discord to my web account" opt-in UI (not needed — email match
  is automatic; the no-email-match case stays separate).
- Merging two *already-separate* accounts (different emails) into one.
- Changes to the rating/stakes logic itself (we only ensure a stable `user_id`).
- The leave/exit lifecycle track (its own spec).

## Testing & verification

- Unit-test the pure pieces: email/discord_id resolution logic (find vs create vs
  link) with a mocked admin client; the client bundling/sequence (authorize →
  exchange → setSession → authenticate) with mocks. Keep the SDK + network behind
  seams so tests run in jest's node env.
- `isDiscordActivity()`-gated → `npm run smoke` (web, no Discord) must stay green:
  web still uses anonymous/guest + Google exactly as before.
- Manual in Discord (via the tunnel build): first launch shows at most one Discord
  consent, then no app login; play a hand; confirm rating persists across a
  relaunch and across desktop↔phone for the same Discord user; confirm the ➕
  invite dialog now opens. If the same person signs in on web with the matching
  Google email, confirm it's the same account/rating.

## Notes / risks

- **Session minting is the #1 technical risk** — the plan starts by proving the
  mint mechanism in isolation before building the rest.
- **`prompt: 'none'`** must be confirmed to suppress repeat consent inside the
  Activity; if not, accept a one-time consent screen.
- Deploying the `discord-auth` function and setting its secrets requires Supabase
  access (the function targets PROD Supabase, the same the Activity proxies to).
