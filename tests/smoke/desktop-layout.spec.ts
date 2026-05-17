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
    // Desktop renders DesktopWelcomeAuth (welcome+auth split) instead of
    // the plain WelcomeScreen; the continue CTA has a different testID.
    await page
      .locator('[data-testid="desktop-welcome-continue"]')
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
    // Desktop renders DesktopWelcomeAuth (welcome+auth split) instead of
    // the plain WelcomeScreen; the continue CTA has a different testID.
    await page
      .locator('[data-testid="desktop-welcome-continue"]')
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
