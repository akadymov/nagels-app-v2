/**
 * Nägels Online — 4-Player Full Feature Demo
 *
 *   Alice  — registers, picks 🦈 avatar, dark theme, English, joins, chats
 *   Bob    — registers (unconfirmed email), picks 🐺 avatar, Russian, joins, chats
 *   Carol  — guest, picks 🦊 avatar, Spanish, joins
 *   Dave   — guest, light theme, English, creates room, views last trick periodically
 *
 * Features tested:
 *   ✓ Registration (2 registered, 2 guests)
 *   ✓ Profile editing (avatar, nickname)
 *   ✓ Theme switching (dark, light)
 *   ✓ Language switching (en, ru, es)
 *   ✓ Room create/join
 *   ✓ In-game chat (betting + playing phases)
 *   ✓ Last trick replay
 *   ✓ Full game play
 *
 * Run:
 *   DEMO_URL=https://nigels.online npm run demo
 *   DEMO_URL=https://nigels.online DEMO_SLOW=50 npm run demo:fast
 */

'use strict';

const { chromium, devices } = require('@playwright/test');

const BASE     = process.env.DEMO_URL  || 'http://localhost:8081';
const SLOW_MO  = parseInt(process.env.DEMO_SLOW || '100', 10);
const MAX_HANDS= parseInt(process.env.DEMO_HANDS || '0', 10);
const DEVTOOLS = (process.env.DEMO_DEVTOOLS ?? '0') !== '0';

const IPHONE   = devices['iPhone 15 Pro Max'];
const VP       = { width: 430, height: 932 };
const WAIT     = 8000;
const POLL     = 250;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const TS = () => new Date().toTimeString().slice(0, 8);
const log = (w, m) => console.log(`[${TS()}] [${w.padEnd(5)}] ${m}`);
const step = t => console.log(`\n${'─'.repeat(60)}\n  ${t}\n${'─'.repeat(60)}`);

// ─── Helpers ────────────────────────────────────────────────────────────────

async function find(loc, ms = WAIT) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await loc.isVisible().catch(() => false)) return true;
    await sleep(POLL);
  }
  return false;
}

async function tap(p, tid, w, ms = WAIT) {
  const l = p.locator(`[data-testid="${tid}"]`);
  if (!(await find(l, ms))) { log(w, `✗ ${tid} (${ms}ms)`); return false; }
  await l.click();
  log(w, `✓ ${tid}`);
  return true;
}

async function type(p, tid, val, w) {
  const l = p.locator(`[data-testid="${tid}"]`);
  if (!(await find(l))) throw new Error(`[${w}] missing: ${tid}`);
  await l.click({ clickCount: 3 });
  await l.type(val, { delay: 25 });
  log(w, `✓ ${tid} = "${val}"`);
}

async function txt(p, tid, w) {
  const l = p.locator(`[data-testid="${tid}"]`);
  if (!(await find(l))) throw new Error(`[${w}] missing: ${tid}`);
  return ((await l.textContent()) || '').trim();
}

// ─── App & Auth ─────────────────────────────────────────────────────────────

async function loadApp(p, w) {
  log(w, `open ${BASE}…`);
  await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForFunction(() => document.querySelector('[data-testid]'), { timeout: 20000 }).catch(() => {});
  await sleep(1000);
  log(w, '✓ loaded');
}

async function register(p, w, nick, email, pass) {
  if (!(await tap(p, 'btn-sign-in', w, 10000))) {
    log(w, 'sign-in not found → skip');
    await tap(p, 'btn-skip-to-lobby', w, 5000);
    return;
  }
  await sleep(400);
  await tap(p, 'auth-tab-signUp', w);
  await sleep(300);
  await type(p, 'auth-input-nickname', nick, w);
  await type(p, 'auth-input-email', email, w);
  await type(p, 'auth-input-password', pass, w);
  await tap(p, 'auth-btn-submit', w);
  log(w, 'registering…');
  await sleep(3000);
  log(w, '✓ registered');
}

async function guestLobby(p, w, nick) {
  await tap(p, 'btn-skip-to-lobby', w, 10000);
  await sleep(600);
  const l = p.locator('[data-testid="input-player-name"]');
  if (await find(l, 3000)) {
    await l.click({ clickCount: 3 });
    await l.type(nick, { delay: 25 });
    log(w, `�� name="${nick}"`);
  }
}

// ─── Settings / Profile ─────────────────────────────────────────────────────

