'use strict';

/**
 * Helpers for the feature-showcase demo spec
 * (tests/e2e/multiplayer-demo.spec.ts). Adds on top of
 * multiplayer.ts the auth/Settings/chat/last-trick/scoreboard
 * helpers needed to exercise more surface area than the baseline
 * 6p-mixed e2e.
 *
 * Demo-style: every interaction try/catches. Counters are kept so
 * the final summary tells the human reviewer which features were
 * exercised. No assertions inside these helpers.
 */

import type { Page } from '@playwright/test';
import {
  tap,
  exists,
  sleep,
  dismissTipIfAny,
  dismissPwaModalIfAny,
  tryBet,
  tryPlay,
} from './actions';

// ─── Auth ──────────────────────────────────────────────────────

/**
 * Login flow for a pre-seeded account.
 * Welcome → btn-sign-in → AuthScreen (signIn tab default) →
 *   fill email/password → submit → wait Lobby (input-player-name).
 */
export async function loginAsRegistered(
  page: Page,
  email: string,
  password: string,
  label = 'player',
): Promise<void> {
  await page.goto('/');
  // Pre-seed the save-progress prompt flags (just in case the user
  // somehow appears anonymous mid-flow).
  await page.evaluate(() => {
    try {
      localStorage.setItem('auth_prompt_before_create_dismissed_v1', '1');
      localStorage.setItem('auth_prompt_after_game_dismissed_v1', '1');
    } catch {
      /* ignore */
    }
  });

  // Mobile: Welcome screen → btn-sign-in opens AuthScreen.
  // Desktop: DesktopWelcomeAuth renders AuthScreen directly in the
  // right pane (src/screens/desktop/DesktopWelcomeAuth.tsx) — there
  // is no btn-sign-in to click, the email/password fields are
  // already on screen.
  const vp = page.viewportSize();
  const isDesktop = !!vp && vp.width >= 1024;
  if (!isDesktop) {
    await tap(page, 'btn-sign-in', 20_000);
  } else {
    // Wait for the auth pane to mount before typing.
    await page
      .locator('[data-testid="auth-input-email"]')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 });
  }
  // signIn tab is default but tap explicitly for idempotency.
  await tap(page, 'auth-tab-signIn', 8_000);
  await page.locator('[data-testid="auth-input-email"]').first().fill(email);
  await page
    .locator('[data-testid="auth-input-password"]')
    .first()
    .fill(password);
  await tap(page, 'auth-btn-submit', 8_000);
  // Lobby mounts once auth succeeds. input-player-name is the
  // canonical Lobby marker. On desktop, however, DesktopWelcomeAuth
  // ALSO mounts a LobbyScreen in its right pane the moment auth
  // flips isLoggedIn=true (see src/screens/desktop/DesktopWelcomeAuth.tsx).
  // Navigation then pushes /Lobby, but /Welcome stays in the stack
  // with display:none — so the DOM ends up with TWO input-player-name
  // nodes and `.first()` picks the hidden one. The `:visible` filter
  // pins us to the active route's input on both mobile (single match)
  // and desktop (two matches, want the visible one).
  await page
    .locator('[data-testid="input-player-name"]:visible')
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 });

  // Same PWA-modal poll as enterLobbyAsGuest. The modal pops up
  // ~600ms after the lobby renders and otherwise intercepts the
  // very next click (e.g. player-count-6 from createRoomAsHost).
  for (let i = 0; i < 8; i += 1) {
    if (await dismissPwaModalIfAny(page)) break;
    await sleep(250);
  }

  // eslint-disable-next-line no-console
  console.log(`[demo:${label}] ✓ logged in as ${email}`);
}

// ─── Lobby Settings (for guests) ───────────────────────────────

export interface GuestPrefs {
  lang?: 'en' | 'ru' | 'es';
  theme?: 'light' | 'dark' | 'system';
  deck?: 'twoColor' | 'fourColor';
  avatar?: string;
  nickname?: string;
}

/**
 * Open Settings modal from Lobby, click the pill rows for
 * lang/theme/deck/avatar, close. Each pill click is best-effort —
 * a missing testID just logs a warning.
 */
