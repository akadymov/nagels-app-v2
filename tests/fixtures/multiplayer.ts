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
 * Sign in to one of the pre-seeded confirmed-email demo accounts and
 * land in the Lobby. Mirrors `loginAsRegistered` in multiplayer-demo.ts
 * but lives here so smoke specs (which don't pull in the demo helper
 * surface) can reach a logged-in lobby in a single call.
 *
 * Why pre-seeded accounts and not on-the-fly admin.createUser:
 *   - Smoke runs against the manual :8081 dev server, which is pointed
 *     at the *prod* Supabase project (see CLAUDE.md).
 *   - We don't want to require a SUPABASE_SERVICE_ROLE_KEY in the
 *     smoke env (would mean prod service-role on the dev machine).
 *   - The 4 accounts (alice|bob|dave|eve@nigels.test, password
 *     `demo-pass-1234`) already exist with email_confirmed_at set;
 *     the e2e demo spec uses them daily.
 *
 * Override the password via DEMO_LOGIN_PASS env if the prod seed
 * was reset.
 */
export async function enterLobbyAsRegisteredUser(
  page: Page,
  email: string,
  label = 'player',
): Promise<void> {
  const password = process.env.DEMO_LOGIN_PASS ?? 'demo-pass-1234';
  await page.goto('/');

  // Same prompt-flag pre-seed as enterLobbyAsGuest — irrelevant for
  // registered users today, harmless if logic shifts later.
  await page.evaluate(() => {
    try {
      localStorage.setItem('auth_prompt_before_create_dismissed_v1', '1');
      localStorage.setItem('auth_prompt_after_game_dismissed_v1', '1');
    } catch {
      /* ignore */
    }
  });

  const vp = page.viewportSize();
  const isDesktop = !!vp && vp.width >= 1024;
  if (!isDesktop) {
    await tap(page, 'btn-sign-in', 20_000);
  } else {
    await page
      .locator('[data-testid="auth-input-email"]')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 });
  }
  await tap(page, 'auth-tab-signIn', 8_000);
  await page.locator('[data-testid="auth-input-email"]').first().fill(email);
  await page
    .locator('[data-testid="auth-input-password"]')
    .first()
    .fill(password);
  await tap(page, 'auth-btn-submit', 8_000);

  await page
    .locator('[data-testid="input-player-name"]:visible')
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 });

  for (let i = 0; i < 8; i += 1) {
    if (await dismissPwaModalIfAny(page)) break;
    await sleep(250);
  }
  // eslint-disable-next-line no-console
  console.log(`[mp:${label}] ✓ logged in as ${email}`);
}

/**
 * Host flow: pick player-count chip, open Create tab, click Create,
 * wait for the WaitingRoom screen, return the 6-char room code.
 *
 * Pass `mode: 'scorekeeper'` to flip the Create tab toggle before
 * pressing Create — the resulting room runs the offline-arbitrator
 * flow (no cards dealt, manual tricks recording after betting).
 */
