/**
 * Nägels Online — 6-player visual demo
 *
 * Opens 6 Chromium windows arranged in a 3×2 grid.
 * Each window is an independent player session (separate cookies/storage).
 * Players connect to the same room, mark ready, and auto-play the first few tricks.
 *
 * Usage:
 *   APP_URL=https://your-app.grokony.com npx ts-node scripts/demo-6players.ts
 *
 * Or with the default localhost:
 *   npx ts-node scripts/demo-6players.ts
 *
 * Tip: before recording, maximise the screen and use Mission Control to see all windows.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';

// ── Config ──────────────────────────────────────────────────
const APP_URL  = (process.env.APP_URL || 'http://localhost:8081').replace(/\/$/, '');
const NAMES    = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank'];
const SLOW_MO  = 120;   // ms between Playwright actions (increase for slower demo)
const STEP_MS  = 1800;  // pause between logical steps (visible on screen)
const TRICK_MS = 2200;  // pause between tricks (so viewer can follow)

// Window layout: 3 columns × 2 rows, each 400×680 px
const COLS = 3, ROWS = 2;
const WIN_W = 400, WIN_H = 680, GAP = 4;
const positions = Array.from({ length: 6 }, (_, i) => ({
  x: (i % COLS) * (WIN_W + GAP),
  y: Math.floor(i / COLS) * (WIN_H + GAP),
}));

// ── Helpers ──────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function log(player: string, msg: string) {
  const time = new Date().toTimeString().slice(0, 8);
  console.log(`[${time}] [${player.padEnd(5)}] ${msg}`);
}

/** Position a browser window via JS (works in Chromium) */
async function positionWindow(page: Page, x: number, y: number, w: number, h: number) {
  try {
    await page.evaluate(({ x, y, w, h }) => {
      window.moveTo(x, y);
      window.resizeTo(w, h);
    }, { x, y, w, h });
  } catch {
    // Non-fatal: some environments don't allow window.moveTo
  }
}

/** Click element by testID */
async function tapId(page: Page, testId: string, timeout = 8000) {
  const el = page.getByTestId(testId);
  await el.waitFor({ state: 'visible', timeout });
  await el.click();
}

/** Fill input by testID */
async function fillId(page: Page, testId: string, text: string) {
  const el = page.getByTestId(testId);
  await el.waitFor({ state: 'visible' });
  await el.fill(text);
}

// ── Phase helpers ────────────────────────────────────────────

/** Navigate Welcome → Lobby, set player name */
async function goToLobby(page: Page, name: string) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await positionWindow(page, 0, 0, WIN_W, WIN_H); // will be repositioned after

  // Welcome screen
  await tapId(page, 'btn-skip-to-lobby');
  log(name, 'Lobby reached');

  // Set name
  await fillId(page, 'input-player-name', name);
  await sleep(300);
}

/** Player 1: create a 6-player room, return room code */
async function createRoom(page: Page, name: string): Promise<string> {
  // Select 6 players
  await tapId(page, 'player-count-6');
  await sleep(400);

  await tapId(page, 'btn-create-room');
  log(name, 'Creating room…');

  // Wait for WaitingRoom and read the code
  const codeEl = page.getByTestId('room-code');
  await codeEl.waitFor({ state: 'visible', timeout: 15000 });
  const code = (await codeEl.textContent()) ?? '';
  log(name, `Room created: ${code}`);
  return code.trim();
}

/** Players 2–6: join by room code */
async function joinRoom(page: Page, name: string, code: string) {
  await fillId(page, 'input-join-code', code);
  await sleep(300);
  await tapId(page, 'btn-join-room');
  log(name, `Joining room ${code}…`);

  // Wait for WaitingRoom
  await page.getByTestId('room-code').waitFor({ state: 'visible', timeout: 15000 });
  log(name, 'Joined WaitingRoom');
}

/** Mark ready */
async function markReady(page: Page, name: string) {
  try {
    await tapId(page, 'btn-ready', 5000);
    log(name, 'Marked ready');
  } catch {
    log(name, 'Ready button not found (may already be ready)');
  }
}

/** Host starts the game */
async function startGame(page: Page, name: string) {
  await tapId(page, 'btn-start-game', 10000);
  log(name, 'Started game!');
}

/**
 * Auto-play one betting or card-play action for a player.
 * Returns 'bet' | 'card' | 'waiting' | 'done'.
 */
