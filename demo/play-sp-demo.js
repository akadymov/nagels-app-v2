/**
 * Nägels Online — Single-player (vs bots) demo / smoke test.
 *
 * One Chromium window. Skips to lobby, picks player count + difficulty,
 * starts the quick-match flow, plays the entire game with the bots
 * doing their own bets/cards. Holds the scoreboard winner banner at
 * the end for ~25 s before closing.
 *
 * Configurable knobs (all env):
 *   DEMO_URL=https://nigels.online   target host (default localhost:8081)
 *   SP_PLAYERS=4                     total players incl. me (2..6, default 4)
 *   SP_DIFF=medium                   bot difficulty: easy|medium|hard
 *   SP_HEADLESS=0                    1 to run headless
 *   SP_SLOW=80                       slowMo ms (default 80)
 *
 * Useful as a regression check whenever the SP path (gameStore /
 * BettingPhase SP synthesis / bot timers) gets touched.
 */

'use strict';

const { chromium, devices } = require('@playwright/test');

const BASE     = process.env.DEMO_URL  || 'http://localhost:8081';
const PLAYERS  = Math.max(2, Math.min(6, parseInt(process.env.SP_PLAYERS || '4', 10)));
const DIFF     = process.env.SP_DIFF || 'medium';
const HEADLESS = process.env.SP_HEADLESS === '1';
const SLOW_MO  = parseInt(process.env.SP_SLOW || '80', 10);

const IPHONE = devices['iPhone 15 Pro Max'];
const VP     = { width: 430, height: 932 };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const TS = () => new Date().toTimeString().slice(0, 8);
const log = (m) => console.log(`[${TS()}] ${m}`);
const step = (s) => console.log(`\n${'─'.repeat(60)}\n  ${s}\n${'─'.repeat(60)}`);

async function tap(p, testId, timeout = 8000) {
  const el = p.locator(`[data-testid="${testId}"]`).first();
  await el.waitFor({ state: 'visible', timeout });
  await el.click();
}

async function exists(p, testId, timeout = 1000) {
  return p.locator(`[data-testid="${testId}"]`).first().isVisible({ timeout }).catch(() => false);
}

