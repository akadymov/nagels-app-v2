# Testing strategy — Phase 4 (Smoke tier + orchestrator) Design

> Companion to `2026-05-16-testing-strategy-design.md`. Phase 1 (foundation),
> Phase 2 (local Supabase + isolated Expo on `:8082`), and Phase 3 (fixtures
> + POC scenario) all shipped on `main`. Phase 4 adds the smoke tier and
> the cross-tier orchestrator.

## Why now

Smoke catches the cheapest class of bug — "the app doesn't even render" —
and is the layer most likely to fire before every release. We want it fast
enough to run on a whim while a feature branch is open, not just when a full
backend is up.

The orchestrator (`npm run test:all`) ties the four tiers together so a
single command produces a release-readiness verdict, and the registry
(`tests/tests.config.json`) lets known-broken specs be muted without
deleting them — they show up in the final report so nothing is silently
disabled.

## Goals

- 8 smoke specs covering boot, navigation, modals, settings, i18n, and
  desktop layout. Mobile-first; one desktop-only spec for split-pane
  invariants.
- Smoke runs against the manual `:8081` dev server. No Docker, no Supabase
  boot. Total tier runtime ≤ 2 min.
- Registry: a single committed JSON file lists every spec across every
  tier with an `enabled` flag and optional `note`. Disabled specs do not
  run but always appear in the final report.
- Orchestrator: `npm run test:all` runs all four tiers in order, respects
  the registry, supports `--skip`, `--only`, and `--tag` CLI overrides,
  and prints one consolidated summary.

## Non-goals

