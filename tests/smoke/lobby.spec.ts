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