export async function applyGuestSettings(
  page: Page,
  prefs: GuestPrefs,
  label = 'player',
): Promise<void> {
  // Guests on desktop don't have the gear (DesktopLobbyScreen drops
  // onSettings — see src/screens/desktop/DesktopLobbyScreen.tsx).
  // Settings live in the right pane. Skip the modal flow there.
  const vp = page.viewportSize();
  const isDesktop = !!vp && vp.width >= 1024;

  if (!isDesktop) {
    if (!(await exists(page, 'btn-open-settings', 1_000))) {
      console.log(`[demo:${label}] ⚠ btn-open-settings absent — skipping prefs`);
      return;
    }
    await tap(page, 'btn-open-settings', 5_000);
    await sleep(300);
  }
  // On desktop the SettingsBody is always mounted in the right
  // pane → testIDs (theme-*, lang-*, deck-*) are addressable
  // directly without opening anything.

  if (prefs.theme) {
    await tapBestEffort(page, `theme-${prefs.theme}`, label);
  }
  if (prefs.lang) {
    await tapBestEffort(page, `lang-${prefs.lang}`, label);
  }
  if (prefs.deck) {
    await tapBestEffort(page, `deck-${prefs.deck}`, label);
  }
  if (prefs.avatar) {
    await tapBestEffort(page, `avatar-${prefs.avatar}`, label);
  }

  if (!isDesktop) {
    await tapBestEffort(page, 'settings-modal-close', label);
    await sleep(300);
  }
}

/**
 * Replace the guest nickname (input-player-name in Lobby) with the
 * given string, blur to trigger saveName.
 */
export async function changeNicknameInLobby(
  page: Page,
  nickname: string,
  label = 'player',
): Promise<void> {
  // `:visible` so we always grab the active route's input, not the
  // dormant duplicate that DesktopWelcomeAuth leaves mounted in the
  // /Welcome stack screen after navigation. See loginAsRegistered
  // for the full reasoning.
  const input = page.locator('[data-testid="input-player-name"]:visible').first();
  try {
    await input.waitFor({ state: 'visible', timeout: 5_000 });
    await input.click({ clickCount: 3 });
    await input.type(nickname, { delay: 20 });
    await page.keyboard.press('Tab');
    // eslint-disable-next-line no-console
    console.log(`[demo:${label}] ✓ nickname → ${nickname}`);
  } catch (e: unknown) {
    console.log(
      `[demo:${label}] ⚠ nickname change failed: ${(e as Error).message.slice(0, 100)}`,
    );
  }
}

// ─── Room entry ────────────────────────────────────────────────

/**
 * Deep-link join: navigate directly to /join/CODE. NavigatorGuard
 * auto-joins after auth hydrates and lands the user in WaitingRoom.
 */
export async function joinViaDeepLink(
  page: Page,
  code: string,
  label = 'player',
): Promise<void> {
  await page.goto(`/join/${code}`);
  await page
    .locator('[data-testid="room-code"]')
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 });
  // eslint-disable-next-line no-console
  console.log(`[demo:${label}] ✓ joined via /join/${code}`);
}

// ─── In-game interactions ──────────────────────────────────────

/**
 * Best-effort chat send. Tries betting-chat first; if the betting
 * UI isn't mounted, opens the game chat panel and sends there.
 * Returns true if the message left the input field.
 */
export async function sendChatMessage(
  page: Page,
  text: string,
  label = 'player',
): Promise<boolean> {
  // Betting phase has a permanent chat strip with prefix testIDs.
  if (await exists(page, 'betting-chat-input', 500)) {
    try {
      const input = page.locator('[data-testid="betting-chat-input"]').first();
      await input.click({ timeout: 2_000 });
      await input.type(text, { delay: 15 });
      await tap(page, 'betting-chat-send', 2_000);
      console.log(`[demo:${label}] 💬 betting: "${text}"`);
      return true;
    } catch {
      /* fall through */
    }
  }
  // Game phase: toggle the chat panel open.
  if (await exists(page, 'game-btn-chat', 500)) {
    try {
      await tap(page, 'game-btn-chat', 2_000);
      await sleep(300);
      const input = page.locator('[data-testid="chat-input"]').first();
      await input.click({ timeout: 2_000 });
      await input.type(text, { delay: 15 });
      await tap(page, 'chat-send', 2_000);
      // Close the panel so it doesn't block bet/play later.
      await tapBestEffort(page, 'chat-close', label);
      console.log(`[demo:${label}] 💬 game: "${text}"`);
      return true;
    } catch {
      /* fall through */
    }
  }
  return false;
}

