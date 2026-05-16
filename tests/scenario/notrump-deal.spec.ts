import { test, expect } from '@playwright/test';
import { seedScenario } from '../fixtures/seed';

/**
 * Scenario-tier POC. Proves the seed → assert pattern works end-to-end
 * against the isolated :8082 Expo + local supabase stack.
 *
 * Hand 5 in Nägels is the no-trump hand. The assertions verify that:
 *   - the hand counter shows 5/20
 *   - the trump indicator shows NT (or "NO TRUMP")
 *   - the betting UI is mounted (at least one bet-btn-* present)
 *
 * Reaching that state is delegated to seedScenario, which UI-drives
 * the SP game through hands 1-4. Wall-clock ~3-4 min.
 */

test('notrump hand 5 deals with NT badge and betting UI', async ({ page }) => {
  await seedScenario(page, 'notrump-hand-5');

  await expect(page.getByText(/Hand 5\s*\/\s*20/)).toBeVisible();
  await expect(page.getByText(/\bNT\b|NO TRUMP/)).toBeVisible();
  await expect(page.locator('[data-testid^="bet-btn-"]').first()).toBeVisible();
});
