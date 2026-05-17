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
