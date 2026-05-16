'use strict';

/**
 * Single-player end-to-end regression test.
 *
 * Drives a full SP game vs Hard bots and asserts the scoreboard winner
 * banner appears — i.e. the game progressed through every hand without
 * stalling.
 *
 * Configurable via env:
 *   DEMO_URL    target host (default http://localhost:8081)
 *   SP_PLAYERS  total players incl. me, 2..6 (default 4)
 *   HEADLESS    "1" to run headless for CI (default headed for visual review)
 *   SLOW_MO     ms per action (default 80, set 0 for max speed)
 *
 * Difficulty is hard-pinned to "hard" — we want regression coverage
 * against the strongest bot path because that's where the most code
 * branches run (sabotage logic, suit-following heuristics, etc.).
 *
 * Pass: scoreboard-winner-banner becomes visible.
 * Fail: idle watchdog fires (no progress for STUCK_S seconds), or the
 *       per-test Playwright timeout (12 min) trips.
 */

const { test, expect } = require('@playwright/test');
const {
  sleep,
  tap,
  exists,
  dismissTipIfAny,
  dismissPwaModalIfAny,
  tryBet,
  tryPlay,
} = require('../fixtures/actions');

const PLAYERS = Math.max(2, Math.min(6, parseInt(process.env.SP_PLAYERS || '4', 10)));
const DIFF = 'hard';

async function dumpDiagnostic(p) {
  const snap = await p
    .evaluate(() => {
      const isVis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const ids = Array.from(document.querySelectorAll('[data-testid]'))
        .filter(isVis)
        .slice(0, 60)
        .map((el) => {
          const tid = el.getAttribute('data-testid');
          const dis =
            el.getAttribute('aria-disabled') || el.getAttribute('disabled') || '';
          const txt = (el.textContent || '').trim().slice(0, 60);
          return `${tid}${dis ? ` [dis=${dis}]` : ''}${txt ? ` "${txt}"` : ''}`;
        });
      const texts = Array.from(document.querySelectorAll('div, span'))
        .filter((el) => el.children.length === 0 && isVis(el))
        .map((el) => (el.textContent || '').trim())
        .filter((t) => t && t.length < 80)
        .slice(0, 40);
      return { ids, texts };
    })
    .catch(() => ({ ids: [], texts: [] }));
  return [
    '--- visible testIDs ---',
    ...snap.ids,
    '--- visible text leaves ---',
    ...snap.texts,
  ].join('\n  ');
}

test(`SP game (vs ${PLAYERS - 1} Hard bots) completes without stalling`, async ({
  page,
}) => {
  const baseURL = process.env.DEMO_URL || 'http://localhost:8081';

  // Pre-flight: load and skip onboarding to reach the lobby.
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page
    .locator('[data-testid="btn-skip-to-lobby"]')
    .waitFor({ state: 'visible', timeout: 30_000 });
  await tap(page, 'btn-skip-to-lobby', 10_000);
  await sleep(400);

  // PWA install modal pops up on first lobby visit (post mount) and
  // intercepts pointer events on the difficulty selector. Dismiss it
  // before touching the setup row. The wait is short — if the modal
  // isn't shown, we move on immediately.
  for (let i = 0; i < 6; i++) {
    if (await dismissPwaModalIfAny(page)) break;
    await sleep(250);
  }

  // Quick Match config: player count + Hard difficulty.
  await tap(page, `player-count-${PLAYERS}`, 5_000);
  await sleep(200);
  await tap(page, `difficulty-${DIFF}`, 5_000);
  await sleep(200);
  await tap(page, 'btn-quick-match', 5_000);
  await sleep(2_000);

  // Game loop — bots drive their own bets and cards. We just bid, play,
  // and dismiss any modal that gets in the way. The watchdog enforces a
  // hard cap on idleness so a stalled hand fails the test promptly.
  const POLL_MS = 600;
  const STUCK_S = 60; // 60s without progress → stalled
  const STUCK_THRESHOLD = Math.ceil((STUCK_S * 1000) / POLL_MS);

  let lastHand = 0;
  let idle = 0;
  let didDiagnostic = false;

  // Loop bound: the scoreboard winner-banner is the only success path;
  // the watchdog `throw` is the only fail path. The Playwright timeout
  // is the last-resort backstop.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(POLL_MS);

    if (await dismissPwaModalIfAny(page)) {
      idle = 0;
      continue;
    }

    if (await dismissTipIfAny(page)) {
      idle = 0;
      continue;
    }

    if (await exists(page, 'scoreboard-winner-banner', 500)) {
      // Found end-of-game banner — assert and exit.
      await expect(
        page.locator('[data-testid="scoreboard-winner-banner"]'),
      ).toBeVisible();
      return;
    }

    if (await exists(page, 'btn-continue-scoreboard', 500)) {
      await tap(page, 'btn-continue-scoreboard', 3_000).catch(() => {});
      idle = 0;
      await sleep(800);
      continue;
    }

    const bet = await tryBet(page, PLAYERS);
    if (bet !== false) {
      idle = 0;
      continue;
    }

    const card = await tryPlay(page);
    if (card !== false) {
      idle = 0;
      continue;
    }

    // Progress watchdog — track Hand N/M and bail if nothing changes.
    const handText = await page
      .locator('text=/Hand \\d+\\/\\d+/')
      .first()
      .textContent({ timeout: 500 })
      .catch(() => '');
    const m = handText && handText.match(/Hand (\d+)/);
    const handNo = m ? parseInt(m[1], 10) : null;
    if (handNo !== null && handNo !== lastHand) {
      lastHand = handNo;
      idle = 0;
    } else {
      idle++;
    }

    if (idle === Math.floor(STUCK_THRESHOLD / 3) && !didDiagnostic) {
      // First-third idleness: dump a diagnostic so a future failure is
      // debuggable from CI logs without a re-run.
      didDiagnostic = true;
      const snap = await dumpDiagnostic(page);
      // eslint-disable-next-line no-console
      console.log(`[diagnostic @ idle ${idle}, hand ${lastHand}]\n  ${snap}`);
    }

    if (idle >= STUCK_THRESHOLD) {
      const snap = await dumpDiagnostic(page);
      throw new Error(
        `SP game stalled — no progress for ${STUCK_S}s on hand ${lastHand}\n${snap}`,
      );
    }
  }
});