async function main() {
  step(`Nägels SP smoke test — ${PLAYERS} players, difficulty=${DIFF}`);
  console.log(`  URL: ${BASE}  slowMo: ${SLOW_MO}ms  headless: ${HEADLESS}\n`);

  const browser = await chromium.launch({
    channel: 'chrome', headless: HEADLESS, slowMo: SLOW_MO,
    args: [
      '--disable-features=TranslateUI',
      '--disable-infobars',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  });
  const ctx = await browser.newContext({ ...IPHONE, viewport: VP });
  const p = await ctx.newPage();

  p.on('dialog', async (d) => {
    log(`🚨 dialog (${d.type()}): ${d.message().replace(/\s+/g, ' ').slice(0, 200)}`);
    await d.dismiss().catch(() => {});
  });
  p.on('pageerror', (e) => log(`🛑 pageerror: ${(e.message || String(e)).slice(0, 200)}`));
  p.on('console', (m) => {
    if (m.type() === 'error') {
      const txt = m.text();
      if (txt.includes('Download the React DevTools')) return;
      log(`❌ console: ${txt.slice(0, 200)}`);
    }
  });

  try {
    step('Step 1: Load app');
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p.locator('[data-testid="btn-skip-to-lobby"]').waitFor({ state: 'visible', timeout: 30000 });
    log('✓ loaded');

    step('Step 2: Lobby — skip to menu');
    await tap(p, 'btn-skip-to-lobby', 10000);
    await sleep(400);

    step(`Step 3: Quick Match — ${PLAYERS} players, ${DIFF}`);
    await tap(p, `player-count-${PLAYERS}`, 5000);
    await sleep(200);
    await tap(p, `difficulty-${DIFF}`, 5000);
    await sleep(200);
    await tap(p, 'btn-quick-match', 5000);
    log('✓ quick match started');

    step('Step 4: Game loop — let bots drive');
    // Wait for the game table to appear; we infer "playing" by the
    // presence of either a bidding modal or a card hand testID.
    await sleep(2000);

    let lastHand = 0;
    let idle = 0;
    const POLL_MS = 600;
    const STUCK_THRESHOLD = 90; // ticks of no progress = ~54s

    while (true) {
      await sleep(POLL_MS);

      // Onboarding tip — pointer events to dismiss reliably
      const tipBtn = p.locator('[data-testid^="onboarding-tip-"][data-testid$="-got-it"]').first();
      if (await tipBtn.isVisible().catch(() => false)) {
        try {
          await tipBtn.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const opts = { bubbles: true, cancelable: true, view: window,
              clientX: cx, clientY: cy, button: 0,
              pointerId: 1, pointerType: 'mouse', isPrimary: true };
            el.dispatchEvent(new PointerEvent('pointerdown', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new PointerEvent('pointerup', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
          });
          await tipBtn.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
          const tid = await p.locator('[data-testid^="onboarding-tip-"][data-testid$="-got-it"]').first().getAttribute('data-testid').catch(() => null);
          log(`✓ dismissed onboarding tip${tid ? ' ' + tid : ''}`);
        } catch (_) {}
      }

      // Game over — scoreboard renders a winner banner at the top.
      // Hold for 25s so the human watcher reads the celebration, then
      // exit without dismissing.
      if (await exists(p, 'scoreboard-winner-banner', 500)) {
        log('🏁 Game over — holding 25s');
        await sleep(25000);
        break;
      }

      // Mid-game scoreboard — click Continue (host of SP = local player)
      if (await exists(p, 'btn-continue-scoreboard', 500)) {
        await tap(p, 'btn-continue-scoreboard', 3000).catch(() => {});
        log('✓ scoreboard Continue');
        idle = 0;
        await sleep(800);
        continue;
      }

      // Auto-bet: bet chips are rendered with testID `bet-btn-{N}`.
      // Mirror the 4-player demo's tryBet — pick a bet near
      // cardsPerPlayer / PLAYERS with small jitter, fall back to the
      // first enabled chip if the desired one is blocked. Plain
      // Playwright .click() drives the Pressable correctly here (same
      // as the 4p demo); we don't need the manual pointer-event dance.
      {
        const allBtns = p.locator('[data-testid^="bet-btn-"]');
        const totalCount = await allBtns.count().catch(() => 0);
        if (totalCount > 0) {
          const cardsPerPlayer = totalCount - 1;
          const enabled = p.locator('[data-testid^="bet-btn-"]:not([disabled]):not([aria-disabled="true"])');
          const enabledCount = await enabled.count().catch(() => 0);
          if (enabledCount > 0) {
            const allowed = [];
            for (let i = 0; i < enabledCount; i++) {
              const txt = ((await enabled.nth(i).textContent().catch(() => '')) || '').trim();
              const n = parseInt(txt, 10);
              if (!Number.isNaN(n)) allowed.push(n);
            }
            if (allowed.length > 0) {
              const target = cardsPerPlayer / PLAYERS;
              const jitter = Math.floor(Math.random() * 3) - 1;
              const desired = Math.max(0, Math.min(cardsPerPlayer, Math.round(target + jitter)));
              allowed.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired) || (Math.random() - 0.5));
              const choice = allowed[0];
              const chip = p.locator(`[data-testid="bet-btn-${choice}"]`);
              try {
                await chip.click({ timeout: 3000 });
              } catch (_) {
                await enabled.first().click({ timeout: 3000, force: true }).catch(() => {});
              }
              await sleep(400);
              // After a successful placeBet the bet panel hides — chips
              // disappear. If they're still visible we count it as no-op
              // and fall through to the watchdog.
              if (!(await enabled.first().isVisible({ timeout: 200 }).catch(() => false))) {
                log(`✓ auto-bet ${choice}`);
                idle = 0;
                continue;
              }
            }
          }
        }
      }

      // Auto-play my card during playing. Must scope into
      // [data-testid="my-hand"] — the same `card-{suit}-{rank}` testID
      // is also used for cards rendered in the trick area, so a bare
      // `[data-testid^="card-"]` locator can hit a card that isn't in
      // our hand and produce a phantom "play" with no game progress.
      // Verify the card actually leaves the hand before declaring
      // success (see demo/play-demo.js:tryPlay for the same pattern).
      const hand = p.locator('[data-testid="my-hand"]');
      if (await hand.isVisible({ timeout: 200 }).catch(() => false)) {
        const cards = hand.locator('[data-testid^="card-"]');
        const cnt = await cards.count();
        let played = false;
        for (let i = 0; i < cnt && i < 12; i++) {
          const c = cards.nth(i);
          const tid = await c.getAttribute('data-testid').catch(() => null);
          if (!tid) continue;
          try {
            await c.click({ timeout: 800 });
            await sleep(350);
            const same = hand.locator(`[data-testid="${tid}"]`);
            if (!(await same.isVisible().catch(() => false))) {
              log(`✓ play ${tid}`);
              played = true;
              break;
            }
            // Card still in hand → second click is the confirm gesture.
            await same.click({ timeout: 800 }).catch(() => {});
            await sleep(400);
            if ((await cards.count()) < cnt) {
              log(`✓ play ${tid}`);
              played = true;
              break;
            }
          } catch (_) {}
        }
        if (played) { idle = 0; continue; }
      }

      // Progress watchdog — if nothing changed for STUCK_THRESHOLD ticks
      // we declare a freeze and bail.
      const handText = await p.locator('text=/Hand \\d+\\/\\d+/').first().textContent().catch(() => '');
      const m = handText && handText.match(/Hand (\d+)/);
      const handNo = m ? parseInt(m[1], 10) : null;
      if (handNo !== null && handNo !== lastHand) {
        if (lastHand !== 0) log(`▶ Hand ${handNo}`);
        lastHand = handNo;
        idle = 0;
      } else {
        idle++;
      }

      if (idle % 20 === 0 && idle > 0) {
        log(`⌛ idle ${idle * POLL_MS / 1000}s (hand ${lastHand})`);
        if (idle === 20) {
          // Diagnostic snapshot on first idle warning — dump every
          // [data-testid] currently in the DOM with its disabled
          // state and a snippet of text. Helps catch cases where the
          // game phase doesn't match what the demo expects.
          const snap = await p.evaluate(() => {
            const isVis = (el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            };
            const ids = Array.from(document.querySelectorAll('[data-testid]'))
              .filter(isVis)
              .slice(0, 60)
              .map((el) => {
                const tid = el.getAttribute('data-testid');
                const dis = el.getAttribute('aria-disabled') || el.getAttribute('disabled') || '';
                const txt = (el.textContent || '').trim().slice(0, 60);
                return `${tid}${dis ? ` [dis=${dis}]` : ''} ${txt ? `"${txt}"` : ''}`;
              });
            // Visible Text-like elements — useful for catching status
            // text such as "Waiting for X" / "Place your bid".
            const texts = Array.from(document.querySelectorAll('div, span'))
              .filter((el) => el.children.length === 0 && isVis(el))
              .map((el) => (el.textContent || '').trim())
              .filter((t) => t && t.length < 80)
              .slice(0, 40);
            return { ids, texts };
          });
          console.log('  --- testID snapshot (visible only) ---');
          snap.ids.forEach((line) => console.log('  ' + line));
          console.log('  --- visible text leaves ---');
          snap.texts.forEach((line) => console.log('  ' + line));
          console.log('  --- end snapshot ---');
        }
      }
      if (idle >= STUCK_THRESHOLD) {
        log('⚠ STUCK — bailing');
        await sleep(2000);
        break;
      }
    }

    step('✅ Done');

  } catch (err) {
    step(`❌ ${err.message}`);
    console.log('  Browser open. Ctrl+C to exit.\n');
    await sleep(60000);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
