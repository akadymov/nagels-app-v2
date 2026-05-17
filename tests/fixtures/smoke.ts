'use strict';

/**
 * Shared helpers for the smoke tier. Smoke specs run against the
 * manual :8081 dev server (not the Phase 2/3 :8082 isolated stack),
 * so we can't rely on a global-setup probe — each spec calls
 * ensureDevServer() in its beforeAll instead.
 */

import { request, type Page } from '@playwright/test';

const SMOKE_BASE_URL = process.env.DEMO_URL || 'http://localhost:8081';

/**
 * Probe :8081 once. Throws a clear actionable error if the dev
 * server is not reachable.
 */
export async function ensureDevServer(): Promise<void> {
  const ctx = await request.newContext({ baseURL: SMOKE_BASE_URL });
  try {
    const res = await ctx.get('/', { timeout: 3_000 });
    if (!res.ok()) {
      throw new Error(`dev server at ${SMOKE_BASE_URL} returned ${res.status()}`);
    }
  } catch (e: any) {
    throw new Error(
      `Smoke tests require the dev server at ${SMOKE_BASE_URL}. ` +
        `Start it with:  npx expo start --port 8081\n` +
        `Underlying error: ${e?.message ?? e}`,
    );
  } finally {
    await ctx.dispose();
  }
}

/**
 * i18next missing-key heuristic: a string is `lowercase.dotted.path`.
 * Tightened from the original strategy doc's pattern to require at
 * least one digit/alpha after the dot, reducing false positives on
 * filenames and version strings.
 */
const MISSING_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

const ALLOW_LIST = new Set<string>([
  // Add false-positive strings here as they are discovered. Empty for now.
]);

/**
 * Walk visible text nodes under the page (or the given root). Return
 * any string content that matches the missing-key heuristic and is
 * not in ALLOW_LIST. Caller asserts the array is empty.
 */
export async function findUntranslatedKeys(
  page: Page,
  rootSelector?: string,
): Promise<string[]> {
  const sel = rootSelector ?? 'body';
  return page.evaluate(
    ({ sel, allow, pattern }) => {
      const root = document.querySelector(sel);
      if (!root) return [];
      const allowSet = new Set(allow);
      const re = new RegExp(pattern);
      const out: string[] = [];
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const txt = (node.textContent || '').trim();
          if (re.test(txt) && !allowSet.has(txt)) out.push(txt);
        } else {
          node.childNodes.forEach(walk);
        }
      };
      walk(root);
      return Array.from(new Set(out));
    },
    {
      sel,
      allow: Array.from(ALLOW_LIST),
      pattern: MISSING_KEY_RE.source,
    },
  );
}

/**
 * Assert (a) no horizontal scroll, (b) optionally two named selectors
 * (split panes) do not overlap horizontally.
 */
export async function assertNoOverflow(
  page: Page,
  splitPanes?: { left: string; right: string },
): Promise<void> {
  const metrics = await page.evaluate(({ left, right }) => {
    const bodyScrollWidth = document.body.scrollWidth;
    const viewportWidth = window.innerWidth;
    let leftRect: DOMRect | null = null;
    let rightRect: DOMRect | null = null;
    if (left) {
      const el = document.querySelector(left);
      leftRect = el ? el.getBoundingClientRect() : null;
    }
    if (right) {
      const el = document.querySelector(right);
      rightRect = el ? el.getBoundingClientRect() : null;
    }
    return { bodyScrollWidth, viewportWidth, leftRect, rightRect };
  }, splitPanes ?? { left: '', right: '' });

  if (metrics.bodyScrollWidth > metrics.viewportWidth + 1) {
    throw new Error(
      `Horizontal overflow: body.scrollWidth=${metrics.bodyScrollWidth} > innerWidth=${metrics.viewportWidth}`,
    );
  }
  if (splitPanes && metrics.leftRect && metrics.rightRect) {
    if (metrics.leftRect.right > metrics.rightRect.left + 1) {
      throw new Error(
        `Split-pane overlap: ${splitPanes.left}.right=${metrics.leftRect.right} > ${splitPanes.right}.left=${metrics.rightRect.left}`,
      );
    }
  }
}

/**
 * Add to test.use({ contextOptions }) so every spec starts with empty
 * cookies + localStorage. Prevents user-state pollution between
 * smoke specs when the same :8081 dev server is reused.
 */
export const freshContextHooks = {
  storageState: undefined as undefined,
};
