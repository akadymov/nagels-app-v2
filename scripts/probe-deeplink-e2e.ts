/**
 * Probe: full deeplink flow.
 *  1) context A: skip-to-lobby, create a 4p room, capture code.
 *  2) context B: open /join/{code} fresh, verify it lands on WaitingRoom.
 *
 *   APP_URL=http://localhost:8081 npx tsx scripts/probe-deeplink-e2e.ts
 */

import { chromium, Page } from 'playwright';

const APP_URL = (process.env.APP_URL || 'http://localhost:8081').replace(/\/$/, '');

async function attach(page: Page, label: string) {
  page.on('console', m => console.log(`[${label}] CONSOLE ${m.type().padEnd(7)} ${m.text().slice(0, 200)}`));
  page.on('pageerror', e => console.log(`[${label}] PAGEERR ${e.name}: ${e.message}`));
  page.on('framenavigated', f => { if (f === page.mainFrame()) console.log(`[${label}] NAV ${f.url()}`); });
  page.on('dialog', async d => { console.log(`[${label}] DIALOG ${d.type()}: ${d.message()}`); await d.dismiss(); });
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ── Context A: create room ──────────────────────
  const ctxA = await browser.newContext({ viewport: { width: 480, height: 760 } });
  const a = await ctxA.newPage();
  await attach(a, 'A');
  await a.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await a.getByTestId('btn-skip-to-lobby').click();
  await a.getByTestId('input-player-name').fill('Alice');
  await a.getByTestId('player-count-4').click();
  await a.getByTestId('tab-create').click();
  await a.getByTestId('btn-create-room').click();
  const codeEl = a.getByTestId('room-code');
  await codeEl.waitFor({ state: 'visible', timeout: 15000 });
  const code = ((await codeEl.textContent()) ?? '').trim();
  console.log(`\n=== Room created: ${code} ===\n`);

  // ── Context B: deep-link join ───────────────────
  const ctxB = await browser.newContext({ viewport: { width: 480, height: 760 } });
  const b = await ctxB.newPage();
  await attach(b, 'B');
  console.log(`\n=== Opening ${APP_URL}/join/${code} in fresh context ===\n`);
  await b.goto(`${APP_URL}/join/${code}`, { waitUntil: 'domcontentloaded' });

  // Wait up to 15 s for either WaitingRoom (room-code visible) or final state
  let landed: string | null = null;
  for (let i = 0; i < 30; i++) {
    await b.waitForTimeout(500);
    if (await b.getByTestId('room-code').isVisible().catch(() => false)) { landed = 'WaitingRoom'; break; }
  }

  const finalUrl = b.url();
  const visible = await b.evaluate(() => {
    const ids = ['btn-learn-to-play', 'btn-skip-to-lobby', 'btn-create-room', 'tab-create', 'tab-join', 'btn-ready', 'room-code'];
    return ids.filter(id => !!document.querySelector(`[data-testid="${id}"]`));
  });
  console.log(`\n=== B FINAL_URL ${finalUrl}`);
  console.log(`=== B VISIBLE_TESTIDS [${visible.join(', ')}]`);
  console.log(`=== B LANDED: ${landed ?? 'NOT WaitingRoom'}\n`);

  await browser.close();
  process.exit(landed === 'WaitingRoom' ? 0 : 1);
})();
