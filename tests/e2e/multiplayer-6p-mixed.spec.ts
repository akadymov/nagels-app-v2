'use strict';

/**
 * Phase 6 — Multi-context multiplayer e2e.
 *
 * 6 players in one real Supabase-backed room:
 *   P0..P3 — mobile  (iPhone 15 Pro Max @ 430×932)
 *   P4..P5 — desktop (1440×900)
 *
 * P5 (desktop) is host. The other five join via the captured room
 * code, all six mark Ready, host starts the game, and each context
 * runs a parallel game loop until the scoreboard winner banner
 * appears. Spec passes when ALL six pages observe game-over.
 *
 * Backed by the isolated :8082 Expo + local Supabase stack via
 * Playwright globalSetup (same as test:scenario:local and
 * test:sp:local). The manual :8081 dev server is untouched.
 *
 * See docs/superpowers/specs/2026-05-17-testing-phase-6-multiplayer-design.md.
 */

import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  createRoomAsHost,
  joinRoomByCode,
  markReady,
  startGame,
  runGameLoop,
  enterLobbyAsGuest,
} from '../fixtures/multiplayer';

const MOBILE_VP = {
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 ' +
    'Mobile/15E148 Safari/604.1',
} as const;

const DESKTOP_VP = {
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  isMobile: false,
  hasTouch: false,
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
} as const;

const ROSTER = [
  { label: 'P0', vp: MOBILE_VP, role: 'guest' as const },
  { label: 'P1', vp: MOBILE_VP, role: 'guest' as const },
  { label: 'P2', vp: MOBILE_VP, role: 'guest' as const },
  { label: 'P3', vp: MOBILE_VP, role: 'guest' as const },
  { label: 'P4', vp: DESKTOP_VP, role: 'guest' as const },
  { label: 'P5', vp: DESKTOP_VP, role: 'host' as const },
];

const PLAYER_COUNT = ROSTER.length;
const HOST_IDX = ROSTER.findIndex((r) => r.role === 'host');

// 60-minute hard ceiling. First successful headless run reached
// hand 13/20 at the 30-min mark on the 24 GB MacBook — roughly
// 2.5 min/hand, so 20 hands lands around 50 min wall-clock. Add
// 10 min slack for boot, room sync, and one transient retry.
// Headed mode (TILE_WINDOWS=1 / test:mp:local:headed) is a few
// minutes slower due to slowMo, still fits the budget.
test.setTimeout(60 * 60 * 1000);

test('6p mixed (4 mobile + 2 desktop) full game to scoreboard', async ({
  browser,
}: {
  browser: Browser;
}) => {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  try {
    // ── Spin up 6 contexts ───────────────────────────────────────
    for (const slot of ROSTER) {
      const ctx = await browser.newContext({ ...slot.vp });
      contexts.push(ctx);
      const page = await ctx.newPage();
      pages.push(page);
      // Surface unexpected alerts/console errors in the test log so
      // a failure is easy to attribute to a specific player.
      page.on('dialog', async (d) => {
        // eslint-disable-next-line no-console
        console.log(
          `[mp:${slot.label}] 🚨 dialog (${d.type()}): ${d
            .message()
            .replace(/\s+/g, ' ')
            .slice(0, 200)}`,
        );
        await d.dismiss().catch(() => {});
      });
      page.on('pageerror', (e) => {
        // eslint-disable-next-line no-console
        console.log(`[mp:${slot.label}] 🛑 pageerror: ${e.message.slice(0, 200)}`);
      });
    }

    // ── Step 1: every player enters the Lobby ────────────────────
    // Stagger by 400ms so the bundler's first compile doesn't get
    // hammered by 6 simultaneous /index.bundle requests.
    await Promise.all(
      pages.map((p, i) =>
        new Promise<void>((resolve) =>
          setTimeout(() => enterLobbyAsGuest(p).then(resolve), i * 400),
        ),
      ),
    );

    // ── Step 2: host creates the room ────────────────────────────
    const code = await createRoomAsHost(
      pages[HOST_IDX],
      PLAYER_COUNT,
      ROSTER[HOST_IDX].label,
    );
    // eslint-disable-next-line no-console
    console.log(`[mp] room code: ${code}`);

    // ── Step 3: other five join via the code ─────────────────────
    // Joins are SERIAL on purpose: parallel anonymous joins race
    // against the edge function's seat-allocation and one player
    // gets "Seat already taken — try again." from join_room. Five
    // sequential joins add ~10s wall-clock — cheap insurance.
    for (let i = 0; i < ROSTER.length; i += 1) {
      if (i === HOST_IDX) continue;
      await joinRoomByCode(pages[i], code, ROSTER[i].label);
    }

    // Give the realtime store a beat to propagate the new roster
    // to all six clients before everyone hits Ready.
    await pages[0].waitForTimeout(2_000);

    // ── Step 4: all six mark Ready ───────────────────────────────
    // The host's UI shows btn-start-game once N-1 guests are ready —
    // there's no Ready button for the host themselves.
    await Promise.all(
      ROSTER.map((_, i) => (i === HOST_IDX ? Promise.resolve() : markReady(pages[i]))),
    );
    await pages[HOST_IDX].waitForTimeout(2_500);

    // ── Step 5: host starts the game ─────────────────────────────
    await startGame(pages[HOST_IDX]);

    // Give the deal animation a moment so every page mounts the
    // betting UI before the loop starts polling for tryBet.
    await pages[0].waitForTimeout(4_000);

    // ── Step 6: parallel game loops ──────────────────────────────
    const results = await Promise.all(
      pages.map((p, i) => runGameLoop(p, { label: ROSTER[i].label })),
    );

    // Every player must observe game-over. If any returned
    // 'idle-timeout' or 'budget-exhausted' the spec fails with the
    // attributing label in the assertion message.
    for (let i = 0; i < results.length; i += 1) {
      expect(
        results[i],
        `[mp:${ROSTER[i].label}] expected 'game-over', got '${results[i]}'`,
      ).toBe('game-over');
    }

    // ── Step 7: belt-and-suspenders — assert the banner is visible
    //          on at least one mobile and one desktop page ────────
    const bannerVisible = await Promise.all(
      pages.map((p) =>
        p
          .locator('[data-testid="scoreboard-winner-banner"]')
          .first()
          .isVisible({ timeout: 5_000 })
          .catch(() => false),
      ),
    );
    expect(
      bannerVisible.slice(0, 4).some(Boolean),
      'at least one mobile player should still show the winner banner',
    ).toBe(true);
    expect(
      bannerVisible.slice(4).some(Boolean),
      'at least one desktop player should still show the winner banner',
    ).toBe(true);
  } finally {
    // Always close contexts, even on failure — orphaned browser
    // processes pile up fast at 6-per-run.
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  }
});
