import { test, expect } from '@playwright/test';
import { tap } from '../fixtures/actions';

const BASE = process.env.DEMO_URL ?? 'http://localhost:8082';

test('tournament: one table, bets with undo, tricks, TV mirrors', async ({ browser }) => {
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();

  await phone.goto(`${BASE}/tournament/new`);
  await phone.fill('[data-testid="tournament-name"]', 'E2E');
  await phone.fill('[data-testid="tournament-participants"]', 'Ann\nBen\nCat\nDan -');
  // The create form defaults to 2 tables; step down to 1 so all 4 players share one table.
  await tap(phone, 'tournament-table-count-dec');
  await tap(phone, 'tournament-create');
  await phone.waitForURL(/\/tournament\/[A-Z0-9]{6}\/admin\?k=/);
  const url = new URL(phone.url());
  const code = url.pathname.split('/')[2];
  const k = url.searchParams.get('k')!;

  await tap(phone, 'tournament-shuffle');
  await expect(phone.locator('[data-testid="tournament-preview-0"]')).toBeVisible();
  await tap(phone, 'tournament-start-tour');

  await tv.goto(`${BASE}/tournament/${code}/tv?k=${k}`);
  await expect(tv.locator('[data-testid="tournament-table-1"]')).toBeVisible();
  await expect(tv.locator('[data-testid="tournament-table-qr"]')).toBeVisible();

  await phone.goto(`${BASE}/tournament/${code}/table/1?k=${k}`);
  await expect(phone.locator('[data-testid="tournament-recorder"]')).toBeVisible();
  // After claim the QR stays, small, for takeover.
  await expect(tv.locator('[data-testid="tournament-table-qr"]')).toHaveCount(1);

  // 4 bets of 0 except the last; undo once in the middle.
  await tap(phone, 'recorder-bet-0');
  await tap(phone, 'recorder-undo');
  for (let i = 0; i < 3; i++) await tap(phone, 'recorder-bet-0');
  // Last bidder: 10 cards, sum so far 0 -> saying 10 is forbidden.
  // RN Web exposes TouchableOpacity `disabled` as aria-disabled, which toBeDisabled honors.
  await expect(phone.locator('[data-testid="recorder-bet-10"]')).toBeDisabled();
  await tap(phone, 'recorder-bet-1');

  // Hand 1: max_cards for 4 -> 10 cards. Give all 10 to seat 0.
  for (let i = 0; i < 10; i++) await tap(phone, 'recorder-tricks-inc-0');
  await expect(phone.locator('[data-testid="recorder-tricks-submit"]')).toBeEnabled();
  await tap(phone, 'recorder-tricks-submit');
  await expect(phone.locator('[data-testid="recorder-next-hand"]')).toBeVisible();

  await expect(tv.locator('[data-testid="tournament-status-1"]')).toContainText(/scored/i, { timeout: 5000 });
  await expect(tv.locator('[data-testid="tournament-leaderboard"]')).toBeVisible();

  // Takeover: a second phone claims the table; the first phone offers Take back.
  const phone2 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone2.goto(`${BASE}/tournament/${code}/table/1?k=${k}`);
  await expect(phone2.locator('[data-testid="recorder-next-hand"]')).toBeVisible();
  await expect(phone.locator('[data-testid="recorder-taken-over"]')).toBeVisible({ timeout: 5000 });
  await tap(phone, 'recorder-take-back');
  await expect(phone.locator('[data-testid="recorder-next-hand"]')).toBeVisible();
  await expect(phone2.locator('[data-testid="recorder-taken-over"]')).toBeVisible({ timeout: 5000 });
});