async function goSettings(p, w) {
  // From lobby: tap ⚙ button
  const gear = p.locator('text=/⚙/').first();
  if (await find(gear, 3000)) {
    await gear.click();
    log(w, '✓ → settings');
    await sleep(800);
    return true;
  }
  log(w, '✗ settings button not found');
  return false;
}

async function setAvatar(p, w, emoji) {
  await tap(p, `avatar-${emoji}`, w, 3000);
  await tap(p, 'settings-save', w, 3000);
  await sleep(500);
  log(w, `✓ avatar=${emoji}`);
}

async function setTheme(p, w, theme) {
  await tap(p, `theme-${theme}`, w, 3000);
  log(w, `✓ theme=${theme}`);
}

async function setLang(p, w, lang) {
  await tap(p, `lang-${lang}`, w, 3000);
  log(w, `✓ lang=${lang}`);
}

async function backFromSettings(p, w) {
  await tap(p, 'settings-back', w, 3000);
  await sleep(500);
}

// ─── Room ───────────────────────────────────────────────────────────────────

async function createRoom(p, w) {
  await tap(p, 'tab-create', w);
  await sleep(300);
  await tap(p, 'btn-create-room', w);
  log(w, 'creating…');
  await sleep(4000);
  const code = await txt(p, 'room-code', w);
  log(w, `✓ room: ${code}`);
  return code;
}

async function joinRoom(p, w, code) {
  await tap(p, 'tab-join', w);
  await sleep(300);
  await type(p, 'input-join-code', code, w);
  await sleep(200);
  await tap(p, 'btn-join-room', w);
  log(w, 'joining…');
  await sleep(4000);
  log(w, '✓ joined');
}

// ─── Chat ───────────────────────────────────────────────────────────────────

async function chatBetting(p, w, msg) {
  try {
    const input = p.locator('[data-testid="betting-chat-input"]');
    if (!(await find(input, 2000))) { log(w, '✗ chat input hidden'); return; }
    await input.click({ timeout: 3000 });
    await input.type(msg, { delay: 20 });
    await tap(p, 'betting-chat-send', w, 3000);
    log(w, `✓ chat: "${msg}"`);
  } catch (_) { log(w, `✗ chat send failed (non-fatal)`); }
}

async function chatGame(p, w, msg) {
  try {
    await tap(p, 'game-btn-chat', w, 2000);
    await sleep(400);
    const input = p.locator('[data-testid="chat-input"]');
    if (!(await find(input, 2000))) { log(w, '✗ chat panel not open'); return; }
    await input.click({ timeout: 3000 });
    await input.type(msg, { delay: 20 });
    await tap(p, 'chat-send', w, 3000);
    await sleep(300);
    // Close chat
    const close = p.locator('text=/✕/').first();
    if (await find(close, 1000)) await close.click();
    log(w, `✓ chat: "${msg}"`);
  } catch (_) { log(w, `✗ chat send failed (non-fatal)`); }
}

// ─── Last Trick ─────────────────────────────────────────────────────────────

async function viewLastTrick(p, w) {
  if (await tap(p, 'game-btn-last-trick', w, 1500)) {
    await sleep(1500);
    // Use testID if available, otherwise fall back to text with force click
    const closeBtn = p.locator('[data-testid="last-trick-close"]');
    if (await find(closeBtn, 1500)) {
      await closeBtn.click();
    } else {
      const close = p.locator('text=/Close|Закрыть|Cerrar/i').first();
      if (await find(close, 2000)) await close.click({ force: true });
    }
    log(w, '✓ viewed last trick');
  }
}

// ─── Game Logic ─────────────────────────────────────────────────────────────

async function tryBet(p, w) {
  const btns = p.locator('[data-testid^="bet-btn-"]:not([disabled]):not([aria-disabled="true"])');
  if ((await btns.count()) === 0) return false;
  const b = btns.first();
  const v = ((await b.textContent()) || '?').trim();
  await b.click();
  await sleep(400);
  if (!(await btns.first().isVisible().catch(() => false))) {
    log(w, `✓ bet=${v}`);
    return true;
  }
  return false;
}

async function tryPlay(p, w) {
  const hand = p.locator('[data-testid="my-hand"]');
  if (!(await hand.isVisible().catch(() => false))) return false;
  const cards = hand.locator('[data-testid^="card-"]');
  const n = await cards.count();
  if (n === 0) return false;

  for (let i = 0; i < n; i++) {
    const c = cards.nth(i);
    const tid = await c.getAttribute('data-testid').catch(() => null);
    if (!tid) continue;
    try {
      await c.click({ timeout: 1000 });
      await sleep(350);
      const same = hand.locator(`[data-testid="${tid}"]`);
      if (!(await same.isVisible().catch(() => false))) { log(w, `✓ ${tid}`); return true; }
      await same.click({ timeout: 1000 });
      await sleep(400);
      if ((await cards.count()) < n) { log(w, `✓ ${tid}`); return true; }
    } catch (_) { continue; }
  }
  return false;
}

