import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 480, height: 760 } });
  await ctx.addInitScript(() => {
    const cur = JSON.parse(localStorage.getItem('nagels_settings') || '{}');
    cur.shownTips = { bidding: true, trumpRank: true, noTrump: true, scoring: true };
    localStorage.setItem('nagels_settings', JSON.stringify(cur));
  });
  const p = await ctx.newPage();
  await p.goto('http://localhost:8081/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2000);
  const stored = await p.evaluate(() => localStorage.getItem('nagels_settings'));
  console.log('localStorage nagels_settings:', stored);
  await browser.close();
})();
