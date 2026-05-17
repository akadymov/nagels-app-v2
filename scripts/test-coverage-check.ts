#!/usr/bin/env tsx
/* eslint-disable no-console */

/**
 * Test coverage linter.
 *
 * Walks src/**\/*.{ts,tsx} for production testIDs and
 * tests/**\/*.spec.{ts,js} for data-testid references. Reports:
 *
 *   - ORPHANS: testIDs referenced in tests but no longer present in
 *     src/ — likely renamed/removed. Loud warning, doesn't fail.
 *   - UNCOVERED: testIDs in src/ that no test references. Summary
 *     counter; full list via `npm run test:lint`.
 *
 * Exit code always 0 (warning-only — per project decision, lint
 * should never block a release). Use the counter trend + the
 * separate `tests/TEST_TODO.md` to track gaps.
 *
 * Flags:
 *   --update-todo   Overwrites the "Auto-detected" section of
 *                   tests/TEST_TODO.md with the current uncovered
 *                   list. Agents call this after adding testIDs.
 *   --verbose       Lists every uncovered testID (default: just
 *                   counter + orphans).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..');
const SRC_DIR = join(REPO_ROOT, 'src');
const TESTS_DIR = join(REPO_ROOT, 'tests');
const TODO_PATH = join(TESTS_DIR, 'TEST_TODO.md');

interface SrcTestId {
  id: string;
  file: string;
  line: number;
  kind: 'static' | 'template-prefix';
}

interface TestRef {
  selector: string;
  op: '=' | '^=' | '*=' | '$=';
  value: string;
  file: string;
  line: number;
}

// ─── File walking ──────────────────────────────────────────────

function walk(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git' || entry === '__tests__') continue;
      out.push(...walk(full, ext));
    } else if (ext.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// ─── Extractors ────────────────────────────────────────────────

const STATIC_TESTID_RE = /testID=["']([a-zA-Z0-9_-]+)["']/g;
// Captures the prefix from `testID={`foo-${bar}-baz`}` → 'foo-'
// (we treat anything up to the first ${ as a stable prefix).
const TEMPLATE_TESTID_RE = /testID=\{`([a-zA-Z0-9_-]*)\$\{/g;
// Captures generic prefix props from <PillRow testIDPrefix="theme" .../>
// or <ChatPanel testIdPrefix="betting-chat" .../> usages — without
// this, the dynamic IDs the components render (theme-light,
// betting-chat-input, …) read as orphans. Both casings exist in the
// codebase (case-insensitive match).
const TESTID_PREFIX_PROP_RE = /testI[Dd]Prefix=["']([a-zA-Z0-9_-]+)["']/g;

function extractFromSrc(): SrcTestId[] {
  const files = walk(SRC_DIR, /\.(ts|tsx)$/);
  const out: SrcTestId[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      let m: RegExpExecArray | null;
      STATIC_TESTID_RE.lastIndex = 0;
      while ((m = STATIC_TESTID_RE.exec(line)) !== null) {
        out.push({ id: m[1], file, line: i + 1, kind: 'static' });
      }
      TEMPLATE_TESTID_RE.lastIndex = 0;
      while ((m = TEMPLATE_TESTID_RE.exec(line)) !== null) {
        if (m[1]) out.push({ id: m[1], file, line: i + 1, kind: 'template-prefix' });
      }
      TESTID_PREFIX_PROP_RE.lastIndex = 0;
      while ((m = TESTID_PREFIX_PROP_RE.exec(line)) !== null) {
        // <PillRow testIDPrefix="theme" /> generates "theme-<opt.key>" ids.
        out.push({ id: `${m[1]}-`, file, line: i + 1, kind: 'template-prefix' });
      }
    }
  }
  return out;
}

// Match `[data-testid="X"]`, `[data-testid^="X"]`, etc., with " or '.
const SELECTOR_RE = /\[data-testid(\^=|\*=|\$=|=)["']([^"']+)["']\]/g;
// Match testID helper calls in fixtures: tap(page, 'btn-ready',
// ...), exists(page, 'btn-ready', ...) — the helpers build the
// data-testid selector internally. Without this, every testID
// referenced only through helpers reads as uncovered.
const HELPER_CALL_RE = /\b(?:tap|exists)\(\s*\w+\s*,\s*["']([a-zA-Z0-9_-]+)["']/g;

function extractFromTests(): TestRef[] {
  // Include fixture helpers (tests/fixtures/*.ts) alongside spec
  // files — many testIDs (room-code, btn-ready, pwa-close, etc.)
  // are referenced only from shared helpers and would otherwise
  // read as uncovered.
  const files = walk(TESTS_DIR, /\.(spec|fixture)\.(ts|js)$|\.(ts|js)$/);
  const out: TestRef[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      let m: RegExpExecArray | null;
      SELECTOR_RE.lastIndex = 0;
      while ((m = SELECTOR_RE.exec(line)) !== null) {
        // Skip template-literal selectors like `lang-${lang}` —
        // the variable substitution is dynamic and not analysable
        // by grep. Test author already knows what they're doing.
        if (m[2].includes('${')) continue;
        out.push({
          selector: m[0],
          op: m[1] as TestRef['op'],
          value: m[2],
          file,
          line: i + 1,
        });
      }
      HELPER_CALL_RE.lastIndex = 0;
      while ((m = HELPER_CALL_RE.exec(line)) !== null) {
        out.push({
          selector: m[0],
          op: '=',
          value: m[1],
          file,
          line: i + 1,
        });
      }
    }
  }
  return out;
}

// ─── Coverage checks ───────────────────────────────────────────

function srcMatchesRef(srcId: SrcTestId, ref: TestRef): boolean {
  if (srcId.kind === 'static') {
    if (ref.op === '=') return srcId.id === ref.value;
    if (ref.op === '^=') return srcId.id.startsWith(ref.value);
    if (ref.op === '*=') return srcId.id.includes(ref.value);
    if (ref.op === '$=') return srcId.id.endsWith(ref.value);
  } else {
    // template-prefix in src means "all IDs starting with this prefix"
    if (ref.op === '=') return ref.value.startsWith(srcId.id);
    if (ref.op === '^=') return srcId.id.startsWith(ref.value) || ref.value.startsWith(srcId.id);
    if (ref.op === '*=') return srcId.id.includes(ref.value) || ref.value.includes(srcId.id);
    if (ref.op === '$=') return false; // hard to reconcile prefix vs suffix
  }
  return false;
}

function refMatchesAnySrc(ref: TestRef, src: SrcTestId[]): boolean {
  for (const s of src) {
    if (srcMatchesRef(s, ref)) return true;
  }
  return false;
}

// ─── Main ──────────────────────────────────────────────────────

const src = extractFromSrc();
const refs = extractFromTests();
const argv = process.argv.slice(2);
const updateTodo = argv.includes('--update-todo');
const verbose = argv.includes('--verbose');

const orphans = refs.filter((r) => !refMatchesAnySrc(r, src));
const uncoveredSrc = src.filter(
  (s) => s.kind === 'static' && !refs.some((r) => srcMatchesRef(s, r)),
);
// De-duplicate uncovered by ID (same ID may appear in many files).
const uncoveredById = new Map<string, SrcTestId>();
for (const s of uncoveredSrc) {
  if (!uncoveredById.has(s.id)) uncoveredById.set(s.id, s);
}
const uncoveredList = [...uncoveredById.values()].sort((a, b) =>
  a.id.localeCompare(b.id),
);

const totalSrcStatic = src.filter((s) => s.kind === 'static').length;
const uniqueSrcStatic = new Set(src.filter((s) => s.kind === 'static').map((s) => s.id)).size;

console.log('───── Test coverage check ─────');
console.log(
  `src testIDs (static, unique):  ${uniqueSrcStatic}  (${totalSrcStatic} occurrences across files)`,
);
console.log(`test data-testid references:  ${refs.length}`);
console.log('');

if (orphans.length > 0) {
  console.log(`⚠  ORPHANS — referenced in tests but not in src/ (${orphans.length}):`);
  for (const o of orphans) {
    console.log(
      `   ${o.value.padEnd(28)} (op '${o.op}')  ${relative(REPO_ROOT, o.file)}:${o.line}`,
    );
  }
  console.log('');
} else {
  console.log('✓  No orphan testIDs.');
  console.log('');
}

console.log(
  `?  UNCOVERED — in src/ but no test references: ${uncoveredList.length} / ${uniqueSrcStatic} testIDs.`,
);
if (verbose) {
  for (const u of uncoveredList) {
    console.log(`   ${u.id.padEnd(30)}  ${relative(REPO_ROOT, u.file)}:${u.line}`);
  }
} else if (uncoveredList.length > 0) {
  console.log(`   Run \`npm run test:lint -- --verbose\` for the full list.`);
  console.log(`   Or \`npm run test:lint -- --update-todo\` to refresh tests/TEST_TODO.md.`);
}
console.log('');

if (updateTodo) {
  updateTodoFile(uncoveredList);
  console.log(`✓  tests/TEST_TODO.md refreshed (${uncoveredList.length} pending entries).`);
}

// Exit 0 always — coverage gaps are informational, never blocking.
process.exit(0);

// ─── TODO file maintenance ─────────────────────────────────────

function updateTodoFile(uncovered: SrcTestId[]): void {
  const AUTO_BEGIN = '<!-- AUTO-DETECTED:BEGIN — do not edit manually; rewritten by test:lint --update-todo -->';
  const AUTO_END = '<!-- AUTO-DETECTED:END -->';

  const lines: string[] = [];
  lines.push('# TEST_TODO — pending test coverage');
  lines.push('');
  lines.push('Auto-maintained partially by `scripts/test-coverage-check.ts`.');
  lines.push('');
  lines.push('## Auto-detected uncovered testIDs');
  lines.push('');
  lines.push(AUTO_BEGIN);
  if (uncovered.length === 0) {
    lines.push('_All static testIDs in src/ are referenced from at least one spec. Nothing to add._');
  } else {
    for (const u of uncovered) {
      lines.push(
        `- [ ] \`${u.id}\` — ${relative(REPO_ROOT, u.file)}:${u.line}`,
      );
    }
  }
  lines.push(AUTO_END);
  lines.push('');
  lines.push('## Manual notes');
  lines.push('');
  lines.push(
    'Add free-form notes about coverage gaps the linter cannot see (flow-level UX, error states, multi-context scenarios, etc.).',
  );
  lines.push('');

  // Preserve any user-written manual notes between previous AUTO_END
  // and end of file (if the file already exists).
  if (existsSync(TODO_PATH)) {
    const prev = readFileSync(TODO_PATH, 'utf8');
    const idx = prev.indexOf(AUTO_END);
    if (idx >= 0) {
      const after = prev.slice(idx + AUTO_END.length);
      const manualHeader = after.indexOf('## Manual notes');
      if (manualHeader >= 0) {
        const manualBody = after.slice(manualHeader + '## Manual notes'.length).trimStart();
        // Replace our placeholder Manual section with the prior body.
        const out = lines.join('\n');
        const ourManualHeader = out.indexOf('## Manual notes');
        const restored =
          out.slice(0, ourManualHeader + '## Manual notes'.length) +
          '\n\n' +
          manualBody;
        writeFileSync(TODO_PATH, restored, 'utf8');
        return;
      }
    }
  }

  writeFileSync(TODO_PATH, lines.join('\n') + '\n', 'utf8');
}
