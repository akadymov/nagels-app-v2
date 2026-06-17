# Route Supabase through the Discord proxy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a Discord Activity, build the Supabase client (and the discord-auth fetch) from a proxied base URL (`${origin}/supabase`) so auth/REST/realtime go through the Discord proxy and the session works; zero change outside Discord.

**Architecture:** A tiny pure resolver `resolveSupabaseUrl()` in its own module (imports only the light `discord/context` + `discord/mappings`, no react-native/supabase-js) returns the proxied origin path inside a Discord Activity and the direct `EXPO_PUBLIC_SUPABASE_URL` otherwise. The Supabase client and `runAuth()` consume it. Decided synchronously at client-creation time via `isDiscordActivity()`, so it no longer depends on `patchUrlMappings` timing.

**Tech Stack:** Expo RN + TS, @supabase/supabase-js, @discord/embedded-app-sdk, jest (pure-logic tests only). No RN component-test harness — verification is jest + `ts:check` + a live Discord check by the user.

**Spec:** `docs/superpowers/specs/2026-06-17-discord-supabase-proxy-auth-design.md`

---

## File structure

- `src/lib/supabase/resolveUrl.ts` (new) — `resolveSupabaseUrl()`. Imports only `isDiscordActivity` (`../discord/context`) and `DISCORD_SUPABASE_PREFIX` (`../discord/mappings`).
- `src/lib/supabase/__tests__/resolveUrl.test.ts` (new) — unit test.
- `src/lib/supabase/client.ts` — use `resolveSupabaseUrl()` in `getSupabaseClient()`.
- `src/lib/discord/bootstrap.ts` — use `resolveSupabaseUrl()` in `runAuth()`.

---

### Task 1: `resolveSupabaseUrl()` resolver (TDD)

**Files:**
- Create: `src/lib/supabase/resolveUrl.ts`
- Create: `src/lib/supabase/__tests__/resolveUrl.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/supabase/__tests__/resolveUrl.test.ts`:

```ts
jest.mock('../../discord/context', () => ({ isDiscordActivity: jest.fn() }));
import { isDiscordActivity } from '../../discord/context';
import { resolveSupabaseUrl } from '../resolveUrl';

describe('resolveSupabaseUrl', () => {
  const origEnv = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const origWindow = (global as any).window;
  afterEach(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = origEnv;
    (global as any).window = origWindow;
    jest.resetAllMocks();
  });

  it('returns the direct env URL outside Discord', () => {
    (isDiscordActivity as jest.Mock).mockReturnValue(false);
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co';
    expect(resolveSupabaseUrl()).toBe('https://ref.supabase.co');
  });

  it('returns the proxied origin path inside a Discord Activity', () => {
    (isDiscordActivity as jest.Mock).mockReturnValue(true);
    (global as any).window = { location: { origin: 'https://1234.discordsays.com' } };
    expect(resolveSupabaseUrl()).toBe('https://1234.discordsays.com/supabase');
  });

  it('falls back to the env URL in Discord if window is unavailable', () => {
    (isDiscordActivity as jest.Mock).mockReturnValue(true);
    (global as any).window = undefined;
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co';
    expect(resolveSupabaseUrl()).toBe('https://ref.supabase.co');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- resolveUrl`
Expected: FAIL — module `../resolveUrl` not found.

- [ ] **Step 3: Implement the resolver**

Create `src/lib/supabase/resolveUrl.ts`:

```ts
import { isDiscordActivity } from '../discord/context';
import { DISCORD_SUPABASE_PREFIX } from '../discord/mappings';

/**
 * The Supabase base URL to build the client (and the discord-auth fetch) from.
 *
 * Inside a Discord Activity, return the proxied path on the Activity origin
 * (`${origin}/supabase`) — the exact form `patchUrlMappings` rewrites direct
 * Supabase calls to (and that realtime already uses). This routes auth + REST
 * + realtime through the Discord proxy by construction, so it does not depend
 * on the global `fetch` patch having been applied yet.
 *
 * Everywhere else (web, native), return the direct `EXPO_PUBLIC_SUPABASE_URL`
 * unchanged.
 */
export function resolveSupabaseUrl(): string {
  if (isDiscordActivity() && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${DISCORD_SUPABASE_PREFIX}`;
  }
  return process.env.EXPO_PUBLIC_SUPABASE_URL || '';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- resolveUrl`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/resolveUrl.ts src/lib/supabase/__tests__/resolveUrl.test.ts
git commit -m "feat(supabase): resolveSupabaseUrl — proxied base inside Discord"
```

---

### Task 2: Use the resolver in the Supabase client

