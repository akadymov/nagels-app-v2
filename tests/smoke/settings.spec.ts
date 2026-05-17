import { test, expect } from '@playwright/test';
import { ensureDevServer } from '../fixtures/smoke';

/**
 * Smoke 4/8 — open Settings from Lobby, flip theme (light↔dark),
 * cycle language EN→RU→ES→EN. Assertions verify the pills' active
 * state visually changes (selected pill gains accent backgroundColor).
 * No untranslated key check here — that's i18n.spec.ts.
 */

test.beforeAll(async () => {
  await ensureDevServer();
});

test.describe('settings', () => {
  test('theme toggle + language cycle', async ({ page }) => {
    await page.goto('/');
    await page
      .locator('[data-testid="btn-skip-to-lobby"]')
      .first()
      .click({ timeout: 15_000 });

    await page
      .locator('[data-testid="btn-open-settings"]')
      .first()
      .click({ timeout: 10_000 });

    // Theme pills exist.
    const themeLight = page.locator('[data-testid="theme-light"]').first();
    const themeDark = page.locator('[data-testid="theme-dark"]').first();
    await expect(themeLight).toBeVisible({ timeout: 10_000 });
    await expect(themeDark).toBeVisible({ timeout: 5_000 });

    // Click dark, then light. The selected pill should have a measurable
    // background-color change — we don't lock to a specific color, just
    // assert that clicking changes the pair.
    await themeDark.click();
    await page.waitForTimeout(150);
    const darkBg = await themeDark.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    await themeLight.click();
    await page.waitForTimeout(150);
    const lightBg = await themeLight.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(darkBg).not.toBe(lightBg);

    // Language cycle. Capture some visible text after each switch and
    // assert at least one node changed.
    const grabFirstHeader = async () =>
      (await page
        .locator('text=/.{3,}/')
        .first()
        .textContent()
        .catch(() => null)) || '';
    const langEn = page.locator('[data-testid="lang-en"]').first();
    const langRu = page.locator('[data-testid="lang-ru"]').first();
    const langEs = page.locator('[data-testid="lang-es"]').first();
    await expect(langEn).toBeVisible({ timeout: 5_000 });
    await expect(langRu).toBeVisible({ timeout: 5_000 });
    await expect(langEs).toBeVisible({ timeout: 5_000 });

    await langEn.click();
    await page.waitForTimeout(200);
    const sampleEn = await grabFirstHeader();
    await langRu.click();
    await page.waitForTimeout(200);
    const sampleRu = await grabFirstHeader();
    await langEs.click();
    await page.waitForTimeout(200);
    const sampleEs = await grabFirstHeader();

    expect(sampleEn).not.toBe('');
    // At least one of RU/ES must differ from EN — if all three match,
    // the language switch is a no-op.
    const someChanged = sampleRu !== sampleEn || sampleEs !== sampleEn;
    expect(someChanged).toBe(true);

    // Reset to EN to leave the dev server in a clean state.
    await langEn.click();

    // Close the modal.
    await page
      .locator('[data-testid="settings-modal-close"]')
      .first()
      .click({ timeout: 5_000 });
  });
});
