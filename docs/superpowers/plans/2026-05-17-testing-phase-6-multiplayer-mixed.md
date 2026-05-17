# Testing strategy — Phase 6 (Multi-context e2e) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Tasks use checkbox (`- [ ]`) syntax.

**Goal:** Ship `tests/e2e/multiplayer-6p-mixed.spec.ts` and supporting fixtures, plumbed through orchestrator. Reference spec: `docs/superpowers/specs/2026-05-17-testing-phase-6-multiplayer-design.md`.

## File structure

**Created:**

- `tests/fixtures/multiplayer.ts` — `createRoomAsHost`, `joinRoomByCode`, `markReady`, `startGame`, `runGameLoop`
- `tests/e2e/multiplayer-6p-mixed.spec.ts` — the spec

**Modified:**

- `tests/tests.config.json` — registry entry
- `package.json` — `test:mp` + `test:mp:local` scripts
- `tests/README.md` — Phase 6 status, multiplayer spec section
- `README.md` — pointer line update if needed

**Untouched:** all of `src/`, all other tests, Supabase config, demo scripts.

---

## Task 1: `tests/fixtures/multiplayer.ts`

**Files:** Create `tests/fixtures/multiplayer.ts`

Port from `demo/play-demo.js`:
- `createRoom` (line 233) → `createRoomAsHost(page, playerCount)`
- `joinRoom` (line 247) → `joinRoomByCode(page, code)`
- `gameLoop` (line 397) → `runGameLoop(page, opts)`

Adapt:
- TS types (`Page` from `@playwright/test`)
- Reuse `dismissTipIfAny`, `dismissPwaModalIfAny`, `tryBet`, `tryPlay`, `tap`, `sleep` from `tests/fixtures/actions.ts`
- Logging: `console.log(\`[mp:P${i}] ...\`)` instead of demo's `log(name, msg)` helper — keeps Playwright reporter clean.
- Remove demo-only branches: no chat sends, no last-trick replay, no profile customisation.

Verification:
- `npx tsc --noEmit tests/fixtures/multiplayer.ts` (with the same flags Phase 4 used).

Commit: `test(fixtures): multiplayer.ts — port room+gameLoop helpers`.

---

## Task 2: `tests/e2e/multiplayer-6p-mixed.spec.ts`

**Files:** Create `tests/e2e/multiplayer-6p-mixed.spec.ts`

Structure:

```ts
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  createRoomAsHost, joinRoomByCode, markReady, startGame, runGameLoop,
} from '../fixtures/multiplayer';
import { dismissPwaModalIfAny } from '../fixtures/actions';

const MOBILE = { width: 430, height: 932, isMobile: true, hasTouch: true };
const DESKTOP = { width: 1440, height: 900, isMobile: false, hasTouch: false };
const VPS = [MOBILE, MOBILE, MOBILE, MOBILE, DESKTOP, DESKTOP];

test.setTimeout(45 * 60 * 1000);  // 45-min budget

test('6p mixed (4 mobile + 2 desktop) full game to scoreboard', async ({ browser }) => {
  const ctxs: BrowserContext[] = [];
  const pages: Page[] = [];
  for (const vp of VPS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.hasTouch,
    });
    ctxs.push(ctx);
    pages.push(await ctx.newPage());
  }
  // ... dialog/error handlers per page

  // 1. all skip-to-lobby, dismiss PWA modal
  // 2. host (page 5, desktop) creates room → captures code
  // 3. players 0-4 join via code
  // 4. all 6 ready
  // 5. host starts
  // 6. parallel gameLoop, await all
  // 7. each page asserts scoreboard-winner-banner

  // cleanup: contexts close on test end
});
```

Key constraints:
- `test.setTimeout(45 * 60 * 1000)` — overrides the 30-min config default.
- Wrap context creation in a `try`/`finally` so contexts close on any failure.
- Capture `page.on('dialog')` for each page early — surface unexpected alerts in test output.

Verification:
- `npx playwright test --list` shows the new spec under `[e2e]`.

Commit: `test(e2e): multiplayer-6p-mixed.spec.ts — 4 mobile + 2 desktop full game`.

---

## Task 3: Registry + npm scripts

**Files:** modify `tests/tests.config.json`, `package.json`

Registry: insert before `sp-game`:

```json
{ "name": "multiplayer-6p-mixed", "tier": "end-to-end",    "enabled": true  },
```

`package.json`: insert after `test:scenario:local`:

```json
"test:mp": "playwright test tests/e2e/multiplayer-6p-mixed.spec.ts",
"test:mp:local": "LOCAL_SUPABASE=1 HEADLESS=1 DEMO_URL=http://localhost:8082 playwright test tests/e2e/multiplayer-6p-mixed.spec.ts",
```

Verification:
- `node -e "const r=require('./tests/tests.config.json'); console.log(r.specs.length, r.specs.map(s=>s.name).filter(n=>n.startsWith('multi')));"` prints `14 [ 'multiplayer-6p-mixed' ]`.

Commit: `test(orchestrator): register multiplayer-6p-mixed in e2e tier`.

---

## Task 4: Verify against :8082

**Pre-flight:**
- `lsof -i :8082` empty.
- `docker ps --filter "name=supabase"` empty (else `supabase stop`).
- `vm_stat | head -3` shows ≥ 4 GB free + inactive.

Run: `npm run test:mp:local 2>&1 | tee /tmp/mp-run.log`

Expected: `1 passed (~30 min)` then `[global-teardown] expo killed`, `Stopped containers`.

If failure → inspect `test-results/<spec>/trace.zip` with `npx playwright show-trace`.

Likely failure modes + recipes:
- **Memory denied by guard** → close Chrome, retry.
- **Room code never captures** → check `[data-testid="room-code"]` selector matches WaitingRoom UI.
- **Game loop stalls at some hand** → onboarding tip not dismissed for that player; widen the tip selector.
- **Scoreboard times out** → bump `runGameLoop` watchdog, or the game is hung (sync bug — file an issue).

Do NOT commit anything from this task unless the run is green.

---

## Task 5: README + memory

**Files:** modify `tests/README.md`, `README.md`, `~/.claude-personal/.../project_testing_strategy.md`, `~/.claude-personal/.../MEMORY.md`.

`tests/README.md`:
- Status section: tick Phase 6, mention new spec.
- Running table: add `test:mp:local` row.
- New `## Multiplayer e2e (tests/e2e/multiplayer-6p-mixed.spec.ts)` section: how it works, viewport mix, debugging recipe.

`README.md`: pointer line updated if helpful, but the existing "Full docs" link to `tests/README.md` is enough.

Memory:
- `project_testing_strategy.md`: append Phase 6 status block (mirrors Phase 4's).
- `MEMORY.md`: bump description.

Commit: `docs(tests): Phase 6 — multiplayer e2e shipped`.

---

## Phase 6 done when

- `npm run test:mp:local` exits 0.
- `npm run test:all` runs all 6 tiers + multiplayer in e2e, exits 0 (total ~55 min on the 24 GB MacBook).
- `tests/tests.config.json` lists `multiplayer-6p-mixed`; toggling `enabled: false` honoured.
- `tests/README.md` documents the new spec + scripts.
- Memory updated.

Phase 6.1+ (host-exit, reconnect, spectator) unblocked.
