'use strict';

/**
 * Phase 6 addendum — Multiplayer DEMO spec.
 *
 * Feature-touching showcase, NOT a regression test. Six players
 * with fixed configurations exercise as many MVP surfaces as
 * possible in one run. Result of a run = video.webm per context +
 * console summary. No hard expects on the showcased features.
 *
 * Roster (immutable; see
 * docs/superpowers/specs/2026-05-17-testing-phase-6-multiplayer-demo-design.md):
 *
 *   P1 alice  EN light 4-col registered mobile  → HOST (creates room)
 *   P2 bob    RU dark  4-col registered mobile  → join by code
 *   P3 guest  ES light 2-col guest      mobile  → join by deep-link
 *   P4 dave   EN dark  4-col registered mobile  → join by code
 *   P5 eve    RU light 4-col registered desktop → join by code
 *   P6 guest  ES dark  2-col guest      desktop → join by deep-link
 *
 * Excluded from test:all (registry enabled:false). Run with:
 *   npm run demo:full:local:headed   (canonical, watchable)
 *   npm run demo:full:local          (headless, faster)
 */

import {
  test,
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
} from '../fixtures/multiplayer';
import {
  loginAsRegistered,
  applyGuestSettings,
  changeNicknameInLobby,
  joinViaDeepLink,
  runDemoGameLoop,
  type DemoLoopResult,
} from '../fixtures/multiplayer-demo';

const PASS = process.env.DEMO_LOGIN_PASS ?? 'demo-pass-1234';

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

const DESKTOP_VP = {
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  isMobile: false,
  hasTouch: false,
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
} as const;

interface RegisteredAuth {
  type: 'registered';
  email: string;
  password: string;
}
interface GuestAuth {
  type: 'guest';
  nickname: string;
  prefs: {
    lang: 'en' | 'ru' | 'es';
    theme: 'light' | 'dark' | 'system';
    deck: 'twoColor' | 'fourColor';
  };
}

type RosterEntry =
  | {
      label: string;
      vp: typeof MOBILE_VP | typeof DESKTOP_VP;
      role: 'host' | 'player';
      auth: RegisteredAuth;
      joinPath: 'host' | 'code';
    }
  | {
      label: string;
      vp: typeof MOBILE_VP | typeof DESKTOP_VP;
      role: 'host' | 'player';
      auth: GuestAuth;
      joinPath: 'code' | 'deepLink';
    };

const ROSTER: RosterEntry[] = [
  {
    label: 'P1',
    vp: MOBILE_VP,
    role: 'host',
    auth: { type: 'registered', email: 'alice@nigels.test', password: PASS },
    joinPath: 'host',
  },
  {
    label: 'P2',
    vp: MOBILE_VP,
    role: 'player',
    auth: { type: 'registered', email: 'bob@nigels.test', password: PASS },
    joinPath: 'code',
  },
  {
    label: 'P3',
    vp: MOBILE_VP,
    role: 'player',
    auth: {
      type: 'guest',
      nickname: 'Carol',
      prefs: { lang: 'es', theme: 'light', deck: 'twoColor' },
    },
    joinPath: 'deepLink',
  },
  {
    label: 'P4',
    vp: MOBILE_VP,
    role: 'player',
    auth: { type: 'registered', email: 'dave@nigels.test', password: PASS },
    joinPath: 'code',
  },
  {
    label: 'P5',
    vp: DESKTOP_VP,
    role: 'player',
    auth: { type: 'registered', email: 'eve@nigels.test', password: PASS },
    joinPath: 'code',
  },
  {
    label: 'P6',
    vp: DESKTOP_VP,
    role: 'player',
    auth: {
      type: 'guest',
      nickname: 'Frank',
      prefs: { lang: 'es', theme: 'dark', deck: 'twoColor' },
    },
    joinPath: 'deepLink',
  },
];

const CHAT_PER_LANG: Record<'en' | 'ru' | 'es', string[]> = {
  en: ['gl!', 'nice', 'gg', 'oh!', 'wow', '👏'],
  ru: ['удачи!', 'красиво', 'gg', 'ого!', 'ничего себе', '👍'],
  es: ['¡suerte!', 'bonito', 'gg', 'oh!', 'increíble', '👏'],
};

function langOf(entry: RosterEntry): 'en' | 'ru' | 'es' {
  if (entry.auth.type === 'guest') return entry.auth.prefs.lang;
  // Registered users have seeded metadata — the lang is implicit
  // in the email. Mirror the seed:
  //   alice/dave → en, bob/eve → ru
  const e = entry.auth.email;
  if (e.startsWith('bob') || e.startsWith('eve')) return 'ru';
  return 'en';
}

