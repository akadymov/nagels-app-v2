/**
 * Probe: desktop Lobby + Profile renders side-by-side at >=1024px;
 * mobile Lobby is unchanged at <1024px.
 *
 *   APP_URL=http://localhost:8081 npx tsx scripts/probe-desktop-lobby.ts
 */

import { chromium } from 'playwright';

const APP_URL = (process.env.APP_URL || 'http://localhost:8081').replace(/\/$/, '');

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ── 1. Wide viewport — expect desktop layout ──
  const wide = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const wp = await wide.newPage();
  wp.on('pageerror', e => console.log(`[wide] PAGEERR ${e.name}: ${e.message}`));
  await wp.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await wp.getByTestId('btn-skip-to-lobby').click();

  // Both panes (Lobby tab + Profile section) must be visible.
  await wp.getByTestId('tab-bots').waitFor({ state: 'visible', timeout: 10000 });
  const lobbyBox = await wp.getByTestId('tab-bots').boundingBox();
  // Settings/Profile section renders "Profile" header text via i18n.
  const settingsHdr = wp.locator('text=/Profile|Профиль|Perfil/').first();
  await settingsHdr.waitFor({ state: 'visible', timeout: 10000 });
  const profBox = await settingsHdr.boundingBox();

  if (!lobbyBox || !profBox) {
    console.error('FAIL: missing panes', { lobbyBox, profBox });
    process.exit(1);
  }
  // Profile pane must sit to the right of the Lobby tab (split layout).
  if (profBox.x <= lobbyBox.x) {
    console.error(`FAIL: profile not to the right of lobby (lobby x=${lobbyBox.x}, profile x=${profBox.x})`);
    process.exit(1);
  }
  console.log(`OK desktop split — lobby.x=${lobbyBox.x.toFixed(0)} profile.x=${profBox.x.toFixed(0)}`);

  // ── 2. Narrow viewport — expect mobile layout (no Profile side-by-side) ──
  const narrow = await browser.newContext({ viewport: { width: 480, height: 760 } });
  const np = await narrow.newPage();
  np.on('pageerror', e => console.log(`[narrow] PAGEERR ${e.name}: ${e.message}`));
  await np.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await np.getByTestId('btn-skip-to-lobby').click();
  await np.getByTestId('tab-bots').waitFor({ state: 'visible', timeout: 10000 });

  // Settings body should NOT be mounted in mobile.
  const mobileProfileHdr = np.locator('text=/Profile|Профиль|Perfil/').first();
  const profileVisible = await mobileProfileHdr.isVisible().catch(() => false);
  if (profileVisible) {
    console.error('FAIL: mobile lobby unexpectedly shows Profile section');
    process.exit(1);
  }
  console.log('OK mobile lobby unchanged — no Profile pane');

  await browser.close();
  console.log('\nDesktop pilot probe passed.');
  process.exit(0);
})();
