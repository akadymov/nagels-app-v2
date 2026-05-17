#!/usr/bin/env tsx
/* eslint-disable no-console */

/**
 * Cross-tier test orchestrator. Reads tests/tests.config.json,
 * applies CLI filters, runs unit → smoke → smoke-desktop → scenario
 * → e2e in order, and prints a single summary.
 *
 * Invoked via:  npm run test:all [-- --skip a,b --only c --tag '!flaky']
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

type Tier = 'unit' | 'smoke' | 'smoke-desktop' | 'scenario' | 'end-to-end';

interface SpecRegistryEntry {
  name: string;
  tier: Tier;
  enabled: boolean;
  note?: string;
  tags?: string[];
}

interface Registry {
  specs: SpecRegistryEntry[];
}

interface TierResult {
  tier: Tier;
  passed: number;
  failed: number;
  skipped: number;
  exitCode: number;
  durationMs: number;
}

const REPO_ROOT = join(__dirname, '..');
const REGISTRY_PATH = join(REPO_ROOT, 'tests', 'tests.config.json');
const TIER_ORDER: Tier[] = [
  'unit',
  'smoke',
  'smoke-desktop',
  'scenario',
  'end-to-end',
];

function parseArgs(argv: string[]): {
  skip: Set<string>;
  only: Set<string> | null;
  tagPredicate: ((tags: string[] | undefined) => boolean) | null;
} {
  const skip = new Set<string>();
  let only: Set<string> | null = null;
  let tagPredicate: ((tags: string[] | undefined) => boolean) | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skip' && argv[i + 1]) {
      argv[++i]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((n) => skip.add(n));
    } else if (a === '--only' && argv[i + 1]) {
      only = new Set(
        argv[++i]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (a === '--tag' && argv[i + 1]) {
      const raw = argv[++i];
      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
      const excludes = parts.filter((p) => p.startsWith('!')).map((p) => p.slice(1));
      const includes = parts.filter((p) => !p.startsWith('!'));
      tagPredicate = (tags) => {
        const t = tags ?? [];
        if (excludes.some((e) => t.includes(e))) return false;
        if (includes.length > 0 && !includes.some((i) => t.includes(i))) return false;
        return true;
      };
    }
  }
  return { skip, only, tagPredicate };
}

function loadRegistry(): Registry {
  if (!existsSync(REGISTRY_PATH)) {
    throw new Error(`Registry not found at ${REGISTRY_PATH}`);
  }
  const raw = readFileSync(REGISTRY_PATH, 'utf8');
  const data = JSON.parse(raw) as Registry;
  if (!Array.isArray(data.specs)) {
    throw new Error('Registry missing specs[]');
  }
  return data;
}

function resolveEnabled(
  registry: Registry,
  filters: ReturnType<typeof parseArgs>,
): {
  enabled: SpecRegistryEntry[];
  skipped: Array<{ entry: SpecRegistryEntry; reason: string }>;
} {
  const enabled: SpecRegistryEntry[] = [];
  const skipped: Array<{ entry: SpecRegistryEntry; reason: string }> = [];
  for (const entry of registry.specs) {
    if (!entry.enabled) {
      skipped.push({ entry, reason: '[enabled=false]' + (entry.note ? ' ' + entry.note : '') });
      continue;
    }
    if (filters.only && !filters.only.has(entry.name)) {
      skipped.push({ entry, reason: '[not in --only]' });
      continue;
    }
    if (filters.skip.has(entry.name)) {
      skipped.push({ entry, reason: '[--skip]' });
      continue;
    }
    if (filters.tagPredicate && !filters.tagPredicate(entry.tags)) {
      skipped.push({ entry, reason: '[tag filter]' });
      continue;
    }
    enabled.push(entry);
  }
  return { enabled, skipped };
}

function runTier(tier: Tier, names: string[]): TierResult {
  if (names.length === 0) {
    return { tier, passed: 0, failed: 0, skipped: 0, exitCode: 0, durationMs: 0 };
  }
  const start = Date.now();

  let exitCode = 0;
  if (tier === 'unit') {
    const pattern = names
      .map((n) => `/${n}\\.test\\.|__tests__/${n}\\.`)
      .join('|');
    const res = spawnSync(
      'npx',
      ['jest', '--no-coverage', '--testPathPattern', pattern],
      { stdio: 'inherit', cwd: REPO_ROOT, env: process.env },
    );
    exitCode = res.status ?? 1;
  } else if (tier === 'smoke' || tier === 'smoke-desktop') {
    const res = spawnSync(
      'npx',
      [
        'playwright',
        'test',
        `--project=${tier}`,
        '--grep',
        // The simplest reliable filter: spec filename, anchored.
        names.map((n) => n).join('|'),
      ],
      {
        stdio: 'inherit',
        cwd: REPO_ROOT,
        env: { ...process.env, DEMO_URL: 'http://localhost:8081' },
      },
    );
    exitCode = res.status ?? 1;
  } else if (tier === 'scenario' || tier === 'end-to-end') {
    const project = tier === 'scenario' ? 'scenario' : 'e2e';
    const res = spawnSync(
      'npx',
      [
        'playwright',
        'test',
        `--project=${project}`,
        '--grep',
        names.join('|'),
      ],
      {
        stdio: 'inherit',
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          LOCAL_SUPABASE: '1',
          HEADLESS: '1',
          DEMO_URL: 'http://localhost:8082',
        },
      },
    );
    exitCode = res.status ?? 1;
  }

  return {
    tier,
    // We don't parse runner output to fill passed/failed; the runner
    // prints its own summary above. The orchestrator just reports
    // pass/fail at tier granularity in its consolidated block.
    passed: exitCode === 0 ? names.length : 0,
    failed: exitCode === 0 ? 0 : 1,
    skipped: 0,
    exitCode,
    durationMs: Date.now() - start,
  };
}

function main(): number {
  const filters = parseArgs(process.argv.slice(2));
  const registry = loadRegistry();
  const { enabled, skipped } = resolveEnabled(registry, filters);

  // Group by tier.
  const byTier = new Map<Tier, string[]>();
  for (const tier of TIER_ORDER) byTier.set(tier, []);
  for (const e of enabled) byTier.get(e.tier)!.push(e.name);

  const results: TierResult[] = [];
  for (const tier of TIER_ORDER) {
    const names = byTier.get(tier)!;
    console.log(`\n===== running tier: ${tier} (${names.length} spec${names.length === 1 ? '' : 's'}) =====`);
    if (names.length === 0) {
      console.log('(no enabled specs)');
      results.push({ tier, passed: 0, failed: 0, skipped: 0, exitCode: 0, durationMs: 0 });
      continue;
    }
    const r = runTier(tier, names);
    results.push(r);
  }

  // Summary block.
  console.log('\n===== test:all summary =====');
  let total = 0;
  for (const r of results) {
    const status = r.exitCode === 0 ? '✓' : '✗';
    const secs = (r.durationMs / 1000).toFixed(1);
    console.log(`${status} ${r.tier.padEnd(14)} (${secs}s)`);
    total += r.durationMs;
  }
  if (skipped.length > 0) {
    console.log(`\nSkipped specs (${skipped.length}):`);
    for (const s of skipped) {
      console.log(`  - ${s.entry.name.padEnd(20)} (${s.entry.tier}) ${s.reason}`);
    }
  }
  const anyFailed = results.some((r) => r.exitCode !== 0);
  const totalMin = (total / 60000).toFixed(1);
  console.log(
    `\nResult: ${anyFailed ? '✗ at least one tier failed' : '✓ all enabled specs passed'} (~${totalMin} min)`,
  );
  return anyFailed ? 1 : 0;
}

process.exit(main());
