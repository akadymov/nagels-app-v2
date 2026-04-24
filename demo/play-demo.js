/**
 * Nägels Online — 3-Player Multiplayer Demo
 *
 * Three independent browser contexts:
 *   Alice — registers, creates room
 *   Bob   — registers (no email confirmation), joins room
 *   Carol — guest (no registration), joins room
 *
 * All three play the game together.
 *
 * Run:
 *   Terminal 1:  npm run web
 *   Terminal 2:  npm run demo          (normal speed)
 *                npm run demo:slow     (slow, for recording)
 *                npm run demo:fast     (fast, for debugging)
 *
 * Env vars:
 *   DEMO_URL      http://localhost:8081  (or https://nigels.online)
 *   DEMO_SLOW     delay ms between actions (default 700)
 *   DEMO_HANDS    max hands, 0 = until end (default 0)
 *   DEMO_DEVTOOLS 1 = open DevTools (default 0)
 */

'use strict';

const { chromium, devices } = require('@playwright/test');

const BASE_URL      = process.env.DEMO_URL      || 'http://localhost:8081';
const SLOW_MO       = parseInt(process.env.DEMO_SLOW  || '700',  10);
const MAX_HANDS     = parseInt(process.env.DEMO_HANDS || '0',    10);
const OPEN_DEVTOOLS = (process.env.DEMO_DEVTOOLS ?? '0') !== '0';

const IPHONE = devices['iPhone 14 Pro'];
const VIEWPORT = { width: 393, height: 852 };

const TS = () => new Date().toTimeString().slice(0, 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Logging ────────────────────────────────────────────────────────────────

function log(who, msg) { console.log(`[${TS()}] [${who.padEnd(5)}] ${msg}`); }

function step(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ─── Utils ──────────────────────────────────────────────────────────────────

async function waitVisible(locator, who, hint, timeout = 40000) {
  log(who, `wait: ${hint}…`);
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) {
      log(who, `✓ found: ${hint}`);
      return true;
    }
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (elapsed % 5 === 0 && elapsed > 0) log(who, `  …${elapsed}s`);
    await sleep(500);
  }
  log(who, `✗ timeout: ${hint} (${timeout / 1000}s)`);
  return false;
}

async function click(locator, who, hint) {
  const ok = await waitVisible(locator, who, hint);
  if (!ok) throw new Error(`[${who}] element not found: ${hint}`);
  await locator.click();
  log(who, `✓ click: ${hint}`);
}

async function fill(locator, value, who, hint) {
  const ok = await waitVisible(locator, who, hint);
  if (!ok) throw new Error(`[${who}] element not found: ${hint}`);
  await locator.click({ clickCount: 3 });
  await locator.type(value, { delay: 40 });
  log(who, `✓ typed "${value}" → ${hint}`);
}

async function readText(locator, who, hint) {
  const ok = await waitVisible(locator, who, hint);
  if (!ok) throw new Error(`[${who}] element not found: ${hint}`);
  const t = (await locator.textContent())?.trim() ?? '';
  log(who, `✓ text: "${t}" ← ${hint}`);
  return t;
}

// ─── Navigation ─────────────────────────────────────────────────────────────

async function waitForApp(page, who) {
  log(who, `open ${BASE_URL}…`);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  log(who, 'waiting for React app…');
  await page.waitForFunction(() => document.querySelector('[data-testid]') !== null, { timeout: 60000 }).catch(() => {});
  await sleep(1500);
  log(who, '✓ app loaded');
}

/** Welcome → Auth → Sign Up → fill form → submit → Lobby */
async function registerAndGoToLobby(page, who, nickname, email, password) {
  await waitForApp(page, who);

  // Welcome → Sign In button
  await click(page.locator('[data-testid="btn-sign-in"]'), who, 'btn-sign-in');
  await sleep(800);

  // Switch to Sign Up tab
  await click(page.locator('[data-testid="auth-tab-signUp"]'), who, 'auth-tab-signUp');
  await sleep(400);

  // Fill sign up form
  await fill(page.locator('[data-testid="auth-input-nickname"]'), nickname, who, 'nickname');
  await fill(page.locator('[data-testid="auth-input-email"]'), email, who, 'email');
  await fill(page.locator('[data-testid="auth-input-password"]'), password, who, 'password');
  await sleep(300);

  // Submit
  await click(page.locator('[data-testid="auth-btn-submit"]'), who, 'auth-btn-submit');
  log(who, 'waiting for registration…');
  await sleep(4000);

  // Should land in Lobby
  log(who, '✓ registered and in lobby');
}

