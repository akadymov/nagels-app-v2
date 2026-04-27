/**
 * Nägels Online — 4-player full-game test on PROD
 *
 * Plays a complete 4-player match (20 hands, ~100 tricks) and captures all
 * potential bugs:
 *   - Page errors (uncaught JS exceptions)
 *   - Console errors
 *   - Failed network requests (Supabase / app domain)
 *   - Stuck states (no progress for >60s)
 *   - State desync (different `hand x/y` across players)
 *   - Scoreboard / continue-button quirks
 *
 * Each player runs an independent action loop in parallel. Loops are tolerant
 * to "not my turn" — the app silently ignores clicks from non-active players.
 *
 * Usage:
 *   APP_URL=https://nigels.online npx tsx scripts/demo-4players.ts
 */

import { chromium, Browser, BrowserContext, Page, ConsoleMessage } from 'playwright';

// ── Config ──────────────────────────────────────────────────
const APP_URL  = (process.env.APP_URL || 'http://localhost:8081').replace(/\/$/, '');
const NAMES    = ['Alice', 'Bob', 'Carol', 'Dave'];
const PLAYERS  = NAMES.length;
const SLOW_MO  = 30;
const STEP_MS  = 1200;
const POLL_MS  = 700;             // per-player action loop tick
const STUCK_THRESHOLD_MS = 90_000; // flag bug if a player makes no action for this long
const MAX_GAME_DURATION_MS = 75 * 60 * 1000; // 75 min hard cap

// Window layout: 2 columns × 2 rows
const COLS = 2;
const WIN_W = 480, WIN_H = 760, GAP = 4;
const positions = Array.from({ length: PLAYERS }, (_, i) => ({
  x: (i % COLS) * (WIN_W + GAP),
  y: Math.floor(i / COLS) * (WIN_H + GAP),
}));

// ── Bug collection ───────────────────────────────────────────
type Bug = {
  ts: string;
  player: string;
  category: 'pageerror' | 'consoleerror' | 'requestfailed' | 'stuck' | 'desync' | 'unexpected';
  message: string;
};

const bugs: Bug[] = [];
const bugSeen = new Set<string>(); // dedupe by category+message

function recordBug(player: string, category: Bug['category'], message: string) {
  const key = `${category}::${message.slice(0, 200)}`;
  if (bugSeen.has(key)) return;
  bugSeen.add(key);
  const ts = new Date().toTimeString().slice(0, 8);
  bugs.push({ ts, player, category, message });
  console.log(`🐞 [${ts}] [${player.padEnd(5)}] [${category}] ${message.slice(0, 300)}`);
}

// ── Helpers ──────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function log(player: string, msg: string) {
  const time = new Date().toTimeString().slice(0, 8);
  console.log(`[${time}] [${player.padEnd(5)}] ${msg}`);
}

async function positionWindow(page: Page, x: number, y: number, w: number, h: number) {
  try {
    await page.evaluate(({ x, y, w, h }) => {
      window.moveTo(x, y);
      window.resizeTo(w, h);
    }, { x, y, w, h });
  } catch {}
}

async function tapId(page: Page, testId: string, timeout = 8000) {
  const el = page.getByTestId(testId);
  await el.waitFor({ state: 'visible', timeout });
  await el.click();
}

async function fillId(page: Page, testId: string, text: string) {
  const el = page.getByTestId(testId);
  await el.waitFor({ state: 'visible' });
  await el.fill(text);
}

function attachBugListeners(page: Page, name: string) {
  page.on('pageerror', err => {
    recordBug(name, 'pageerror', `${err.name}: ${err.message}`);
  });
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') {
      const txt = m.text();
      // Filter common noise
      if (txt.includes('Download the React DevTools')) return;
      if (txt.includes('Failed to load resource')) return;
      if (txt.includes('manifest.json')) return;
      recordBug(name, 'consoleerror', txt);
    }
  });
  page.on('requestfailed', req => {
    const url = req.url();
    if (url.includes('nigels.online') || url.includes('supabase')) {
      const failure = req.failure()?.errorText ?? 'unknown';
      recordBug(name, 'requestfailed', `${req.method()} ${url} — ${failure}`);
    }
  });
}

