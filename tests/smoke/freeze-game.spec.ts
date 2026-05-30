'use strict';

/**
 * Smoke — Host Freeze / Resume (Task 8 of host-freeze plan).
 *
 * Two registered (non-guest) players reach the betting phase.
 * The host freezes the room, both players see the paused overlay,
 * then the host resumes and the overlay clears.
 *
 * Why registered users: the Freeze button is hidden for rooms that
 * contain anonymous guests (server also rejects with guests_present).
 * The spec reuses the same pre-seeded accounts the other registered-
 * login smoke specs rely on (alice|bob@nigels.test, demo-pass-1234).
 */

import { test, expect } from '@playwright/test';
import { ensureDevServer } from '../fixtures/smoke';
import {
  enterLobbyAsRegisteredUser,
  createRoomAsHost,
  joinRoomByCode,
  markReady,
  startGame,
} from '../fixtures/multiplayer';
import { tap, exists, sleep } from '../fixtures/actions';

const MOBILE_VP = {
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
} as const;

test.beforeAll(async () => {
  await ensureDevServer();
});

test.describe('freeze game', () => {
  test('host freezes -> overlay shown -> host resumes', async ({ browser }) => {
    const ctxA = await browser.newContext({ ...MOBILE_VP });
    const ctxB = await browser.newContext({ ...MOBILE_VP });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    // Accept window.confirm dialogs on the host page so freezeWithConfirm
    // proceeds to pauseGame (headless Playwright auto-dismisses → returns false).
    pageA.on('dialog', (d) => d.accept());

    try {
      // 1) Two registered players log in (alice = host, bob = guest/joiner).
      await enterLobbyAsRegisteredUser(pageA, 'alice@nigels.test', 'host');
      await enterLobbyAsRegisteredUser(pageB, 'bob@nigels.test', 'bob');

      // 2) Host creates a 2-player room; bob joins by code.
      const code = await createRoomAsHost(pageA, 2, 'host');
      await joinRoomByCode(pageB, code, 'bob');

      // Give realtime a moment to propagate both seats to both clients
      // before bob hits Ready (mirrors the 2s guard in the e2e spec).
      await sleep(2_000);

      // 3) Bob marks ready (host has no Ready button in a 2-player room,
      //    the Start button unlocks once all non-host players are ready).
      await markReady(pageB);

      // Give the host's UI a moment to see bob ready before host starts.
      await sleep(1_500);

      // 4) Host starts the game — room.phase transitions to 'playing'.
      await startGame(pageA);

      // 5) Wait for the betting/game UI to mount on both sides.
      //    BettingPhase shows btn-freeze-game once phase === 'playing'
      //    and no guests are present. Poll up to 12s.
      const freezeBtn = pageA.locator('[data-testid="btn-freeze-game"]:visible').first();
      await freezeBtn.waitFor({ state: 'visible', timeout: 12_000 });

      // Wait for at least one heartbeat cycle (10s interval) to ensure
      // last_seen_at is fresh for both players before freezing.
      // Without this, canResume may be false right after the freeze
      // because last_seen_at hasn't been updated since join.
      await sleep(12_000);

      // 6) Host taps the freeze button.
      //    The game table has a full-screen touch-handler div that
      //    intercepts pointer events at the toolbar level; dispatchEvent
      //    on the element itself bypasses the interception (same pattern
      //    as dismissTipIfAny / dismissPwaModalIfAny in actions.ts).
      await freezeBtn.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const opts = {
          bubbles: true, cancelable: true, view: window,
          clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
          button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true,
        };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
      });

      // 7) Both players should see the paused overlay (room.phase = 'paused').
      //    Give the realtime snapshot up to 8s to propagate.
      const overlayA = pageA.locator('[data-testid="paused-overlay"]:visible').first();
      const overlayB = pageB.locator('[data-testid="paused-overlay"]:visible').first();
      await overlayA.waitFor({ state: 'visible', timeout: 8_000 });
      await overlayB.waitFor({ state: 'visible', timeout: 8_000 });

      expect(await exists(pageA, 'paused-overlay')).toBeTruthy();
      expect(await exists(pageB, 'paused-overlay')).toBeTruthy();

      // 8) Both contexts are still active so last_seen_at stays fresh.
      //    Wait for canResume to become true — indicated by btn-resume-game
      //    losing its disabled attribute (aria-disabled disappears in RN-web
      //    Pressable when disabled=false).
      const resumeBtn = pageA.locator('[data-testid="btn-resume-game"]').first();
      await resumeBtn.waitFor({ state: 'visible', timeout: 15_000 });
      // Poll until not disabled — canResume = missingNames.length === 0.
      await pageA.waitForFunction(
        () => {
          const btn = document.querySelector('[data-testid="btn-resume-game"]');
          if (!btn) return false;
          // RN-web Pressable sets aria-disabled="true" when disabled prop is true.
          return btn.getAttribute('aria-disabled') !== 'true';
        },
        undefined,
        { timeout: 35_000 },
      );

      // 9) Host resumes — btn-resume-game is enabled, overlay is in front.
      //    Use dispatchEvent to bypass any pointer-interception layers
      //    (same pattern as freeze button above and dismissTipIfAny).
      await resumeBtn.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const opts = {
          bubbles: true, cancelable: true, view: window,
          clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
          button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true,
        };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
      });

      // 10) Overlay should clear on both sides as room.phase returns to 'playing'.
      await overlayA.waitFor({ state: 'hidden', timeout: 8_000 });
      await overlayB.waitFor({ state: 'hidden', timeout: 8_000 });

      expect(await exists(pageA, 'paused-overlay')).toBeFalsy();
      expect(await exists(pageB, 'paused-overlay')).toBeFalsy();
    } finally {
      await ctxA.close().catch(() => {});
      await ctxB.close().catch(() => {});
    }
  });
});