- Auto-starting the dev server. Smoke fails with a clear "start `npx expo
  start --port 8081` first" error if `:8081` is not reachable. Rationale:
  the suite is for the developer who already has the app open in a
  browser, and auto-spawning risks colliding with an already-running
  bundler.
- Pixel-diff screenshots. DOM smoke + layout-invariant checks only,
  consistent with the original strategy doc.
- CI workflow files. Phase 4 makes a future CI hook trivial but doesn't
  add `.github/workflows/*`.
- Real authentication submission. The auth-modals spec opens and dismisses
  modals without filling forms.
- Touch-event simulation in the desktop project. 1440×900 with mouse
  pointer events is enough for layout invariants.

## Architecture

### Two new Playwright projects

`playwright.config.js` gains two entries alongside the existing `e2e` and
`scenario` projects:

```js
{ name: 'smoke',         testDir: './tests/smoke',
  use: { /* inherits mobile viewport from top-level use */ } },
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
```

Both share the same `testDir`. The `testMatch` on `smoke-desktop` narrows
it to a single file; the other 7 specs run only in the mobile `smoke`
project. The existing top-level `testMatch` (`**/*.spec.{js,ts}`) still
applies and is overridden per-project where needed.

### Smoke spec inventory (8 specs)

All under `tests/smoke/`. Mobile viewport unless noted.

| # | Spec | What it proves | Runtime |
|---|------|---------------|---------|
| 1 | `boot.spec.ts` | Welcome renders; "Skip to Lobby" CTA navigates to Lobby. | ~5s |
| 2 | `lobby.spec.ts` | Lobby tabs switch (Quick Match / Create / Join). All three CTAs visible and enabled. | ~10s |
| 3 | `auth-modals.spec.ts` | Sign In, Create Account, Reset Password modals open from Settings and dismiss via X. No form submission. | ~15s |
| 4 | `settings.spec.ts` | Light↔Dark toggle flips theme class. Language switcher cycles EN→RU→ES→EN, on each pass strings on visible elements update. No overflow on mobile. | ~15s |
| 5 | `quickmatch-entry.spec.ts` | Quick Match → game table mounts. `my-hand` and at least one `bet-btn-*` visible. Does NOT play any cards. Returns to Lobby via End-the-game. | ~20s |
| 6 | `private-room.spec.ts` | Create Room (`silent: true` via UI flag) → room code visible, copyable. Open Join → enter bad code → error appears. | ~15s |
| 7 | `i18n.spec.ts` | Walks EN→RU→ES, on each pass asserts (a) Settings + Lobby + Welcome have no DOM nodes matching the missing-i18n-key pattern `/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/`, (b) visible text length stays within container bounds on mobile (no truncation arrows). | ~25s |
| 8 | `desktop-layout.spec.ts` (desktop project, 1440×900) | For each of Lobby and an in-progress SP game: (a) `document.body.scrollWidth ≤ window.innerWidth + 1`, (b) split-pane bounding rects do not overlap (`leftPane.right ≤ rightPane.left + 1`). | ~15s |

Total expected wall-clock: ≤2 min.

### Shared smoke helpers — `tests/fixtures/smoke.ts`

Three helpers, all small:

```ts
// Probe :8081 once; if dead, throw with the start command.
export async function ensureDevServer(): Promise<void>;

// Walk visible text nodes under a root, return any that match the
// missing-i18n-key heuristic. Used by i18n.spec.ts.
export async function findUntranslatedKeys(page: Page, root?: Locator): Promise<string[]>;

// Assert no horizontal scroll + (optionally) named split panes don't
// overlap. Used by desktop-layout.spec.ts.
export async function assertNoOverflow(
  page: Page,
  splitPanes?: { left: string; right: string },
): Promise<void>;
```

No new wide-scope abstractions. These wrap a few Playwright primitives
each. Smoke specs that don't need them just import `actions.ts` helpers
from Phase 3.

### Registry — `tests/tests.config.json`

Single committed file. Hand-edited. Source of truth for what's enabled.

```json
{
  "specs": [
    { "name": "createRoom",            "tier": "unit",       "enabled": true  },
    { "name": "gameLoop",              "tier": "unit",       "enabled": true  },
    { "name": "push-transitions",      "tier": "unit",       "enabled": true  },
    { "name": "push-i18n",             "tier": "unit",       "enabled": true  },
    { "name": "telegram",              "tier": "unit",       "enabled": true  },
    { "name": "boot",                  "tier": "smoke",      "enabled": true  },
    { "name": "lobby",                 "tier": "smoke",      "enabled": true  },
    { "name": "auth-modals",           "tier": "smoke",      "enabled": true  },
    { "name": "settings",              "tier": "smoke",      "enabled": true  },
    { "name": "quickmatch-entry",      "tier": "smoke",      "enabled": true  },
    { "name": "private-room",          "tier": "smoke",      "enabled": true  },
    { "name": "i18n",                  "tier": "smoke",      "enabled": true  },
    { "name": "desktop-layout",        "tier": "smoke",      "enabled": true  },
    { "name": "notrump-deal",          "tier": "scenario",   "enabled": true  },
    { "name": "sp-game",               "tier": "end-to-end", "enabled": true  }
  ]
}
```

Schema:

```ts
interface Registry {
  specs: Array<{
    name: string;           // matches spec file basename without .spec.ts
    tier: 'unit' | 'smoke' | 'scenario' | 'end-to-end';
    enabled: boolean;
    note?: string;          // shown in skip report when enabled=false
    tags?: string[];        // for --tag filtering ('flaky', 'slow', etc.)
  }>;
}
```

The orchestrator validates the file at startup (every `name` must map to
exactly one spec file on disk; unknown specs warn but don't fail).

### Orchestrator — `scripts/test-all.ts`

Standalone TypeScript file, invoked via `npm run test:all`.

**Flow:**

1. Parse CLI args. Support `--skip a,b`, `--only c,d`, `--tag '!flaky'`.
2. Read `tests/tests.config.json`. Build the effective enabled set: start
   from `enabled: true` entries, apply `--only` (intersect) and `--skip`
   (subtract) and `--tag` (filter by tag predicate).
3. For each tier in order `unit → smoke → smoke-desktop → scenario → e2e`:
   - **unit**: invoke `jest --no-coverage --testPathPattern '<list>'`
     where `<list>` is built from the enabled unit specs. If empty,
     skip the tier.
   - **smoke / smoke-desktop**: invoke `playwright test --project=smoke
     --grep '<list>'` (or `--project=smoke-desktop`) where `<list>` is
     `(boot|lobby|...)`. The dev server is assumed running on `:8081`;
     a single `ensureDevServer()` probe happens up-front and fails the
     whole run with an actionable error if `:8081` is dead.
   - **scenario / e2e**: invoke `LOCAL_SUPABASE=1 HEADLESS=1
     DEMO_URL=http://localhost:8082 playwright test --project=<tier>
     --grep '<list>'`. Supabase boots once per tier (global-setup) and
     stops at teardown; the orchestrator does not coordinate Supabase
     across tiers — each tier owns its own backend.
4. Aggregate exit codes. The run fails if any tier failed.
5. Print a single summary block:

   ```
   ===== test:all summary =====
   unit            : 5 passed,  0 failed,  0 skipped
   smoke           : 7 passed,  0 failed,  0 skipped
   smoke-desktop   : 1 passed,  0 failed,  0 skipped
   scenario        : 1 passed,  0 failed,  0 skipped
   end-to-end      : 1 passed,  0 failed,  0 skipped

   Skipped specs (5):
     - play-again       (scenario)   [enabled=false] waits on backlog item
     - host-exit        (scenario)   [--skip]
     - ...

   Result: ✓ all enabled specs passed (~28 min)
   ```

Exit code 0 only if every tier returned 0 and no `--strict-skip` violations.

**Tag filter syntax** (`--tag`):
- `--tag flaky` → only specs whose `tags` include `flaky`.
- `--tag '!flaky'` → exclude specs tagged `flaky`.
- `--tag a,b` → either tag matches (OR).
- `--tag '!flaky,!slow'` → exclude either.

**Skip vs registry vs CLI precedence**:

| Source | Effect |
|--------|--------|
| `enabled: false` in registry | Always skipped, listed in report |
| `--skip <name>` CLI | Always skipped, listed in report with `[--skip]` |
| `--only <name>` CLI | Restrict to listed names; everything else listed as `[not in --only]` |
| `--tag '!x'` CLI | Filter by tag; matched-out specs listed with `[tag filter]` |

CLI overrides do NOT modify the registry file.

### Failure modes and recovery

- **`:8081` is dead** — orchestrator exits before any tier runs, prints
  the start command, exit code 2.
- **Smoke spec discovers an untranslated key** — `i18n.spec.ts` fails
  with a list of the offending strings. No flaky retry.
- **Desktop spec sees overflow** — fails with the offending pane name
  and the measured widths.
- **Registry references a missing spec file** — orchestrator prints a
  warning and continues. (Stale entries are common during refactors; a
  hard fail would block the run.)
- **A tier's exit code is non-zero** — orchestrator continues to the
  next tier and reports the failure at the end. Rationale: smoke
  catching one regression shouldn't hide an unrelated scenario failure
  that would also have been caught.

## File structure

**Created:**

```
tests/
├── smoke/
│   ├── boot.spec.ts
│   ├── lobby.spec.ts
│   ├── auth-modals.spec.ts
│   ├── settings.spec.ts
│   ├── quickmatch-entry.spec.ts
│   ├── private-room.spec.ts
│   ├── i18n.spec.ts
│   └── desktop-layout.spec.ts
├── fixtures/
│   └── smoke.ts                       # new
└── tests.config.json                  # registry
scripts/
└── test-all.ts                        # orchestrator
```

**Modified:**

- `playwright.config.js` — add `smoke` + `smoke-desktop` projects.
- `package.json` — add scripts: `test:smoke`, `test:smoke:desktop`,
  `test:unit`, `test:all`. The existing `test:sp*` and
  `test:scenario:local` stay.
- `tests/README.md` — Phase 4 status, scenario→smoke flow, orchestrator
  usage.

**Untouched:**

- All `src/`.
- `tests/playwright/*` (global setup/teardown stays scenario+e2e-only).
- `tests/fixtures/actions.ts`, `tests/fixtures/seed.ts`.
- `tests/e2e/sp-game.spec.js`.
- `tests/scenario/notrump-deal.spec.ts`.
- `supabase/*`.

## Sub-phase order

Phase 4 ships in two halves to keep verification cheap:

**Phase 4a — smoke specs (~6 hours):**
1. Add `tests/fixtures/smoke.ts`.
2. Add the 7 mobile smoke specs.
3. Add the 1 desktop spec.
4. Wire both Playwright projects.
5. Add `npm run test:smoke` + `npm run test:smoke:desktop`.
6. Update README.
7. Verify: `test:smoke` ≤90s green, `test:smoke:desktop` ≤30s green.

**Phase 4b — orchestrator (~3 hours):**
8. Write `tests/tests.config.json` with all current specs enabled.
9. Write `scripts/test-all.ts`.
10. Add `npm run test:unit` + `npm run test:all`.
11. Add registry validation step.
12. Verify: `test:all` runs all four tiers end-to-end, prints the
    summary, returns the right exit code on a forced failure.

The two halves are independently shippable. If Phase 4a green-lights but
4b drags, smoke alone is still a meaningful pre-push check.

## Conventions

- All smoke specs call `ensureDevServer()` in `test.beforeAll` so a dead
  `:8081` fails fast and clearly.
- All smoke specs are idempotent: any clicks they make are reversed
  before the test exits (modals closed, language reset to EN, theme
  reset to system default). The browser context is fresh per test
  anyway, but resetting visible mutations also helps when watching
  headed.
- `silent: true` flag on Create Room comes from the existing UI flag
  (Phase 1 wiring). Smoke does not bypass it.
- No `await sleep(...)` longer than 1s anywhere in smoke. If a step
  needs more than 1s, the assertion should be `expect(...).toBeVisible()`
  with a timeout, not a raw sleep.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| `:8081` user-state pollution between specs (e.g. already-logged-in guest, cached room codes) leaks across runs and flakes tests. | Each spec begins with `page.goto('/')` and an `await page.context().clearCookies()` + `localStorage.clear()` via `addInitScript`. Eliminates session reuse. |
| i18n missing-key regex over-matches (e.g. `something.tsx` in copy). | Spec uses a tight pattern: lowercase letter, optional alphanumerics, then 1+ `.lowercase` segments. Add an allow-list of false positives in `smoke.ts` if needed (start empty). |
| Desktop project ignores the mobile-first user-agent / device-pixel-ratio differences. | Spec asserts layout properties only (no UA-dependent CSS branches). The `isMobile: false` override is the only required difference. |
| `npm run test:all` takes ~30 min — too long to run before every commit. | Add `npm run test:fast` = unit + smoke (~2 min) in Phase 4b. Document it in the README as the pre-commit check; `test:all` is the pre-push check. |
| Orchestrator becomes its own untested code path. | `scripts/test-all.ts` is ~150 lines and exercised by every release run. Add a small smoke check: invoke `test:all -- --only nonexistent` and assert exit code 2 with "no specs match" error. |
| Registry drifts (new spec added, registry not updated). | Orchestrator warns on disk specs that aren't in the registry. Akula sees the warning in the next run. |

## Success criteria

Phase 4 is done when:

- `npm run test:smoke` runs all 7 mobile specs against `:8081`, finishes
  in ≤2 min, prints a Playwright "X passed" summary.
- `npm run test:smoke:desktop` runs `desktop-layout.spec.ts`, finishes
  in ≤30s.
- `npm run test:all` runs unit + smoke + smoke-desktop + scenario + e2e
  in order against the right backends, prints the consolidated summary
  with skip reasons, returns exit code 0 on success and non-zero on any
  failure.
- `tests/tests.config.json` enumerates every shipped spec across all
  four tiers; toggling `enabled: false` on any spec is honoured by
  `test:all`.
- `tests/README.md` documents `test:smoke`, `test:smoke:desktop`,
  `test:fast`, `test:all`, and the registry semantics.
- All previously-green tests stay green: `test:sp:local`,
  `test:scenario:local`, jest unit suite.
- `tests/.runtime/`, `.env.test`, `test-results/` remain gitignored;
  working tree clean post-run.

Phase 5 is then free to add scenario specs (winner-banner, host-exit,
spectator, reconnect) and the multi-context e2e tier.