// ── Phase helpers ────────────────────────────────────────────

async function goToLobby(page: Page, name: string) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await positionWindow(page, 0, 0, WIN_W, WIN_H);
  await tapId(page, 'btn-skip-to-lobby');
  log(name, 'Lobby reached');
  await fillId(page, 'input-player-name', name);
  await sleep(300);
}

async function createRoom(page: Page, name: string): Promise<string> {
  await tapId(page, `player-count-${PLAYERS}`);
  await sleep(300);
  await tapId(page, 'tab-create');
  await sleep(300);
  await tapId(page, 'btn-create-room');
  log(name, 'Creating room…');
  const codeEl = page.getByTestId('room-code');
  await codeEl.waitFor({ state: 'visible', timeout: 15000 });
  const code = (await codeEl.textContent()) ?? '';
  log(name, `Room created: ${code}`);
  return code.trim();
}

async function joinRoom(page: Page, name: string, code: string) {
  await tapId(page, 'tab-join');
  await sleep(300);
  await fillId(page, 'input-join-code', code);
  await sleep(300);
  await tapId(page, 'btn-join-room');
  log(name, `Joining room ${code}…`);
  await page.getByTestId('room-code').waitFor({ state: 'visible', timeout: 15000 });
  log(name, 'Joined WaitingRoom');
}

async function markReady(page: Page, name: string) {
  try {
    await tapId(page, 'btn-ready', 5000);
    log(name, 'Marked ready');
  } catch {
    log(name, 'Ready button not found (may already be ready)');
  }
}

async function startGame(page: Page, name: string) {
  await tapId(page, 'btn-start-game', 10000);
  log(name, 'Started game!');
}

// ── Action loop (per player) ─────────────────────────────────

type LoopState = {
  lastActionAt: number;
  betsPlaced: number;
  cardsPlayed: number;
  scoreboardClicks: number;
  done: boolean;
  endReason: string | null;
};

async function tryClick(locator: ReturnType<Page['locator']>, timeout = 4000): Promise<boolean> {
  try {
    await locator.click({ timeout });
    return true;
  } catch {
    try {
      await locator.click({ timeout: 1500, force: true });
      return true;
    } catch {
      return false;
    }
  }
}

