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

// Chromium background-tab throttling cuts non-focused windows' JS
// timers to ~1Hz, which stalls every multi-context headed test
// (multiplayer-6p-mixed, TILE_WINDOWS smoke). Always include these
// flags so the multi-window path "just works"; they're no-ops for
// headless and single-context runs. Mirrors demo/play-demo.js.
const NO_THROTTLE_ARGS = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

// TILE_WINDOWS=1 → headed parallel run with per-worker --window-position
// so the user can watch 6 mobile smoke specs in one row + desktop specs
// cascaded with a 20% rightward shift on a big external monitor.
//   - smoke project: 6-per-row tile, wraps to row 2 for the 7th file.
//   - smoke-desktop project: cascade, 20% of window width per worker.
// Each worker is a fresh Node process; process.env.TEST_PARALLEL_INDEX
// is set by Playwright before the config is re-evaluated, so the
// per-worker x/y here is stable across retries.
const TILE = process.env.TILE_WINDOWS === '1';
const WORKER_IDX = parseInt(process.env.TEST_PARALLEL_INDEX ?? '0', 10);

function tileMobileArgs() {
  if (!TILE) return [];
  const slotW = 470;   // viewport 430 + chrome ~40px
  const slotH = 1000;  // viewport 932 + chrome ~68px
  const perRow = 6;
  const col = WORKER_IDX % perRow;
  const row = Math.floor(WORKER_IDX / perRow);
  return [
    `--window-position=${col * slotW},${row * slotH}`,
    `--window-size=${slotW},${slotH}`,
  ];
}

function tileDesktopArgs() {
  if (!TILE) return [];
  const w = 1480;
  const h = 980;
  const shift = Math.round(w * 0.20);  // 296px
  return [
    `--window-position=${WORKER_IDX * shift},${WORKER_IDX * 40}`,
    `--window-size=${w},${h}`,
  ];
}

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  // Phase 2: wired in but no-ops unless LOCAL_SUPABASE=1.
  globalSetup: require.resolve('./tests/playwright/global-setup'),
  globalTeardown: require.resolve('./tests/playwright/global-teardown'),
  // Per-project `testDir` lives below. The top-level `testMatch`
  // applies to every project. `testMatch` widens to .ts so future
  // phase specs need no further config.
  testMatch: '**/*.spec.{js,ts}',
  // Headed runs against the manual :8081 dev server finish in
  // ~13-14 min. Headless runs against the LOCAL_SUPABASE=1 stack
  // (extra Postgres/Auth/Realtime hops + bundler cold start) reach
  // Hand 20/20 but can need ~22-25 min. 30 minutes covers both modes
  // with headroom. Stalls are caught earlier by the 60s in-spec
  // watchdog (see sp-game.spec.js), so this is the last-resort
  // backstop rather than the primary fail signal.
  timeout: 30 * 60 * 1000,
  expect: { timeout: 15_000 },
  // Tiled mode parallelises within a project (each worker → its own
  // window, positioned by tile{Mobile,Desktop}Args). Default stays
  // serial so scenario/e2e + the headless CI path are unaffected.
  fullyParallel: TILE,
  retries: 0,
  workers: TILE ? 6 : 1,
  reporter: 'list',
  use: {
    baseURL: BASE,
    headless: HEADLESS,
    launchOptions: { slowMo: SLOW_MO, args: [...NO_THROTTLE_ARGS] },
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
    { name: 'e2e',      testDir: './tests/e2e' },
    { name: 'scenario', testDir: './tests/scenario' },
    { name: 'smoke',    testDir: './tests/smoke',
      testIgnore: '**/desktop-layout.spec.ts',
      use: {
        launchOptions: {
          slowMo: SLOW_MO,
          args: [...NO_THROTTLE_ARGS, ...tileMobileArgs()],
        },
      } },
    { name: 'smoke-desktop', testDir: './tests/smoke',
      testMatch: '**/desktop-layout.spec.ts',
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        isMobile: false,
        hasTouch: false,
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
          'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        launchOptions: {
          slowMo: SLOW_MO,
          args: [...NO_THROTTLE_ARGS, ...tileDesktopArgs()],
        },
      } },
  ],
};
