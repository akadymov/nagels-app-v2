'use strict';

/**
 * Multi-context multiplayer fixture. Ports the proven room + game-loop
 * flow from demo/play-demo.js into TS, adapted for Playwright Test.
 *
 * Used by tests/e2e/multiplayer-6p-mixed.spec.ts (Phase 6). Each
 * function operates on a single Page (one player's browser context).
 * The caller is responsible for orchestrating multiple pages in
 * parallel (typically via Promise.all).
 */

import type { Page } from '@playwright/test';
import {
  tap,
  exists,
  sleep,
  dismissTipIfAny,
  dismissPwaModalIfAny,
  tryBet,
  tryPlay,
} from './actions';

/**
 * Host flow: pick player-count chip, open Create tab, click Create,
 * wait for the WaitingRoom screen, return the 6-char room code.
 */
export async function createRoomAsHost(
  page: Page,
  playerCount: number,
  label = 'host',
): Promise<string> {
  await tap(page, `player-count-${playerCount}`, 10_000);
  await sleep(200);
  await tap(page, 'tab-create', 5_000);
  await sleep(300);
  await tap(page, 'btn-create-room', 5_000);
  // WaitingRoom mounts once the server returns the room — room-code
  // testID is the canonical "we're in" signal.
  const codeEl = page.locator('[data-testid="room-code"]').first();
  await codeEl.waitFor({ state: 'visible', timeout: 15_000 });
  const code = (await codeEl.textContent())?.trim() ?? '';
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    throw new Error(
      `[mp:${label}] expected 6-char room code, got "${code}"`,
    );
  }
  return code;
}

/**
 * Join flow: open Join tab, fill code, click Join, wait for
 * WaitingRoom (same room-code testID confirms membership).
 */
export async function joinRoomByCode(
  page: Page,
  code: string,
  label = 'player',
): Promise<void> {
  await tap(page, 'tab-join', 5_000);
  await sleep(300);
  const input = page.locator('[data-testid="input-join-code"]').first();
  await input.waitFor({ state: 'visible', timeout: 5_000 });
  await input.fill(code);
  await sleep(200);
  await tap(page, 'btn-join-room', 5_000);
  await page
    .locator('[data-testid="room-code"]')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  // Sanity: confirm we're in the right room.
  const observed = (
    await page.locator('[data-testid="room-code"]').first().textContent()
  )?.trim();
  if (observed !== code) {
    throw new Error(
      `[mp:${label}] expected room ${code} but landed in ${observed}`,
    );
  }
}

/** Click the ready button in WaitingRoom. */
export async function markReady(page: Page): Promise<void> {
  await tap(page, 'btn-ready', 8_000);
}

/** Host-only: click start-game. WaitingRoom auto-validates everyone ready. */
export async function startGame(page: Page): Promise<void> {
  await tap(page, 'btn-start-game', 8_000);
}

export interface GameLoopOptions {
  /** Max wall-clock seconds before giving up. Default 35 min. */
  budgetSec?: number;
  /** Idle iterations (~1s each) before failing the loop. Default 120. */
  idleLimit?: number;
  /** Optional label used in console output, e.g. "P3". */
  label?: string;
}

export type GameLoopResult = 'game-over' | 'budget-exhausted' | 'idle-timeout';

/**
 * Drive a single player through betting/playing until the scoreboard
 * winner banner appears (game over). Returns the reason the loop
 * stopped — caller asserts 'game-over' for a passing test.
 *
 * Mirrors demo/play-demo.js gameLoop (line 397) but stripped of
 * chat sends, last-trick replay, and the demo's localStorage
 * fallback for stuck onboarding tips (rarer in headless mode).
 */
export async function runGameLoop(
  page: Page,
  opts: GameLoopOptions = {},
): Promise<GameLoopResult> {
  const budgetSec = opts.budgetSec ?? 35 * 60;
  const idleLimit = opts.idleLimit ?? 120;
  const label = opts.label ?? 'player';
  const playerCount = 6;
  const deadline = Date.now() + budgetSec * 1000;

  let hands = 0;
  let idle = 0;

  while (Date.now() < deadline) {
    await sleep(1_000);

    // Dismiss onboarding tips proactively — they intercept pointer
    // events on the underlying betting/playing UI.
    if (await dismissTipIfAny(page)) {
      idle = 0;
      continue;
    }

    // Game over — scoreboard winner banner is the canonical
    // end-of-game signal across all players.
    if (await exists(page, 'scoreboard-winner-banner', 200)) {
      // eslint-disable-next-line no-console
      console.log(`[mp:${label}] 🏁 game over after ${hands} continues`);
      return 'game-over';
    }

    // Continue button between hands.
    if (await exists(page, 'btn-continue-scoreboard', 200)) {
      try {
        await tap(page, 'btn-continue-scoreboard', 5_000);
        hands += 1;
        idle = 0;
        continue;
      } catch (_) {
        /* non-fatal — next iteration retries */
      }
    }

    // Bet.
    const bet = await tryBet(page, playerCount);
    if (bet !== false) {
      idle = 0;
      continue;
    }

    // Play card.
    const played = await tryPlay(page);
    if (played !== false) {
      idle = 0;
      continue;
    }

    idle += 1;
    if (idle % 20 === 0) {
      // eslint-disable-next-line no-console
      console.log(`[mp:${label}] ⌛ idle ${idle}s (hand ${hands})`);
    }

    // Try the in-game sync button if we're stuck — it's a safe
    // no-op when nothing's desynced.
    if (idle > 0 && idle % 16 === 0) {
      const synced =
        (await exists(page, 'game-btn-sync', 100))
          ? await tap(page, 'game-btn-sync', 1_000).then(() => true).catch(() => false)
          : (await exists(page, 'betting-btn-sync', 100))
            ? await tap(page, 'betting-btn-sync', 1_000).then(() => true).catch(() => false)
            : false;
      if (synced) {
        // eslint-disable-next-line no-console
        console.log(`[mp:${label}] 🔄 pressed sync`);
        await sleep(2_000);
      }
    }

    if (idle >= idleLimit) {
      // eslint-disable-next-line no-console
      console.log(`[mp:${label}] ✗ idle timeout at ${idleLimit}s`);
      return 'idle-timeout';
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[mp:${label}] ✗ wall-clock budget exhausted (${budgetSec}s)`);
  return 'budget-exhausted';
}

/**
 * Skip the Welcome screen + dismiss PWA modal. Every player calls
 * this once on boot before createRoom/joinRoom.
 */
export async function enterLobbyAsGuest(page: Page): Promise<void> {
  await page.goto('/');
  await tap(page, 'btn-skip-to-lobby', 20_000);
  // PWA modal pops up ~600ms after lobby mount; poll for it.
  for (let i = 0; i < 8; i++) {
    if (await dismissPwaModalIfAny(page)) break;
    await sleep(250);
  }
  // Wait for at least one Lobby CTA to be sure we're in.
  await page
    .locator('[data-testid="btn-quick-match"]')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 });
}
