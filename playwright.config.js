'use strict';

/**
 * Playwright config — only used by the SP-game e2e tests under tests/.
 * Visual demos live in demo/ and are run as plain node scripts.
 *
 * Defaults are tuned for **watching** the run (headed + slowMo) — the
 * primary use of this suite is visual regression review. Set HEADLESS=1
 * for CI/background runs.
 *
 * We pin chromium explicitly because devices['iPhone 15 Pro Max']
 * carries defaultBrowserType='webkit', and we want the suite to run on
 * the same engine the multiplayer demo uses (chromium) without forcing
 * a 600 MB webkit download. The viewport / isMobile / hasTouch fields
 * are set by hand so we still emulate a mobile context.
 */

const BASE = process.env.DEMO_URL || 'http://localhost:8081';
const HEADLESS = process.env.HEADLESS === '1';
// Per-action slow-mo so a human watcher can follow what the test is
// doing. 80 ms matches the multiplayer demo's default. Override with
// SLOW_MO=0 to run as fast as Playwright allows.
const SLOW_MO = parseInt(process.env.SLOW_MO ?? '80', 10);

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: './tests',
  testMatch: '**/*.spec.js',
  // A full Hard-bot game can take ~3-6 minutes per hand × 20 hands.
  // We cap each test at 12 minutes so a stuck game fails fast rather
  // than blocking CI.
  timeout: 12 * 60 * 1000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE,
    headless: HEADLESS,
    launchOptions: { slowMo: SLOW_MO },
    browserName: 'chromium',
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
      'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 ' +
      'Mobile/15E148 Safari/604.1',
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
};
