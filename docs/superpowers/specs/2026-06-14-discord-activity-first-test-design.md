# Discord Activity — First Playable Test (Design)

Date: 2026-06-14
Status: Approved for planning
Branch: `feat/discord-activity` (to be created off `main`)

## Goal

Get Nägels Online running as a **Discord Activity** that loads and is
**playable** — on desktop **and** mobile (Android, ideally iOS) — well
enough that a single person can launch it on two devices, join one room,
and play a full hand desktop ↔ phone.

This is the first integration step after the realtime-over-proxy spike
(resolved 2026-06-14, 🟢 GO: Supabase WS survives the Discord proxy,
rtt ~45ms, no idle drop). The spike proved the network mechanism; this
project wires it into the real app.

### Explicit non-goals (deferred to a later "full SDK" phase)

- **No Discord auth.** Players enter as guests, exactly as today. No
  Discord nick/avatar, no `authorize`/`authenticate` handshake.
- **No auto-room from voice channel.** No pulling channel participants
  into a room. The player creates/joins a room by hand in the normal UI.
- **No production rollout.** The Activity points at a Vercel **preview**
  deploy, not `nigels.online`. Prod stays untouched.
- **No deep mobile polish up front.** Mobile gets fixed reactively —
  only what actually blocks playability in the two-device test.

## Decisions (locked during brainstorming)

| Dimension | Decision |
|---|---|
| Success criterion | Game loads and a hand is playable, 2 devices |
| Testers | Solo (owner only — no tester allowlist needed) |
| Mobile | Playable on mobile in the first pass, not desktop-only |
| Activity URL target | **Vercel preview** of the existing project (branch deploy), not a new project, not prod |
| Supabase proxying | `patchUrlMappings` from the Embedded App SDK + URL Mappings in the Developer Portal |
| Entry UX inside Discord | Normal app, guest mode, manual room create/join |

**Why Vercel preview of the same project:** preview deploys live inside
the existing `nigels-app-v2` project — they are not a new Project and
should not consume a separate "slot," sidestepping the reported Vercel
free-tier limit. If that assumption turns out wrong, the fallback is a
**Cloudflare Tunnel → local `expo start --web`** (free, no Vercel, stable
named subdomain). The design keeps the Discord-specific code
host-agnostic so switching the target is a config change, not a rewrite.

## Architecture

A Discord Activity is our existing **web build** (`expo export --platform
web`) loaded inside a sandboxed iframe served from
`<client_id>.discordsays.com`, which proxies to our real host. The
sandbox enforces a strict CSP: **every external request must go through
the Discord proxy**, or the browser blocks it.

Three integration surfaces, all gated behind an `isDiscordActivity()`
check so nothing changes for normal web/PWA players:

1. **Discord context detection** — `src/lib/discord/context.ts`
   - `isDiscordActivity()`: true when launched inside Discord. Detect via
     the `frame_id` query param Discord injects, or
     `location.hostname.endsWith('discordsays.com')`.
   - Cheap, synchronous, no SDK dependency — safe to call anywhere,
     including before the SDK is initialized.

2. **SDK bootstrap + URL proxying** — `src/lib/discord/bootstrap.ts`
   - On module load, **if** `isDiscordActivity()`: synchronously call
     `patchUrlMappings([...])` so it patches global `fetch`/`WebSocket`/
     `XMLHttpRequest` **before** the Supabase singleton issues any
     request.
   - Expose `initDiscord()` (async) that does `new DiscordSDK(CLIENT_ID)`
     then `await sdk.ready()`. Called once from the app root; the root
     shows a splash until it resolves.
   - Guard: only construct `DiscordSDK` inside a real Activity — outside
     Discord the constructor's handshake (it needs `frame_id`/
     `instance_id` from the URL) would hang.

3. **App root wiring** — the existing root component (Expo Router
   `app/_layout.tsx` or `App.tsx`, whichever is the real entry)
   - Awaits `initDiscord()` before rendering networked screens when in a
     Discord context; renders a lightweight splash meanwhile.
   - Passes `isDiscordActivity()` down (or via a small context/store) so
     layout can adapt (hide browser-only chrome, apply orientation/safe-
     area tweaks in Phase 4).

### URL Mappings

Configured in **both** the Developer Portal (authoritative) and mirrored
in the `patchUrlMappings` call:

| Prefix | Target | Covers |
|---|---|---|
| `/` | Vercel preview branch host | the app itself (HTML, JS, assets) |
| `/supabase` (example) | `<project>.supabase.co` | REST, Realtime WS, Edge Functions, Storage, Auth — all share one host, so **one mapping** covers every path (`/rest/v1`, `/realtime/v1`, `/functions/v1`, `/storage/v1`, `/auth/v1`) |

