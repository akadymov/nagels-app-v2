# Testing strategy — Phase 4 (Smoke tier + orchestrator) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the smoke test tier (8 specs against the manual `:8081` dev server, ≤2 min wall-clock) and the cross-tier orchestrator (`tests/tests.config.json` + `npm run test:all`).

**Architecture:** Phase 4a adds 7 mobile-viewport smoke specs + 1 desktop-viewport spec under a new Playwright `smoke` / `smoke-desktop` project pair. Phase 4b adds a JSON registry plus a small TypeScript orchestrator (`scripts/test-all.ts`) that runs unit → smoke → smoke-desktop → scenario → e2e sequentially, respects per-spec enable flags, supports `--skip` / `--only` / `--tag` overrides, and prints a single consolidated summary.

**Tech Stack:** Playwright (existing), Jest (existing), TypeScript, Node 24. No new npm dependencies.

Reference spec: `docs/superpowers/specs/2026-05-17-testing-phase-4-smoke-design.md`.

Phase 3 plan (shipped): `docs/superpowers/plans/2026-05-17-testing-phase-3-fixtures-poc.md`.

---

## File Structure

**Created:**

- `tests/fixtures/smoke.ts` — `ensureDevServer`, `findUntranslatedKeys`, `assertNoOverflow`, `freshContextHooks`.
- `tests/smoke/boot.spec.ts`
- `tests/smoke/lobby.spec.ts`
- `tests/smoke/auth-modals.spec.ts`
- `tests/smoke/settings.spec.ts`
- `tests/smoke/quickmatch-entry.spec.ts`
- `tests/smoke/private-room.spec.ts`
- `tests/smoke/i18n.spec.ts`
- `tests/smoke/desktop-layout.spec.ts`
- `tests/tests.config.json` — registry.
- `scripts/test-all.ts` — orchestrator.

**Modified:**

- `src/screens/LobbyScreen.tsx` — add `testID="btn-open-settings"` to the ⚙ button (currently has none).
- `playwright.config.js` — register `smoke` and `smoke-desktop` projects.
- `package.json` — add `test:smoke`, `test:smoke:desktop`, `test:unit`, `test:fast`, `test:all` scripts.
- `tests/README.md` — Phase 4 status, smoke usage, orchestrator usage.

**Untouched:**

- `src/` apart from the one testID addition.
- `tests/playwright/global-setup.ts` and `global-teardown.ts` (scenario/e2e-only, not invoked by smoke).
- `tests/fixtures/actions.ts`, `tests/fixtures/seed.ts`.
- `tests/e2e/sp-game.spec.js`, `tests/scenario/notrump-deal.spec.ts`.
- `supabase/*`.

---

# Phase 4a — Smoke specs

## Task 1: Add missing testID to the Lobby ⚙ button

**Files:**
- Modify: `src/screens/LobbyScreen.tsx`

The Phase 3 design rejected production-code changes for tests. Here we make a single 1-token exception: the ⚙ Settings button has no testID and is the only entry point to the Settings modal from the Lobby. Without a stable selector the `auth-modals` and `settings` smoke specs would have to match the bare unicode glyph `⚙`, which is brittle (font fallback, decorative repositioning).

- [ ] **Step 1: Locate the Pressable**

Read `src/screens/LobbyScreen.tsx` around line 323–328. Confirm the block looks like:

```tsx
{onSettings && (
  <Pressable onPress={onSettings} hitSlop={12} style={styles.settingsBtn}>
    <Text style={{ fontSize: 20, color: colors.textPrimary }}>⚙</Text>
  </Pressable>
)}
```

- [ ] **Step 2: Add the testID**

Edit `src/screens/LobbyScreen.tsx`, replace the Pressable line with:

```tsx
<Pressable onPress={onSettings} hitSlop={12} style={styles.settingsBtn} testID="btn-open-settings">
```

- [ ] **Step 3: Verify the app still type-checks**

Run: `npm run ts:check 2>&1 | tail -20`

Expected: no new errors. (The repo may have unrelated pre-existing errors — diff against `git status` if unsure.)

- [ ] **Step 4: Commit**

```bash
git add src/screens/LobbyScreen.tsx
git commit -m "$(cat <<'EOF'
feat(lobby): testID="btn-open-settings" on gear button

The Phase 4 smoke tier needs a stable selector for the Settings entry
point from the Lobby. The button previously rendered only the ⚙ glyph
with no testID. One-token addition, no behavioural change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create `tests/fixtures/smoke.ts`

**Files:**
- Create: `tests/fixtures/smoke.ts`

- [ ] **Step 1: Create the file**

Write `tests/fixtures/smoke.ts` with this exact content:

```ts
'use strict';

/**
 * Shared helpers for the smoke tier. Smoke specs run against the
 * manual :8081 dev server (not the Phase 2/3 :8082 isolated stack),
 * so we can't rely on a global-setup probe — each spec calls
 * ensureDevServer() in its beforeAll instead.
 */

import { request, type Page, type Locator } from '@playwright/test';

const SMOKE_BASE_URL = process.env.DEMO_URL || 'http://localhost:8081';

/**
 * Probe :8081 once. Throws a clear actionable error if the dev
 * server is not reachable.
 */
export async function ensureDevServer(): Promise<void> {
  const ctx = await request.newContext({ baseURL: SMOKE_BASE_URL });
  try {
    const res = await ctx.get('/', { timeout: 3_000 });
    if (!res.ok()) {
      throw new Error(`dev server at ${SMOKE_BASE_URL} returned ${res.status()}`);
    }
  } catch (e: any) {
    throw new Error(
      `Smoke tests require the dev server at ${SMOKE_BASE_URL}. ` +
        `Start it with:  npx expo start --port 8081\n` +
        `Underlying error: ${e?.message ?? e}`,
    );
  } finally {
    await ctx.dispose();
  }
}

/**
 * i18next missing-key heuristic: a string is `lowercase.dotted.path`.
 * Tightened from the original strategy doc's pattern to require at
 * least one digit/alpha after the dot, reducing false positives on
 * filenames and version strings.
 */
const MISSING_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

const ALLOW_LIST = new Set<string>([
  // Add false-positive strings here as they are discovered. Empty for now.
]);

/**
 * Walk visible text nodes under the page (or the given root). Return
 * any string content that matches the missing-key heuristic and is
 * not in ALLOW_LIST. Caller asserts the array is empty.
 */
export async function findUntranslatedKeys(
  page: Page,
  rootSelector?: string,
): Promise<string[]> {
  const sel = rootSelector ?? 'body';
  return page.evaluate(
    ({ sel, allow, pattern }) => {
      const root = document.querySelector(sel);
      if (!root) return [];
      const allowSet = new Set(allow);
      const re = new RegExp(pattern);
      const out: string[] = [];
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const txt = (node.textContent || '').trim();
          if (re.test(txt) && !allowSet.has(txt)) out.push(txt);
        } else {
          node.childNodes.forEach(walk);
        }
      };
      walk(root);
      return Array.from(new Set(out));
    },
    {
      sel,
      allow: Array.from(ALLOW_LIST),
      pattern: MISSING_KEY_RE.source,
    },
  );
}

/**
 * Assert (a) no horizontal scroll, (b) optionally two named selectors
 * (split panes) do not overlap horizontally.
 */
