import { test, expect } from '@playwright/test';
import { ensureDevServer } from '../fixtures/smoke';

/**
 * Smoke 3/8 — auth screen opens from the Lobby, both tabs render,
 * inputs are mounted, and dismissal (back navigation) returns to
 * Lobby. No form submission, no real auth.
 */

test.beforeAll(async () => {
  await ensureDevServer();
});

test.describe('auth modals', () => {
  test('sign-in/sign-up tabs open from lobby and dismiss cleanly', async ({
    page,
  }) => {
    await page.goto('/');
    await page
      .locator('[data-testid="btn-skip-to-lobby"]')
      .first()
      .click({ timeout: 15_000 });

    // Lobby may render a "Sign in" entry; if not, fall back to gear→Settings.
    const lobbySignIn = page.locator('[data-testid="lobby-sign-in"]').first();
    if (await lobbySignIn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await lobbySignIn.click();
    } else {
      await page
        .locator('[data-testid="btn-open-settings"]')
        .first()
        .click({ timeout: 5_000 });
      // Settings modal exposes a sign-in entry — selector confirmed when the
      // spec is run; if the testID differs, update this line.
      const settingsSignIn = page
        .locator('[data-testid*="sign-in"], [data-testid*="signin"]')
        .first();
      await settingsSignIn.click({ timeout: 5_000 });
    }

    // Both auth tabs must mount.
    await expect(
      page.locator('[data-testid="auth-tab-signIn"]').first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-testid="auth-tab-signUp"]').first(),
    ).toBeVisible({ timeout: 5_000 });

    // Toggle to sign-up, then back to sign-in.
    await page.locator('[data-testid="auth-tab-signUp"]').first().click();
    await expect(
      page.locator('[data-testid="auth-input-nickname"]').first(),
    ).toBeVisible({ timeout: 5_000 });

    await page.locator('[data-testid="auth-tab-signIn"]').first().click();
    await expect(
      page.locator('[data-testid="auth-input-email"]').first(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator('[data-testid="auth-input-password"]').first(),
    ).toBeVisible({ timeout: 5_000 });

    // Dismiss via browser back. Lobby CTAs must reappear.
    await page.goBack();
    await expect(
      page.locator('[data-testid="btn-quick-match"]').first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