// ─── Game Loop with extras ──────────────────────────────────────────────────

async function gameLoop(p, w, opts = {}) {
  // opts: { chat: [...], viewTricks: bool }
  const chatMsgs = opts.chat || [];
  const viewTricks = opts.viewTricks || false;
  let msgIdx = 0;
  let hands = 0, idle = 0, tricks = 0;

  log(w, 'game loop');

  while (true) {
    await sleep(600);

    // Game over
    if (await p.locator('text=/Game Over|Конец игры|Fin del juego/i').first().isVisible().catch(() => false)) {
      log(w, '🏁 Game Over!');
      break;
    }

    // Continue
    const cont = p.locator('text=/Continue Playing|Продолжить|Continuar/i').first();
    if (await cont.isVisible().catch(() => false)) {
      await cont.click();
      hands++;
      idle = 0;
      tricks = 0;
      log(w, `✓ Continue (hand ${hands})`);
      if (MAX_HANDS > 0 && hands >= MAX_HANDS) break;
      continue;
    }

    // Bet
    if (await tryBet(p, w)) {
      idle = 0;
      // Chat during betting
      if (msgIdx < chatMsgs.length && chatMsgs[msgIdx].phase === 'bet') {
        await sleep(300);
        await chatBetting(p, w, chatMsgs[msgIdx].text);
        msgIdx++;
      }
      continue;
    }

    // Play card
    if (await tryPlay(p, w)) {
      idle = 0;
      tricks++;
      // View last trick occasionally
      if (viewTricks && tricks > 1 && tricks % 3 === 0) {
        await sleep(500);
        await viewLastTrick(p, w);
      }
      // Chat during play
      if (msgIdx < chatMsgs.length && chatMsgs[msgIdx].phase === 'play') {
        await sleep(300);
        await chatGame(p, w, chatMsgs[msgIdx].text);
        msgIdx++;
      }
      continue;
    }

    idle++;
    if (idle % 20 === 0) {
      log(w, `⌛ idle ${idle}s`);
      // Diagnostic: dump visible text near turn indicator
      try {
        const turnText = await p.locator('[data-testid="turn-indicator"], [data-testid="waiting-text"]').first().textContent().catch(() => '');
        const handVisible = await p.locator('[data-testid="my-hand"]').isVisible().catch(() => false);
        const cardCount = handVisible ? await p.locator('[data-testid="my-hand"] [data-testid^="card-"]').count().catch(() => 0) : 0;
        const phase = await p.locator('text=/Place Your Bets|Сделайте ставки|Hagan sus apuestas/i').first().isVisible().catch(() => false) ? 'betting' : 'playing';
        log(w, `  📋 phase=${phase} cards=${cardCount} turn="${turnText}"`);
      } catch (_) {}
    }

    // Sync button: if stuck for ~30s during gameplay, tap the sync button to resync
    if (idle === 50 || idle === 80) {
      log(w, '🔄 sync (stuck)');
      const synced = await tap(p, 'game-btn-sync', w, 1000) || await tap(p, 'betting-btn-sync', w, 1000);
      if (synced) await sleep(2000);
    }

    if (idle >= 120) { log(w, '⚠ timeout'); break; }
  }
}

// ─── Window positioning ─────────────────────────────────────────────────────

