'use strict';

/**
 * Smoke — Conditional Stakes (Task 21).
 *
 * Two confirmed-email users enter the lobby, host creates a 2-player
 * room, picks stake=5, the second player opts in, and the ★ badge
 * for the second player appears in the host's roster.
 *
 * Why two registered users: the opt-in switch is disabled for guests
 * (selfEligible === false), so a 2-guest run can't exercise the
 * opt-in toggle. The fixture uses the pre-seeded prod accounts
 * (alice|bob@nigels.test) the demo spec already relies on.
 */

import { test, expect } from '@playwright/test';
import { ensureDevServer } from '../fixtures/smoke';
import {
  enterLobbyAsRegisteredUser,
  createRoomAsHost,
  joinRoomByCode,
} from '../fixtures/multiplayer';

const MOBILE_VP = {
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
} as const;

test.beforeAll(async () => {
  await ensureDevServer();
});

test.describe('stakes waitingroom', () => {
  test('host picks stake, second logged-in player opts in', async ({
    browser,
  }) => {
    const ctxA = await browser.newContext({ ...MOBILE_VP });
    const ctxB = await browser.newContext({ ...MOBILE_VP });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      await enterLobbyAsRegisteredUser(pageA, 'alice@nigels.test', 'host');
      await enterLobbyAsRegisteredUser(pageB, 'bob@nigels.test', 'guest');

      const code = await createRoomAsHost(pageA, 2, 'host');
      await joinRoomByCode(pageB, code, 'guest');

      // Host picks stake=5.
      await pageA
        .locator('[data-testid="stake-chip-5"]')
        .first()
        .click({ timeout: 5_000 });

      // Wait for the optin row to materialize on B (it only renders
      // once room.stake > 0 propagates via realtime/snapshot).
      const optinB = pageB.locator('[data-testid="stake-optin-toggle"]').first();
      await optinB.waitFor({ state: 'visible', timeout: 8_000 });
      await optinB.click({ timeout: 5_000 });

      // The ★ badge appears in the host's roster for whichever seat
      // B occupies. We don't pin the seat — either seat-0 or seat-1
      // works (host could be seated first or second depending on
      // server ordering, though host is typically seat 0). Match any
      // stake-star-* in the host view.
      const star = pageA.locator('[data-testid^="stake-star-"]').first();
      await expect(star).toBeVisible({ timeout: 8_000 });
    } finally {
      await ctxA.close().catch(() => {});
      await ctxB.close().catch(() => {});
    }
  });
});
