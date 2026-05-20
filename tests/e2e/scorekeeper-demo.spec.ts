'use strict';

/**
 * Scorekeeper demo — focused 2-player e2e for the offline-arbitrator
 * room mode (no cards dealt, players record trick results manually).
 *
 * Demo arc:
 *   1. Both players enter Lobby as guest.
 *   2. Host creates a Scorekeeper room (player-count 2 + mode toggle).
 *   3. Guest joins by code; both Ready, host starts.
 *   4. Hand 1 (10 cards): both bet, both land in TricksRecorder.
 *   5. Both record 0 → mismatch banner visible to everyone.
 *   6. Both correct to 5+5 → hand transitions to scoring.
 *   7. Scoreboard with hand-1 row renders on at least one client.
 *
 * Runs against the isolated :8082 Expo + local Supabase stack
 * (LOCAL_SUPABASE=1) — same env as multiplayer-6p-mixed.
 */

import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  createRoomAsHost,
  joinRoomByCode,
  markReady,
  startGame,
  enterLobbyAsGuest,
  tileContextWindows,
  tryRecordTricks,
} from '../fixtures/multiplayer';
import {
  exists, sleep, tryBet, tap, dismissTipIfAny,
} from '../fixtures/actions';

const MOBILE_VP = {
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 ' +
    'Mobile/15E148 Safari/604.1',
} as const;

const ROSTER = [
  { label: 'HOST', role: 'host' as const },
  { label: 'P1',   role: 'guest' as const },
];

const HOST_IDX = 0;
const PLAYER_COUNT = ROSTER.length;
const FIRST_HAND_CARDS = 10;

// 10-min ceiling — single hand of betting + claim/fix should finish
// in ~3-4 min, leaving slack for stack boot + sync. Way under the
// 60-min budget of the full 6p game.
test.setTimeout(10 * 60 * 1000);

