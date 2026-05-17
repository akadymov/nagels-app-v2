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
