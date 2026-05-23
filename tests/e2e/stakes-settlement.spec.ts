'use strict';

/**
 * Conditional Stakes — e2e settlement flow (Task 22).
 *
 * Three pre-seeded confirmed-email accounts (alice host + bob +
 * dave) enter a 3-player room. The host picks stake=1; alice and
 * bob opt in, dave does NOT. We then drive a real multiplayer game
 * to scoreboard via runGameLoop (same fixture the 6p-mixed spec
 * uses) and assert:
 *
 *   1. alice and bob see the RatingSettlementModal
 *      (`[data-testid="settlement-title"]`); dave does NOT.
 *   2. The `rating_events` journal has exactly 2 fresh `reason=settle`
 *      rows for this room, and their `delta` values sum to 0
 *      (zero-sum invariant from computeSettlement).
 *
 * Wiring:
 *   - Runs in the `e2e` Playwright project (`tests/e2e/`).
 *   - sanity / test:mp:local boot the isolated :8082 Expo + local
 *     Supabase via globalSetup; the spec calls `supabase status -o
 *     json` to fetch the SERVICE_ROLE_KEY (it's not exported into
 *     process.env by global-setup). When running outside
 *     LOCAL_SUPABASE=1 (e.g. against a remote stack) the spec falls
 *     back to SUPABASE_SERVICE_ROLE_KEY from the env, and if neither
 *     is available the journal assertion is skipped with a
 *     `test.info().annotations` note — the UI-only assertions are
 *     the meaningful gate even without service-role access.
 *
 * Trigger this spec via `npm run sanity` (which is
 * test:mp:local:headed) — controller decides when to run.
 *
 * Account note: `carol@nigels.test` is NOT in the seed (see
 * supabase/migrations/20260517204500_seed_demo_accounts.sql). The
 * Task 22 plan suggested falling back to `dave@nigels.test`, which
 * is what we use here.
 */

import { test, expect, type Browser } from '@playwright/test';
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import {
  enterLobbyAsRegisteredUser,
  createRoomAsHost,
  joinRoomByCode,
  markReady,
  startGame,
  runGameLoop,
  tileContextWindows,
} from '../fixtures/multiplayer';

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

interface PlayerSlot {
  label: string;
  email: string;
  optIn: boolean;
}

const ROSTER: readonly PlayerSlot[] = [
  { label: 'alice', email: 'alice@nigels.test', optIn: true  }, // host
  { label: 'bob',   email: 'bob@nigels.test',   optIn: true  },
  { label: 'dave',  email: 'dave@nigels.test',  optIn: false },
] as const;

const HOST_IDX = 0;
const PLAYER_COUNT = ROSTER.length;
const STAKE = 1;

// Mirror multiplayer-6p-mixed.spec.ts budget. 3p games finish ≈ 30%
// faster than 6p (fewer pages waiting on each other) but the
// LOCAL_SUPABASE bundler cold start is a fixed cost. 60 min keeps
// parity with the other multi-context e2e specs.
test.setTimeout(60 * 60 * 1000);

/** Resolve SERVICE_ROLE_KEY from the local Supabase stack (when
 *  LOCAL_SUPABASE=1) or from the test env. Returns null if neither
 *  source is available — caller skips the journal assertion. */
