/**
 * Offline tournament — pure seating and balance helpers.
 *
 * Shared by the app (via src/lib/tournament) and the game-action edge
 * function (server-side validation in start_tour). No imports, so it runs
 * unchanged under jest (node) and deno.
 */

export const MIN_TABLE = 2;
export const MAX_TABLE = 6;
export const STAKE_CHIPS = [0, 1, 5, 10, 25] as const;

export interface SeatingParticipant { id: string; no_stakes: boolean }

export type SeatingError =
  | 'no_tables' | 'table_too_small' | 'table_too_large'
  | 'no_stakes_capacity' | 'no_stakes_at_stake_table'
  | 'duplicate' | 'unknown_participant' | 'bad_pin';

export type SeatingResult =
  | { ok: true; tables: string[][] }
  | { ok: false; reason: SeatingError };

function shuffled<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Index of the smallest table among `candidates` that still has room; ties broken randomly. */
function pickSmallest(tables: string[][], candidates: number[], rng: () => number): number | null {
  const open = candidates.filter((i) => tables[i].length < MAX_TABLE);
  if (open.length === 0) return null;
  const min = Math.min(...open.map((i) => tables[i].length));
  const best = open.filter((i) => tables[i].length === min);
  return best[Math.floor(rng() * best.length)];
}

export function shuffleSeating(
  input: { participants: SeatingParticipant[]; stakes: number[]; pins?: Record<string, number> },
  rng: () => number = Math.random,
): SeatingResult {
  const { participants, stakes } = input;
  const pins = input.pins ?? {};
  if (stakes.length === 0) return { ok: false, reason: 'no_tables' };

  const tables: string[][] = stakes.map(() => []);
  const all = stakes.map((_, i) => i);
  const free = all.filter((i) => stakes[i] === 0);
  const byId = new Map(participants.map((p) => [p.id, p]));

  // 1. Pins.
  for (const [pid, ti] of Object.entries(pins)) {
    const p = byId.get(pid);
    if (!p) return { ok: false, reason: 'unknown_participant' };
    if (!Number.isInteger(ti) || ti < 0 || ti >= stakes.length) return { ok: false, reason: 'bad_pin' };
    if (p.no_stakes && stakes[ti] > 0) return { ok: false, reason: 'no_stakes_at_stake_table' };
    if (tables[ti].length >= MAX_TABLE) return { ok: false, reason: 'table_too_large' };
    tables[ti].push(pid);
  }

  const rest = participants.filter((p) => !(p.id in pins));

  // 2. No-stakes participants → stake-0 tables only.
  for (const p of shuffled(rest.filter((x) => x.no_stakes), rng)) {
    const ti = pickSmallest(tables, free, rng);
    if (ti === null) return { ok: false, reason: 'no_stakes_capacity' };
    tables[ti].push(p.id);
  }

  // 3. Everyone else → any table, smallest first.
  for (const p of shuffled(rest.filter((x) => !x.no_stakes), rng)) {
    const ti = pickSmallest(tables, all, rng);
    if (ti === null) return { ok: false, reason: 'table_too_large' };
    tables[ti].push(p.id);
  }

  if (tables.some((t) => t.length < MIN_TABLE)) return { ok: false, reason: 'table_too_small' };

  // 4. Random seat order inside each table.
  return { ok: true, tables: tables.map((t) => shuffled(t, rng)) };
}

export function validateSeating(
  tables: string[][],
  participants: SeatingParticipant[],
  stakes: number[],
): SeatingError | null {
  if (tables.length === 0 || tables.length !== stakes.length) return 'no_tables';
  const byId = new Map(participants.map((p) => [p.id, p]));
  const seen = new Set<string>();
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    if (t.length < MIN_TABLE) return 'table_too_small';
    if (t.length > MAX_TABLE) return 'table_too_large';
    for (const id of t) {
      if (seen.has(id)) return 'duplicate';
      seen.add(id);
      const p = byId.get(id);
      if (!p) return 'unknown_participant';
      if (p.no_stakes && stakes[i] > 0) return 'no_stakes_at_stake_table';
    }
  }
  return null;
}

export interface BalanceRow { hand_id: string; participant_id: string; hand_score: number; stake: number }

/** Sum of (score − mean score of that hand) × stake, per participant. Not rounded. */
export function computeBalance(rows: BalanceRow[]): Record<string, number> {
  const byHand = new Map<string, BalanceRow[]>();
  for (const r of rows) {
    const list = byHand.get(r.hand_id) ?? [];
    list.push(r);
    byHand.set(r.hand_id, list);
  }
  const out: Record<string, number> = {};
  for (const list of byHand.values()) {
    const mean = list.reduce((s, r) => s + r.hand_score, 0) / list.length;
    for (const r of list) {
      out[r.participant_id] = (out[r.participant_id] ?? 0) + (r.hand_score - mean) * r.stake;
    }
  }
  return out;
}

/** Same max_cards for every table: bounded by the largest table and the 10-card cap. */
export function defaultMaxCards(tableSizes: number[]): number {
  const largest = Math.max(MIN_TABLE, ...tableSizes);
  return Math.min(10, Math.floor(52 / largest));
}
