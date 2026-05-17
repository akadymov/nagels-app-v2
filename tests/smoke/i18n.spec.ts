import { test, expect } from '@playwright/test';
import { ensureDevServer, findUntranslatedKeys } from '../fixtures/smoke';

/**
 * Smoke 7/8 — for each of EN, RU, ES, walk the Welcome + Lobby +
 * Settings surfaces and assert no DOM text node matches the i18next
 * missing-key heuristic.
 */

test.beforeAll(async () => {
  await ensureDevServer();
});

test.describe('i18n', () => {
  for (const lang of ['en', 'ru', 'es'] as const) {
    test(`no untranslated keys in ${lang.toUpperCase()}`, async ({ page }) => {
      await page.goto('/');
      // Welcome screen.
      const welcomeMissing = await findUntranslatedKeys(page);
      expect(welcomeMissing).toEqual([]);

      // Enter Lobby.
      await page
        .locator('[data-testid="btn-skip-to-lobby"]')
        .first()
        .click({ timeout: 15_000 });
      await page
        .locator('[data-testid="btn-quick-match"]')
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 });

      // Switch language via Settings.
      await page
        .locator('[data-testid="btn-open-settings"]')
        .first()
        .click({ timeout: 5_000 });
      await page
        .locator(`[data-testid="lang-${lang}"]`)
        .first()
        .click({ timeout: 5_000 });
      await page.waitForTimeout(300);

      // Within Settings (the modal is still open), check.
      const settingsMissing = await findUntranslatedKeys(page);
      expect(settingsMissing).toEqual([]);

      // Close settings, re-check Lobby.
      await page
        .locator('[data-testid="settings-modal-close"]')
        .first()
        .click({ timeout: 5_000 });
      await page.waitForTimeout(200);
      const lobbyMissing = await findUntranslatedKeys(page);
      expect(lobbyMissing).toEqual([]);

      // Reset to EN to leave the dev server clean for the next spec.
      if (lang !== 'en') {
        await page
          .locator('[data-testid="btn-open-settings"]')
          .first()
          .click({ timeout: 5_000 });
        await page
          .locator('[data-testid="lang-en"]')
          .first()
          .click({ timeout: 5_000 });
        await page
          .locator('[data-testid="settings-modal-close"]')
          .first()
          .click({ timeout: 5_000 });
      }
    });
  }
});