function resolveServiceRoleKey(): { url: string; key: string } | null {
  // Env-var path (remote stack / dev override).
  const envUrl =
    process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const envKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (envUrl && envKey) return { url: envUrl, key: envKey };

  // Local-stack path: ask the supabase CLI. Cheap when the stack is
  // already up (which it is — global-setup booted it).
  if (process.env.LOCAL_SUPABASE === '1') {
    try {
      const raw = execSync('supabase status -o json', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const j = JSON.parse(raw) as Record<string, unknown>;
      const apiUrl = typeof j.API_URL === 'string' ? j.API_URL : '';
      const srv = typeof j.SERVICE_ROLE_KEY === 'string' ? j.SERVICE_ROLE_KEY : '';
      if (apiUrl && srv) return { url: apiUrl, key: srv };
    } catch {
      /* fall through */
    }
  }

  return null;
}

test('stakes settlement — 3 players, 2 opt-in, journal balances + modal visibility', async ({
  browser,
}: {
  browser: Browser;
}) => {
  const contexts = await Promise.all(
    ROSTER.map(() => browser.newContext({ ...MOBILE_VP })),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));

  // Surface dialogs + pageerrors per slot so a failure attributes
  // cleanly to a specific player (same pattern as 6p-mixed).
  pages.forEach((p, i) => {
    const lbl = ROSTER[i].label;
    p.on('dialog', async (d) => {
      // eslint-disable-next-line no-console
      console.log(
        `[stakes:${lbl}] dialog (${d.type()}): ${d
          .message()
          .replace(/\s+/g, ' ')
          .slice(0, 200)}`,
      );
      await d.dismiss().catch(() => {});
    });
    p.on('pageerror', (e) => {
      // eslint-disable-next-line no-console
      console.log(`[stakes:${lbl}] pageerror: ${e.message.slice(0, 200)}`);
    });
  });

  try {
    await tileContextWindows(pages);

    // ── Step 1: login each player ────────────────────────────────
    // Stagger 400ms — same Metro-bundler warmup rationale as 6p-mixed.
    await Promise.all(
      pages.map((p, i) =>
        new Promise<void>((resolve) =>
          setTimeout(
            () =>
              enterLobbyAsRegisteredUser(p, ROSTER[i].email, ROSTER[i].label).then(
                resolve,
              ),
            i * 400,
          ),
        ),
      ),
    );

    // ── Step 2: host creates the room ────────────────────────────
    const code = await createRoomAsHost(
      pages[HOST_IDX],
      PLAYER_COUNT,
      ROSTER[HOST_IDX].label,
    );
    // eslint-disable-next-line no-console
    console.log(`[stakes] room code: ${code}`);

    // ── Step 3: other players join serially ──────────────────────
    for (let i = 0; i < ROSTER.length; i += 1) {
      if (i === HOST_IDX) continue;
      await joinRoomByCode(pages[i], code, ROSTER[i].label);
    }

    // Let realtime propagate the full roster before any stake clicks.
    await pages[HOST_IDX].waitForTimeout(1_500);

    // ── Step 4: host picks stake=1 ───────────────────────────────
    await pages[HOST_IDX]
      .locator(`[data-testid="stake-chip-${STAKE}"]`)
      .first()
      .click({ timeout: 5_000 });

    // ── Step 5: alice + bob opt in, dave does NOT ────────────────
    // The opt-in row only renders once room.stake > 0 has propagated
    // to the guest's snapshot. Wait for the switch to materialize
    // before clicking.
    for (let i = 0; i < ROSTER.length; i += 1) {
      if (!ROSTER[i].optIn) continue;
      const toggle = pages[i]
        .locator('[data-testid="stake-optin-toggle"]')
        .first();
      await toggle.waitFor({ state: 'visible', timeout: 8_000 });
      await toggle.click({ timeout: 5_000 });
    }

    // Give realtime a beat to broadcast the opt-in flags to all
    // peers, including the host's roster view.
    await pages[HOST_IDX].waitForTimeout(1_500);

    // ── Step 6: all non-host players Ready, host starts ──────────
    await Promise.all(
      ROSTER.map((_, i) =>
        i === HOST_IDX ? Promise.resolve() : markReady(pages[i]),
      ),
    );
    await pages[HOST_IDX].waitForTimeout(2_000);
    await startGame(pages[HOST_IDX]);

    // Deal animation grace period before the loop polls tryBet.
    await pages[HOST_IDX].waitForTimeout(4_000);

    // ── Step 7: parallel game loops to scoreboard ────────────────
    const results = await Promise.all(
      pages.map((p, i) =>
        runGameLoop(p, {
          label: ROSTER[i].label,
          playerCount: PLAYER_COUNT,
        }),
      ),
    );
    for (let i = 0; i < results.length; i += 1) {
      expect(
        results[i],
        `[stakes:${ROSTER[i].label}] expected 'game-over', got '${results[i]}'`,
      ).toBe('game-over');
    }

    // ── Step 8: settlement modal visibility ──────────────────────
    // alice + bob (opted-in) see the RatingSettlementModal AFTER
    // the scoreboard (commit a42cbab mounts it post-scoreboard).
    // dave (opted-out) must NOT see it.
    for (let i = 0; i < ROSTER.length; i += 1) {
      const titleLoc = pages[i]
        .locator('[data-testid="settlement-title"]')
        .first();
      if (ROSTER[i].optIn) {
        await expect(
          titleLoc,
          `[stakes:${ROSTER[i].label}] expected settlement modal to be visible`,
        ).toBeVisible({ timeout: 30_000 });
      } else {
        // Give the modal a chance to *fail* to appear. Polling with
        // toHaveCount(0) over a short window gives realtime a moment
        // to (incorrectly) push the modal, so a regression that
        // shows it to non-opt-in players fails loudly.
        await pages[i].waitForTimeout(2_000);
        await expect(
          pages[i].locator('[data-testid="settlement-title"]'),
          `[stakes:${ROSTER[i].label}] expected settlement modal NOT to appear (opt-out)`,
        ).toHaveCount(0);
      }
    }

    // ── Step 9: rating_events journal ────────────────────────────
    // Verify the settle rows the edge function wrote. Two opt-in
    // players → two `reason=settle` rows for this room; deltas
    // sum to 0 (zero-sum invariant).
    const sr = resolveServiceRoleKey();
    if (!sr) {
      test
        .info()
        .annotations.push({
          type: 'skip-journal-assertion',
          description:
            'No SERVICE_ROLE_KEY available (LOCAL_SUPABASE=0 and SUPABASE_SERVICE_ROLE_KEY unset). ' +
            'UI-only assertions still apply. To enable, run via `npm run sanity` ' +
            '(LOCAL_SUPABASE=1) or export SUPABASE_SERVICE_ROLE_KEY before the run.',
        });
      // eslint-disable-next-line no-console
      console.log('[stakes] skipping rating_events journal assertion — no SERVICE_ROLE_KEY');
      return;
    }

    const svc = createClient(sr.url, sr.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Look up room_id by code so we can filter rating_events
    // precisely (the journal is keyed on room_id, not code).
    const roomLookup = await svc
      .from('rooms')
      .select('id')
      .eq('code', code)
      .single();
    expect(
      roomLookup.error,
      `[stakes] failed to look up room id for code ${code}: ${roomLookup.error?.message ?? ''}`,
    ).toBeNull();
    const roomId = (roomLookup.data as { id: string } | null)?.id;
    expect(roomId, `[stakes] missing room.id for code ${code}`).toBeTruthy();

    const journal = await svc
      .from('rating_events')
      .select('user_id, delta, reason')
      .eq('room_id', roomId)
      .eq('reason', 'settle');
    expect(
      journal.error,
      `[stakes] rating_events query failed: ${journal.error?.message ?? ''}`,
    ).toBeNull();

    const rows = (journal.data ?? []) as Array<{
      user_id: string;
      delta: number;
      reason: string;
    }>;
    expect(
      rows.length,
      `[stakes] expected 2 settle rows for room ${roomId}, got ${rows.length}`,
    ).toBe(2);
    const sum = rows.reduce((acc, r) => acc + r.delta, 0);
    expect(
      sum,
      `[stakes] expected zero-sum settle deltas, got [${rows.map((r) => r.delta).join(', ')}]`,
    ).toBe(0);
  } finally {
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  }
});