async function isVisible(locator: ReturnType<Page['locator']>, timeout = 300): Promise<boolean> {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

/** One iteration of a player's autoplay loop. Returns true if game ended. */
async function actionStep(page: Page, name: string, state: LoopState, debug: boolean): Promise<void> {
  // 1. Scoreboard modal: detect "Play Again" (game over) or click "Continue Playing"
  const playAgainBtn = page.getByText('Play Again', { exact: false }).first();
  if (await isVisible(playAgainBtn, 200)) {
    state.done = true;
    state.endReason = 'PlayAgain visible — match complete';
    log(name, '🏁 Match complete (Play Again button visible)');
    return;
  }

  const continueBtn = page.getByText('Continue Playing', { exact: false }).first();
  if (await isVisible(continueBtn, 200)) {
    if (await tryClick(continueBtn, 1500)) {
      state.scoreboardClicks++;
      state.lastActionAt = Date.now();
      log(name, `▶ Scoreboard continue (#${state.scoreboardClicks})`);
      await sleep(600);
      return;
    }
  }

  // 2. Bet buttons (only the active better has them rendered)
  const betBtns = page.locator('[data-testid^="bet-btn-"]');
  const betCount = await betBtns.count().catch(() => 0);
  if (debug) log(name, `[debug] bets=${betCount}`);
  if (betCount > 0) {
    // Try several bet positions if the middle one is forbidden
    const tryOrder = [Math.floor(betCount / 2), 0, betCount - 1, 1, betCount - 2].filter((v, i, a) => v >= 0 && v < betCount && a.indexOf(v) === i);
    for (const idx of tryOrder) {
      const target = betBtns.nth(idx);
      if (await tryClick(target, 3000)) {
        state.betsPlaced++;
        state.lastActionAt = Date.now();
        log(name, `🎯 Bet #${state.betsPlaced} (idx ${idx})`);
        await sleep(500);
        return;
      }
    }
    if (debug) log(name, `[debug] all bet clicks failed`);
  }

  // 3. Cards in own hand (clicks ignored unless it's our turn)
  const hand = page.locator('[data-testid="my-hand"] [data-testid^="card-"]');
  const cardCount = await hand.count().catch(() => 0);
  if (debug) log(name, `[debug] cards=${cardCount}`);
  if (cardCount > 0) {
    const target = hand.first();
    if (await tryClick(target, 2000)) {
      state.cardsPlayed++;
      state.lastActionAt = Date.now();
      if (state.cardsPlayed % 10 === 0) {
        log(name, `🃏 Card clicks: ${state.cardsPlayed}`);
      }
      await sleep(300);
      return;
    }
  }
}

async function runPlayerLoop(page: Page, name: string, gameStartAt: number): Promise<LoopState> {
  const state: LoopState = {
    lastActionAt: Date.now(),
    betsPlaced: 0,
    cardsPlayed: 0,
    scoreboardClicks: 0,
    done: false,
    endReason: null,
  };

  let iter = 0;
  let stuckShotTaken = false;
  while (!state.done) {
    iter++;
    if (Date.now() - gameStartAt > MAX_GAME_DURATION_MS) {
      state.done = true;
      state.endReason = 'Hard time cap reached';
      recordBug(name, 'unexpected', 'Game exceeded 30-min hard cap');
      break;
    }
    const stuckMs = Date.now() - state.lastActionAt;
    if (stuckMs > STUCK_THRESHOLD_MS) {
      recordBug(name, 'stuck', `No successful action for ${Math.round(stuckMs / 1000)}s`);
      if (!stuckShotTaken) {
        try {
          const shot = `/tmp/demo-stuck-${name}-${Date.now()}.png`;
          await page.screenshot({ path: shot, fullPage: true });
          log(name, `📸 Screenshot saved: ${shot}`);
          stuckShotTaken = true;
        } catch {}
      }
      state.lastActionAt = Date.now();
    } else if (stuckMs < 5000) {
      stuckShotTaken = false;
    }

    // Debug log on first few iterations of game (when we want to see initial state)
    const debug = iter <= 3 || iter % 50 === 0;

    try {
      await actionStep(page, name, state, debug);
    } catch (err) {
      recordBug(name, 'unexpected', `actionStep threw: ${(err as Error).message}`);
    }

    if (!state.done) await sleep(POLL_MS);
  }

  log(name, `Loop done — ${state.endReason} | bets=${state.betsPlaced} cards=${state.cardsPlayed} continues=${state.scoreboardClicks}`);
  return state;
}

// ── Cross-player desync watcher ─────────────────────────────

async function readHandIndicator(page: Page): Promise<string | null> {
  // Look for "Hand X/Y" or "Hand X / Y" text — present on Scoreboard
  // Falls back to null if not visible
  try {
    const el = page.getByText(/Hand\s+\d+\s*\/\s*\d+/i).first();
    if (await isVisible(el, 200)) {
      return ((await el.textContent()) ?? '').trim();
    }
  } catch {}
  return null;
}

async function desyncWatcher(pages: Page[], cancel: () => boolean): Promise<void> {
  while (!cancel()) {
    await sleep(15_000);
    const reads = await Promise.all(pages.map(p => readHandIndicator(p)));
    const present = reads.filter(Boolean) as string[];
    if (present.length >= 2) {
      const unique = new Set(present);
      if (unique.size > 1) {
        recordBug('ALL', 'desync', `Hand indicators differ: ${reads.map((r, i) => `${NAMES[i]}=${r ?? '—'}`).join(', ')}`);
      }
    }
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Nägels Online — 4-Player FULL MATCH    ║');
  console.log(`║   App: ${APP_URL.slice(0, 32).padEnd(32)}  ║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  const browser: Browser = await chromium.launch({
    headless: false,
    slowMo: SLOW_MO,
    args: ['--start-maximized'],
  });

  const contexts: BrowserContext[] = [];
  const pages:    Page[]           = [];

  for (let i = 0; i < PLAYERS; i++) {
    const ctx = await browser.newContext({
      viewport: { width: WIN_W, height: WIN_H },
      locale: 'en-US',
    });
    const page = await ctx.newPage();
    attachBugListeners(page, NAMES[i]);
    contexts.push(ctx);
    pages.push(page);
  }

  // ── Setup ─────────────────────────────────────────────────
  console.log(`\n▶  Setup: opening ${PLAYERS} windows…`);
  await Promise.all(pages.map((page, i) => goToLobby(page, NAMES[i])));
  for (let i = 0; i < PLAYERS; i++) {
    const { x, y } = positions[i];
    await positionWindow(pages[i], x, y, WIN_W, WIN_H);
  }
  await sleep(STEP_MS);

  console.log('\n▶  Setup: Alice creates room…');
  const roomCode = await createRoom(pages[0], NAMES[0]);
  await sleep(STEP_MS);

  console.log(`\n▶  Setup: ${NAMES.slice(1).join(', ')} join ${roomCode}…`);
  for (let i = 1; i < PLAYERS; i++) {
    await joinRoom(pages[i], NAMES[i], roomCode);
    await sleep(STEP_MS);
  }
  await sleep(STEP_MS);

  console.log('\n▶  Setup: marking ready…');
  for (let i = 1; i < PLAYERS; i++) {
    await markReady(pages[i], NAMES[i]);
    await sleep(400);
  }
  await sleep(STEP_MS);

  console.log('\n▶  Setup: Alice starts the game…');
  await startGame(pages[0], NAMES[0]);

  console.log('   Waiting for GameTable on all screens…');
  await Promise.all(
    pages.map((page, i) =>
      page.locator('[data-testid="my-hand"]').waitFor({ state: 'visible', timeout: 25000 })
        .catch(() => recordBug(NAMES[i], 'unexpected', 'my-hand never appeared'))
    )
  );
  log('ALL', 'GameTable visible — match begins!');
  await sleep(STEP_MS);

  // ── Run match ─────────────────────────────────────────────
  console.log('\n▶  Playing full 20-hand match (this will take a while)…');
  const gameStartAt = Date.now();
  let cancelled = false;
  const desync = desyncWatcher(pages, () => cancelled);

  const results = await Promise.all(
    pages.map((page, i) => runPlayerLoop(page, NAMES[i], gameStartAt))
  );
  cancelled = true;
  await desync;

  const totalSec = Math.round((Date.now() - gameStartAt) / 1000);
  console.log(`\n✅  Match finished in ${totalSec}s`);

  // ── Bug report ───────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log('  BUG REPORT');
  console.log('══════════════════════════════════════════');
  if (bugs.length === 0) {
    console.log('  ✓ No bugs detected.');
  } else {
    const byCat = new Map<string, Bug[]>();
    for (const b of bugs) {
      if (!byCat.has(b.category)) byCat.set(b.category, []);
      byCat.get(b.category)!.push(b);
    }
    for (const [cat, list] of Array.from(byCat.entries())) {
      console.log(`\n[${cat}] (${list.length})`);
      for (const b of list) {
        console.log(`  • [${b.ts}] [${b.player}] ${b.message.slice(0, 400)}`);
      }
    }
  }

  console.log('\n══════════════════════════════════════════');
  console.log('  PLAYER STATS');
  console.log('══════════════════════════════════════════');
  results.forEach((r, i) => {
    console.log(`  ${NAMES[i].padEnd(5)} → bets=${r.betsPlaced}  cards=${r.cardsPlayed}  continues=${r.scoreboardClicks}  end=${r.endReason}`);
  });
  console.log('');

  console.log('Browsers stay open. Ctrl+C to exit.');
  await new Promise(() => {});
}

main().catch(err => {
  console.error('Demo failed:', err);
  process.exit(1);
});