/** Open the last-trick modal then close it. */
export async function viewLastTrick(
  page: Page,
  label = 'player',
): Promise<boolean> {
  if (!(await exists(page, 'game-btn-last-trick', 500))) return false;
  try {
    await tap(page, 'game-btn-last-trick', 2_000);
    await sleep(800);
    await tapBestEffort(page, 'last-trick-close', label);
    console.log(`[demo:${label}] 👁 viewed last trick`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Open the scoreboard modal then close it (mobile flow). On
 * desktop the scoreboard is in the persistent right pane, so this
 * is a no-op there.
 */
export async function openScoreboardMobile(
  page: Page,
  label = 'player',
): Promise<boolean> {
  if (!(await exists(page, 'game-btn-scores', 500))) return false;
  try {
    await tap(page, 'game-btn-scores', 2_000);
    await sleep(800);
    await tapBestEffort(page, 'scoreboard-close-x', label);
    console.log(`[demo:${label}] 📊 viewed scoreboard`);
    return true;
  } catch {
    return false;
  }
}

// ─── Internal helpers ──────────────────────────────────────────

async function tapBestEffort(
  page: Page,
  testId: string,
  label: string,
): Promise<void> {
  try {
    if (!(await exists(page, testId, 500))) return;
    await tap(page, testId, 2_000);
  } catch (e: unknown) {
    console.log(
      `[demo:${label}] ⚠ tap ${testId} failed: ${(e as Error).message.slice(0, 80)}`,
    );
  }
}

// ─── Demo game loop ────────────────────────────────────────────

export interface DemoLoopOptions {
  label?: string;
  isDesktop?: boolean;
  /** Chat messages to cycle through, one per hand. */
  chatMessages?: string[];
  /** Hard wall-clock budget in seconds. Default 90 min. */
  budgetSec?: number;
}

export interface DemoLoopResult {
  outcome: 'game-over' | 'budget-exhausted' | 'idle-timeout';
  hands: number;
  chatSent: number;
  lastTricksViewed: number;
  scoreboardsOpened: number;
}

/**
 * Like multiplayer.ts:runGameLoop but on each Continue boundary,
 * inject the per-hand demo interactions. Mobile players try
 * chat + last-trick + scoreboard; desktop players try chat only
 * (desktop right-pane toggles are not yet wired — TODO Phase 6.2).
 *
 * Every interaction try/catches. Counts go into the return value
 * so the spec's final summary tells the reviewer what was hit.
 */
export async function runDemoGameLoop(
  page: Page,
  opts: DemoLoopOptions = {},
): Promise<DemoLoopResult> {
  const label = opts.label ?? 'player';
  const budgetSec = opts.budgetSec ?? 90 * 60;
  const chatMessages = opts.chatMessages ?? ['gl!', 'nice', 'gg', 'oh!', '👏'];
  const deadline = Date.now() + budgetSec * 1000;

  let hands = 0;
  let chatSent = 0;
  let lastTricksViewed = 0;
  let scoreboardsOpened = 0;
  let idle = 0;
  let lastBetOrPlayHand = -1;
  let didInteractThisHand = false;

  while (Date.now() < deadline) {
    await sleep(800);

    if (await dismissTipIfAny(page)) {
      idle = 0;
      continue;
    }

    if (await exists(page, 'scoreboard-winner-banner', 200)) {
      console.log(`[demo:${label}] 🏁 game over after ${hands} hands`);
      return { outcome: 'game-over', hands, chatSent, lastTricksViewed, scoreboardsOpened };
    }

    if (await exists(page, 'btn-continue-scoreboard', 200)) {
      try {
        await tap(page, 'btn-continue-scoreboard', 5_000);
        hands += 1;
        didInteractThisHand = false;
        idle = 0;
        continue;
      } catch {
        /* retry next tick */
      }
    }

    // Per-hand interactions: run AFTER betting starts (so we know
    // the new hand is rendered) but before any cards are played.
    // Cheap heuristic — if we just placed a bet, the next iteration
    // is a good moment to do the chat/last-trick/scoreboard side-tasks.

    const bet = await tryBet(page, 6);
    if (bet !== false) {
      idle = 0;
      if (lastBetOrPlayHand !== hands) {
        lastBetOrPlayHand = hands;
      }
      if (!didInteractThisHand && chatMessages.length > 0) {
        const msg = chatMessages[hands % chatMessages.length];
        if (await sendChatMessage(page, msg, label)) chatSent += 1;
        if (!opts.isDesktop) {
          if (await viewLastTrick(page, label)) lastTricksViewed += 1;
          if (await openScoreboardMobile(page, label)) scoreboardsOpened += 1;
        }
        didInteractThisHand = true;
      }
      continue;
    }

    const played = await tryPlay(page);
    if (played !== false) {
      idle = 0;
      continue;
    }

    idle += 1;
    if (idle % 20 === 0) {
      console.log(`[demo:${label}] ⌛ idle ${idle}s (hand ${hands})`);
    }
    if (idle >= 120) {
      console.log(`[demo:${label}] ✗ idle timeout`);
      return { outcome: 'idle-timeout', hands, chatSent, lastTricksViewed, scoreboardsOpened };
    }
  }

  console.log(`[demo:${label}] ✗ budget exhausted`);
  return { outcome: 'budget-exhausted', hands, chatSent, lastTricksViewed, scoreboardsOpened };
}
