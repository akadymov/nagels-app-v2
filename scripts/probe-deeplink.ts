/**
 * Probe: open /join/CODE on prod and capture what actually happens.
 *
 *   APP_URL=https://nigels.online JOIN_CODE=INVALD npx tsx scripts/probe-deeplink.ts
 *
 * If JOIN_CODE is omitted we use 'INVALD' (won't exist) — that's enough to
 * tell whether the deeplink handler is reached at all.
 */

import { chromium } from 'playwright';

const APP_URL = (process.env.APP_URL || 'https://nigels.online').replace(/\/$/, '');
const CODE = process.env.JOIN_CODE || 'INVALD';
const URL = `${APP_URL}/join/${CODE}`;

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({ viewport: { width: 480, height: 760 } });
  const page = await ctx.newPage();

  const events: string[] = [];
  const log = (s: string) => { events.push(`${new Date().toISOString().slice(11, 23)}  ${s}`); console.log(events[events.length - 1]); };

  page.on('console', m => log(`CONSOLE ${m.type().padEnd(7)} ${m.text().slice(0, 240)}`));
  page.on('pageerror', e => log(`PAGEERR ${e.name}: ${e.message}`));
  page.on('framenavigated', f => { if (f === page.mainFrame()) log(`NAV ${f.url()}`); });
  page.on('dialog', async d => { log(`DIALOG ${d.type()}: ${d.message()}`); await d.dismiss(); });
  page.on('requestfailed', r => log(`REQFAIL ${r.method()} ${r.url().slice(0, 100)} ${r.failure()?.errorText}`));

  log(`GO ${URL}`);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  // Watch for ~15 s
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
  }

  // Final state snapshot
  const finalUrl = page.url();
  const visible = await page.evaluate(() => {
    const ids = ['btn-learn-to-play', 'btn-skip-to-lobby', 'btn-create-room', 'tab-create', 'tab-join', 'btn-ready', 'room-code'];
    return ids.filter(id => !!document.querySelector(`[data-testid="${id}"]`));
  });
  log(`FINAL_URL ${finalUrl}`);
  log(`VISIBLE_TESTIDS [${visible.join(', ')}]`);

  await browser.close();
})();