**Files:**
- Modify: `src/lib/supabase/client.ts` (import + line 39)

- [ ] **Step 1: Add the import**

In `src/lib/supabase/client.ts`, after the existing imports (below the `AsyncStorage` import, ~line 9), add:

```ts
import { resolveSupabaseUrl } from './resolveUrl';
```

- [ ] **Step 2: Build the client from the resolved URL**

In `getSupabaseClient()`, change the `createClient` call (line ~39) from:

```ts
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
```

to:

```ts
    supabaseClient = createClient(resolveSupabaseUrl(), supabaseAnonKey, {
```

Leave everything else (the module-level `supabaseUrl`/`supabaseAnonKey`, the
`if (!supabaseUrl || !supabaseAnonKey)` guard, the `auth`/`realtime` options)
unchanged — the guard still correctly requires the env vars to be present, and
`EXPO_PUBLIC_SUPABASE_URL` is set in the Discord build too.

- [ ] **Step 3: Typecheck**

Run: `npm run ts:check`
Expected: no new `src/` errors (pre-existing `supabase/functions/*` Deno errors are baseline).

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/client.ts
git commit -m "feat(supabase): build client from resolveSupabaseUrl (Discord proxy)"
```

---

### Task 3: Use the resolver in `runAuth()`

**Files:**
- Modify: `src/lib/discord/bootstrap.ts` (import + line 72)

- [ ] **Step 1: Add the import**

In `src/lib/discord/bootstrap.ts`, after the existing imports (below the
`runDiscordAuth` import, ~line 9), add:

```ts
import { resolveSupabaseUrl } from '../supabase/resolveUrl';
```

- [ ] **Step 2: Resolve the URL for the discord-auth fetch**

In `runAuth()`, change line ~72 from:

```ts
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
```

to:

```ts
  const supabaseUrl = resolveSupabaseUrl();
```

This makes the `exchange` fetch hit `${supabaseUrl}/functions/v1/discord-auth`
through the proxy (`${origin}/supabase/functions/v1/discord-auth`) inside
Discord. The `anonKey` line and everything else stay unchanged. (`setSession` /
`getUser` already go through `getSupabaseClient()`, which is fixed by Task 2.)

- [ ] **Step 3: Typecheck**

Run: `npm run ts:check`
Expected: no new `src/` errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/discord/bootstrap.ts
git commit -m "feat(discord): runAuth uses the proxied Supabase URL"
```

---

### Task 4: Gate + verification

- [ ] **Step 1: Full unit suite**

Run: `npm run test:unit`
Expected: all pass, including the new `resolveUrl` suite. (The known jest
"worker process failed to exit gracefully" warning is benign.)

- [ ] **Step 2: Smoke (non-Discord regression — must be untouched)**

Precondition: `:8081` dev server up (`lsof -i :8081`); if empty, surface as a blocker, don't start it.
Run: `npm run smoke`
Expected: same baseline as before (the pre-existing `stakes-waitingroom` failure is unrelated); no NEW failures. This confirms the non-Discord path (where `resolveSupabaseUrl()` returns the direct env URL) is unchanged.

- [ ] **Step 3: Rebuild the Discord playtest bundle**

Run: `npx expo export -p web` (the `:8081` static `dist/` the Discord tunnel serves), then the user reloads the Activity.

- [ ] **Step 4: Live Discord verification (user)**

In a real Discord Activity, **desktop and browser**: log in → **rating loads** → **create a room** succeeds (lands in WaitingRoom) → realtime updates flow (a second client sees changes). This is the real success criterion; it cannot be reproduced locally (no Discord parent / prod blocks anon sign-in).

---

## Self-review

- **Spec coverage:** resolver (spec §1) → Task 1; client uses it (spec §2 bullet 1) → Task 2; `runAuth` uses it (spec §2 bullet 2) → Task 3; keep `patchUrlMappings` (spec §3) → untouched (no task removes it); non-Discord unchanged → Task 2 keeps the guard + Task 1 returns env URL; verification (spec Risks) → Task 4. The exact proxy path `${origin}/supabase` (spec "Key fact") is in Task 1's implementation and test.
- **Placeholders:** none — every code step shows real code; the live Discord check is explicitly the user's manual step.
- **Type consistency:** `resolveSupabaseUrl(): string` is defined in Task 1 and consumed identically in Tasks 2 and 3; `DISCORD_SUPABASE_PREFIX` is the existing export from `src/lib/discord/mappings.ts` (`'/supabase'`); `isDiscordActivity` is the existing export from `src/lib/discord/context.ts`. No new types introduced.
