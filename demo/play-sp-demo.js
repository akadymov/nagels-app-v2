/**
 * Nägels Online — Single-player (vs bots) demo / smoke test.
 *
 * One Chromium window. Skips to lobby, picks player count + difficulty,
 * starts the quick-match flow, plays the entire game with the bots
 * doing their own bets/cards. Holds the WinnerFanfareModal at the end
 * for ~25 s before closing.
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

      // Winner fanfare — payoff shot, hold and exit
      if (await exists(p, 'winner-fanfare-continue', 500)) {
        log('🏁 Winner fanfare — holding 25s');
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

      // Auto-bet for me: I always pick the smallest allowed bet so the
      // game progresses without the user having to chime in. Bots
      // handle the other seats themselves.
      // Look for any visible "betting-bet-N" chip; the Lobby exposes
      // bet chips as elements with class containing "bet"; use a plain
      // text-based locator.
      const myTurnBadge = p.locator('text=/Place your bid|Сделай ставку|Hagan sus apuestas/i').first();
      if (await myTurnBadge.isVisible({ timeout: 200 }).catch(() => false)) {
        // Find first enabled bet chip — they're rendered as Pressables
        // with text like "0", "1", ... For robustness, try testIDs that
        // look like numbers, otherwise click the smallest visible bid.
        const tried = await p.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('div[role="button"], button')).filter((b) => {
            const txt = (b.textContent || '').trim();
            return /^\d+$/.test(txt) && parseInt(txt, 10) <= 9;
          });
          for (const b of buttons) {
            const rect = b.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              const ev = (type) => b.dispatchEvent(new MouseEvent(type, {
                bubbles: true, cancelable: true, view: window,
                clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2,
                button: 0,
              }));
              ev('mousedown'); ev('mouseup'); ev('click');
              return (b.textContent || '').trim();
            }
          }
          return null;
        });
        if (tried) { log(`✓ auto-bet ${tried}`); idle = 0; continue; }
      }

      // Auto-play my card during playing: pick the first my-hand card.
      // The hand is rendered with testID `card-{suit}-{rank}` (matches
      // the multiplayer demo's locator).
      const myCards = p.locator('[data-testid^="card-"]');
      if (await myCards.first().isVisible({ timeout: 200 }).catch(() => false)) {
        const cnt = await myCards.count();
        // Try each card until one gets accepted (greys out / disappears).
        let played = false;
        for (let i = 0; i < cnt && i < 12; i++) {
          const c = myCards.nth(i);
          const tid = await c.getAttribute('data-testid').catch(() => '');
          try {
            await c.click({ timeout: 800 });
            await c.click({ timeout: 800 }).catch(() => {});
            await sleep(300);
            // Confirm by observing that this exact testID has gone or
            // current_seat advanced. We just trust the click and let
            // the next tick verify by counting the hand.
            log(`✓ play ${tid}`);
            played = true;
            break;
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