The Supabase client URL in `client.ts` stays as-is (full
`https://<project>.supabase.co`). `patchUrlMappings` rewrites outgoing
requests to that host into `/.proxy/supabase/...`, which Discord proxies
to the target. Minimal change to `client.ts`; the patch lives at the app
boundary.

Note: set `detectSessionInUrl: false` when in a Discord context — the
Activity URL carries Discord's own query params and we have no email-
confirm redirect flow inside Discord (guest only).

### CSP / framing (`vercel.json`)

Add a `headers` block so the proxied content may be framed by Discord:

```
Content-Security-Policy: frame-ancestors https://discord.com https://*.discord.com https://*.discordsays.com
```

No `X-Frame-Options: DENY` (none today — keep it that way).

## Environment

Preview deploy needs, in Vercel project env (Preview scope):
- `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` — prod values.
- `EXPO_PUBLIC_DISCORD_CLIENT_ID` — **new**, from the Developer Portal.

## Phases & success criteria

**Phase 0 — Discord application (Developer Portal, no code, ~30 min)**
- Create application; enable Activities (Embedded App SDK).
- URL Mappings: `/` → Vercel preview **branch** host (stable per-branch
  alias `nigels-app-v2-git-feat-discord-activity-<scope>.vercel.app`, so
  the mapping survives each push), `/supabase` → Supabase host.
- Enable supported platforms incl. **iOS/Android** (default is often
  desktop-only); set default mobile orientation.
- Owner can launch unapproved activities — no tester allowlist needed.
- Done when: the Activity appears launchable for the owner.

**Phase 1 — minimal embed loads**
- Create `feat/discord-activity`; ensure the branch produces a publicly
  reachable preview (no Vercel Deployment Protection on it — Discord's
  proxy must fetch it unauthenticated).
- Install `@discord/embedded-app-sdk`; add `context.ts` + `bootstrap.ts`;
  wire `initDiscord()` + splash into the root; add CSP header.
- Done when: launching the Activity on **desktop** shows the app UI (a
  Supabase screen may still error — network comes in Phase 2).

**Phase 2 — network through the proxy**
- Add `patchUrlMappings` for the Supabase host; set `detectSessionInUrl`
  gate.
- Done when: on desktop inside the Activity you can create a room and see
  Realtime state tick (no CSP/network errors in console).

**Phase 3 — playable, two devices, solo**
- Open the same Activity on a phone (mobile Discord), join the room
  created on desktop, play a full hand desktop ↔ phone.
- Done when: a hand completes end-to-end across the two devices.

**Phase 4 — reactive mobile polish**
- Fix only what blocked Phase 3: orientation lock, safe-area insets,
  touch-target sizing. App is already mobile-first, so expected to be
  small.
- Done when: the two-device game is comfortable on the phone.

## Testing / verification

- This is exploratory integration, not a smoke-gated feature. No new
  jest/Playwright coverage is required to call the first test done.
- Before any later merge toward prod, run `npm run smoke` to confirm the
  Discord gating didn't regress normal web play (the `isDiscordActivity()`
  guards must be inert outside Discord).
- Side-effect hygiene: guest entry inside Discord still creates rooms via
  `gameClient`; verify the existing `isAutomatedContext()` / `silent`
  path is unaffected (we are not automated here — real notifications are
  expected and fine for a manual solo test).

## Risks & open questions

- **Vercel preview slot/limit** — if branch previews are themselves
  blocked (not just new projects), fall back to Cloudflare Tunnel. The
  code is host-agnostic, so only the URL Mapping + env change.
- **Deployment Protection** — Vercel may gate preview URLs behind auth;
  Discord's proxy can't authenticate. Must confirm the preview is public.
- **SDK handshake outside Discord** — `DiscordSDK` construction must be
  strictly guarded by `isDiscordActivity()` or it hangs in a normal
  browser. Covered by the gate; call out in the plan as a verification
  point.
- **Realtime WS host** — confirm `patchUrlMappings` rewrites the
  `wss://<project>.supabase.co/realtime/...` socket and not just `fetch`.
  The spike says WS works through the proxy; verify the patch targets it.
- **Expo Router SPA rewrite** — `vercel.json` already rewrites all routes
  to `/`; confirm the Discord query params survive that rewrite so
  `isDiscordActivity()` still sees `frame_id`.
```
