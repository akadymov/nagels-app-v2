'use strict';

/**
 * Playwright config — only used by the SP-game e2e tests under tests/.
 * Visual demos live in demo/ and are run as plain node scripts.
 */
const { devices } = require('@playwright/test');

const BASE = process.env.DEMO_URL || 'http://localhost:8081';
const HEADLESS = process.env.HEADLESS !== '0';

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
  reporter: process.env.CI ? 'list' : 'list',
  use: {
    baseURL: BASE,
    headless: HEADLESS,
    viewport: { width: 430, height: 932 },
    ...devices['iPhone 15 Pro Max'],
    // Override the device viewport — devices['iPhone 15 Pro Max'] sets
    // its own; respread last so { width, height } above wins.
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
};
