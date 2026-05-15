/**
 * Probe: spectator mode.
 *  1) context A: skip-to-lobby, create a 4p room, capture code.
 *  2) context B: open /join/{code}?as=spectator, verify Watching badge + no Ready button.
 *  3) Back to A: verify spectator-count indicator appeared.
 *
 *   APP_URL=http://localhost:8081 npx tsx scripts/probe-spectator-e2e.ts
 */

import { chromium, Page } from 'playwright';

const APP_URL = (process.env.APP_URL || 'http://localhost:8081').replace(/\/$/, '');

async function attach(page: Page, label: string) {
  page.on('console', m => console.log(`[${label}] CONSOLE ${m.type().padEnd(7)} ${m.text().slice(0, 200)}`));
  page.on('pageerror', e => console.log(`[${label}] PAGEERR ${e.name}: ${e.message}`));
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
  // First create on a fresh anon device shows the SaveProgressModal — dismiss it to continue.
  try {
    await a.getByTestId('save-progress-dismiss').click({ timeout: 4000 });
  } catch { /* modal not shown — flag was already dismissed for this device */ }
  const codeEl = a.getByTestId('room-code');
  await codeEl.waitFor({ state: 'visible', timeout: 15000 });
  const code = ((await codeEl.textContent()) ?? '').trim();
  console.log(`\n=== Room created: ${code} ===\n`);

  // ── Context B: spectator deep-link ──────────────
  const ctxB = await browser.newContext({ viewport: { width: 480, height: 760 } });
  const b = await ctxB.newPage();
  await attach(b, 'B');
  await b.goto(`${APP_URL}/join/${code}?as=spectator`, { waitUntil: 'domcontentloaded' });

  const badge = b.getByTestId('spectator-badge').or(b.getByTestId('spectator-strip'));
  await badge.first().waitFor({ state: 'visible', timeout: 15000 });

  const readyCount = await b.getByTestId('btn-ready').count();
  if (readyCount > 0) {
    console.error('FAIL: btn-ready visible to spectator');
    await browser.close();
    process.exit(1);
  }

  // ── Context A sees the indicator ────────────────
  const indicator = a.getByTestId('spectator-count');
  await indicator.waitFor({ state: 'visible', timeout: 15000 });
  const indicatorText = (await indicator.textContent()) ?? '';
  if (!indicatorText.includes('1')) {
    console.error(`FAIL: spectator-count text "${indicatorText}" does not include 1`);
    await browser.close();
    process.exit(1);
  }

  console.log('\nOK — spectator probe passed\n');
  await browser.close();
  process.exit(0);
})();
