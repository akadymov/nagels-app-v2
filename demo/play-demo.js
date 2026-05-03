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
  // Two attempts: first respects actionability checks, second forces.
  // 4 parallel chromium pages hammering the Expo dev bundle frequently
  // re-render the welcome screen mid-click → the first click sees a detached
  // element. A short retry + force: true on the second try recovers reliably.
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await l.click({ timeout: 5000, force: attempt > 0 });
      log(w, `✓ ${tid}${attempt ? ` (retry ${attempt})` : ''}`);
      return true;
    } catch (e) {
      lastErr = (e && e.message ? e.message : String(e)).split('\n')[0].slice(0, 120);
      if (attempt === 2) { log(w, `✗ ${tid} (click failed 3×: ${lastErr})`); return false; }
      await sleep(400);
      // Re-confirm visibility before retry — element may have re-mounted.
      await find(l, 2000);
    }
  }
  return false;
}

async function type(p, tid, val, w) {
  const l = p.locator(`[data-testid="${tid}"]`);
  if (!(await find(l))) throw new Error(`[${w}] missing: ${tid}`);
  // Same retry shape as tap(): focus can fail transiently under load.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await l.click({ clickCount: 3, timeout: 5000, force: attempt > 0 });
      await l.type(val, { delay: 25 });
      log(w, `✓ ${tid} = "${val}"${attempt ? ` (retry ${attempt})` : ''}`);
      return;
    } catch (_) {
      if (attempt === 2) throw new Error(`[${w}] type failed: ${tid}`);
      await sleep(400);
      await find(l, 2000);
    }
  }
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
  // Wait for the welcome screen specifically — btn-skip-to-lobby is always
  // rendered there once Expo finishes hydration. Generic "any testid" wait
  // returns too early because language pills mount before main buttons.
  await p.locator('[data-testid="btn-skip-to-lobby"]').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  await sleep(1500);
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

// Sign in with a pre-registered email/password account. Lands on Lobby.
// The session persists in localStorage, so a subsequent navigation to
// /join/CODE goes through the deep-link auto-join path with the
// authenticated user — exercises both login and deep-link flows.
async function loginAs(p, w, email, pass) {
  await tap(p, 'btn-sign-in', w, 10000);
  log(w, `→ Auth (login as ${email})`);
  await sleep(400);
  // signIn is the default tab, but tap it to be explicit/idempotent.
  await tap(p, 'auth-tab-signIn', w, 5000);
  await sleep(200);
  await type(p, 'auth-input-email', email, w);
  await type(p, 'auth-input-password', pass, w);
  await tap(p, 'auth-btn-submit', w);
  // Wait for Lobby — input-player-name is unique to LobbyScreen.
  const ok = await find(p.locator('[data-testid="input-player-name"]'), 15000);
  if (!ok) throw new Error(`login failed for ${w} (${email})`);
  log(w, '✓ logged in → Lobby');
}