async function pos(p, x, y, w, h) {
  try {
    const s = await p.context().newCDPSession(p);
    const { windowId } = await s.send('Browser.getWindowForTarget');
    await s.send('Browser.setWindowBounds', { windowId, bounds: { left: x, top: y, width: w, height: h } });
  } catch (_) {}
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const ts = Date.now();
  step('Nägels Online — 4-Player Full Feature Demo');
  console.log(`  URL: ${BASE}  slowMo: ${SLOW_MO}ms`);
  console.log(`  Alice 🦈 EN dark  |  Bob 🐺 RU  |  Carol 🦊 ES  |  Dave 🐻 light\n`);

  const browser = await chromium.launch({
    channel: 'chrome', headless: false, slowMo: SLOW_MO, devtools: DEVTOOLS,
    args: ['--disable-features=TranslateUI', '--disable-infobars'],
  });

  const ctxs = await Promise.all([
    browser.newContext({ ...IPHONE, viewport: VP }),
    browser.newContext({ ...IPHONE, viewport: VP }),
    browser.newContext({ ...IPHONE, viewport: VP }),
    browser.newContext({ ...IPHONE, viewport: VP }),
  ]);
  const [ap, bp, cp, dp] = await Promise.all(ctxs.map(c => c.newPage()));

  // 2×2 grid
  const W = VP.width + 16, H = VP.height + 88;
  await Promise.all([
    pos(ap, 0,   0,   W, H),
    pos(bp, W+4, 0,   W, H),
    pos(cp, 0,   H+4, W, H),
    pos(dp, W+4, H+4, W, H),
  ]);

  try {
    // ── Load all ─────────────────────────────────────────────────
    step('Step 1: Load apps');
    await Promise.all([loadApp(ap,'Alice'), loadApp(bp,'Bob'), loadApp(cp,'Carol'), loadApp(dp,'Dave')]);

    // ── Register Alice & Bob ─────────────────────────────────────
    step('Step 2: Alice & Bob register');
    await Promise.all([
      register(ap, 'Alice', 'Alice', `alice-${ts}@test.nigels.online`, 'test123456'),
      register(bp, 'Bob',   'Bob',   `bob-${ts}@test.nigels.online`,   'test123456'),
    ]);

    // ── Carol & Dave as guests ───────────────────────────────────
    step('Step 3: Carol & Dave as guests');
    await Promise.all([
      guestLobby(cp, 'Carol', 'Carol'),
      guestLobby(dp, 'Dave',  'Dave'),
    ]);

    // ── Profile & Settings ───────────────────────────────────────
    step('Step 4: Customize profiles & settings');

    // Alice: Settings → dark theme, avatar 🦈
    if (await goSettings(ap, 'Alice')) {
      await setTheme(ap, 'Alice', 'dark');
      await setAvatar(ap, 'Alice', '🦈');
      await backFromSettings(ap, 'Alice');
    }

    // Bob: Settings → Russian, avatar 🐺
    if (await goSettings(bp, 'Bob')) {
      await setLang(bp, 'Bob', 'ru');
      await setAvatar(bp, 'Bob', '🐺');
      await backFromSettings(bp, 'Bob');
    }

    // Carol: Settings → Spanish, avatar 🦊
    if (await goSettings(cp, 'Carol')) {
      await setLang(cp, 'Carol', 'es');
      await setAvatar(cp, 'Carol', '🦊');
      await backFromSettings(cp, 'Carol');
    }

    // Dave: Settings → light theme, avatar 🐻
    if (await goSettings(dp, 'Dave')) {
      await setTheme(dp, 'Dave', 'light');
      await setAvatar(dp, 'Dave', '🐻');
      await backFromSettings(dp, 'Dave');
    }

    // ── Create & join room ───────────────────────────────────────
    // Dave (guest) creates — registered users can't create with unconfirmed email
    step('Step 5: Dave creates room');
    const code = await createRoom(dp, 'Dave');

    step('Step 6: Others join');
    // Sequential joins so each player appears one by one
    await joinRoom(ap, 'Alice', code);
    await joinRoom(bp, 'Bob', code);
    await joinRoom(cp, 'Carol', code);

    // ── Ready & start ────────────────────────────────────────────
    step('Step 7: Ready & start');
    await sleep(1500);
    await Promise.all([
      tap(ap, 'btn-ready', 'Alice'),
      tap(bp, 'btn-ready', 'Bob'),
      tap(cp, 'btn-ready', 'Carol'),
    ]);
    await sleep(2500);
    await tap(dp, 'btn-start-game', 'Dave');

    // ── Play ─────────────────────────────────────────────────────
    step('Step 8: Playing!');
    await sleep(3000);

    await Promise.all([
      gameLoop(ap, 'Alice', {
        chat: [
          { phase: 'bet', text: 'Good luck everyone!' },
          { phase: 'play', text: 'Nice trick!' },
          { phase: 'play', text: 'GG' },
        ],
      }),
      gameLoop(bp, 'Bob', {
        chat: [
          { phase: 'bet', text: 'Удачи!' },
          { phase: 'play', text: 'Ого, красиво' },
        ],
      }),
      gameLoop(cp, 'Carol', {
        chat: [
          { phase: 'bet', text: '¡Buena suerte!' },
        ],
      }),
      gameLoop(dp, 'Dave', {
        viewTricks: true,
      }),
    ]);

    step('✅ Done! Closing in 10s…');
    await sleep(10000);

  } catch (err) {
    step(`❌ ${err.message}`);
    console.log('  Browser open. Ctrl+C to exit.\n');
    await sleep(120000);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
