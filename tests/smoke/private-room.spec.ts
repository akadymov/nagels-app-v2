import { test, expect } from '@playwright/test';
import { ensureDevServer } from '../fixtures/smoke';

/**
 * Smoke 6/8 — join flow with a bad code surfaces an error.
 *
 * Why not test Create Room? Creating a real room is a side-effecting
 * mutation that hits Supabase and may fire a Telegram notification
 * (the `silent` flag is API-only in MVP, not exposed in the UI).
 * Smoke is supposed to be side-effect-free against the manual :8081
 * dev server, so this spec covers the join path with a bad code.
 */

test.beforeAll(async () => {
  await ensureDevServer();
});

test.describe('private room', () => {
  test('join with bad code shows an error', async ({ page }) => {
    await page.goto('/');
    await page
      .locator('[data-testid="btn-skip-to-lobby"]')
      .first()
      .click({ timeout: 15_000 });

    const joinInput = page.locator('[data-testid="input-join-code"]').first();
    await expect(joinInput).toBeVisible({ timeout: 10_000 });
    await joinInput.fill('ZZZZZZ');

    await page
      .locator('[data-testid="btn-join-room"]')
      .first()
      .click({ timeout: 5_000 });

    // The exact error testID is not standardized across the lobby — fall
    // back to "some visible text contains a known error fragment". Common
    // patterns: "not found", "Room not found", "no room", "invalid".
    const errorPattern = /not found|no such|invalid|cannot find/i;
    await expect(
      page.locator(`text=${errorPattern}`).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Lobby must still be reachable — we have NOT navigated away.
    await expect(
      page.locator('[data-testid="btn-quick-match"]').first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