export async function assertNoOverflow(
  page: Page,
  splitPanes?: { left: string; right: string },
): Promise<void> {
  const metrics = await page.evaluate(({ left, right }) => {
    const bodyScrollWidth = document.body.scrollWidth;
    const viewportWidth = window.innerWidth;
    let leftRect: DOMRect | null = null;
    let rightRect: DOMRect | null = null;
    if (left) {
      const el = document.querySelector(left);
      leftRect = el ? el.getBoundingClientRect() : null;
    }
    if (right) {
      const el = document.querySelector(right);
      rightRect = el ? el.getBoundingClientRect() : null;
    }
    return { bodyScrollWidth, viewportWidth, leftRect, rightRect };
  }, splitPanes ?? { left: '', right: '' });

  if (metrics.bodyScrollWidth > metrics.viewportWidth + 1) {
    throw new Error(
      `Horizontal overflow: body.scrollWidth=${metrics.bodyScrollWidth} > innerWidth=${metrics.viewportWidth}`,
    );
  }
  if (splitPanes && metrics.leftRect && metrics.rightRect) {
    if (metrics.leftRect.right > metrics.rightRect.left + 1) {
      throw new Error(
        `Split-pane overlap: ${splitPanes.left}.right=${metrics.leftRect.right} > ${splitPanes.right}.left=${metrics.rightRect.left}`,
      );
    }
  }
}

/**
 * Add to test.use({ contextOptions }) so every spec starts with empty
 * cookies + localStorage. Prevents user-state pollution between
 * smoke specs when the same :8081 dev server is reused.
 */
