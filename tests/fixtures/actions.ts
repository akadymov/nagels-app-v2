'use strict';

/**
 * Reusable click / poll helpers for Playwright specs that exercise the
 * React Native Web build. Extracted from tests/e2e/sp-game.spec.js so
 * the upcoming tests/scenario/ specs can reuse them.
 *
 * Behaviour is identical to the originals — the only API change is that
 * tryBet takes a `playerCount` parameter instead of reading the spec's
 * module-scoped PLAYERS constant.
 */

import type { Page, Locator } from '@playwright/test';

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export async function tap(p: Page, testId: string, timeout = 8000): Promise<void> {
  const el: Locator = p.locator(`[data-testid="${testId}"]`).first();
  await el.waitFor({ state: 'visible', timeout });
  await el.click();
}

export async function exists(p: Page, testId: string, timeout = 1000): Promise<boolean> {
  return p
    .locator(`[data-testid="${testId}"]`)
    .first()
    .isVisible({ timeout })
    .catch(() => false);
}

// Pointer-event-aware dismiss for onboarding tips. RN-web's Pressable
// listens to PointerEvents, so plain mouse events don't trigger onPress.
export async function dismissTipIfAny(p: Page): Promise<boolean> {
  const tipBtn = p.locator('[data-testid^="onboarding-tip-"][data-testid$="-got-it"]').first();
  if (!(await tipBtn.isVisible().catch(() => false))) return false;
  try {
    await tipBtn.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const opts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    });
    await tipBtn.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    return true;
  } catch (_) {
    return false;
  }
}

// Pointer-event-aware dismiss for the PWA install modal that pops up on
// first lobby visit. Mirrors dismissTipIfAny — RN-web's Pressable needs
// synthesized PointerEvents to fire onPress. Targets the always-present
// X button (pwa-close).
export async function dismissPwaModalIfAny(p: Page): Promise<boolean> {
  const closeBtn = p.locator('[data-testid="pwa-close"]').first();
  if (!(await closeBtn.isVisible().catch(() => false))) return false;
  try {
    await closeBtn.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const opts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    });
    await closeBtn.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    return true;
  } catch (_) {
    return false;
  }
}

export async function tryBet(p: Page, playerCount: number): Promise<number | false> {
  const allBtns = p.locator('[data-testid^="bet-btn-"]');
  const totalCount = await allBtns.count().catch(() => 0);
  if (totalCount === 0) return false;
  const cardsPerPlayer = totalCount - 1;

  const enabled = p.locator(
    '[data-testid^="bet-btn-"]:not([disabled]):not([aria-disabled="true"])',
  );
  const enabledCount = await enabled.count().catch(() => 0);
  if (enabledCount === 0) return false;

  const allowed: number[] = [];
  for (let i = 0; i < enabledCount; i++) {
    const txt = ((await enabled.nth(i).textContent().catch(() => '')) || '').trim();
    const n = parseInt(txt, 10);
    if (!Number.isNaN(n)) allowed.push(n);
  }
  if (allowed.length === 0) return false;

  // Bet near cardsPerPlayer / playerCount with ±1 jitter — keeps the sum
  // realistic so the last-bidder rule rarely forces a bad fallback.
  const target = cardsPerPlayer / playerCount;
  const jitter = Math.floor(Math.random() * 3) - 1;
  const desired = Math.max(0, Math.min(cardsPerPlayer, Math.round(target + jitter)));
  allowed.sort(
    (a, b) => Math.abs(a - desired) - Math.abs(b - desired) || Math.random() - 0.5,
  );
  const choice = allowed[0];

  const chip = p.locator(`[data-testid="bet-btn-${choice}"]`);
  try {
    await chip.click({ timeout: 3000 });
  } catch (_) {
    await enabled.first().click({ timeout: 3000, force: true }).catch(() => {});
  }
  await sleep(400);

  // After commit fe677b1+, the chip tap is select-only — the bet is
  // only placed when bet-confirm is clicked (or the same chip is
  // tapped again, but the explicit button is the canonical path).
  const confirm = p.locator('[data-testid="bet-confirm"]').first();
  if (await confirm.isVisible({ timeout: 1_000 }).catch(() => false)) {
    try {
      await confirm.click({ timeout: 3_000 });
    } catch (_) {
      await confirm.click({ timeout: 3_000, force: true }).catch(() => {});
    }
    await sleep(400);
  }

  // Bet panel hides after a successful placeBet.
  if (!(await enabled.first().isVisible({ timeout: 200 }).catch(() => false))) {
    return choice;
  }
  return false;
}

export async function tryPlay(p: Page): Promise<string | false> {
  const hand = p.locator('[data-testid="my-hand"]');
  if (!(await hand.isVisible({ timeout: 200 }).catch(() => false))) return false;
  const cards = hand.locator('[data-testid^="card-"]');
  const cnt = await cards.count();
  if (cnt === 0) return false;

  for (let i = 0; i < cnt && i < 12; i++) {
    const c = cards.nth(i);
    const tid = await c.getAttribute('data-testid').catch(() => null);
    if (!tid) continue;
    try {
      await c.click({ timeout: 800 });
      await sleep(350);
      const same = hand.locator(`[data-testid="${tid}"]`);
      if (!(await same.isVisible().catch(() => false))) return tid;
      // Card still in hand → second click confirms (select-then-confirm UI).
      await same.click({ timeout: 800 }).catch(() => {});
      await sleep(400);
      if ((await cards.count()) < cnt) return tid;
    } catch (_) {}
  }
  return false;
}
