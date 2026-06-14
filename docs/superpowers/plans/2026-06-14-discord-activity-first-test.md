# Discord Activity — First Playable Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Nägels Online launch and be playable as a Discord Activity (desktop + mobile), guest mode, pointed at a Vercel preview deploy.

**Architecture:** Three small, Discord-gated modules under `src/lib/discord/` (context detection, URL-mapping builder, SDK bootstrap) wired into the existing `src/App.tsx` root behind a splash gate. All behavior is inert outside Discord, so normal web/PWA play is unaffected. Network to Supabase is routed through Discord's proxy via the Embedded App SDK's `patchUrlMappings`. Hosting target is a Vercel preview of the existing project; CSP `frame-ancestors` is added in `vercel.json`.

**Tech Stack:** Expo (React Native) + react-native-web, TypeScript, Supabase, `@discord/embedded-app-sdk`, Vercel, jest (ts-jest).

**Spec:** `docs/superpowers/specs/2026-06-14-discord-activity-first-test-design.md`

---

## File Structure

- Create: `src/lib/discord/context.ts` — detect whether we're inside a Discord Activity (pure + window wrapper).
- Create: `src/lib/discord/mappings.ts` — build the `patchUrlMappings` array from the Supabase URL (pure).
- Create: `src/lib/discord/bootstrap.ts` — apply URL mappings + init the SDK (`ready()`), lazy-importing the SDK so the module is import-safe in jest/native.
- Create: `src/lib/discord/__tests__/context.test.ts`, `src/lib/discord/__tests__/mappings.test.ts`.
- Modify: `src/App.tsx` — await `bootstrapDiscord()` behind a splash gate before rendering networked screens.
- Modify: `vercel.json` — add `headers` with CSP `frame-ancestors`.
- Modify: `.env.example` — document `EXPO_PUBLIC_DISCORD_CLIENT_ID`.

Manual (no code): Developer Portal config (Task 7), preview verification (Task 8), two-device play (Task 9), reactive mobile polish (Task 10).

---

## Task 1: Install SDK + document env var

**Files:**
- Modify: `package.json` (via install)
- Modify: `.env.example`

- [ ] **Step 1: Install the Embedded App SDK**

Run: `npm install @discord/embedded-app-sdk`
Expected: `package.json` gains `@discord/embedded-app-sdk` under dependencies; no peer-dep errors that block install.

- [ ] **Step 2: Document the new env var**

Add to `.env.example` (append near the other `EXPO_PUBLIC_*` entries):

```
# Discord Activity (Embedded App SDK) — client_id from the Discord Developer Portal.
# Only used when the app runs inside a Discord Activity; safe to leave blank otherwise.
EXPO_PUBLIC_DISCORD_CLIENT_ID=
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore(discord): add embedded-app-sdk dep + client_id env"
```

---

## Task 2: Discord context detection

**Files:**
- Create: `src/lib/discord/context.ts`
- Test: `src/lib/discord/__tests__/context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/discord/__tests__/context.test.ts
import { detectDiscordActivity } from '../context';

describe('detectDiscordActivity', () => {
  it('is true when a frame_id query param is present', () => {
    expect(detectDiscordActivity({ search: '?frame_id=abc&instance_id=1', hostname: 'localhost' })).toBe(true);
  });

  it('is true when hosted under discordsays.com', () => {
    expect(detectDiscordActivity({ search: '', hostname: '123456789.discordsays.com' })).toBe(true);
  });

  it('is false for a normal web host with no frame_id', () => {
    expect(detectDiscordActivity({ search: '?room=xyz', hostname: 'nigels.online' })).toBe(false);
  });

  it('is false for an empty location', () => {
    expect(detectDiscordActivity({ search: '', hostname: '' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/lib/discord/__tests__/context.test.ts`
Expected: FAIL — cannot find module `../context`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/discord/context.ts
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