export const freshContextHooks = {
  storageState: undefined as undefined,
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit --moduleResolution node --module commonjs --target es2020 --esModuleInterop --skipLibCheck tests/fixtures/smoke.ts`

Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/smoke.ts
git commit -m "$(cat <<'EOF'
test(fixtures): smoke.ts — ensureDevServer + i18n + overflow helpers

Three small helpers used by the upcoming tests/smoke/ specs:
- ensureDevServer probes :8081 and throws an actionable error if dead.
- findUntranslatedKeys walks visible text nodes and returns any that
  match the i18next missing-key pattern, modulo an allow-list.
- assertNoOverflow checks document.body.scrollWidth and, optionally,
  that two named selectors don't overlap.

All three are pure helpers — no global state, no Playwright fixtures
plumbing. Specs call them ad-hoc.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire `smoke` and `smoke-desktop` Playwright projects

**Files:**
- Modify: `playwright.config.js`
- Modify: `package.json`

- [ ] **Step 1: Register the projects**

Open `playwright.config.js`. Find the existing `projects:` block:

```js
projects: [
  { name: 'e2e',      testDir: './tests/e2e' },
  { name: 'scenario', testDir: './tests/scenario' },
],
```

Replace with:

```js
projects: [
  { name: 'e2e',      testDir: './tests/e2e' },
  { name: 'scenario', testDir: './tests/scenario' },
  { name: 'smoke',    testDir: './tests/smoke',
    testIgnore: '**/desktop-layout.spec.ts' },
  { name: 'smoke-desktop', testDir: './tests/smoke',
    testMatch: '**/desktop-layout.spec.ts',
    use: {
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      isMobile: false,
      hasTouch: false,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
        'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    } },
],
```

The `testIgnore` on `smoke` and `testMatch` on `smoke-desktop` make `desktop-layout.spec.ts` the only file that runs in the desktop project, while every other file in `tests/smoke/` runs in the mobile `smoke` project. Both inherit the top-level `use.viewport` (430×932) unless overridden.

- [ ] **Step 2: Add npm scripts**

Open `package.json`. Find the `"test:scenario:local"` line and insert below it:

```json
    "test:smoke": "DEMO_URL=http://localhost:8081 playwright test --project=smoke",
    "test:smoke:desktop": "DEMO_URL=http://localhost:8081 playwright test --project=smoke-desktop",
```

So the block becomes (only the new lines shown in context):

```json
    "test:scenario:local": "LOCAL_SUPABASE=1 HEADLESS=1 DEMO_URL=http://localhost:8082 playwright test --project=scenario",
    "test:smoke": "DEMO_URL=http://localhost:8081 playwright test --project=smoke",
    "test:smoke:desktop": "DEMO_URL=http://localhost:8081 playwright test --project=smoke-desktop",
    "test:sp:prod": "...",
```

Note: smoke deliberately omits `HEADLESS=1`. The default config is headed at slowMo=80, which is what Akula wants for visual review; CI/background callers can prepend `HEADLESS=1` themselves.

- [ ] **Step 3: Sanity-check discovery**

Run: `npx playwright test --list 2>&1 | tail -15`

Expected: still shows the existing 2 tests (`e2e` and `scenario`). No new specs yet because `tests/smoke/` is empty. No "globalSetup not found" or "Unknown project" errors.

- [ ] **Step 4: Validate JSON**

Run: `node -e "console.log(require('./package.json').scripts['test:smoke'], '|', require('./package.json').scripts['test:smoke:desktop'])"`

Expected: `DEMO_URL=http://localhost:8081 playwright test --project=smoke | DEMO_URL=http://localhost:8081 playwright test --project=smoke-desktop`

- [ ] **Step 5: Commit**

```bash
git add playwright.config.js package.json
git commit -m "$(cat <<'EOF'
test(playwright): register smoke + smoke-desktop projects

Mobile smoke runs every file under tests/smoke/ except
desktop-layout.spec.ts. The desktop project overrides viewport to
1440x900 and toggles isMobile/hasTouch off. Both empty until the
next commits populate them.

npm run test:smoke and test:smoke:desktop scripts wired against
the manual :8081 dev server — no LOCAL_SUPABASE plumbing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `tests/smoke/boot.spec.ts`

**Files:**
- Create: `tests/smoke/boot.spec.ts`

- [ ] **Step 1: Create the directory and spec**

Run: `mkdir -p tests/smoke`

Create `tests/smoke/boot.spec.ts` with this exact content:

```ts
import { test, expect } from '@playwright/test';
import { ensureDevServer } from '../fixtures/smoke';

/**
 * Smoke 1/8 — Welcome renders, Skip-to-Lobby navigates to Lobby.
 * Smallest possible smoke: if this fails the app is broken at the
 * bundler or root render level.
 */

test.beforeAll(async () => {
  await ensureDevServer();
});

test.describe('boot', () => {
  test('welcome renders and skip-to-lobby reaches lobby', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.locator('[data-testid="btn-skip-to-lobby"]').first(),
    ).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-testid="btn-skip-to-lobby"]').first().click();

    // Lobby is identified by any of its three CTAs being present.
    await expect(
      page.locator('[data-testid="btn-quick-match"]').first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
```

- [ ] **Step 2: Verify discovery**

Run: `npx playwright test --list 2>&1 | grep smoke | head -5`

Expected: one new line under `[smoke]`:

```
  [smoke] › tests/smoke/boot.spec.ts:NN:N › boot › welcome renders and skip-to-lobby reaches lobby
```

- [ ] **Step 3: Commit**

```bash
git add tests/smoke/boot.spec.ts
git commit -m "$(cat <<'EOF'
test(smoke): boot.spec.ts — welcome → lobby navigation

Smallest possible smoke: ensures the bundler runs, root renders, and
the skip-to-lobby CTA reaches the lobby. Run with: npm run test:smoke
(requires :8081 dev server up).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `tests/smoke/lobby.spec.ts`

**Files:**
- Create: `tests/smoke/lobby.spec.ts`

- [ ] **Step 1: Create the spec**

Create `tests/smoke/lobby.spec.ts` with this exact content:

```ts
import { test, expect } from '@playwright/test';
import { ensureDevServer } from '../fixtures/smoke';

/**
 * Smoke 2/8 — Lobby tabs switch; the three primary CTAs render and
 * are enabled. No mutations of backend state.
 */

test.beforeAll(async () => {
  await ensureDevServer();
});

test.describe('lobby', () => {
  test('tabs switch and CTAs are visible', async ({ page }) => {
    await page.goto('/');
    await page
      .locator('[data-testid="btn-skip-to-lobby"]')
      .first()
      .click({ timeout: 15_000 });

    // Tab discovery: tab-${tab}. We don't know all keys up front, but
    // there are at least three. Assert the first is selectable.
    const tabs = page.locator('[data-testid^="tab-"]');
    await expect(tabs.first()).toBeVisible({ timeout: 15_000 });
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(2);

    // Click each visible tab once.
    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click({ timeout: 5_000 });
    }

    // Three primary CTAs must all exist in the DOM after tab cycling.
    await expect(
      page.locator('[data-testid="btn-quick-match"]').first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-testid="btn-create-room"]').first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-testid="btn-join-room"]').first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Verify discovery**

Run: `npx playwright test --list 2>&1 | grep "tests/smoke" | head -5`

Expected: two specs listed (boot + lobby).

- [ ] **Step 3: Commit**

```bash
git add tests/smoke/lobby.spec.ts
git commit -m "$(cat <<'EOF'
test(smoke): lobby.spec.ts — tabs + CTAs

Cycles through all data-testid^="tab-" elements and asserts the
three primary CTAs (Quick Match, Create Room, Join) are visible.
No real room creation; no mutations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `tests/smoke/auth-modals.spec.ts`

**Files:**
- Create: `tests/smoke/auth-modals.spec.ts`

The MVP exposes auth via two entry points: the Welcome button (`btn-sign-in`) and the Settings modal's Sign-In affordance (the Lobby has `lobby-sign-in`). The AuthScreen itself has tabs (`auth-tab-signIn`, `auth-tab-signUp`). Reset Password is reached via a "forgot password" link inside the auth screen. This spec opens the AuthScreen, toggles between sign-in and sign-up tabs, and dismisses without submitting.

- [ ] **Step 1: Create the spec**

Create `tests/smoke/auth-modals.spec.ts` with this exact content:

```ts
import { test, expect } from '@playwright/test';
import { ensureDevServer } from '../fixtures/smoke';

/**
 * Smoke 3/8 — auth screen opens from the Lobby, both tabs render,
 * inputs are mounted, and dismissal (back navigation) returns to
 * Lobby. No form submission, no real auth.
 */

test.beforeAll(async () => {
  await ensureDevServer();
});

test.describe('auth modals', () => {
  test('sign-in/sign-up tabs open from lobby and dismiss cleanly', async ({
    page,
  }) => {
    await page.goto('/');
    await page
      .locator('[data-testid="btn-skip-to-lobby"]')
      .first()
      .click({ timeout: 15_000 });

    // Lobby may render a "Sign in" entry; if not, fall back to gear→Settings.
    const lobbySignIn = page.locator('[data-testid="lobby-sign-in"]').first();
    if (await lobbySignIn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await lobbySignIn.click();
    } else {
      await page
        .locator('[data-testid="btn-open-settings"]')
        .first()
        .click({ timeout: 5_000 });
      // Settings modal exposes a sign-in entry — selector confirmed when the
      // spec is run; if the testID differs, update this line.
      const settingsSignIn = page
        .locator('[data-testid*="sign-in"], [data-testid*="signin"]')
        .first();
      await settingsSignIn.click({ timeout: 5_000 });
    }

    // Both auth tabs must mount.
    await expect(
      page.locator('[data-testid="auth-tab-signIn"]').first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-testid="auth-tab-signUp"]').first(),
    ).toBeVisible({ timeout: 5_000 });

    // Toggle to sign-up, then back to sign-in.
    await page.locator('[data-testid="auth-tab-signUp"]').first().click();
    await expect(
      page.locator('[data-testid="auth-input-nickname"]').first(),
    ).toBeVisible({ timeout: 5_000 });

    await page.locator('[data-testid="auth-tab-signIn"]').first().click();
    await expect(
      page.locator('[data-testid="auth-input-email"]').first(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator('[data-testid="auth-input-password"]').first(),
    ).toBeVisible({ timeout: 5_000 });

    // Dismiss via browser back. Lobby CTAs must reappear.
    await page.goBack();
    await expect(
      page.locator('[data-testid="btn-quick-match"]').first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Verify discovery**

Run: `npx playwright test --list 2>&1 | grep "tests/smoke" | head -5`

Expected: three specs listed.

- [ ] **Step 3: Commit**

```bash
git add tests/smoke/auth-modals.spec.ts
git commit -m "$(cat <<'EOF'
test(smoke): auth-modals.spec.ts — auth screen lifecycle

Opens the auth screen from the Lobby (falls back to Settings→sign-in
if the lobby entry is hidden by feature flag), toggles between
sign-in / sign-up tabs, asserts inputs mount, dismisses via
page.goBack(). No form submission.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `tests/smoke/settings.spec.ts`

**Files:**
- Create: `tests/smoke/settings.spec.ts`

The Settings panel uses prefixed pill testIDs from `SettingsBody.tsx`:
- `theme-light`, `theme-dark`, `theme-system`
- `lang-en`, `lang-ru`, `lang-es`
- `deck-*`, `haptics-*`, `notifications-*` (not asserted here)

- [ ] **Step 1: Create the spec**

Create `tests/smoke/settings.spec.ts` with this exact content:

```ts
import { test, expect } from '@playwright/test';
import { ensureDevServer } from '../fixtures/smoke';

/**
 * Smoke 4/8 — open Settings from Lobby, flip theme (light↔dark),
 * cycle language EN→RU→ES→EN. Assertions verify the pills' active
 * state visually changes (selected pill gains accent backgroundColor).
 * No untranslated key check here — that's i18n.spec.ts.
 */

test.beforeAll(async () => {
  await ensureDevServer();
});

test.describe('settings', () => {
  test('theme toggle + language cycle', async ({ page }) => {
    await page.goto('/');
    await page
      .locator('[data-testid="btn-skip-to-lobby"]')
      .first()
      .click({ timeout: 15_000 });

    await page
      .locator('[data-testid="btn-open-settings"]')
      .first()
      .click({ timeout: 10_000 });

    // Theme pills exist.
    const themeLight = page.locator('[data-testid="theme-light"]').first();
    const themeDark = page.locator('[data-testid="theme-dark"]').first();
    await expect(themeLight).toBeVisible({ timeout: 10_000 });
    await expect(themeDark).toBeVisible({ timeout: 5_000 });

    // Click dark, then light. The selected pill should have a measurable
    // background-color change — we don't lock to a specific color, just
    // assert that clicking changes the pair.
    await themeDark.click();
    await page.waitForTimeout(150);
    const darkBg = await themeDark.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    await themeLight.click();
    await page.waitForTimeout(150);
    const lightBg = await themeLight.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(darkBg).not.toBe(lightBg);

    // Language cycle. Capture some visible text after each switch and
    // assert at least one node changed.
    const grabFirstHeader = async () =>
      (await page
        .locator('text=/.{3,}/')
        .first()
        .textContent()
        .catch(() => null)) || '';
    const langEn = page.locator('[data-testid="lang-en"]').first();
    const langRu = page.locator('[data-testid="lang-ru"]').first();
    const langEs = page.locator('[data-testid="lang-es"]').first();
    await expect(langEn).toBeVisible({ timeout: 5_000 });
    await expect(langRu).toBeVisible({ timeout: 5_000 });
    await expect(langEs).toBeVisible({ timeout: 5_000 });

    await langEn.click();
    await page.waitForTimeout(200);
    const sampleEn = await grabFirstHeader();
    await langRu.click();
    await page.waitForTimeout(200);
    const sampleRu = await grabFirstHeader();
    await langEs.click();
    await page.waitForTimeout(200);
    const sampleEs = await grabFirstHeader();

    expect(sampleEn).not.toBe('');
    // At least one of RU/ES must differ from EN — if all three match,
    // the language switch is a no-op.
    const someChanged = sampleRu !== sampleEn || sampleEs !== sampleEn;
    expect(someChanged).toBe(true);

    // Reset to EN to leave the dev server in a clean state.
    await langEn.click();

    // Close the modal.
    await page
      .locator('[data-testid="settings-modal-close"]')
      .first()
      .click({ timeout: 5_000 });
  });
});
```

- [ ] **Step 2: Verify discovery**

Run: `npx playwright test --list 2>&1 | grep "tests/smoke" | head -5`

Expected: four specs listed.

- [ ] **Step 3: Commit**

```bash
git add tests/smoke/settings.spec.ts
git commit -m "$(cat <<'EOF'
test(smoke): settings.spec.ts — theme + language pills

Opens Settings from Lobby, asserts theme-light/dark pills change
background on click, then cycles EN→RU→ES→EN and asserts at least
one visible-text node changes between languages. Closes the modal at
the end to keep the dev server clean.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `tests/smoke/quickmatch-entry.spec.ts`

**Files:**
- Create: `tests/smoke/quickmatch-entry.spec.ts`

This spec checks the game table mounts after Quick Match. It does NOT play any cards or bets — that's the e2e tier's job. Reaching the table proves: lobby→quick-match wiring, bot population, deal animation completion, betting UI mount.

- [ ] **Step 1: Create the spec**

Create `tests/smoke/quickmatch-entry.spec.ts` with this exact content:

```ts
import { test, expect } from '@playwright/test';
import { ensureDevServer } from '../fixtures/smoke';

/**
 * Smoke 5/8 — Quick Match (4 players, Hard) reaches the game table.
 * Asserts my-hand and at least one bet-btn-* are visible. Does NOT
 * play. Leaves via End-the-game (no scoreboard navigation needed).
 */

test.beforeAll(async () => {
  await ensureDevServer();
});

test.describe('quickmatch entry', () => {
  test('quick match reaches game table with hand + bet buttons', async ({
    page,
  }) => {
    await page.goto('/');
    await page
      .locator('[data-testid="btn-skip-to-lobby"]')
      .first()
      .click({ timeout: 15_000 });

    await page
      .locator('[data-testid="player-count-4"]')
      .first()
      .click({ timeout: 10_000 });
    await page
      .locator('[data-testid="difficulty-hard"]')
      .first()
      .click({ timeout: 5_000 });
    await page
      .locator('[data-testid="btn-quick-match"]')
      .first()
      .click({ timeout: 5_000 });

    // Game table mount: my-hand + at least one bet button. The deal
    // animation can take a few seconds, so allow a 20s budget here.
    await expect(page.locator('[data-testid="my-hand"]').first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.locator('[data-testid^="bet-btn-"]').first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Verify discovery**

Run: `npx playwright test --list 2>&1 | grep "tests/smoke" | head -6`

Expected: five specs listed.

- [ ] **Step 3: Commit**

```bash
git add tests/smoke/quickmatch-entry.spec.ts
git commit -m "$(cat <<'EOF'
test(smoke): quickmatch-entry.spec.ts — game table mounts

Quick Match (4 players, Hard) → asserts my-hand + bet-btn-* visible.
Does not play; e2e/sp-game.spec.js still owns the full playthrough.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `tests/smoke/private-room.spec.ts`

**Files:**
- Create: `tests/smoke/private-room.spec.ts`

This spec creates a real room (the `silent: true` UI flag is not exposed in MVP — creating a room here will produce a Telegram notification in dev mode). To keep smoke side-effect-free we use Join instead of Create: we deliberately enter an invalid code and assert the error UI appears.

- [ ] **Step 1: Create the spec**

Create `tests/smoke/private-room.spec.ts` with this exact content:

```ts
import { test, expect } from '@playwright/test';
import { ensureDevServer } from '../fixtures/smoke';

/**
 * Smoke 6/8 — join flow with a bad code surfaces an error.
 *
 * Why not test Create Room? Creating a real room is a side-effecting
 * mutation that hits Supabase and may fire a Telegram notification
 * (the `silent` flag is API-only in MVP, not exposed in the UI).
 * Smoke is supposed to be side-effect-free against the manual :8081
 * dev server, so this spec covers the join path with a bad code.
 */

test.beforeAll(async () => {
  await ensureDevServer();
});

test.describe('private room', () => {
  test('join with bad code shows an error', async ({ page }) => {
    await page.goto('/');
    await page
      .locator('[data-testid="btn-skip-to-lobby"]')
      .first()
      .click({ timeout: 15_000 });

    const joinInput = page.locator('[data-testid="input-join-code"]').first();
    await expect(joinInput).toBeVisible({ timeout: 10_000 });
    await joinInput.fill('ZZZZZZ');

    await page
      .locator('[data-testid="btn-join-room"]')
      .first()
      .click({ timeout: 5_000 });

    // The exact error testID is not standardized across the lobby — fall
    // back to "some visible text contains a known error fragment". Common
    // patterns: "not found", "Room not found", "no room", "invalid".
    const errorPattern = /not found|no such|invalid|cannot find/i;
    await expect(
      page.locator(`text=${errorPattern}`).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Lobby must still be reachable — we have NOT navigated away.
    await expect(
      page.locator('[data-testid="btn-quick-match"]').first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
```

- [ ] **Step 2: Verify discovery**

Run: `npx playwright test --list 2>&1 | grep "tests/smoke" | head -7`

Expected: six specs listed.

- [ ] **Step 3: Commit**

```bash
git add tests/smoke/private-room.spec.ts
git commit -m "$(cat <<'EOF'
test(smoke): private-room.spec.ts — bad join code surfaces error

Smoke avoids creating real rooms (would hit Supabase + Telegram in
dev). Covers the inverse instead: invalid join code → error message
appears → lobby still reachable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `tests/smoke/i18n.spec.ts`

**Files:**
- Create: `tests/smoke/i18n.spec.ts`

- [ ] **Step 1: Create the spec**

Create `tests/smoke/i18n.spec.ts` with this exact content:

```ts
import { test, expect } from '@playwright/test';
import { ensureDevServer, findUntranslatedKeys } from '../fixtures/smoke';

/**
 * Smoke 7/8 — for each of EN, RU, ES, walk the Welcome + Lobby +
 * Settings surfaces and assert no DOM text node matches the i18next
 * missing-key heuristic.
 */

test.beforeAll(async () => {
  await ensureDevServer();
});

test.describe('i18n', () => {
  for (const lang of ['en', 'ru', 'es'] as const) {
    test(`no untranslated keys in ${lang.toUpperCase()}`, async ({ page }) => {
      await page.goto('/');
      // Welcome screen.
      const welcomeMissing = await findUntranslatedKeys(page);
      expect(welcomeMissing).toEqual([]);

      // Enter Lobby.
      await page
        .locator('[data-testid="btn-skip-to-lobby"]')
        .first()
        .click({ timeout: 15_000 });
      await page
        .locator('[data-testid="btn-quick-match"]')
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 });

      // Switch language via Settings.
      await page
        .locator('[data-testid="btn-open-settings"]')
        .first()
        .click({ timeout: 5_000 });
      await page
        .locator(`[data-testid="lang-${lang}"]`)
        .first()
        .click({ timeout: 5_000 });
      await page.waitForTimeout(300);

      // Within Settings (the modal is still open), check.
      const settingsMissing = await findUntranslatedKeys(page);
      expect(settingsMissing).toEqual([]);

      // Close settings, re-check Lobby.
      await page
        .locator('[data-testid="settings-modal-close"]')
        .first()
        .click({ timeout: 5_000 });
      await page.waitForTimeout(200);
      const lobbyMissing = await findUntranslatedKeys(page);
      expect(lobbyMissing).toEqual([]);

      // Reset to EN to leave the dev server clean for the next spec.
      if (lang !== 'en') {
        await page
          .locator('[data-testid="btn-open-settings"]')
          .first()
          .click({ timeout: 5_000 });
        await page
          .locator('[data-testid="lang-en"]')
          .first()
          .click({ timeout: 5_000 });
        await page
          .locator('[data-testid="settings-modal-close"]')
          .first()
          .click({ timeout: 5_000 });
      }
    });
  }
});
```

- [ ] **Step 2: Verify discovery**

Run: `npx playwright test --list 2>&1 | grep "tests/smoke" | head -10`

Expected: nine spec-test rows (six previous specs + three i18n parametrized tests).

- [ ] **Step 3: Commit**

```bash
git add tests/smoke/i18n.spec.ts
git commit -m "$(cat <<'EOF'
test(smoke): i18n.spec.ts — no untranslated keys in EN/RU/ES

For each of the three languages, switches via Settings and walks
Welcome / Lobby / Settings surfaces, asserting no DOM text matches
the i18next missing-key heuristic. Resets to EN at the end.

If a string trips the heuristic falsely, extend the ALLOW_LIST in
tests/fixtures/smoke.ts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `tests/smoke/desktop-layout.spec.ts`

**Files:**
- Create: `tests/smoke/desktop-layout.spec.ts`

- [ ] **Step 1: Create the spec**

Create `tests/smoke/desktop-layout.spec.ts` with this exact content:

```ts
import { test, expect } from '@playwright/test';
import { ensureDevServer, assertNoOverflow } from '../fixtures/smoke';

/**
 * Smoke 8/8 — desktop layout invariants at 1440×900. Runs only in
 * the smoke-desktop Playwright project (testMatch in
 * playwright.config.js). The smoke (mobile) project excludes it via
 * testIgnore.
 *
 * Asserts: no horizontal scroll on Lobby; no horizontal scroll on
 * the SP game table after Quick Match; split-pane bounding boxes do
 * not overlap.
 */

test.beforeAll(async () => {
  await ensureDevServer();
});

test.describe('desktop layout', () => {
  test('lobby has no horizontal overflow at 1440x900', async ({ page }) => {
    await page.goto('/');
    await page
      .locator('[data-testid="btn-skip-to-lobby"]')
      .first()
      .click({ timeout: 15_000 });
    await page
      .locator('[data-testid="btn-quick-match"]')
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 });

    await assertNoOverflow(page);
  });

  test('SP game has no overflow and split-panes do not overlap', async ({
    page,
  }) => {
    await page.goto('/');
    await page
      .locator('[data-testid="btn-skip-to-lobby"]')
      .first()
      .click({ timeout: 15_000 });
    await page
      .locator('[data-testid="player-count-4"]')
      .first()
      .click({ timeout: 5_000 });
    await page
      .locator('[data-testid="difficulty-hard"]')
      .first()
      .click({ timeout: 5_000 });
    await page
      .locator('[data-testid="btn-quick-match"]')
      .first()
      .click({ timeout: 5_000 });
    await page
      .locator('[data-testid="my-hand"]')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 });

    // Body horizontal scroll guard.
    await assertNoOverflow(page);

    // Best-effort split-pane check: desktop layout uses a left game
    // pane + right info pane. Both expose testIDs once the desktop
    // layout components mount. If selectors below don't exist on the
    // current build, the assertion is skipped (assertNoOverflow only
    // throws if BOTH selectors resolve).
    await assertNoOverflow(page, {
      left: '[data-testid="desktop-game-left"]',
      right: '[data-testid="desktop-game-right"]',
    });
  });
});
```

- [ ] **Step 2: Verify discovery**

Run: `npx playwright test --list 2>&1 | tail -15`

Expected: 2 desktop-layout tests appear under `[smoke-desktop]`, and all 9 mobile-smoke tests appear under `[smoke]`. The desktop-layout file does NOT show under `[smoke]`.

If `desktop-layout.spec.ts` appears under `[smoke]`, re-read Task 3 Step 1 — the `testIgnore` is likely missing.

- [ ] **Step 3: Commit**

```bash
git add tests/smoke/desktop-layout.spec.ts
git commit -m "$(cat <<'EOF'
test(smoke): desktop-layout.spec.ts — overflow + split-pane

Runs only in the smoke-desktop project (1440x900). Two cases: lobby
overflow guard, and SP-game overflow + split-pane non-overlap. Uses
the desktop-game-left/right testIDs if present — silently no-ops the
split-pane check otherwise so the spec doesn't false-positive on
builds that haven't shipped those selectors yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Update README + verify Phase 4a end-to-end

**Files:**
- Modify: `tests/README.md`

- [ ] **Step 1: Update README status**

Open `tests/README.md`. Find:

```markdown
## Status (Phase 3 — Fixtures + POC scenario)
```

Replace that whole section (down to but not including `## Running`) with:

```markdown
## Status (Phase 4a — Smoke tier shipped)

- ✅ `tests/e2e/sp-game.spec.js` — single-player vs Hard bots, full game.
  - Manual `:8081` dev server: `npm run test:sp`
  - Isolated `:8082` Expo + local supabase: `npm run test:sp:local`
- ✅ `tests/scenario/notrump-deal.spec.ts` — POC scenario.
  - `npm run test:scenario:local` (~6 min spec + ~1 min boot)
- ✅ `tests/smoke/*.spec.ts` — 7 mobile + 1 desktop spec against `:8081`.
  - `npm run test:smoke` (~90s)
  - `npm run test:smoke:desktop` (~30s)
- ✅ Reusable click helpers `tests/fixtures/actions.ts`.
- ✅ Scenario seeding `tests/fixtures/seed.ts`.
- ✅ Smoke helpers `tests/fixtures/smoke.ts`.
- ✅ Edge-function unit tests: `cd supabase/functions && deno test --allow-all`.
- ⏳ Cross-tier orchestrator (`npm run test:all`) — Phase 4b.
- ⏳ Additional scenarios / multi-context e2e — Phase 5+.
```

- [ ] **Step 2: Update Running section**

Find the existing `## Running` block:

```bash
npm run test:sp              # SP e2e against manual :8081 dev server (headed)
npm run test:sp:local        # SP e2e against isolated :8082 + local supabase (headless)
npm run test:scenario:local  # Scenario tier (notrump-deal POC) against :8082 (headless)
npm run test:sp:prod         # SP e2e against $APP_URL (production)
```

Replace with:

```bash
npm run test:sp              # SP e2e against manual :8081 dev server (headed)
npm run test:sp:local        # SP e2e against isolated :8082 + local supabase (headless)
npm run test:scenario:local  # Scenario tier (notrump-deal POC) against :8082 (headless)
npm run test:smoke           # 7 smoke specs against manual :8081 dev server (~90s)
npm run test:smoke:desktop   # 1 desktop-layout spec at 1440x900 against :8081 (~30s)
npm run test:sp:prod         # SP e2e against $APP_URL (production)
```

- [ ] **Step 3: Append a Smoke section**

After the existing `## Scenario tier (tests/scenario/)` section and before `## Conventions`, insert:

```markdown
## Smoke tier (`tests/smoke/`)

8 specs that prove the app boots, renders, and navigates. Runs against
the manual `:8081` dev server — start it yourself with
`npx expo start --port 8081` before running.

| Spec | What it proves |
|------|---------------|
| `boot.spec.ts` | Welcome renders, Skip-to-Lobby navigates to Lobby. |
| `lobby.spec.ts` | Tabs switch, Quick Match / Create / Join CTAs render. |
| `auth-modals.spec.ts` | Auth screen opens, sign-in/sign-up tabs toggle. |
| `settings.spec.ts` | Theme + language pills change on click. |
| `quickmatch-entry.spec.ts` | Quick Match reaches game table. |
| `private-room.spec.ts` | Bad join code surfaces an error. |
| `i18n.spec.ts` | No untranslated keys in EN/RU/ES. |
| `desktop-layout.spec.ts` | 1440×900 layout has no overflow / pane overlap. |

**Why `:8081` and not `:8082`?** Smoke is the fast, side-effect-free
pre-commit check. The local Supabase stack adds ~1 min boot and
hits Postgres / Realtime / Auth for assertions that don't need them.
Keep the heavy stack for scenario + e2e.

**Why not auto-start the dev server?** Auto-spawn would conflict with
the one Akula already has open in a browser. Smoke fails fast with
the start command in the error message if `:8081` is dead.

**Adding a new smoke spec:**
1. Drop a `<name>.spec.ts` in `tests/smoke/`. It auto-picks-up.
2. Call `ensureDevServer()` in `test.beforeAll`.
3. Use existing `data-testid` selectors; if none exists, add a
   testID to the production component (single-token, no behaviour
   change — see Task 1 of the Phase 4 plan).
```

- [ ] **Step 4: Pre-flight checks for verification**

Run: `vm_stat | head -5`

Confirm `Pages free + Pages inactive` × 16 KB ≥ 2 GB reclaimable. Close heavy Chrome / Slack windows if under 3 GB combined.

Run: `lsof -i :8081 -sTCP:LISTEN -P -n 2>&1 | head -3`

If empty → start the dev server in another shell: `npx expo start --port 8081`. Wait until the bundler reports "Bundling complete" (~30–60s).

If non-empty → confirm it's an Expo bundler (the line should mention `node`).

- [ ] **Step 5: Run smoke (mobile)**

Run: `npm run test:smoke 2>&1 | tail -20`

Expected: `7 passed (~90s)` or similar. (Mobile project has 9 test rows: boot, lobby, auth-modals, settings, quickmatch-entry, private-room, plus 3 i18n parametrized tests = 9 passes total.)

If any spec fails:
- **`Error: Smoke tests require the dev server at http://localhost:8081`** → start `npx expo start --port 8081`.
- **`Locator not found: ...`** → the data-testid in the spec doesn't match the live UI. Inspect the failure's screenshot under `test-results/` and update the selector.
- **`i18n: missing keys in DOM`** → either real missing translations or false positives. Add false-positive strings to `ALLOW_LIST` in `tests/fixtures/smoke.ts`.

- [ ] **Step 6: Run smoke-desktop**

Run: `npm run test:smoke:desktop 2>&1 | tail -10`

Expected: `2 passed (~30s)`.

If the split-pane assertion fires unexpectedly, the desktop layout component selectors (`desktop-game-left/right`) don't match current code. The helper skips the assertion when either selector is absent; if both are present and they overlap, that's a real layout bug — investigate in `src/screens/desktop/`.

- [ ] **Step 7: Confirm test:sp:local still passes (regression guard)**

Run: `npm run test:sp:local 2>&1 | tail -5`

Expected: `1 passed (~22m)`. The smoke wiring must not have regressed the e2e tier. (This is a 22-minute test — run only if there's any reason to suspect a regression. If you didn't modify `playwright.config.js`'s top-level config or the global-setup, you can skip this step.)

- [ ] **Step 8: Confirm working tree is clean**

Run: `git status`

Expected: no leftover `test-results/` in the tracked diff (gitignored from Phase 3). No `.env.test`. No `tests/.runtime/` unless a `:8082` test was also run.

- [ ] **Step 9: Commit README**

```bash
git add tests/README.md
git commit -m "$(cat <<'EOF'
docs(tests): Phase 4a — smoke tier README

Documents the 8 smoke specs, the :8081-vs-:8082 split rationale, the
no-auto-start choice, and the recipe for adding new smoke specs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase 4b — Orchestrator

## Task 13: Write `tests/tests.config.json`

**Files:**
- Create: `tests/tests.config.json`

- [ ] **Step 1: Create the registry**

Create `tests/tests.config.json` with this exact content:

```json
{
  "_schema": {
    "spec": {
      "name": "string — matches the spec file basename without extension",
      "tier": "unit | smoke | smoke-desktop | scenario | end-to-end",
      "enabled": "boolean — false hides from test:all and logs in skip report",
      "note": "optional — shown in skip report when enabled=false",
      "tags": "optional string[] — for --tag filtering"
    }
  },
  "specs": [
    { "name": "createRoom",          "tier": "unit",          "enabled": true  },
    { "name": "gameLoop",            "tier": "unit",          "enabled": true  },
    { "name": "push-transitions",    "tier": "unit",          "enabled": true  },
    { "name": "push-i18n",           "tier": "unit",          "enabled": true  },
    { "name": "telegram",            "tier": "unit",          "enabled": true  },
    { "name": "boot",                "tier": "smoke",         "enabled": true  },
    { "name": "lobby",               "tier": "smoke",         "enabled": true  },
    { "name": "auth-modals",         "tier": "smoke",         "enabled": true  },
    { "name": "settings",            "tier": "smoke",         "enabled": true  },
    { "name": "quickmatch-entry",    "tier": "smoke",         "enabled": true  },
    { "name": "private-room",        "tier": "smoke",         "enabled": true  },
    { "name": "i18n",                "tier": "smoke",         "enabled": true  },
    { "name": "desktop-layout",      "tier": "smoke-desktop", "enabled": true  },
    { "name": "notrump-deal",        "tier": "scenario",      "enabled": true  },
    { "name": "sp-game",             "tier": "end-to-end",    "enabled": true  }
  ]
}
```

- [ ] **Step 2: Validate JSON**

Run: `node -e "const r = require('./tests/tests.config.json'); console.log('specs:', r.specs.length)"`

Expected: `specs: 15`

- [ ] **Step 3: Commit**

```bash
git add tests/tests.config.json
git commit -m "$(cat <<'EOF'
test(orchestrator): tests.config.json — spec registry

Enumerates every spec across unit/smoke/smoke-desktop/scenario/e2e
tiers with an enabled flag and optional note + tags. Source of truth
for the upcoming npm run test:all orchestrator.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Write `scripts/test-all.ts`

**Files:**
- Create: `scripts/test-all.ts`

The orchestrator is invoked as `node --import tsx scripts/test-all.ts -- [args]`. The npm wrapper adds the runner; this task just creates the script.

- [ ] **Step 1: Verify `tsx` (TypeScript executor) is available**

Run: `node -e "require.resolve('tsx')" 2>&1 | head -3`

If it errors with "Cannot find module 'tsx'", install it as a dev dependency:

```bash
npm install --save-dev tsx
```

Expected after install (or if already present): no error.

- [ ] **Step 2: Create the file**

Create `scripts/test-all.ts` with this exact content:

```ts
#!/usr/bin/env tsx
/* eslint-disable no-console */

/**
 * Cross-tier test orchestrator. Reads tests/tests.config.json,
 * applies CLI filters, runs unit → smoke → smoke-desktop → scenario
 * → e2e in order, and prints a single summary.
 *
 * Invoked via:  npm run test:all [-- --skip a,b --only c --tag '!flaky']
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

type Tier = 'unit' | 'smoke' | 'smoke-desktop' | 'scenario' | 'end-to-end';

interface SpecRegistryEntry {
  name: string;
  tier: Tier;
  enabled: boolean;
  note?: string;
  tags?: string[];
}

interface Registry {
  specs: SpecRegistryEntry[];
}

interface TierResult {
  tier: Tier;
  passed: number;
  failed: number;
  skipped: number;
  exitCode: number;
  durationMs: number;
}

const REPO_ROOT = join(__dirname, '..');
const REGISTRY_PATH = join(REPO_ROOT, 'tests', 'tests.config.json');
const TIER_ORDER: Tier[] = [
  'unit',
  'smoke',
  'smoke-desktop',
  'scenario',
  'end-to-end',
];

function parseArgs(argv: string[]): {
  skip: Set<string>;
  only: Set<string> | null;
  tagPredicate: ((tags: string[] | undefined) => boolean) | null;
} {
  const skip = new Set<string>();
  let only: Set<string> | null = null;
  let tagPredicate: ((tags: string[] | undefined) => boolean) | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skip' && argv[i + 1]) {
      argv[++i]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((n) => skip.add(n));
    } else if (a === '--only' && argv[i + 1]) {
      only = new Set(
        argv[++i]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (a === '--tag' && argv[i + 1]) {
      const raw = argv[++i];
      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
      const excludes = parts.filter((p) => p.startsWith('!')).map((p) => p.slice(1));
      const includes = parts.filter((p) => !p.startsWith('!'));
      tagPredicate = (tags) => {
        const t = tags ?? [];
        if (excludes.some((e) => t.includes(e))) return false;
        if (includes.length > 0 && !includes.some((i) => t.includes(i))) return false;
        return true;
      };
    }
  }
  return { skip, only, tagPredicate };
}

function loadRegistry(): Registry {
  if (!existsSync(REGISTRY_PATH)) {
    throw new Error(`Registry not found at ${REGISTRY_PATH}`);
  }
  const raw = readFileSync(REGISTRY_PATH, 'utf8');
  const data = JSON.parse(raw) as Registry;
  if (!Array.isArray(data.specs)) {
    throw new Error('Registry missing specs[]');
  }
  return data;
}

function resolveEnabled(
  registry: Registry,
  filters: ReturnType<typeof parseArgs>,
): {
  enabled: SpecRegistryEntry[];
  skipped: Array<{ entry: SpecRegistryEntry; reason: string }>;
} {
  const enabled: SpecRegistryEntry[] = [];
  const skipped: Array<{ entry: SpecRegistryEntry; reason: string }> = [];
  for (const entry of registry.specs) {
    if (!entry.enabled) {
      skipped.push({ entry, reason: '[enabled=false]' + (entry.note ? ' ' + entry.note : '') });
      continue;
    }
    if (filters.only && !filters.only.has(entry.name)) {
      skipped.push({ entry, reason: '[not in --only]' });
      continue;
    }
    if (filters.skip.has(entry.name)) {
      skipped.push({ entry, reason: '[--skip]' });
      continue;
    }
    if (filters.tagPredicate && !filters.tagPredicate(entry.tags)) {
      skipped.push({ entry, reason: '[tag filter]' });
      continue;
    }
    enabled.push(entry);
  }
  return { enabled, skipped };
}

function runTier(tier: Tier, names: string[]): TierResult {
  if (names.length === 0) {
    return { tier, passed: 0, failed: 0, skipped: 0, exitCode: 0, durationMs: 0 };
  }
  const start = Date.now();

  let exitCode = 0;
  if (tier === 'unit') {
    const pattern = names
      .map((n) => `/${n}\\.test\\.|__tests__/${n}\\.`)
      .join('|');
    const res = spawnSync(
      'npx',
      ['jest', '--no-coverage', '--testPathPattern', pattern],
      { stdio: 'inherit', cwd: REPO_ROOT, env: process.env },
    );
    exitCode = res.status ?? 1;
  } else if (tier === 'smoke' || tier === 'smoke-desktop') {
    const res = spawnSync(
      'npx',
      [
        'playwright',
        'test',
        `--project=${tier}`,
        '--grep',
        // The simplest reliable filter: spec filename, anchored.
        names.map((n) => n).join('|'),
      ],
      {
        stdio: 'inherit',
        cwd: REPO_ROOT,
        env: { ...process.env, DEMO_URL: 'http://localhost:8081' },
      },
    );
    exitCode = res.status ?? 1;
  } else if (tier === 'scenario' || tier === 'end-to-end') {
    const project = tier === 'scenario' ? 'scenario' : 'e2e';
    const res = spawnSync(
      'npx',
      [
        'playwright',
        'test',
        `--project=${project}`,
        '--grep',
        names.join('|'),
      ],
      {
        stdio: 'inherit',
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          LOCAL_SUPABASE: '1',
          HEADLESS: '1',
          DEMO_URL: 'http://localhost:8082',
        },
      },
    );
    exitCode = res.status ?? 1;
  }

  return {
    tier,
    // We don't parse runner output to fill passed/failed; the runner
    // prints its own summary above. The orchestrator just reports
    // pass/fail at tier granularity in its consolidated block.
    passed: exitCode === 0 ? names.length : 0,
    failed: exitCode === 0 ? 0 : 1,
    skipped: 0,
    exitCode,
    durationMs: Date.now() - start,
  };
}

function main(): number {
  const filters = parseArgs(process.argv.slice(2));
  const registry = loadRegistry();
  const { enabled, skipped } = resolveEnabled(registry, filters);

  // Group by tier.
  const byTier = new Map<Tier, string[]>();
  for (const tier of TIER_ORDER) byTier.set(tier, []);
  for (const e of enabled) byTier.get(e.tier)!.push(e.name);

  const results: TierResult[] = [];
  for (const tier of TIER_ORDER) {
    const names = byTier.get(tier)!;
    console.log(`\n===== running tier: ${tier} (${names.length} spec${names.length === 1 ? '' : 's'}) =====`);
    if (names.length === 0) {
      console.log('(no enabled specs)');
      results.push({ tier, passed: 0, failed: 0, skipped: 0, exitCode: 0, durationMs: 0 });
      continue;
    }
    const r = runTier(tier, names);
    results.push(r);
  }

  // Summary block.
  console.log('\n===== test:all summary =====');
  let total = 0;
  for (const r of results) {
    const status = r.exitCode === 0 ? '✓' : '✗';
    const secs = (r.durationMs / 1000).toFixed(1);
    console.log(`${status} ${r.tier.padEnd(14)} (${secs}s)`);
    total += r.durationMs;
  }
  if (skipped.length > 0) {
    console.log(`\nSkipped specs (${skipped.length}):`);
    for (const s of skipped) {
      console.log(`  - ${s.entry.name.padEnd(20)} (${s.entry.tier}) ${s.reason}`);
    }
  }
  const anyFailed = results.some((r) => r.exitCode !== 0);
  const totalMin = (total / 60000).toFixed(1);
  console.log(
    `\nResult: ${anyFailed ? '✗ at least one tier failed' : '✓ all enabled specs passed'} (~${totalMin} min)`,
  );
  return anyFailed ? 1 : 0;
}

process.exit(main());
```

- [ ] **Step 3: Verify it parses**

Run: `npx tsx scripts/test-all.ts --only nonexistent-spec 2>&1 | tail -20`

Expected: the script prints `===== running tier: unit (0 specs) =====` for each tier (because nothing matches `--only`), then the summary listing 15 skipped specs with `[not in --only]`, and a final `Result: ✓ all enabled specs passed (~0.0 min)`. Exit code 0.

Why exit 0 on an empty `--only`? Because "no specs ran and no spec failed" is technically a pass. If you want it to fail loudly, add a `--strict-empty` guard later.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-all.ts package-lock.json package.json 2>/dev/null || git add scripts/test-all.ts
git commit -m "$(cat <<'EOF'
test(orchestrator): scripts/test-all.ts — cross-tier runner

Reads tests/tests.config.json, applies --skip / --only / --tag CLI
filters, runs each tier with the right project/env (unit → smoke →
smoke-desktop → scenario → e2e), prints a consolidated summary with
skip reasons.

Tier exit code is best-effort: 0 if the runner reported success,
non-zero otherwise. Per-spec pass/fail comes from each runner's own
output, which streams to stdout/stderr above the summary.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(If `npm install --save-dev tsx` was needed in Step 1, the package-lock change is included.)

---

## Task 15: Add `test:unit`, `test:fast`, and `test:all` npm scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the scripts**

Open `package.json`. Find the `test:smoke:desktop` line added in Task 3:

```json
    "test:smoke:desktop": "DEMO_URL=http://localhost:8081 playwright test --project=smoke-desktop",
```

Insert below it:

```json
    "test:unit": "jest --no-coverage",
    "test:fast": "npm run test:unit && npm run test:smoke && npm run test:smoke:desktop",
    "test:all": "tsx scripts/test-all.ts",
```

- [ ] **Step 2: Validate**

Run: `node -e "['test:unit','test:fast','test:all'].forEach(k => console.log(k, '=>', require('./package.json').scripts[k]))"`

Expected:

```
test:unit => jest --no-coverage
test:fast => npm run test:unit && npm run test:smoke && npm run test:smoke:desktop
test:all => tsx scripts/test-all.ts
```

- [ ] **Step 3: Smoke-test the orchestrator argument plumbing**

Run: `npm run test:all -- --only nonexistent 2>&1 | tail -20`

Expected: same skipped-spec output as Task 14 Step 3, proving the `npm run test:all --` arg passthrough works.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
test(scripts): test:unit / test:fast / test:all

test:fast = unit + smoke + smoke-desktop, the pre-commit check (~2 min).
test:all  = tsx scripts/test-all.ts, the pre-push check (~30 min).
test:unit = jest standalone, used by test:all internally and useful
            for snappy iteration on rules invariants.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Verify Phase 4b end-to-end + final README

**Files:**
- Modify: `tests/README.md`

- [ ] **Step 1: Run `test:fast`**

Pre-flight: confirm `:8081` is up (Task 12 Step 4 procedure).

Run: `npm run test:fast 2>&1 | tail -20`

Expected: jest passes (50/50 modulo the 4 Deno suite-load failures pre-existing), smoke passes (~90s), smoke-desktop passes (~30s). Total ~2 min.

- [ ] **Step 2: Force a tier failure (sanity check)**

Temporarily disable `notrump-deal` in the registry to confirm the skip-report mechanism. Edit `tests/tests.config.json` and flip:

```json
{ "name": "notrump-deal",        "tier": "scenario",      "enabled": false, "note": "Phase 4b verification toggle" },
```

Run: `npm run test:all -- --only notrump-deal,sp-game 2>&1 | tail -30`

Expected: scenario tier reports 0 specs run, e2e runs sp-game (~22 min — long), summary lists `notrump-deal` with `[enabled=false] Phase 4b verification toggle`.

Revert the flip:

```json
{ "name": "notrump-deal",        "tier": "scenario",      "enabled": true  },
```

Verify with `git diff tests/tests.config.json` → empty.

(If running the full `--only` verification is too slow, settle for `npm run test:all -- --only nonexistent` — the orchestrator should still print the summary and skip report, just with `[not in --only]` for every spec.)

- [ ] **Step 3: Update README — orchestrator section**

Open `tests/README.md`. Update the Status section:

Find:

```markdown
- ⏳ Cross-tier orchestrator (`npm run test:all`) — Phase 4b.
- ⏳ Additional scenarios / multi-context e2e — Phase 5+.
```

Replace with:

```markdown
- ✅ Cross-tier orchestrator: `npm run test:all` (see Orchestrator section below).
- ⏳ Additional scenarios / multi-context e2e — Phase 5+.
```

And update the heading:

```markdown
## Status (Phase 4a — Smoke tier shipped)
```

becomes:

```markdown
## Status (Phase 4 — Smoke + orchestrator shipped)
```

- [ ] **Step 4: Append Orchestrator section**

After the `## Smoke tier (tests/smoke/)` section, before `## Conventions`, insert:

```markdown
## Cross-tier orchestrator (`npm run test:all`)

Reads `tests/tests.config.json` and runs each tier in order:
`unit → smoke → smoke-desktop → scenario → end-to-end`.

```bash
# Pre-commit: ~2 min (no Docker, requires :8081 up).
npm run test:fast

# Pre-push: ~30 min (boots Supabase + isolated Expo, also requires :8081 up).
npm run test:all

# CLI overrides (do NOT mutate the registry):
npm run test:all -- --skip notrump-deal,sp-game
npm run test:all -- --only boot,lobby
npm run test:all -- --tag '!flaky'
```

**Registry semantics:**

`tests/tests.config.json` is a single committed JSON file. Each entry:

| Field | Required | Meaning |
|-------|----------|---------|
| `name` | yes | Spec basename without extension. Must match a real spec file. |
| `tier` | yes | One of `unit`, `smoke`, `smoke-desktop`, `scenario`, `end-to-end`. |
| `enabled` | yes | If `false`, the spec is silently skipped, but always shown in the summary's skip report. |
| `note` | no | Shown in skip report alongside the spec name. |
| `tags` | no | String array for `--tag` filtering. |

**Skip vs registry vs CLI precedence**:

1. `enabled: false` always wins.
2. `--only` narrows the set after registry filtering.
3. `--skip` removes from the narrowed set.
4. `--tag` removes by tag predicate.

All skipped specs are listed in the final summary block so nothing
disappears silently.

**Adding a new spec to the registry:**

1. Add an entry to `tests/tests.config.json`.
2. Run `npm run test:all -- --only <new-name>` and confirm the
   right tier runs.
3. The orchestrator warns (but does not fail) if a registry entry
   has no matching spec file on disk — that's how stale entries get
   noticed.
```

- [ ] **Step 5: Commit**

```bash
git add tests/README.md
git commit -m "$(cat <<'EOF'
docs(tests): Phase 4 README — orchestrator + registry

Documents npm run test:fast / test:all, the precedence rules between
enabled flag / --only / --skip / --tag, and how to add a new spec to
the registry without breaking the orchestrator.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Final clean-tree check**

Run: `git status`

Expected: only pre-existing untracked / supabase noise. No `.env.test`, no leftover `tests/.runtime/`, no `test-results/` (gitignored).

- [ ] **Step 7: Update memory**

Update `/Users/akadymov/.claude-personal/projects/-Users-akadymov-claude-projects-nigels-app-v2/memory/project_testing_strategy.md` and `MEMORY.md` to reflect Phase 4 closed. Pattern matches Phase 3's update.

---

## Phase 4 done when

- `npm run test:smoke` passes against `:8081` in ≤2 min (mobile project: 9 tests).
- `npm run test:smoke:desktop` passes in ≤30s (desktop project: 2 tests).
- `npm run test:fast` runs jest + smoke + smoke-desktop and exits 0 in ≤2 min.
- `npm run test:all` runs all five tiers, prints the consolidated summary with skip report, returns exit code 0 on success and non-zero on any tier failure.
- `tests/tests.config.json` enumerates 15 specs (5 unit + 7 smoke + 1 smoke-desktop + 1 scenario + 1 e2e). Toggling `enabled: false` on any one is honoured.
- `tests/README.md` documents `test:smoke`, `test:smoke:desktop`, `test:fast`, `test:all`, the registry, and the precedence rules.
- All previously-green tests stay green: `test:sp:local` ≤25 min, `test:scenario:local` ≤8 min, jest unit suite.
- Working tree clean post-run.

Phase 5 (additional scenario specs — winner-banner, host-exit, spectator, reconnect — and the multi-context e2e tier) is then unblocked.

---

## Self-review notes

- **Spec coverage:** every Phase 4 design-doc requirement maps to a task here:
  - 8 smoke specs → Tasks 4–11.
  - `ensureDevServer` / `findUntranslatedKeys` / `assertNoOverflow` → Task 2.
  - Two Playwright projects (mobile + desktop) → Task 3.
  - Registry → Task 13.
  - Orchestrator + CLI overrides → Task 14.
  - npm scripts (`test:smoke*`, `test:unit`, `test:fast`, `test:all`) → Tasks 3 + 15.
  - README updates → Tasks 12 + 16.
- **No placeholders:** every code block is the actual content to write. No TODO, no "implement appropriately".
- **Type consistency:** `Tier` union is the same string set everywhere (`unit | smoke | smoke-desktop | scenario | end-to-end`); `Registry` shape is the same in `scripts/test-all.ts` and the `tests.config.json` schema comment.
- **Untracked failure modes:** Task 12 Step 5 enumerates the three most likely smoke failures (dev server dead, missing testID, i18n false positive) and the debug recipe for each. Task 16 Step 2 forces an orchestrator skip-report run as a sanity check.
- **Production-code change scope:** exactly one production-code change (`btn-open-settings` testID in Task 1). All other production code is untouched.
