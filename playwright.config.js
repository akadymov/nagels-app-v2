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

// Three modes:
//   - LOCAL_SUPABASE=1  → :8082 (isolated test stack, booted by globalSetup)
//   - DEMO_URL=…        → arbitrary host (used by test:sp:prod)
//   - default           → :8081 (manual dev server, legacy npm run test:sp)
const BASE =
  process.env.DEMO_URL ||
  (process.env.LOCAL_SUPABASE === '1'
    ? 'http://localhost:8082'
    : 'http://localhost:8081');
const HEADLESS = process.env.HEADLESS === '1';
// Per-action slow-mo so a human watcher can follow what the test is
// doing. 80 ms matches the multiplayer demo's default. Override with
// SLOW_MO=0 to run as fast as Playwright allows.
const SLOW_MO = parseInt(process.env.SLOW_MO ?? '80', 10);

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  // Phase 2: wired in but no-ops unless LOCAL_SUPABASE=1.
  globalSetup: require.resolve('./tests/playwright/global-setup'),
  globalTeardown: require.resolve('./tests/playwright/global-teardown'),
  // Per-project `testDir` lives below. The top-level `testMatch`
  // applies to every project. `testMatch` widens to .ts so future
  // phase specs need no further config.
  testMatch: '**/*.spec.{js,ts}',
  // A full Hard-bot game in headless mode runs ~13-14 of 20 hands in
  // 12 minutes on a 24 GB Apple Silicon laptop. 20 minutes leaves
  // headroom for the full game to complete. Stalls are caught earlier
  // by the 60s in-spec watchdog (see sp-game.spec.js), so this is the
  // last-resort backstop rather than the primary fail signal.
  timeout: 20 * 60 * 1000,
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
  projects: [
    // Phase 1 ships with just the e2e project. smoke / scenario
    // projects are added in Phase 4 / Phase 5.
    { name: 'e2e', testDir: './tests/e2e' },
  ],
};