/** Welcome → Skip to Menu → Lobby (guest) */
async function guestGoToLobby(page, who) {
  await waitForApp(page, who);
  const skip = page.locator('[data-testid="btn-skip-to-lobby"]');
  if (await skip.isVisible({ timeout: 8000 }).catch(() => false)) {
    await click(skip, who, 'btn-skip-to-lobby');
    await sleep(1200);
  }
  log(who, '✓ guest in lobby');
}

/** Lobby → Create Room tab → Create → WaitingRoom → return code */
async function createRoom(page, who) {
  await click(page.locator('[data-testid="tab-create"]'), who, 'tab-create');
  await sleep(500);
  await click(page.locator('[data-testid="btn-create-room"]'), who, 'btn-create-room');
  log(who, 'waiting for room creation…');
  await sleep(5000);
  const code = await readText(page.locator('[data-testid="room-code"]'), who, 'room-code');
  console.log(`\n  ╔══════════════════════╗`);
  console.log(`  ║  ROOM CODE: ${code}  ║`);
  console.log(`  ╚══════════════════════╝\n`);
  return code;
}

/** Lobby → Join Room tab → enter code → Join → WaitingRoom */
async function joinRoom(page, who, code) {
  await click(page.locator('[data-testid="tab-join"]'), who, 'tab-join');
  await sleep(500);
  await fill(page.locator('[data-testid="input-join-code"]'), code, who, 'input-join-code');
  await sleep(300);
  await click(page.locator('[data-testid="btn-join-room"]'), who, 'btn-join-room');
  log(who, 'joining room…');
  await sleep(5000);
}

async function pressReady(page, who) {
  await click(page.locator('[data-testid="btn-ready"]'), who, 'btn-ready');
}

async function pressStart(page, who) {
  const startBtn = page.locator('[data-testid="btn-start-game"]:not([disabled]):not([aria-disabled="true"])');
  await click(startBtn, who, 'btn-start-game (enabled)');
}

// ─── Game Actions ───────────────────────────────────────────────────────────

async function tryBet(page, who) {
  const btns = page.locator('[data-testid^="bet-btn-"]:not([disabled]):not([aria-disabled="true"])');
  const n = await btns.count();
  if (n === 0) return false;

  const btn = btns.first();
  const val = (await btn.textContent())?.trim() ?? '?';
  await btn.click();
  await sleep(600);
  const stillVisible = await btns.first().isVisible({ timeout: 300 }).catch(() => false);
  if (!stillVisible) {
    log(who, `✓ bet = ${val}`);
    return true;
  }
  log(who, `  ↩ bet ${val} not accepted`);
  return false;
}

async function tryPlayCard(page, who) {
  const hand = page.locator('[data-testid="my-hand"]');
  if (!(await hand.isVisible({ timeout: 300 }).catch(() => false))) return false;

  const cards = hand.locator('[data-testid^="card-"]');
  const countBefore = await cards.count();
  if (countBefore === 0) return false;

  for (let i = 0; i < countBefore; i++) {
    const card = cards.nth(i);
    const tid = await card.getAttribute('data-testid').catch(() => null);
    if (!tid) continue;

    try {
      await card.click({ timeout: 1500 });
      await sleep(500);
      const same = hand.locator(`[data-testid="${tid}"]`);
      const exists = await same.isVisible({ timeout: 500 }).catch(() => false);
      if (!exists) {
        log(who, `✓ played ${tid} (1 tap)`);
        return true;
      }
      await same.click({ timeout: 1500 });
    } catch (_) { continue; }

    await sleep(700);
    const countAfter = await cards.count();
    if (countAfter < countBefore) {
      log(who, `✓ played ${tid} (${countBefore}→${countAfter} cards)`);
      return true;
    }
    log(who, `  ↩ card ${tid} not accepted`);
  }
  return false;
}

// ─── Game Loop ──────────────────────────────────────────────────────────────

async function gameLoop(page, who, maxHands) {
  log(who, 'entered game loop');
  let hands = 0;
  let idle  = 0;
  const IDLE_MAX = 180;

  while (true) {
    await sleep(900);

    // Game Over
    const over = await page.locator('text=/Game Over|Конец игры|Fin del juego/i')
      .first().isVisible({ timeout: 300 }).catch(() => false);
    if (over) { log(who, '🏁 Game over!'); await sleep(5000); break; }

    // Continue between hands
    const cont = page.locator('text=/Continue Playing|Продолжить|Continuar/i').first();
    if (await cont.isVisible({ timeout: 300 }).catch(() => false)) {
      await cont.click();
      hands++;
      log(who, `✓ Continue (hands: ${hands})`);
      idle = 0;
      if (maxHands > 0 && hands >= maxHands) { log(who, `limit ${maxHands} hands`); break; }
      continue;
    }

    if (await tryBet(page, who)) { idle = 0; continue; }
    if (await tryPlayCard(page, who)) { idle = 0; continue; }

    idle++;
    if (idle % 20 === 0) log(who, `⌛ waiting (${idle}s)`);
    if (idle >= IDLE_MAX) { log(who, '⚠ idle timeout'); break; }
  }
}

