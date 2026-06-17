# Discord-auth: non-clobbering session mint

Date: 2026-06-17
Branch: main
Status: design approved

## Problem

`supabase/functions/discord-auth/index.ts` mints the Supabase session by
**resetting the user's password** to a deterministic HMAC on *every* Discord
login (`derivePassword` → `admin.updateUserById({ password })` →
`signInWithPassword`). Side effect: a user who registered on the web with
email + their own password, then logs in via Discord (unified by verified
email), has their real password **overwritten**. Web email/password login then
fails with `invalid credentials`; Google still works (OAuth ignores the
password). And it recurs — every Discord login re-clobbers, so even a web
password reset won't stick.

## Goal

Mint the Discord session **without touching the user's password**, so web
email/password login keeps working. Identity resolution / email-unification
unchanged.

## Design

Replace the mint step (`index.ts` ~lines 105–124) with a magic-link mint:

1. Keep resolve/create + the "ensure a sign-in email" step (synthetic
   `discord_<id>@users.nagels.internal` for emailless users stays — needed so
   `generateLink` has an email to target).
2. `admin.auth.admin.generateLink({ type: 'magiclink', email: signEmail })` →
   read `data.properties.email_otp`.
3. `anon.auth.verifyOtp({ email: signEmail, token: email_otp, type: 'email' })`
   → `data.session` (access + refresh tokens). No password write.
4. Return the same shape: `{ ok, supabase: {access_token, refresh_token},
   discord_access_token, profile }`.

Remove:
- `import { derivePassword } from './mint.ts'` and the `updateUserById({password})`
  call.
- `mint.ts` itself (only `index.ts` imports it) — delete.
- `DISCORD_AUTH_SIGNING_SECRET` from the `REQUIRED_ENV` list (no longer used).
  The secret can remain set in prod; it's just no longer required.

## Affected users (one-time recovery)

The old flow already overwrote affected users' passwords with the HMAC value.
This fix stops *future* clobbering but does not restore the original password.
Affected users (incl. Akula) must do **one** web "forgot password" → set a new
password after the fix ships; from then on it persists (Discord login no longer
touches it).

## Risk

Minting is the historical #1 risk. The one uncertainty is the exact `verifyOtp`
`type` for a magic-link OTP — using `'email'`; the alternative is `'magiclink'`.
The edge function can't be fully exercised locally (Deno + real Supabase), so
verification is manual on prod after deploy.

## Testing / verification

- Pure-helper Deno/jest tests for `discord.ts` / `resolve.ts` stay green
  (untouched). No dedicated `derivePassword` test exists to remove.
- Manual on prod after `supabase functions deploy discord-auth`:
  1. Web email/password login works (use a fresh password reset).
  2. Discord login still mints a session (name/avatar/rating, invite works).
  3. After a Discord login, the web password STILL works (no re-clobber).

## Out of scope

- Restoring already-overwritten passwords (impossible — one-time reset instead).
- Any change to the client, web auth UI, or the resolve/unify logic.