export async function createRoomAsHost(
  page: Page,
  playerCount: number,
  label = 'host',
  opts: { mode?: 'standard' | 'scorekeeper' } = {},
): Promise<string> {
  await tap(page, `player-count-${playerCount}`, 10_000);
  await sleep(200);
  await tap(page, 'tab-create', 5_000);
  await sleep(300);
  if (opts.mode === 'scorekeeper') {
    await tap(page, 'room-mode-scorekeeper', 5_000);
    await sleep(200);
  }
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

/**
 * Set the TricksRecorder stepper to `target`, then press submit.
 * The stepper starts at the current taken_tricks value (0 on first
 * entry of a hand); we tap +/− until the displayed integer matches
 * before confirming. Best-effort — returns true if the submit click
 * left the input idle (no exception).
 */
export async function tryRecordTricks(
  page: Page,
  target: number,
  label = 'player',
): Promise<boolean> {
  const valueEl = page.locator('[data-testid="tricks-recorder-value"]').first();
  if (!(await valueEl.isVisible({ timeout: 500 }).catch(() => false))) return false;

  const readValue = async (): Promise<number> => {
    const txt = ((await valueEl.textContent().catch(() => '')) || '').trim();
    const n = parseInt(txt, 10);
    return Number.isNaN(n) ? 0 : n;
  };

  let safety = 30;
  while (safety-- > 0) {
    const v = await readValue();
    if (v === target) break;
    const id = v < target ? 'tricks-recorder-inc' : 'tricks-recorder-dec';
    try {
      await tap(page, id, 2_000);
    } catch {
      break;
    }
    await sleep(80);
  }

  try {
    await tap(page, 'tricks-recorder-submit', 4_000);
    // eslint-disable-next-line no-console
    console.log(`[mp:${label}] 🎯 recorded ${target} tricks`);
    return true;
  } catch {
    return false;
  }
}

export interface GameLoopOptions {
  /** Max wall-clock seconds before giving up. Default 35 min. */
  budgetSec?: number;
  /** Idle iterations (~1s each) before failing the loop. Default 120. */
  idleLimit?: number;
  /** Optional label used in console output, e.g. "P3". */
  label?: string;
  /**
   * Player count for the room — only used by tryBet to choose a
   * realistic bet target (cardsPerPlayer / playerCount). Default 6
   * preserves backward-compat with the multiplayer-6p-mixed spec; the
   * 3-player stakes-settlement spec passes 3 so the betting heuristic
   * doesn't undersell on a 3p game.
   */
  playerCount?: number;
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
  const playerCount = opts.playerCount ?? 6;
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
 * Best-effort window placement for multi-context headed runs.
 *
 * Mobile contexts (viewport width < 1024) are laid out in a row on
 * the left. Desktop contexts (≥ 1024) are cascaded on the right
 * with a 280px shift per window. Headless runs no-op silently.
 *
 * Uses CDP Browser.setWindowBounds per page — Playwright's
 * --window-position launch arg only positions the first window
 * when multiple contexts share the same browser, so we have to
 * push per-context bounds explicitly. Pattern mirrors
 * demo/play-demo.js:pos().
 *
 * Heuristic geometry tuned for a 3440-wide ultrawide. Override
 * via DEMO_TILE_MOBILE_W / DEMO_TILE_MOBILE_H /
 * DEMO_TILE_DESKTOP_W / DEMO_TILE_DESKTOP_H env if your monitor
 * differs; set DEMO_NO_TILE=1 to disable placement entirely.
 */
export async function tileContextWindows(pages: Page[]): Promise<void> {
  if (process.env.DEMO_NO_TILE === '1') return;
  if (process.env.HEADLESS === '1') return;

  const mobileW = parseInt(process.env.DEMO_TILE_MOBILE_W ?? '380', 10);
  // 1040px window inner ≈ 932px viewport + ~108px chrome — full
  // game UI fits without vertical scrolling. Bump above this if
  // the layout grows; drop to ~820 if you're short on screen real
  // estate and don't mind scrolling.
  const mobileH = parseInt(process.env.DEMO_TILE_MOBILE_H ?? '1040', 10);
  const desktopW = parseInt(process.env.DEMO_TILE_DESKTOP_W ?? '1400', 10);
  const desktopH = parseInt(process.env.DEMO_TILE_DESKTOP_H ?? '900', 10);
  const cascadeShiftX = Math.round(desktopW * 0.2);
  const cascadeShiftY = 60;

  let mobileCol = 0;
  let desktopIdx = 0;
  const mobileRowWidth = pages.filter((p) => {
    const vp = p.viewportSize();
    return !!vp && vp.width < 1024;
  }).length * mobileW;

  for (const page of pages) {
    const vp = page.viewportSize();
    if (!vp) continue;
    const isDesktop = vp.width >= 1024;
    let x: number;
    let y: number;
    let w: number;
    let h: number;
    if (isDesktop) {
      x = mobileRowWidth + desktopIdx * cascadeShiftX;
      y = desktopIdx * cascadeShiftY;
      w = desktopW;
      h = desktopH;
      desktopIdx += 1;
    } else {
      x = mobileCol * mobileW;
      y = 0;
      w = mobileW;
      h = mobileH;
      mobileCol += 1;
    }
    try {
      const session = await page.context().newCDPSession(page);
      const { windowId } = (await session.send(
        'Browser.getWindowForTarget',
      )) as { windowId: number };
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: { left: x, top: y, width: w, height: h },
      });
      await session.detach().catch(() => {});
    } catch {
      /* CDP unavailable or wrong target — accept default OS placement */
    }
  }
}

/**
 * Skip the Welcome screen + dismiss PWA modal. Every player calls
 * this once on boot before createRoom/joinRoom.
 *
 * Viewport-aware: mobile renders WelcomeScreen with the testID
 * `btn-skip-to-lobby`, but at width ≥ 1024 the route swaps to
 * `DesktopWelcomeAuth` whose CTA uses `desktop-welcome-continue`
 * (see src/screens/desktop/DesktopWelcomeAuth.tsx +
 * src/components/DesktopWelcomePane.tsx). The downstream
 * LobbyScreen and WaitingRoomScreen are mounted directly inside
 * the desktop wrappers, so their testIDs (player-count-N,
 * tab-create, btn-create-room, room-code, btn-ready,
 * btn-start-game, etc.) are unchanged.
 */
export async function enterLobbyAsGuest(page: Page): Promise<void> {
  await page.goto('/');

  // Pre-seed the "save progress" prompt dismissal flags (see
  // src/lib/auth/promptGate.ts). For anonymous users, clicking
  // btn-create-room or finishing a game would otherwise show a
  // one-time modal that blocks performCreateRoom from firing,
  // leaving the spec stuck waiting for room-code. The flags live in
  // AsyncStorage, which on web maps to plain localStorage.
  await page.evaluate(() => {
    try {
      localStorage.setItem('auth_prompt_before_create_dismissed_v1', '1');
      localStorage.setItem('auth_prompt_after_game_dismissed_v1', '1');
    } catch {
      /* localStorage unavailable — let the modal handlers cope */
    }
  });

  const vp = page.viewportSize();
  const isDesktop = !!vp && vp.width >= 1024;
  const continueTestId = isDesktop
    ? 'desktop-welcome-continue'
    : 'btn-skip-to-lobby';
  await tap(page, continueTestId, 20_000);
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

  // Anonymous sign-in is async — it kicks off on app boot via
  // AuthService and writes the session into localStorage under
  // `sb-<project-ref>-auth-token`. Without this wait, the very next
  // createRoom/joinRoom click can fire before [Auth] Session ready
  // and the edge function returns "not_signed_in". 15s budget is
  // plenty against the local stack (typically <500ms).
  await page.waitForFunction(
    () => {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
          try {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            if (parsed?.user?.id) return true;
            if (parsed?.access_token) return true;
          } catch {
            /* malformed entry — keep polling */
          }
        }
      }
      return false;
    },
    null,
    { timeout: 15_000, polling: 200 },
  );
}
