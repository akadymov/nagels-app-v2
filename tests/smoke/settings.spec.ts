import { test, expect } from '@playwright/test';
import { ensureDevServer, dismissLobbyOverlays } from '../fixtures/smoke';

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

    await dismissLobbyOverlays(page);

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
    // background-color change — we compare the same pill's bg in
    // selected vs. deselected states (both pills cycle through the
    // accent color, so cross-pill comparison reads two equal values).
    await themeDark.click();
    await page.waitForTimeout(150);
    const lightBgWhenDark = await themeLight.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    await themeLight.click();
    await page.waitForTimeout(150);
    const lightBgWhenLight = await themeLight.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(lightBgWhenDark).not.toBe(lightBgWhenLight);

    // Language cycle. Grab the full visible text of the document body
    // after each switch and assert it changes — Latin/Cyrillic alphabets
    // make this a robust signal even when individual nodes haven't been
    // localised. (The first-text-node heuristic from the original plan
    // collapsed to the same value for all three locales.)
    const grabBodyText = async () =>
      page.evaluate(() => document.body.innerText || '');
    const langEn = page.locator('[data-testid="lang-en"]').first();
    const langRu = page.locator('[data-testid="lang-ru"]').first();
    const langEs = page.locator('[data-testid="lang-es"]').first();
    await expect(langEn).toBeVisible({ timeout: 5_000 });
    await expect(langRu).toBeVisible({ timeout: 5_000 });
    await expect(langEs).toBeVisible({ timeout: 5_000 });

    await langEn.click();
    await page.waitForTimeout(300);
    const sampleEn = await grabBodyText();
    await langRu.click();
    await page.waitForTimeout(300);
    const sampleRu = await grabBodyText();
    await langEs.click();
    await page.waitForTimeout(300);
    const sampleEs = await grabBodyText();

    expect(sampleEn.length).toBeGreaterThan(0);
    // RU must differ from EN (Cyrillic vs Latin). ES vs EN may overlap
    // for short labels, so we require at least RU to diverge.
    expect(sampleRu).not.toBe(sampleEn);
    expect(sampleEs).not.toBe(sampleEn);

    // Reset to EN to leave the dev server in a clean state.
    await langEn.click();

    // Close the modal.
    await page
      .locator('[data-testid="settings-modal-close"]')
      .first()
      .click({ timeout: 5_000 });
  });
});
