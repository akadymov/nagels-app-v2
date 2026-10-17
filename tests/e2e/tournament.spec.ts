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

  // The shuffle button renders before tournament state loads; wait for the title (data.tournament.name).
  await expect(phone.locator('[data-testid="tournament-setup"]')).toContainText('E2E');
  await tap(phone, 'tournament-shuffle');
  await expect(phone.locator('[data-testid="tournament-preview-0"]')).toBeVisible();
  await tap(phone, 'tournament-start-tour');
  // Wait for the tour to exist before opening the TV.
  await expect(phone.locator('[data-testid="tournament-tv-link"]')).toBeVisible();

  await tv.goto(`${BASE}/tournament/${code}/tv?k=${k}`);
  await expect(tv.locator('[data-testid="tournament-table-1"]')).toBeVisible();
  await expect(tv.locator('[data-testid="tournament-table-qr"]')).toBeVisible();

  await phone.goto(`${BASE}/tournament/${code}/table/1?k=${k}`);
  await expect(phone.locator('[data-testid="tournament-recorder"]')).toBeVisible();
  // After claim the big QR label goes away, the small QR stays for takeover.
  await expect(tv.getByText('Scan to record this table')).toHaveCount(0, { timeout: 8000 });
  await expect(tv.locator('[data-testid="tournament-table-qr"]')).toHaveCount(1);

  // Bets: the pad ignores clicks while busy, so wait for the turn to advance after each action.
  const bidder = phone.locator('[data-testid="recorder-bidder"]');
  const dis = (id: string) => phone.locator(`[data-testid="${id}"]`);
  await expect(bidder).toBeVisible();
  let prev = await bidder.innerText();
  await tap(phone, 'recorder-bet-0');
  await expect(bidder).not.toHaveText(prev);
  await tap(phone, 'recorder-undo');
  await expect(bidder).toHaveText(prev);
  for (let i = 0; i < 3; i++) {
    prev = await bidder.innerText();
    await tap(phone, 'recorder-bet-0');
    await expect(bidder).not.toHaveText(prev);
  }
  // Last bidder: 10 cards, sum so far 0 -> saying 10 is forbidden.
  // RN Web exposes `disabled` on TouchableOpacity as aria-disabled="true" (roleless div).
  await expect(dis('recorder-bet-10')).toHaveAttribute('aria-disabled', 'true');
  await expect(dis('recorder-bet-1')).not.toHaveAttribute('aria-disabled', 'true');
  await tap(phone, 'recorder-bet-1');
  await expect(dis('recorder-tricks-inc-0')).toBeVisible();

  // Hand 1: max_cards for 4 -> 10 cards. Give all 10 to seat 0.
  for (let i = 0; i < 10; i++) {
    await tap(phone, 'recorder-tricks-inc-0');
    await expect(phone.locator('[data-testid="recorder-tricks-value-0"]')).toHaveText(String(i + 1));
  }
  await expect(phone.locator('[data-testid="recorder-tricks-value-0"]')).toHaveText('10');
  await expect(dis('recorder-tricks-submit')).not.toHaveAttribute('aria-disabled', 'true');
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
