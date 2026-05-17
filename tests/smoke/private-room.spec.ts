import { test, expect } from '@playwright/test';
import { ensureDevServer, dismissLobbyOverlays } from '../fixtures/smoke';

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

    await dismissLobbyOverlays(page);

    // Default tab is `bots`; the join code input lives on the `join` tab.
    await page
      .locator('[data-testid="tab-join"]')
      .first()
      .click({ timeout: 10_000 });

    const joinInput = page.locator('[data-testid="input-join-code"]').first();
    await expect(joinInput).toBeVisible({ timeout: 10_000 });
    await joinInput.fill('ZZZZZZ');

    // The Lobby surfaces join errors via window.alert (RNW falls back to
    // native Alert.alert which on web is `window.alert`). Playwright
    // intercepts these as `dialog` events — capture the message and
    // assert it surfaces an error of some sort. Pattern covers the two
    // failure paths exercised by this smoke:
    //   - guest with no auth   → "not_signed_in" / "Something went wrong"
    //   - signed-in user, bad code → "Room not found" / "invalid"
    const errorPattern = /not found|invalid|cannot|not_signed|something went wrong|wrong/i;
    const dialogMsg = new Promise<string>((resolve) => {
      page.once('dialog', async (d) => {
        const msg = d.message();
        await d.dismiss().catch(() => {});
        resolve(msg);
      });
    });

    await page
      .locator('[data-testid="btn-join-room"]')
      .first()
      .click({ timeout: 5_000 });

    // 30s budget covers TILE_WINDOWS=1 parallel mode where 6 smoke
    // specs hit :8081 simultaneously and the join request can take
    // 10–15s under load. Serial runs resolve in <1s.
    const msg = await Promise.race([
      dialogMsg,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('No dialog within 30s')), 30_000),
      ),
    ]);
    expect(msg).toMatch(errorPattern);

    // Lobby must still be reachable — we have NOT navigated away.
    await expect(
      page.locator('[data-testid="tab-join"]').first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
