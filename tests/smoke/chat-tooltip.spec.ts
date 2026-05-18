import { test, expect } from '@playwright/test';
import { ensureDevServer } from '../fixtures/smoke';
import {
  enterLobbyAsGuest,
  createRoomAsHost,
  joinRoomByCode,
} from '../fixtures/multiplayer';

/**
 * Smoke — chat tooltip surfaces above the sender's player chip when
 * the receiver's chat panel is closed, tap opens chat + dismisses, and
 * the bubble auto-fades after the 5s lifetime.
 *
 * Two anonymous-guest contexts share a private room. Alpha sends a
 * chat message; Bravo's WaitingRoom is the screen under test.
 *
 * Note: smoke specs usually avoid Supabase mutations, but the tooltip
 * pipeline is realtime-end-to-end and cannot be exercised without a
 * real chat round-trip. The room is throwaway (2-player private) and
 * the test never starts the game, so the blast radius is one row in
 * `rooms` + one in `room_players` per test run.
 */

test.beforeAll(async () => {
  await ensureDevServer();
});

test.describe('chat tooltip', () => {
  test('surfaces above sender chip, opens chat on tap', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      await enterLobbyAsGuest(pageA);
      await enterLobbyAsGuest(pageB);

      const code = await createRoomAsHost(pageA, 2, 'alpha');
      await joinRoomByCode(pageB, code, 'bravo');

      // Alpha sends a chat message.
      await pageA.locator('[data-testid="waiting-btn-chat"]').first()
        .click({ timeout: 10_000 });
      const input = pageA.locator('[data-testid="chat-input"]').first();
      await input.waitFor({ state: 'visible', timeout: 5_000 });
      await input.fill('hello bravo');
      await pageA.locator('[data-testid="chat-send"]').first()
        .click({ timeout: 5_000 });
      await pageA.locator('[data-testid="chat-close"]').first()
        .click({ timeout: 5_000 });

      // Bravo's chat panel is closed → tooltip surfaces over Alpha's chip.
      const tooltip = pageB.locator('[data-testid^="chat-tooltip-"]').first();
      await tooltip.waitFor({ state: 'visible', timeout: 10_000 });
      await expect(tooltip).toContainText('hello bravo');

      // Tap → chat opens on Bravo's side, tooltip clears.
      await tooltip.click();
      await pageB.locator('[data-testid="chat-input"]').first()
        .waitFor({ state: 'visible', timeout: 5_000 });
      await expect(
        pageB.locator('[data-testid^="chat-tooltip-"]'),
      ).toHaveCount(0);
    } finally {
      await ctxA.close().catch(() => {});
      await ctxB.close().catch(() => {});
    }
  });

  test('auto-dismisses after 5 seconds', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      await enterLobbyAsGuest(pageA);
      await enterLobbyAsGuest(pageB);

      const code = await createRoomAsHost(pageA, 2, 'alpha');
      await joinRoomByCode(pageB, code, 'bravo');

      await pageA.locator('[data-testid="waiting-btn-chat"]').first()
        .click({ timeout: 10_000 });
      const input = pageA.locator('[data-testid="chat-input"]').first();
      await input.waitFor({ state: 'visible', timeout: 5_000 });
      await input.fill('quick');
      await pageA.locator('[data-testid="chat-send"]').first()
        .click({ timeout: 5_000 });
      await pageA.locator('[data-testid="chat-close"]').first()
        .click({ timeout: 5_000 });

      const tooltip = pageB.locator('[data-testid^="chat-tooltip-"]').first();
      await tooltip.waitFor({ state: 'visible', timeout: 10_000 });

      // 5s lifetime + 200ms fade-out + slack.
      await pageB.waitForTimeout(6_500);
      await expect(
        pageB.locator('[data-testid^="chat-tooltip-"]'),
      ).toHaveCount(0);
    } finally {
      await ctxA.close().catch(() => {});
      await ctxB.close().catch(() => {});
    }
  });
});