// 2-hour ceiling — full 20 hands × 6 players × per-hand actions
// realistically wants ~60-90 min on this laptop.
test.setTimeout(2 * 60 * 60 * 1000);

test('6p multiplayer demo — feature-touching showcase', async ({
  browser,
}: {
  browser: Browser;
}) => {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  try {
    for (const slot of ROSTER) {
      const ctx = await browser.newContext({ ...slot.vp });
      contexts.push(ctx);
      const page = await ctx.newPage();
      pages.push(page);
      page.on('dialog', async (d) => {
        // eslint-disable-next-line no-console
        console.log(
          `[demo:${slot.label}] 🚨 dialog (${d.type()}): ${d
            .message()
            .replace(/\s+/g, ' ')
            .slice(0, 200)}`,
        );
        await d.dismiss().catch(() => {});
      });
      page.on('pageerror', (e) => {
        // eslint-disable-next-line no-console
        console.log(`[demo:${slot.label}] 🛑 pageerror: ${e.message.slice(0, 200)}`);
      });
    }

    // Tile the 6 windows: mobile row on the left, desktop cascade
    // on the right. No-op for headless runs.
    await tileContextWindows(pages);

    // ── Step 1: entry paths in parallel ────────────────────────
    await Promise.all(
      ROSTER.map(async (slot, i) => {
        const page = pages[i];
        if (slot.auth.type === 'registered') {
          await loginAsRegistered(
            page,
            slot.auth.email,
            slot.auth.password,
            slot.label,
          );
        } else {
          await enterLobbyAsGuest(page);
          await applyGuestSettings(page, slot.auth.prefs, slot.label);
          await changeNicknameInLobby(page, slot.auth.nickname, slot.label);
        }
      }),
    );

    // ── Step 2: host creates the room ──────────────────────────
    const hostIdx = ROSTER.findIndex((s) => s.role === 'host');
    const code = await createRoomAsHost(
      pages[hostIdx],
      ROSTER.length,
      ROSTER[hostIdx].label,
    );
    // eslint-disable-next-line no-console
    console.log(`[demo] room code: ${code}`);

    // ── Step 3: serial joins by joinPath ───────────────────────
    // Sequential because the edge function's seat-allocation
    // doesn't tolerate concurrent anonymous joins (see Phase 6
    // baseline: commit 9e6bc61).
    for (let i = 0; i < ROSTER.length; i += 1) {
      if (i === hostIdx) continue;
      const slot = ROSTER[i];
      if (slot.joinPath === 'deepLink') {
        await joinViaDeepLink(pages[i], code, slot.label);
      } else {
        await joinRoomByCode(pages[i], code, slot.label);
      }
    }

    await pages[0].waitForTimeout(2_000);

    // ── Step 4: everyone non-host marks ready, host starts ─────
    for (let i = 0; i < ROSTER.length; i += 1) {
      if (i === hostIdx) continue;
      try {
        await markReady(pages[i]);
      } catch (e: unknown) {
        // eslint-disable-next-line no-console
        console.log(
          `[demo:${ROSTER[i].label}] ⚠ ready failed: ${(e as Error).message.slice(0, 80)}`,
        );
      }
    }
    await pages[hostIdx].waitForTimeout(2_000);
    await startGame(pages[hostIdx]);
    await pages[0].waitForTimeout(4_000);

    // ── Step 5: parallel demo game loops ───────────────────────
    const results = await Promise.all(
      ROSTER.map((slot, i) => {
        const lang = langOf(slot);
        const isDesktop = slot.vp === DESKTOP_VP;
        return runDemoGameLoop(pages[i], {
          label: slot.label,
          isDesktop,
          chatMessages: CHAT_PER_LANG[lang],
        });
      }),
    );

    // ── Step 6: print summary ──────────────────────────────────
    // eslint-disable-next-line no-console
    console.log('\n========== demo summary ==========');
    for (let i = 0; i < ROSTER.length; i += 1) {
      const r: DemoLoopResult = results[i];
      const s = ROSTER[i];
      // eslint-disable-next-line no-console
      console.log(
        `  ${s.label.padEnd(3)} ${s.auth.type.padEnd(11)} ` +
          `${(s.vp === DESKTOP_VP ? 'desktop' : 'mobile ').padEnd(8)} ` +
          `outcome=${r.outcome.padEnd(18)} hands=${r.hands} ` +
          `chat=${r.chatSent} lastTrick=${r.lastTricksViewed} ` +
          `scoreboard=${r.scoreboardsOpened}`,
      );
    }
    // eslint-disable-next-line no-console
    console.log('==================================');
  } finally {
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  }
});