// ─── Window Positioning ─────────────────────────────────────────────────────

async function positionWindow(page, x, y, w, h) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Browser.setWindowBounds', {
      windowId: (await session.send('Browser.getWindowForTarget')).windowId,
      bounds: { left: x, top: y, width: w, height: h },
    });
  } catch (_) {}
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const ts = Date.now();
  step('Nägels Online — 3-Player Multiplayer Demo');
  console.log(`  URL      : ${BASE_URL}`);
  console.log(`  Players  : Alice (registered), Bob (unconfirmed), Carol (guest)`);
  console.log(`  DevTools : ${OPEN_DEVTOOLS ? 'on' : 'off'}`);
  console.log(`  slowMo   : ${SLOW_MO}ms`);
  console.log(`  Hands    : ${MAX_HANDS || 'until end'}\n`);

  const browser = await chromium.launch({
    channel:  'chrome',
    headless: false,
    slowMo:   SLOW_MO,
    devtools: OPEN_DEVTOOLS,
    args: ['--disable-features=TranslateUI', '--disable-infobars', '--lang=en-US'],
  });

  // Three independent contexts (separate sessions)
  const aliceCtx = await browser.newContext({ ...IPHONE, viewport: VIEWPORT });
  const bobCtx   = await browser.newContext({ ...IPHONE, viewport: VIEWPORT });
  const carolCtx = await browser.newContext({ ...IPHONE, viewport: VIEWPORT });

  const alicePage = await aliceCtx.newPage();
  const bobPage   = await bobCtx.newPage();
  const carolPage = await carolCtx.newPage();

  // Position 3 windows side by side
  const winW = VIEWPORT.width + 16;
  const winH = VIEWPORT.height + 88 + (OPEN_DEVTOOLS ? 280 : 0);
  const gap = 6;

  step('Step 0: Position windows');
  await positionWindow(alicePage, 0,                  0, winW, winH);
  await positionWindow(bobPage,   winW + gap,         0, winW, winH);
  await positionWindow(carolPage, (winW + gap) * 2,   0, winW, winH);

  try {
    // ── 1. Alice registers ──────────────────────────────────────────
    step('Step 1: Alice registers');
    const aliceEmail = `alice-${ts}@test.nigels.online`;
    await registerAndGoToLobby(alicePage, 'Alice', 'Alice', aliceEmail, 'test123456');

    // ── 2. Bob registers (won't confirm email) ─────────────────────
    step('Step 2: Bob registers (no email confirmation)');
    const bobEmail = `bob-${ts}@test.nigels.online`;
    await registerAndGoToLobby(bobPage, 'Bob', 'Bob', bobEmail, 'test123456');

    // ── 3. Carol enters as guest ────────────────────────────────────
    step('Step 3: Carol joins as guest');
    await guestGoToLobby(carolPage, 'Carol');
    // Set Carol's name
    await fill(carolPage.locator('[data-testid="input-player-name"]'), 'Carol', 'Carol', 'input-player-name');

    // ── 4. Alice creates room ───────────────────────────────────────
    step('Step 4: Alice creates room');
    const roomCode = await createRoom(alicePage, 'Alice');

    // ── 5. Bob joins room ───────────────────────────────────────────
    step('Step 5: Bob joins room');
    await joinRoom(bobPage, 'Bob', roomCode);

    // ── 6. Carol joins room ─────────────────────────────────────────
    step('Step 6: Carol joins room');
    await joinRoom(carolPage, 'Carol', roomCode);

    // ── 7. Bob & Carol press Ready ──────────────────────────────────
    step('Step 7: Bob & Carol press Ready');
    await sleep(2000);
    await pressReady(bobPage, 'Bob');
    await sleep(1000);
    await pressReady(carolPage, 'Carol');

    // ── 8. Alice starts game ────────────────────────────────────────
    step('Step 8: Alice starts game');
    await sleep(3000);
    await pressStart(alicePage, 'Alice');

    // ── 9. Play! ────────────────────────────────────────────────────
    step('Step 9: Game!');
    await sleep(4000);
    await Promise.all([
      gameLoop(alicePage, 'Alice', MAX_HANDS),
      gameLoop(bobPage,   'Bob',   MAX_HANDS),
      gameLoop(carolPage, 'Carol', MAX_HANDS),
    ]);

    step('✅ Demo complete — closing in 15 seconds');
    console.log('  (stop screen recording now)\n');
    await sleep(15000);

  } catch (err) {
    step(`❌ Error: ${err.message}`);
    console.log('\n  Browser open for inspection. Ctrl+C to exit.\n');
    await sleep(120000);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