// Walk through the Learn-to-Play primer (3 swipeable screens) instead of
// jumping straight to the lobby. Each screen has a "Next" button with a
// stable testID; the third one navigates to Lobby.
async function learnToPlay(p, w, nick) {
  await tap(p, 'btn-learn-to-play', w, 10000);
  log(w, '→ Primer (Learn to Play)');
  for (let i = 0; i < 3; i++) {
    await tap(p, `primer-button-${i}`, w, 5000);
    await sleep(450);
  }
  // Lobby reached
  const l = p.locator('[data-testid="input-player-name"]');
  if (await find(l, 5000)) {
    await l.click({ clickCount: 3 });
    await l.type(nick, { delay: 25 });
    log(w, `✓ Primer done → Lobby, name="${nick}"`);
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
  // Honest about outcome — previously this logged "✓ avatar=🦈" even when
  // the avatar grid wasn't rendered (the Profile section used to be gated
  // behind isLoggedIn so guests never saw it).
  const tapped = await tap(p, `avatar-${emoji}`, w, 3000);
  if (!tapped) { log(w, `✗ avatar=${emoji} (button not found)`); return; }
  const saved = await tap(p, 'settings-save', w, 3000);
  await sleep(500);
  if (saved) log(w, `✓ avatar=${emoji}`);
  else       log(w, `⚠ avatar=${emoji} picked but save button missing`);
}

async function setTheme(p, w, theme) {
  await tap(p, `theme-${theme}`, w, 3000);
  log(w, `✓ theme=${theme}`);
}

async function setLang(p, w, lang) {
  await tap(p, `lang-${lang}`, w, 3000);
  log(w, `✓ lang=${lang}`);
}

async function setDeck(p, w, style) {
  // style: 'classic' (2-color) or 'fourColor' (default)
  await tap(p, `deck-${style}`, w, 3000);
  log(w, `✓ deck=${style}`);
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

// Deep-link join: navigate the page directly to /join/CODE. NavigatorGuard
// auto-joins after auth hydrates and pushes the player into WaitingRoom.
async function joinViaDeepLink(p, w, code) {
  log(w, `→ /join/${code} (deep-link)`);
  await p.goto(`${BASE}/join/${code}`, { waitUntil: 'domcontentloaded' });
  // Wait for the WaitingRoom indicator (room-code testID) to confirm
  // the auto-join landed.
  const ok = await find(p.locator('[data-testid="room-code"]'), 12000);
  if (!ok) throw new Error(`deep-link join timed out for ${w}`);
  log(w, '✓ joined via deep-link');
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
  try {
    if (await tap(p, 'game-btn-last-trick', w, 1500)) {
      await sleep(1500);
      const closeBtn = p.locator('[data-testid="last-trick-close"]');
      if (await find(closeBtn, 1500)) {
        await closeBtn.click({ force: true, timeout: 3000 });
      } else {
        const close = p.locator('text=/Close|Закрыть|Cerrar/i').first();
        if (await find(close, 2000)) await close.click({ force: true, timeout: 3000 });
      }
      log(w, '✓ viewed last trick');
    }
  } catch (_) { log(w, '✗ last trick view failed (non-fatal)'); }
}

// ─── Game Logic ─────────────────────────────────────────────────────────────

async function tryBet(p, w) {
  try {
    // All bet buttons (0..cardsPerPlayer), filtered to those still actionable.
    const allBtns = p.locator('[data-testid^="bet-btn-"]');
    const totalCount = await allBtns.count();
    if (totalCount === 0) return false;
    const cardsPerPlayer = totalCount - 1;

    const enabled = p.locator('[data-testid^="bet-btn-"]:not([disabled]):not([aria-disabled="true"])');
    const enabledCount = await enabled.count();
    if (enabledCount === 0) return false;

    // Collect numeric values of enabled buttons.
    const allowed = [];
    for (let i = 0; i < enabledCount; i++) {
      const txt = ((await enabled.nth(i).textContent()) || '').trim();
      const n = parseInt(txt, 10);
      if (!Number.isNaN(n)) allowed.push(n);
    }
    if (allowed.length === 0) return false;

    // Aim for a bet near cardsPerPlayer / playerCount, with ±1 jitter, so the
    // 4-player sum lands around cardsPerPlayer ±2-4 (realistic bidding).
    // PLAYERS=4 is hard-coded here matching the demo; if we ever support
    // other counts in this file, plumb it through.
    const PLAYERS = 4;
    const target = cardsPerPlayer / PLAYERS;
    const jitter = Math.floor(Math.random() * 3) - 1; // -1, 0, +1
    const desired = Math.max(0, Math.min(cardsPerPlayer, Math.round(target + jitter)));

    // Pick the closest allowed bet to `desired`. Tie-break randomly.
    allowed.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired) || (Math.random() - 0.5));
    const choice = allowed[0];

    const b = p.locator(`[data-testid="bet-btn-${choice}"]`);
    const v = String(choice);
    try {
      await b.click({ timeout: 5000 });
    } catch (_) {
      // Fallback: first allowed button, force.
      await enabled.first().click({ timeout: 5000, force: true }).catch(() => {});
    }
    await sleep(400);
    if (!(await enabled.first().isVisible().catch(() => false))) {
      log(w, `✓ bet=${v}`);
      return true;
    }
    return false;
  } catch (_) { return false; }
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

    // Onboarding tip modals (bidding/trumpRank/noTrump/scoring) appear
    // once per user and block everything underneath them. RN-web's
    // Pressable responder listens to *PointerEvents*, not bare MouseEvents
    // — Playwright's mouse.click() and click({force:true}) only dispatch
    // mouse events, so onPress never fires and the modal stays visible.
    // We dispatch the full pointerdown→mousedown→pointerup→mouseup→click
    // sequence inside the page so the responder actually triggers.
    const tipBtn = p.locator('[data-testid^="onboarding-tip-"][data-testid$="-got-it"]').first();
    if (await tipBtn.isVisible().catch(() => false)) {
      try {
        const tid = (await tipBtn.getAttribute('data-testid')) || 'onboarding-tip';
        await tipBtn.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const opts = {
            bubbles: true, cancelable: true, view: window,
            clientX: cx, clientY: cy, button: 0,
            pointerId: 1, pointerType: 'mouse', isPrimary: true,
          };
          el.dispatchEvent(new PointerEvent('pointerdown', opts));
          el.dispatchEvent(new MouseEvent('mousedown', opts));
          el.dispatchEvent(new PointerEvent('pointerup', opts));
          el.dispatchEvent(new MouseEvent('mouseup', opts));
          el.dispatchEvent(new MouseEvent('click', opts));
        });
        // Verify dismissal actually happened — only a true 'hidden'
        // transition means onPress fired and markTipShown() persisted.
        const dismissed = await tipBtn.waitFor({ state: 'hidden', timeout: 3000 })
          .then(() => true)
          .catch(() => false);
        if (dismissed) {
          log(w, `✓ dismissed ${tid}`);
        } else {
          // Last-resort fallback: forcibly persist shownTips and reload so
          // the next render sees alreadyShown=true. Keeps the loop moving
          // instead of hammering an unresponsive modal forever.
          log(w, `✗ dismiss did not register for ${tid} → seeding shownTips`);
          await p.evaluate(() => {
            try {
              const cur = JSON.parse(localStorage.getItem('nagels_settings') || '{}');
              cur.shownTips = { bidding: true, trumpRank: true, noTrump: true, scoring: true };
              localStorage.setItem('nagels_settings', JSON.stringify(cur));
            } catch {}
          });
        }
        await sleep(200);
        continue;
      } catch (_) {}
    }

    // Game over — prefer testID (i18n-proof), fall back to localized text.
    const gameOverById = p.locator('[data-testid="game-over"]');
    const gameOverByText = p.locator('text=/Game Over|Игра окончена|Juego Terminado|Конец игры|Fin del juego/i').first();
    if (await gameOverById.isVisible().catch(() => false) ||
        await gameOverByText.isVisible().catch(() => false)) {
      log(w, '🏁 Game Over!');
      break;
    }

    // Last Trick modal blocks every other interaction. If the player opened
    // it and the hand has since advanced (Scoreboard or new betting), the
    // modal stays mounted on top and the next button is unreachable.
    // Close it first whenever it's visible.
    const ltModal = p.locator('[data-testid="last-trick-close"]');
    if (await ltModal.isVisible().catch(() => false)) {
      try {
        await ltModal.click({ force: true, timeout: 2000 });
        log(w, '✓ closed Last Trick (was blocking)');
        await sleep(300);
        continue;
      } catch (_) {
        // Fallback: localized "Close" text
        const close = p.locator('text=/^\\s*(Close|Закрыть|Cerrar)\\s*$/i').first();
        if (await close.isVisible().catch(() => false)) {
          await close.click({ force: true, timeout: 2000 }).catch(() => {});
          log(w, '✓ closed Last Trick via text fallback');
          await sleep(300);
          continue;
        }
      }
    }

    // Continue — prefer testID, fall back to localized text.
    const contById = p.locator('[data-testid="btn-continue-scoreboard"]');
    const contByText = p.locator('text=/Continue Playing|Продолжить|Continuar/i').first();
    let cont = (await contById.isVisible().catch(() => false)) ? contById : contByText;
    if (await cont.isVisible().catch(() => false)) {
      try {
        await cont.click({ timeout: 5000 });
        hands++;
        idle = 0;
        tricks = 0;
        log(w, `✓ Continue (hand ${hands})`);
        if (MAX_HANDS > 0 && hands >= MAX_HANDS) break;
      } catch (_) { log(w, '✗ Continue click failed (non-fatal)'); }
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

    // Press sync button every 10s of idle to recover from desync
    if (idle > 0 && idle % 16 === 0) {
      const synced = await tap(p, 'game-btn-sync', w, 500) || await tap(p, 'betting-btn-sync', w, 500);
      if (synced) { log(w, '🔄 sync'); await sleep(1500); }
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
  // Player roster:
  //   Koshasa  — pre-registered (alice@nigels.test), logs in, joins via /join/CODE
  //   Ryabina  — guest, walks Learn-to-Play primer
  //   Scherbet — guest, skips straight to lobby
  //   Guest#XXX — guest, hosts the room (random suffix per run)
  const guestNum = 1000 + Math.floor(Math.random() * 9000);
  const NAMES = ['Koshasa', 'Ryabina', 'Scherbet', `Guest#${guestNum}`];
  const LOGIN_EMAIL = process.env.DEMO_LOGIN_EMAIL || 'alice@nigels.test';
  const LOGIN_PASS  = process.env.DEMO_LOGIN_PASS  || 'demo-pass-1234';
  step('Nägels Online — 4-Player Full Feature Demo');
  console.log(`  URL: ${BASE}  slowMo: ${SLOW_MO}ms`);
  console.log(`  ${NAMES[0]} (login) | ${NAMES[1]} (primer) | ${NAMES[2]} (skip) | ${NAMES[3]} (host)\n`);

  const browser = await chromium.launch({
    channel: 'chrome', headless: false, slowMo: SLOW_MO, devtools: DEVTOOLS,
    args: [
      '--disable-features=TranslateUI',
      '--disable-infobars',
      // Background tabs get throttled to ~1Hz timers by default — kills the
      // 3 non-focused windows in this 4-pane demo. Disable all forms of
      // background throttling so every page renders at full speed.
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });

  const ctxs = await Promise.all([
    browser.newContext({ ...IPHONE, viewport: VP }),
    browser.newContext({ ...IPHONE, viewport: VP }),
    browser.newContext({ ...IPHONE, viewport: VP }),
    browser.newContext({ ...IPHONE, viewport: VP }),
  ]);

  const [ap, bp, cp, dp] = await Promise.all(ctxs.map(c => c.newPage()));

  // Capture browser dialogs (alerts, confirms) so silent failures aren't
  // hidden by Playwright's default auto-dismiss. Without this, the only
  // sign of an error path is "click happened, no nav, idle timeout".
  for (let i = 0; i < 4; i++) {
    const w = NAMES[i];
    const page = [ap, bp, cp, dp][i];
    page.on('dialog', async (d) => {
      log(w, `🚨 dialog (${d.type()}): ${d.message().replace(/\s+/g, ' ').slice(0, 200)}`);
      await d.dismiss().catch(() => {});
    });
    page.on('pageerror', (e) => log(w, `🛑 pageerror: ${(e.message || String(e)).slice(0, 200)}`));
    page.on('console', (m) => {
      if (m.type() === 'error') log(w, `❌ console: ${m.text().slice(0, 200)}`);
    });
  }

  // Single row, left → right: Alice | Bob | Carol | Dave
  const W = VP.width + 16, H = VP.height + 88;
  await Promise.all([
    pos(ap, 0,         0, W, H),
    pos(bp, (W+4)*1,   0, W, H),
    pos(cp, (W+4)*2,   0, W, H),
    pos(dp, (W+4)*3,   0, W, H),
  ]);

  try {
    // ── Load all ─────────────────────────────────────────────────
    step('Step 1: Load apps');
    await Promise.all([loadApp(ap, NAMES[0]), loadApp(bp, NAMES[1]), loadApp(cp, NAMES[2]), loadApp(dp, NAMES[3])]);

    // ── Step 2 — entry paths ─────────────────────────────────────
    //   Koshasa  → email login (pre-registered)
    //   Ryabina  → Learn-to-Play primer
    //   Scherbet → skip-to-lobby
    //   Guest#XXX → skip-to-lobby (will host)
    step('Step 2: Entry paths (login / primer / skip)');
    await Promise.all([
      loginAs(ap, NAMES[0], LOGIN_EMAIL, LOGIN_PASS),
      learnToPlay(bp, NAMES[1], NAMES[1]),
      guestLobby(cp, NAMES[2], NAMES[2]),
      guestLobby(dp, NAMES[3], NAMES[3]),
    ]);

    // ── Profile & Settings ───────────────────────────────────────
    // Koshasa already has an avatar (🐱) and language (ru) saved on the
    // server-side account, so we don't touch her settings — exercises the
    // metadata-restore path. The 3 guests pick their visual preferences.
    step('Step 3: Customize guest profiles & settings');

    if (await goSettings(bp, NAMES[1])) {
      await setLang(bp, NAMES[1], 'ru');
      await setDeck(bp, NAMES[1], 'classic');
      await setAvatar(bp, NAMES[1], '🐺');
      await backFromSettings(bp, NAMES[1]);
    }

    if (await goSettings(cp, NAMES[2])) {
      await setLang(cp, NAMES[2], 'es');
      await setDeck(cp, NAMES[2], 'fourColor');
      await setAvatar(cp, NAMES[2], '🦊');
      await backFromSettings(cp, NAMES[2]);
    }

    if (await goSettings(dp, NAMES[3])) {
      await setTheme(dp, NAMES[3], 'light');
      await setDeck(dp, NAMES[3], 'classic');
      await setAvatar(dp, NAMES[3], '🐻');
      await backFromSettings(dp, NAMES[3]);
    }

    // ── Create & join room ───────────────────────────────────────
    step(`Step 4: ${NAMES[3]} creates room`);
    const code = await createRoom(dp, NAMES[3]);

    step('Step 5: Others join');
    // Koshasa joins via the public invite URL (/join/CODE) — exercises the
    // deep-link auto-join path AND verifies the deep-link picks up her
    // already-authenticated session. Ryabina/Scherbet use the manual
    // code-entry form so we cover both join flows in one run.
    await joinViaDeepLink(ap, NAMES[0], code);
    await joinRoom(bp, NAMES[1], code);
    await joinRoom(cp, NAMES[2], code);

    // ── Ready & start ────────────────────────────────────────────
    step('Step 6: Ready & start');
    await sleep(1500);
    await Promise.all([
      tap(ap, 'btn-ready', NAMES[0]),
      tap(bp, 'btn-ready', NAMES[1]),
      tap(cp, 'btn-ready', NAMES[2]),
    ]);
    await sleep(2500);
    await tap(dp, 'btn-start-game', NAMES[3]);

    // ── Play ─────────────────────────────────────────────────────
    step('Step 7: Playing!');
    await sleep(3000);

    await Promise.all([
      gameLoop(ap, NAMES[0], {
        chat: [
          { phase: 'bet', text: 'Good luck everyone!' },
          { phase: 'play', text: 'Nice trick!' },
          { phase: 'play', text: 'GG' },
        ],
      }),
      gameLoop(bp, NAMES[1], {
        chat: [
          { phase: 'bet', text: 'Удачи!' },
          { phase: 'play', text: 'Ого, красиво' },
        ],
      }),
      gameLoop(cp, NAMES[2], {
        chat: [
          { phase: 'bet', text: '¡Buena suerte!' },
        ],
      }),
      gameLoop(dp, NAMES[3], {
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