/** Pure detection — testable without a real `window`. */
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/lib/discord/__tests__/context.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/discord/context.ts src/lib/discord/__tests__/context.test.ts
git commit -m "feat(discord): detect Discord Activity context"
```

---

## Task 3: URL-mapping builder

**Files:**
- Create: `src/lib/discord/mappings.ts`
- Test: `src/lib/discord/__tests__/mappings.test.ts`

Background: `patchUrlMappings([{ prefix, target }])` reroutes requests to
`target` (an external host) through `<origin>${prefix}`, which Discord's
proxy forwards to that host per the Developer Portal URL Mapping. Supabase
REST, Realtime WS, Edge Functions, Storage, and Auth all share one host,
so a single mapping covers every path. The `prefix` here MUST match the
prefix configured in the portal (`/supabase`).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/discord/__tests__/mappings.test.ts
import { buildDiscordMappings, DISCORD_SUPABASE_PREFIX } from '../mappings';

describe('buildDiscordMappings', () => {
  it('maps the Supabase host under the supabase prefix', () => {
    const mappings = buildDiscordMappings('https://abcde.supabase.co');
    expect(mappings).toEqual([{ prefix: DISCORD_SUPABASE_PREFIX, target: 'abcde.supabase.co' }]);
  });

  it('strips any path/port and keeps just the host', () => {
    const mappings = buildDiscordMappings('https://abcde.supabase.co/rest/v1');
    expect(mappings[0].target).toBe('abcde.supabase.co');
  });

  it('returns an empty array for a blank url', () => {
    expect(buildDiscordMappings('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/lib/discord/__tests__/mappings.test.ts`
Expected: FAIL — cannot find module `../mappings`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/discord/mappings.ts
/**
 * Build the URL-mapping list for the Discord Embedded App SDK's
 * `patchUrlMappings`. The prefix must mirror the Developer Portal config.
 */

export const DISCORD_SUPABASE_PREFIX = '/supabase';

export interface DiscordUrlMapping {
  prefix: string;
  target: string;
}

