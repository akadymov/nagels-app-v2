'use strict';

/**
 * Scenario seeding helpers for the scenario-tier specs. Each scenario
 * is reached by UI-driving the SP game to the relevant state —
 * deliberately slower than direct state hydration, but zero production
 * code changes required.
 *
 * Currently supports: 'notrump-hand-5' (hand 5 of 20 in a 4-player SP
 * game, no-trump variant, betting UI active).
 */

import type { Page } from '@playwright/test';
import {
  sleep,
  tap,
  dismissTipIfAny,
  dismissPwaModalIfAny,
  tryBet,
  tryPlay,
} from './actions';

export type SeedScenario = 'notrump-hand-5';

export interface SeededGame {
  playerCount: number;
  startedHand: number;
}

const POLL_MS = 600;
const STUCK_S = 60;
const STUCK_THRESHOLD = Math.ceil((STUCK_S * 1000) / POLL_MS);
const DEFAULT_DEADLINE_MS = 5 * 60 * 1000; // 5 min hard cap

/**
 * Drive the SP game from the lobby to the requested in-game state.
 * Returns once the target state's UI is visible. Throws on timeout or
 * 60s without observable progress.
 */
export async function seedScenario(
  page: Page,
  scenario: SeedScenario,
): Promise<SeededGame> {
  if (scenario !== 'notrump-hand-5') {
    throw new Error(`seedScenario: unknown scenario "${scenario}"`);
  }

  const baseURL = process.env.DEMO_URL || 'http://localhost:8081';
  const playerCount = 4;
  const targetHand = 5;

  // Pre-flight: load, skip onboarding, dismiss PWA modal.
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page
    .locator('[data-testid="btn-skip-to-lobby"]')
    .waitFor({ state: 'visible', timeout: 30_000 });
  await tap(page, 'btn-skip-to-lobby', 10_000);
  await sleep(400);

  for (let i = 0; i < 6; i++) {
    if (await dismissPwaModalIfAny(page)) break;
    await sleep(250);
  }

  // Quick Match config: 4 players, Hard.
  await tap(page, `player-count-${playerCount}`, 5_000);
  await sleep(200);
  await tap(page, 'difficulty-hard', 5_000);
  await sleep(200);
  await tap(page, 'btn-quick-match', 5_000);
  await sleep(2_000);

  // Game loop — bots auto-play, we tick the human's bets/cards. Returns
  // when (hand counter === N AND a bet button is visible AND an NT or
  // NO TRUMP label is visible) — the three conditions together prove
  // the dealt UI is mounted, not just a momentary flash.
  const deadline = Date.now() + DEFAULT_DEADLINE_MS;
  let lastHand = 0;
  let idle = 0;

  while (Date.now() < deadline) {
    await sleep(POLL_MS);

    if (await dismissPwaModalIfAny(page)) {
      idle = 0;
      continue;
    }
    if (await dismissTipIfAny(page)) {
      idle = 0;
      continue;
    }

    // Auto-continue the scoreboard between hands.
    const continueBtn = page.locator('[data-testid="btn-continue-scoreboard"]').first();
    if (await continueBtn.isVisible({ timeout: 200 }).catch(() => false)) {
      await continueBtn.click({ timeout: 3_000 }).catch(() => {});
      idle = 0;
      await sleep(800);
      continue;
    }

    // Check whether we've arrived at the target state.
    if (await isAtTargetState(page, targetHand)) {
      return { playerCount, startedHand: targetHand };
    }

    const bet = await tryBet(page, playerCount);
    if (bet !== false) {
      idle = 0;
      continue;
    }

    const card = await tryPlay(page);
    if (card !== false) {
      idle = 0;
      continue;
    }

    // Idle-progress watchdog — same shape as sp-game.spec.js.
    const handNo = await readHandNumber(page);
    if (handNo !== null && handNo !== lastHand) {
      lastHand = handNo;
      idle = 0;
    } else {
      idle++;
    }
    if (idle >= STUCK_THRESHOLD) {
      throw new Error(
        `seedScenario("${scenario}") stalled — no progress for ${STUCK_S}s on hand ${lastHand}`,
      );
    }
  }

  throw new Error(
    `seedScenario("${scenario}") timeout after ${DEFAULT_DEADLINE_MS / 1000}s (reached hand ${lastHand})`,
  );
}

async function readHandNumber(page: Page): Promise<number | null> {
  const txt = await page
    .locator('text=/Hand \\d+\\s*\\/\\s*\\d+/')
    .first()
    .textContent({ timeout: 500 })
    .catch(() => '');
  const m = txt && txt.match(/Hand (\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

async function isAtTargetState(page: Page, targetHand: number): Promise<boolean> {
  const handNo = await readHandNumber(page);
  if (handNo !== targetHand) return false;

  const ntVisible = await page
    .locator('text=/\\bNT\\b|NO TRUMP/')
    .first()
    .isVisible({ timeout: 200 })
    .catch(() => false);
  if (!ntVisible) return false;

  const betBtnVisible = await page
    .locator('[data-testid^="bet-btn-"]')
    .first()
    .isVisible({ timeout: 200 })
    .catch(() => false);
  return betBtnVisible;
}