test('scorekeeper 2p — bet, mismatch, fix, scoring', async ({
  browser,
}: {
  browser: Browser;
}) => {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  try {
    for (const slot of ROSTER) {
      const ctx = await browser.newContext({ ...MOBILE_VP });
      contexts.push(ctx);
      const page = await ctx.newPage();
      pages.push(page);
      page.on('dialog', async (d) => {
        // eslint-disable-next-line no-console
        console.log(
          `[sk:${slot.label}] 🚨 dialog (${d.type()}): ${d
            .message()
            .replace(/\s+/g, ' ')
            .slice(0, 200)}`,
        );
        await d.dismiss().catch(() => {});
      });
      page.on('pageerror', (e) => {
        // eslint-disable-next-line no-console
        console.log(`[sk:${slot.label}] 🛑 pageerror: ${e.message.slice(0, 200)}`);
      });
    }
    await tileContextWindows(pages);

    // 1. Both players reach Lobby. Mark every OnboardingTip as already
    //    shown before the first render so 'bidding'/'trumpRank'/'noTrump'/
    //    'scoring' modals never overlay the betting + recorder UI.
    //    enterLobbyAsGuest issues page.goto BEFORE the seed could run,
    //    so we hook addInitScript instead — it runs on every navigation.
    for (const page of pages) {
      await page.addInitScript(() => {
        try {
          const raw = localStorage.getItem('nagels_settings');
          const parsed = raw ? JSON.parse(raw) : {};
          parsed.shownTips = {
            bidding: true, trumpRank: true, noTrump: true, scoring: true,
          };
          localStorage.setItem('nagels_settings', JSON.stringify(parsed));
        } catch {
          /* localStorage unavailable — dismissTipIfAny falls back at runtime */
        }
      });
    }
    await Promise.all(
      pages.map((p, i) =>
        new Promise<void>((resolve) =>
          setTimeout(() => enterLobbyAsGuest(p).then(resolve), i * 400),
        ),
      ),
    );

    // 2. Host creates a Scorekeeper room.
    const code = await createRoomAsHost(pages[HOST_IDX], PLAYER_COUNT, 'HOST', {
      mode: 'scorekeeper',
    });
    // eslint-disable-next-line no-console
    console.log(`[sk] scorekeeper room code: ${code}`);

    // 3. Guest joins.
    await joinRoomByCode(pages[1], code, 'P1');
    await pages[0].waitForTimeout(1_500);

    // 4. Guest Ready, host Start.
    await markReady(pages[1]);
    await pages[HOST_IDX].waitForTimeout(1_500);
    await startGame(pages[HOST_IDX]);
    await pages[0].waitForTimeout(2_500);

    // 5. Hand 1 — both bet. tryBet is generic and works in scorekeeper
    //    (the betting UI is the same; place_bet_action server-side
    //    routes the last bet into tricks_recording when room.mode is
    //    scorekeeper). One short loop per player covers the bet turn.
    //    With 2 players the order is enforced by the server, so we
    //    poll both pages until both bets are placed.
    //
    //    OnboardingTip modals (bidding/trumpRank/noTrump/scoring) overlay
    //    the betting + recorder UI on first encounter — dismissTipIfAny
    //    runs every tick so the bet/record clicks land on a clean surface.
    const deadline = Date.now() + 3 * 60 * 1000;
    const placed = [false, false];
    while ((!placed[0] || !placed[1]) && Date.now() < deadline) {
      await sleep(800);
      for (let i = 0; i < 2; i += 1) {
        await dismissTipIfAny(pages[i]);
      }
      for (let i = 0; i < 2; i += 1) {
        if (placed[i]) continue;
        const result = await tryBet(pages[i], PLAYER_COUNT);
        if (result !== false) {
          placed[i] = true;
          // eslint-disable-next-line no-console
          console.log(`[sk:${ROSTER[i].label}] ✓ bet placed: ${result}`);
        }
      }
    }
    expect(placed[0] && placed[1], 'both bets must land in time').toBe(true);

    // Tips can pop again between betting and recorder mount (e.g. the
    // 'noTrump' tip fires when the player first sees a no-trump hand,
    // and 'scoring' triggers on the first scoreboard view later on).
    for (let i = 0; i < 2; i += 1) {
      for (let k = 0; k < 6; k += 1) {
        if (await dismissTipIfAny(pages[i])) continue;
        await sleep(250);
      }
    }

    // 6. TricksRecorder visible on both clients after the last bet.
    for (let i = 0; i < 2; i += 1) {
      await expect(
        pages[i].locator('[data-testid="tricks-recorder"]').first(),
        `[sk:${ROSTER[i].label}] recorder should mount after betting`,
      ).toBeVisible({ timeout: 15_000 });
    }

    // 7. Both submit 0 first — sum=0 ≠ 10 → mismatch banner.
    //    Dismiss any lingering tip BEFORE the recorder taps land.
    for (let i = 0; i < 2; i += 1) await dismissTipIfAny(pages[i]);
    await tryRecordTricks(pages[0], 0, 'HOST');
    await tryRecordTricks(pages[1], 0, 'P1');
    await pages[0].waitForTimeout(1_500);

    // Banner shows on both clients once the server has seen both claims.
    for (let i = 0; i < 2; i += 1) {
      await expect(
        pages[i].locator('[data-testid="tricks-recorder-mismatch"]').first(),
        `[sk:${ROSTER[i].label}] mismatch banner expected`,
      ).toBeVisible({ timeout: 10_000 });
    }
    // eslint-disable-next-line no-console
    console.log('[sk] ✓ mismatch banner observed on both clients');

    // 8. Fix: both adjust to 5 → sum=10 → scoring.
    for (let i = 0; i < 2; i += 1) await dismissTipIfAny(pages[i]);
    await tryRecordTricks(pages[0], 5, 'HOST');
    await tryRecordTricks(pages[1], 5, 'P1');

    // 9. Scoring screen — btn-continue-scoreboard is the canonical
    //    "hand closed" signal that all multiplayer specs use. The
    //    'scoring' OnboardingTip fires on the first scoreboard view —
    //    dismiss it inside the poll so it doesn't hide the Continue
    //    button from the visibility probe.
    for (let i = 0; i < 2; i += 1) {
      await expect.poll(
        async () => {
          await dismissTipIfAny(pages[i]);
          return exists(pages[i], 'btn-continue-scoreboard', 1_000);
        },
        {
          timeout: 30_000,
          message: `[sk:${ROSTER[i].label}] expected scoreboard after fixing mismatch`,
        },
      ).toBe(true);
    }
    // eslint-disable-next-line no-console
    console.log('[sk] 🏁 hand 1 closed cleanly — scorekeeper flow verified');

    // Bonus: continue to hand 2 from the host side just to prove
    // continueHand still works in scorekeeper mode (no dealt_cards
    // INSERT). We don't need to play out hand 2 — assert that hand 2
    // mounts on EITHER client. starting_seat rotates each hand, so
    // bet-btn-* renders only on whoever the active bidder is; check
    // both pages and accept the first hit.
    await tap(pages[HOST_IDX], 'btn-continue-scoreboard', 5_000);
    await expect.poll(
      async () => {
        for (let i = 0; i < pages.length; i += 1) {
          await dismissTipIfAny(pages[i]);
          // Active bidder sees bet-btn-*; passive players just see the
          // betting backdrop. Either signal proves the hand mounted.
          const hasBet = await pages[i]
            .locator('[data-testid^="bet-btn-"]')
            .first()
            .isVisible({ timeout: 200 })
            .catch(() => false);
          if (hasBet) return true;
          if (await exists(pages[i], 'tricks-recorder', 200)) return true;
        }
        // Scoreboard gone on host = hand has moved past 'scoring' phase.
        return !(await exists(pages[HOST_IDX], 'btn-continue-scoreboard', 200));
      },
      { timeout: 20_000, message: 'hand 2 should mount after continue' },
    ).toBe(true);
    // eslint-disable-next-line no-console
    console.log('[sk] ✓ hand 2 dealt — continueHand handles scorekeeper mode');
  } finally {
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  }
});