async function autoPlayOnce(page: Page, name: string): Promise<string> {
  // Check for bet buttons (betting phase)
  const betBtns = page.locator('[data-testid^="bet-btn-"]');
  const betCount = await betBtns.count();
  if (betCount > 0) {
    // Pick the middle bet to avoid the forbidden-last-player constraint
    const idx = Math.floor(betCount / 2);
    await betBtns.nth(idx).click();
    const label = await betBtns.nth(idx).textContent();
    log(name, `Bet placed: ${label?.trim()}`);
    return 'bet';
  }

  // Check for cards in hand (playing phase)
  const hand = page.locator('[data-testid^="card-"]');
  const cardCount = await hand.count();
  if (cardCount > 0) {
    await hand.first().click();
    const label = await hand.first().getAttribute('data-testid');
    log(name, `Card played: ${label}`);
    return 'card';
  }

  return 'waiting';
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   Nägels Online — 6-Player Demo      ║');
  console.log(`║   App: ${APP_URL.slice(0, 30).padEnd(30)} ║`);
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  const browser: Browser = await chromium.launch({
    headless: false,
    slowMo: SLOW_MO,
    args: ['--start-maximized'],
  });

  // Create 6 independent browser contexts (separate sessions)
  const contexts: BrowserContext[] = [];
  const pages:    Page[]           = [];

  for (let i = 0; i < 6; i++) {
    const ctx = await browser.newContext({
      viewport: { width: WIN_W, height: WIN_H },
      locale: 'en-US',
    });
    const page = await ctx.newPage();
    contexts.push(ctx);
    pages.push(page);
  }

  // ── Step 1: Navigate to Lobby ───────────────────────────
  console.log('\n▶  Step 1: Opening 6 browser windows…');
  await Promise.all(pages.map((page, i) => goToLobby(page, NAMES[i])));

  // Position windows in 3×2 grid
  for (let i = 0; i < 6; i++) {
    const { x, y } = positions[i];
    await positionWindow(pages[i], x, y, WIN_W, WIN_H);
  }

  await sleep(STEP_MS);

  // ── Step 2: Player 1 creates room ─────────────────────
  console.log('\n▶  Step 2: Alice creates a 6-player room…');
  const roomCode = await createRoom(pages[0], NAMES[0]);
  await sleep(STEP_MS);

  // ── Step 3: Players 2–6 join ───────────────────────────
  console.log(`\n▶  Step 3: Bob–Frank join room ${roomCode}…`);
  // Join sequentially so we can see each player appear in Alice's WaitingRoom
  for (let i = 1; i < 6; i++) {
    await joinRoom(pages[i], NAMES[i], roomCode);
    await sleep(STEP_MS);
  }

  await sleep(STEP_MS);

  // ── Step 4: All mark ready ─────────────────────────────
  console.log('\n▶  Step 4: All players marking ready…');
  for (let i = 1; i < 6; i++) {  // players 2–6 mark ready; host auto-ready
    await markReady(pages[i], NAMES[i]);
    await sleep(600);
  }

  await sleep(STEP_MS);

  // ── Step 5: Host starts the game ──────────────────────
  console.log('\n▶  Step 5: Alice starts the game…');
  await startGame(pages[0], NAMES[0]);

  // Wait for GameTable to appear on all screens
  console.log('   Waiting for GameTable on all screens…');
  await Promise.all(
    pages.map(page =>
      page.locator('[data-testid="my-hand"]').waitFor({ state: 'visible', timeout: 20000 })
        .catch(() => { /* some players may be dealt 0 cards in some hands */ })
    )
  );
  log('ALL', 'GameTable visible — game started!');
  await sleep(STEP_MS * 1.5);

  // ── Step 6: Auto-play betting + 3 tricks ─────────────
  console.log('\n▶  Step 6: Auto-playing first betting round…');

  // Betting round: each player places a bet when it's their turn
  const BET_ATTEMPTS = 30;
  for (let attempt = 0; attempt < BET_ATTEMPTS; attempt++) {
    let anyAction = false;
    for (let i = 0; i < 6; i++) {
      const result = await autoPlayOnce(pages[i], NAMES[i]);
      if (result === 'bet') anyAction = true;
    }
    if (!anyAction) break;
    await sleep(STEP_MS);
  }

  await sleep(STEP_MS);
  console.log('\n▶  Step 7: Auto-playing first 3 tricks…');

  // Card-playing rounds
  const TRICKS_TO_DEMO = 3;
  for (let trick = 0; trick < TRICKS_TO_DEMO; trick++) {
    log('ALL', `Trick ${trick + 1}…`);
    const PLAY_ATTEMPTS = 12;
    for (let attempt = 0; attempt < PLAY_ATTEMPTS; attempt++) {
      let anyAction = false;
      for (let i = 0; i < 6; i++) {
        const result = await autoPlayOnce(pages[i], NAMES[i]);
        if (result === 'card') anyAction = true;
      }
      if (!anyAction) break;
      await sleep(STEP_MS);
    }
    await sleep(TRICK_MS);
  }

  // ── Done ───────────────────────────────────────────────
  console.log('');
  console.log('✅  Demo complete. All 6 browsers will stay open for you to explore.');
  console.log('   Close this terminal or press Ctrl+C when done.');
  console.log('');

  // Keep browsers open until user Ctrl+C
  await new Promise(() => {});
}

main().catch(err => {
  console.error('Demo failed:', err);
  process.exit(1);
});
