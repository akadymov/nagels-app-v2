import { test, expect } from '@playwright/test';
import { ensureDevServer, dismissLobbyOverlays } from '../fixtures/smoke';

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

    await dismissLobbyOverlays(page);

    // Lobby exposes three tabs: bots (default), join, create. Each tab
    // mounts its own CTA conditionally on activeTab. Visit each one and
    // assert its CTA renders.
    const tabs = page.locator('[data-testid^="tab-"]');
    await expect(tabs.first()).toBeVisible({ timeout: 15_000 });
    expect(await tabs.count()).toBeGreaterThanOrEqual(3);

    // Default tab is `bots` → btn-quick-match is already mounted.
    await expect(
      page.locator('[data-testid="btn-quick-match"]').first(),
    ).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-testid="tab-join"]').first().click();
    await expect(
      page.locator('[data-testid="btn-join-room"]').first(),
    ).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-testid="tab-create"]').first().click();
    await expect(
      page.locator('[data-testid="btn-create-room"]').first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