export function buildDiscordMappings(supabaseUrl: string): DiscordUrlMapping[] {
  if (!supabaseUrl) return [];
  try {
    const host = new URL(supabaseUrl).host;
    return [{ prefix: DISCORD_SUPABASE_PREFIX, target: host }];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/lib/discord/__tests__/mappings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/discord/mappings.ts src/lib/discord/__tests__/mappings.test.ts
git commit -m "feat(discord): build Supabase URL mappings for the proxy"
```

---

## Task 4: SDK bootstrap module

**Files:**
- Create: `src/lib/discord/bootstrap.ts`

The SDK is **lazy-imported** inside the async functions so this module is
import-safe in jest/native (the browser-only SDK never loads outside a
Discord context). `bootstrapDiscord()` applies the URL mappings *before*
initializing the SDK, and the App splash gate (Task 5) awaits it before
any networked screen mounts — closing the race with the lazy Supabase
singleton.

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/discord/bootstrap.ts
/**
 * Bootstrap Discord Activity integration: route network through the
 * Discord proxy, then bring up the Embedded App SDK. Entirely inert
 * outside a Discord Activity.
 */

import { isDiscordActivity } from './context';
import { buildDiscordMappings } from './mappings';

let patched = false;
let sdkReady = false;

async function applyDiscordUrlMappings(): Promise<void> {
  if (patched) return;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const mappings = buildDiscordMappings(supabaseUrl);
  if (mappings.length === 0) {
    console.warn('[Discord] No Supabase URL — skipping URL mappings');
    return;
  }
  const { patchUrlMappings } = await import('@discord/embedded-app-sdk');
  patchUrlMappings(mappings);
  patched = true;
  console.log('[Discord] URL mappings applied');
}

async function initDiscordSdk(): Promise<void> {
  if (sdkReady) return;
  const clientId = process.env.EXPO_PUBLIC_DISCORD_CLIENT_ID;
  if (!clientId) {
    console.warn('[Discord] EXPO_PUBLIC_DISCORD_CLIENT_ID not set — skipping SDK init');
    return;
  }
  const { DiscordSDK } = await import('@discord/embedded-app-sdk');
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();
  sdkReady = true;
  console.log('[Discord] SDK ready');
}

/**
 * Run once from the app root. Resolves immediately (no-op) outside Discord.
 * Inside Discord: maps URLs, then awaits the SDK handshake.
 */
export async function bootstrapDiscord(): Promise<void> {
  if (!isDiscordActivity()) return;
  await applyDiscordUrlMappings();
  await initDiscordSdk();
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `src/lib/discord/`.

- [ ] **Step 3: Verify the unit suite still imports cleanly**

Run: `npm run test:unit`
Expected: PASS — the existing suites plus Tasks 2–3 pass; no import-time crash from `bootstrap.ts` (it isn't imported by tests, but confirms nothing regressed).

- [ ] **Step 4: Commit**

```bash
git add src/lib/discord/bootstrap.ts
git commit -m "feat(discord): bootstrap URL mappings + SDK ready handshake"
```

---

## Task 5: Wire the splash gate into the app root

**Files:**
- Modify: `src/App.tsx`

Render a minimal splash until `bootstrapDiscord()` resolves, so the SDK's
`ready()` and `patchUrlMappings` complete before any Supabase call. Outside
Discord the gate opens synchronously (effect sets ready on first tick), so
normal web/PWA behavior is unchanged.

- [ ] **Step 1: Add the gate to `App()`**

In `src/App.tsx`, add imports near the existing imports:

```ts
import { useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { bootstrapDiscord } from './lib/discord/bootstrap';
import { isDiscordActivity } from './lib/discord/context';
```

Replace the body of `export default function App()` so the existing
`hydrate()` effect stays and a bootstrap gate is added:

```ts
export default function App() {
  const hydrate = useSettingsStore((s) => s.hydrate);
  // In Discord we must finish SDK ready() + URL mapping before networked
  // screens mount. Elsewhere the gate opens on the first effect tick.
  const [ready, setReady] = useState(!isDiscordActivity());

  useEffect(() => {
    hydrate();
    if (!ready) {
      bootstrapDiscord()
        .catch((e) => console.error('[Discord] bootstrap failed', e))
        .finally(() => setReady(true));
    }
    // ... keep the existing web viewport-height effect body below unchanged ...
```

Keep the rest of the existing `useEffect` body (the `Platform.OS === 'web'`
viewport CSS block) exactly as-is, and keep the existing return/providers.
Wrap the returned tree so the splash shows while `!ready`:

```ts
  return (
    <I18nextProvider i18n={i18n}>
      <SafeAreaProvider>
        {ready ? (
          <AppContent />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0b0f' }}>
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        )}
        <OAuthCollisionModal />
      </SafeAreaProvider>
    </I18nextProvider>
  );
```

Note: match the existing provider nesting in `src/App.tsx` — if the file
already wraps `AppContent` in `I18nextProvider`/`SafeAreaProvider`/
`OAuthCollisionModal`, only insert the `ready ? ... : <Splash/>` conditional
around `AppContent`; do not duplicate providers. Read the current return
block first and adapt minimally.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Confirm normal web play is unaffected (gate opens, no Discord)**

Run: `npm run smoke`
Expected: PASS — jest unit (incl. Tasks 2–3) + 9 smoke + 2 desktop-layout. The smoke run is a normal browser (no `frame_id`), so `isDiscordActivity()` is false, `ready` starts `true`, and the splash never shows.

Note: `smoke` needs the `:8081` dev server. If `lsof -i :8081` is empty, surface that as a blocker — do not start it for the user.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(discord): splash gate awaits Discord bootstrap at app root"
```

---

## Task 6: CSP frame-ancestors header

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add the `headers` block**

Add a `headers` array to `vercel.json` (alongside the existing
`buildCommand`/`outputDirectory`/`rewrites`):

```json
"headers": [
  {
    "source": "/(.*)",
    "headers": [
      {
        "key": "Content-Security-Policy",
        "value": "frame-ancestors https://discord.com https://*.discord.com https://*.discordsays.com"
      }
    ]
  }
]
```

- [ ] **Step 2: Validate the JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "chore(discord): allow Discord to frame the app (CSP frame-ancestors)"
```

---

## Task 7: Developer Portal configuration (manual, no code)

This is Phase 0 from the spec. No commit.

- [ ] **Step 1: Create the application**

At https://discord.com/developers/applications → New Application (e.g. "Nägels Online"). Copy the **Application ID** (this is the `client_id`).

- [ ] **Step 2: Enable Activities**

App → Activities → enable / "Getting Started". Under **URL Mappings** add:
- Root: prefix `/` → target = the Vercel **branch** host for `feat/discord-activity` (the stable per-branch alias, e.g. `nigels-app-v2-git-feat-discord-activity-<scope>.vercel.app` — found on the Vercel deployment page; it always points at the latest deploy of that branch, so the mapping survives each push).
- Supabase: prefix `/supabase` → target = the Supabase host (`<project>.supabase.co`, no scheme).

- [ ] **Step 3: Enable mobile platforms + orientation**

In the Activity settings, enable **iOS** and **Android** as supported platforms (default is often desktop-only). Set a default mobile orientation (start with the orientation the table uses today).

- [ ] **Step 4: Set the env var on the Vercel preview**

In the Vercel project settings → Environment Variables (Preview scope): add `EXPO_PUBLIC_DISCORD_CLIENT_ID` = the Application ID. Confirm `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` exist for Preview too (prod values).

- [ ] **Step 5: Record the IDs**

Note the Application ID in the spec's risks/notes section or a scratch file (do not commit secrets — the client_id is public-safe, the bot token is NOT and we don't need it).

---

## Task 8: Preview deploy + desktop verification (manual)

Phases 1–2 from the spec. No commit unless fixes are needed.

- [ ] **Step 1: Push the branch and get a preview**

```bash
git push -u origin feat/discord-activity
```

Confirm Vercel builds a preview. Open the preview URL **directly in a normal browser** — it should load the app as usual (proving the build is fine and `isDiscordActivity()` is false there).

- [ ] **Step 2: Confirm the preview is publicly reachable**

In Vercel project settings, ensure **Deployment Protection** is OFF for this preview (Discord's proxy fetches it unauthenticated). If a Vercel login wall appears at the preview URL in an incognito window, disable protection.

- [ ] **Step 3: Launch the Activity on desktop**

In the Discord desktop client, start the Activity in a voice channel (via the Activity shelf / "Launch Activity"). Expected: the app UI renders (no perpetual Discord loading spinner — proves `ready()` fired).

- [ ] **Step 4: Verify network through the proxy**

Inside the Activity, create a room and confirm Realtime state updates. Open the Activity devtools console (desktop client supports it) and confirm: no CSP violations, no blocked requests to `*.supabase.co`, and the Realtime `wss://` connection is established (rewritten through `/supabase`). If WS is NOT rewritten, revisit `patchUrlMappings` (it must patch `WebSocket`, not just `fetch`).

- [ ] **Step 5: If broken, debug then re-push**

Common fixes: missing/!matching `/supabase` prefix between portal and `mappings.ts`; `detectSessionInUrl` interfering (set it `false` when `isDiscordActivity()` in `src/lib/supabase/client.ts`); SPA rewrite dropping `frame_id` (confirm `vercel.json` rewrite preserves query string — it does by default). Commit any code fix on the branch and re-push.

---

## Task 9: Two-device playable test (manual)

Phase 3 from the spec. The success criterion for the whole effort.

- [ ] **Step 1: Open on two devices**

Launch the same Activity on desktop and on the phone (mobile Discord client, same account or a second account — either works since both are guests). 

- [ ] **Step 2: Join one room**

On desktop create a Nägels room; on the phone join it (via room code / share, exactly as today's guest flow).

- [ ] **Step 3: Play a full hand**

Play a complete hand desktop ↔ phone. Watch for: turn sync, Realtime liveness over the proxy on mobile, no idle disconnects.

- [ ] **Step 4: Note what broke**

Write down any mobile-specific breakage (layout cut off by notch, untappable cards, wrong orientation) — this feeds Task 10. No fix yet; just capture.

---

## Task 10: Reactive mobile polish (manual + small code)

Phase 4 from the spec. Only fix what Task 9 surfaced — the app is already
mobile-first, so expect little.

- [ ] **Step 1: Triage the Task 9 notes**

For each issue, decide: orientation-lock (portal + possibly `lockScreenOrientation` via SDK), safe-area inset (extend `SafeAreaView` edges), or touch-target sizing (existing component tweak).

- [ ] **Step 2: Apply the minimal fix per issue**

Make the smallest change that resolves it. Keep changes Discord-gated only if they would otherwise harm normal web play; safe-area/touch fixes usually help everywhere and need no gate.

- [ ] **Step 3: Re-verify on the phone**

Re-launch the Activity on the phone and confirm the issue is resolved and a hand is comfortable to play.

- [ ] **Step 4: Run smoke before any merge toward prod**

Run: `npm run smoke`
Expected: PASS — confirms the Discord gating and any polish didn't regress normal web play.

- [ ] **Step 5: Commit each fix**

```bash
git add <changed files>
git commit -m "fix(discord): <specific mobile issue> in Activity"
```

---

## Notes for the implementer

- **Branch:** all work lands on `feat/discord-activity` (create off `main`). The spec doc was committed on `feat/post-frame-capture`; cherry-pick it onto this branch if you want it co-located, or leave it — it's already in history.
- **testID hygiene:** this work adds no new `testID`s (splash is transient). If that changes, run `npm run test:lint` and surface orphans per CLAUDE.md.
- **No new external side effects:** guest room creation inside Discord uses the existing `gameClient`; `isAutomatedContext()` is unaffected. A manual solo test firing a real room notification is expected and fine.
- **Resource limits:** don't keep `expo start` / preview tooling running across tasks; this is a 24 GB machine with memory pressure.
