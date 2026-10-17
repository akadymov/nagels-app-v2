# Offline Tournament Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one recorder per table run an in-person Nägels tournament from a phone (seating, bets, tricks, per-table money stakes) while a TV shows every table and the cumulative balance live.

**Architecture:** Extend the existing scorekeeper room mode. A `tournaments` row owns N scorekeeper rooms per tour, and the rooms are seated with **proxy** `room_sessions` (no auth user, one per participant per tour). The room host (the recorder) acts on behalf of a seat through `on_behalf_of_seat`; the existing `place_bet_action` and `record_tricks_action` RPCs are untouched. Balance is derived on read by `get_tournament_state`. The TV page subscribes to the tournament and room broadcast channels and refetches.

**Tech Stack:** Expo (React Native Web) + TypeScript, Supabase Postgres (plpgsql RPCs), Deno edge function `game-action`, Zustand, react-i18next, jest (src), `deno test` (supabase/functions), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-offline-tournament-design.md`

## Global Constraints

- Table size 2–6 players (`MIN_TABLE = 2`, `MAX_TABLE = 6`).
- Stake chips are exactly `0 / 1 / 5 / 10 / 25` (matches the `rooms.stake` CHECK constraint).
- Default `max_cards` = `min(10, floor(52 / largest table size))`, the same for every table in a tour.
- Balance per closed hand = `(hand_score − mean(hand_score at that table for that hand)) × stake`; hands in phase `scoring` or `closed` count. It is displayed rounded to 1 decimal.
- `no_stakes` participants may only sit at stake-0 tables. This is enforced on the client and on the server (`no_stakes_at_stake_table`).
- Tournament rooms **never** notify: no `notifyNewRoom`, no `notifyPush`, regardless of client flags.
- Tournament rooms have **no timers**: `request_timeout` is rejected server-side, and the tournament screens never mount `useTurnTimeout`, `useHostAbsentTicker`, `HostLeftBanner` or `useHeartbeat`.
- Tournament rooms never write `rating_events`.
- All user-facing strings live in `src/i18n/locales/{en,ru,es,fr}.json`. RU: "не хватает" = fight, "лишних" = give (don't flip). Code, comments and docs are English.
- Bets go seat `+1` on the server (`place_bet_action`: `next = (current_seat + 1) % n`); undo logic must use the same direction.
- Ship as soon as it's ready: migration → `supabase db push`, deploy the edge function, push to main. Akula tests on prod.

## Review Focus

1. **Recorder phone reloads or sleeps mid-hand** → reopening the same URL resumes on the same table and hand with no duplicated bet. Pinned in Task 7 (claim is idempotent, state comes from the server).
2. **Recorder taps a bet twice fast / double-submits tricks** → exactly one bet per seat is recorded and nothing errors visibly. Pinned in Task 7 (buttons disabled while in flight; the server's `already_bet` / `not_your_turn` is swallowed with a refresh).
3. **Wrong bet entered for the last bidder, noticed after phase flipped to tricks_recording** → undo still works. Pinned in Task 2 (SQL test for undo in `tricks_recording`).
4. **Admin session lost (guest cleared, different phone)** → the admin link `?k=` still controls the tournament. Pinned in Task 4 (admin authorization accepts the secret).
5. **Stale `roomStore` version when the recorder moves to another table or tour** → the new table renders, not a frozen old one. Pinned in Task 7 (`useRoomStore.getState().reset()` on room change).
6. **Another phone takes over the table** → the old phone stops showing live controls and offers **Take back**; no half-entered action is silently rejected. Pinned in Task 7 (host check on every snapshot) and Task 10 (e2e takeover step).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/engine/tournament.ts` (new) | Pure: `shuffleSeating`, `validateSeating`, `computeBalance`, `defaultMaxCards`, constants. Shared by client and edge. |
| `src/lib/tournament/index.ts` (new) | Re-export of the engine module for the app (mirrors `src/game/rules.ts`). |
| `src/lib/tournament/__tests__/tournament.test.ts` (new) | jest for the pure helpers. |
| `supabase/migrations/20261017000000_offline_tournament.sql` (new) | Tables, columns, proxy sessions, `get_room_state` (+tournament fields, `is_proxy`), `get_tournament_state`, `undo_last_bet_action`, `cleanup_stale_rooms` exclusion. |
| `supabase/tests/offline_tournament.sql` (new) | psql assertions for undo + balance against local Supabase. |
| `supabase/functions/_shared/types.ts` | New action kinds, `on_behalf_of_seat`, room snapshot fields, player `is_proxy`. |
| `supabase/functions/game-action/actions/tournament.ts` (new) | `tournamentCreate`, `tournamentUpdateParticipants`, `tournamentStartTour`, `tournamentClaimTable`, `isTournamentAdmin`. |
| `supabase/functions/game-action/actions/undoBet.ts` (new) | `undo_bet` handler. |
| `supabase/functions/game-action/onBehalf.ts` (new) | `resolveOnBehalfActor` (authz + proxy lookup). |
| `supabase/functions/game-action/index.ts` | Route tournament actions, on-behalf substitution, push skip, timeout rejection. |
| `supabase/functions/game-action/broadcast.ts` | `broadcastTournamentChanged`. |
| `supabase/functions/game-action/actions/createRoom.ts` | Export `generateCode`. |
| `supabase/functions/game-action/actions/continueHand.ts` | Skip settlement for tournament rooms. |
| `supabase/functions/_shared/__tests__/tournament.test.ts` (new) | deno tests: engine parity + `canActForTable`. |
| `src/lib/gameClient.ts` | Tournament client methods, `placeBetFor`, `recordTricksFor`, `undoBet`. |
| `src/lib/tournament/useTournamentState.ts` (new) | Fetch `get_tournament_state` + realtime refetch. |
| `src/lib/tournament/types.ts` (new) | `TournamentState` client types. |
| `src/components/tournament/TableBoard.tsx` (new) | One table's live board (TV + recorder). |
| `src/components/tournament/Leaderboard.tsx` (new) | Cumulative balance and points. |
| `src/components/tournament/RecorderBetPad.tsx` (new) | Bet pad for the current bidder + undo. |
| `src/components/tournament/RecorderTricks.tsx` (new) | All-players tricks steppers + submit. |
| `src/components/tournament/TableQr.tsx` (new) | QR image for a table claim URL. |
| `src/screens/tournament/TournamentSetupScreen.tsx` (new) | Admin: create, participants, stakes, pins, shuffle, start / next tour. |
| `src/screens/tournament/TournamentRecorderScreen.tsx` (new) | Recorder flow for one table. |
| `src/screens/tournament/TournamentTvScreen.tsx` (new) | TV dashboard. |
| `src/navigation/AppNavigator.tsx` | Routes + linking. |
| `tests/e2e/tournament.spec.ts` (new) | One-table e2e. |

---

### Task 1: Pure tournament engine

**Files:**
- Create: `supabase/functions/_shared/engine/tournament.ts`
- Create: `src/lib/tournament/index.ts`
- Test: `src/lib/tournament/__tests__/tournament.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MIN_TABLE = 2; export const MAX_TABLE = 6;
  export const STAKE_CHIPS = [0, 1, 5, 10, 25] as const;
  export interface SeatingParticipant { id: string; no_stakes: boolean }
  export type SeatingError =
    | 'no_tables' | 'table_too_small' | 'table_too_large'
    | 'no_stakes_capacity' | 'no_stakes_at_stake_table'
    | 'duplicate' | 'unknown_participant' | 'bad_pin';
  export type SeatingResult = { ok: true; tables: string[][] } | { ok: false; reason: SeatingError };
  export function shuffleSeating(input: {
    participants: SeatingParticipant[];
    stakes: number[];                    // one per table
    pins?: Record<string, number>;       // participantId -> table index
  }, rng?: () => number): SeatingResult;
  export function validateSeating(tables: string[][], participants: SeatingParticipant[], stakes: number[]): SeatingError | null;
  export interface BalanceRow { hand_id: string; participant_id: string; hand_score: number; stake: number }
  export function computeBalance(rows: BalanceRow[]): Record<string, number>;
  export function defaultMaxCards(tableSizes: number[]): number;
  ```

- [ ] **Step 1: Write the failing test**

`src/lib/tournament/__tests__/tournament.test.ts`:
```ts
import {
  shuffleSeating, validateSeating, computeBalance, defaultMaxCards,
  type SeatingParticipant,
} from '..';

function seeded(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}
const people = (n: number, noStakes: number[] = []): SeatingParticipant[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, no_stakes: noStakes.includes(i) }));

describe('shuffleSeating', () => {
  it('balances 14 players over 3 tables as 5/5/4 with no duplicates', () => {
    const r = shuffleSeating({ participants: people(14), stakes: [0, 0, 0] }, seeded(1));
    if (!r.ok) throw new Error(r.reason);
    expect(r.tables.map((t) => t.length).sort()).toEqual([4, 5, 5]);
    expect(new Set(r.tables.flat()).size).toBe(14);
  });

  it('is deterministic for the same rng seed', () => {
    const a = shuffleSeating({ participants: people(10), stakes: [0, 5] }, seeded(7));
    const b = shuffleSeating({ participants: people(10), stakes: [0, 5] }, seeded(7));
    expect(a).toEqual(b);
  });

  it('keeps pins at their table', () => {
    for (let seed = 0; seed < 20; seed++) {
      const r = shuffleSeating(
        { participants: people(10), stakes: [0, 5], pins: { p3: 1, p4: 0 } }, seeded(seed));
      if (!r.ok) throw new Error(r.reason);
      expect(r.tables[1]).toContain('p3');
      expect(r.tables[0]).toContain('p4');
    }
  });

  it('never seats a no-stakes participant at a stake table', () => {
    for (let seed = 0; seed < 50; seed++) {
      const r = shuffleSeating(
        { participants: people(12, [0, 1, 2]), stakes: [5, 0, 10] }, seeded(seed));
      if (!r.ok) throw new Error(r.reason);
      for (const id of ['p0', 'p1', 'p2']) expect(r.tables[1]).toContain(id);
    }
  });

  it('reports no_stakes_capacity when no-stakes people exceed stake-0 seats', () => {
    const r = shuffleSeating(
      { participants: people(12, [0, 1, 2, 3, 4, 5, 6]), stakes: [0, 5] }, seeded(1));
    expect(r).toEqual({ ok: false, reason: 'no_stakes_capacity' });
  });

  it('reports no_stakes_at_stake_table for a pin that breaks the rule', () => {
    const r = shuffleSeating(
      { participants: people(8, [0]), stakes: [0, 5], pins: { p0: 1 } }, seeded(1));
    expect(r).toEqual({ ok: false, reason: 'no_stakes_at_stake_table' });
  });

  it('reports table_too_large when there are more than 6 per table', () => {
    expect(shuffleSeating({ participants: people(13), stakes: [0, 0] }, seeded(1)))
      .toEqual({ ok: false, reason: 'table_too_large' });
  });

  it('reports table_too_small when a table would get fewer than 2', () => {
    expect(shuffleSeating({ participants: people(5), stakes: [0, 0, 0] }, seeded(1)))
      .toEqual({ ok: false, reason: 'table_too_small' });
  });

  it('reports no_tables for an empty stakes array', () => {
    expect(shuffleSeating({ participants: people(4), stakes: [] }))
      .toEqual({ ok: false, reason: 'no_tables' });
  });
});

describe('validateSeating', () => {
  const ps = people(6, [0]);
  it('accepts a valid seating', () => {
    expect(validateSeating([['p0', 'p1', 'p2'], ['p3', 'p4', 'p5']], ps, [0, 5])).toBeNull();
  });
  it('rejects duplicates', () => {
    expect(validateSeating([['p0', 'p1', 'p1'], ['p3', 'p4', 'p5']], ps, [0, 5])).toBe('duplicate');
  });
  it('rejects unknown ids', () => {
    expect(validateSeating([['p0', 'p1', 'zz'], ['p3', 'p4', 'p5']], ps, [0, 5])).toBe('unknown_participant');
  });
  it('rejects no-stakes at a stake table', () => {
    expect(validateSeating([['p1', 'p2', 'p3'], ['p0', 'p4', 'p5']], ps, [0, 5])).toBe('no_stakes_at_stake_table');
  });
  it('rejects tables outside 2..6', () => {
    expect(validateSeating([['p0'], ['p1', 'p2', 'p3', 'p4', 'p5']], ps, [0, 0])).toBe('table_too_small');
  });
});

describe('computeBalance', () => {
  it('is zero-sum per hand and scales with stake', () => {
    const b = computeBalance([
      { hand_id: 'h1', participant_id: 'a', hand_score: 12, stake: 5 },
      { hand_id: 'h1', participant_id: 'b', hand_score: 2, stake: 5 },
      { hand_id: 'h1', participant_id: 'c', hand_score: 1, stake: 5 },
    ]);
    expect(b.a).toBeCloseTo(35);   // (12 - 5) * 5
    expect(b.b).toBeCloseTo(-15);
    expect(b.c).toBeCloseTo(-20);
    expect(b.a + b.b + b.c).toBeCloseTo(0);
  });
  it('stake 0 contributes 0 but still lists the participant', () => {
    const b = computeBalance([
      { hand_id: 'h1', participant_id: 'a', hand_score: 12, stake: 0 },
      { hand_id: 'h1', participant_id: 'b', hand_score: 2, stake: 0 },
    ]);
    expect(b).toEqual({ a: 0, b: 0 });
  });
  it('sums across hands and tables', () => {
    const b = computeBalance([
      { hand_id: 'h1', participant_id: 'a', hand_score: 10, stake: 1 },
      { hand_id: 'h1', participant_id: 'b', hand_score: 0, stake: 1 },
      { hand_id: 'h2', participant_id: 'a', hand_score: 0, stake: 10 },
      { hand_id: 'h2', participant_id: 'c', hand_score: 4, stake: 10 },
    ]);
    expect(b.a).toBeCloseTo(5 - 20);
    expect(b.b).toBeCloseTo(-5);
    expect(b.c).toBeCloseTo(20);
  });
});

describe('defaultMaxCards', () => {
  it('uses the largest table, capped at 10', () => {
    expect(defaultMaxCards([4, 4])).toBe(10);
    expect(defaultMaxCards([4, 6])).toBe(8);
    expect(defaultMaxCards([5, 5, 4])).toBe(10);
    expect(defaultMaxCards([])).toBe(10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/lib/tournament --no-coverage`
Expected: FAIL, "Cannot find module '..'".

- [ ] **Step 3: Implement**

`supabase/functions/_shared/engine/tournament.ts`:
```ts
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
```

`src/lib/tournament/index.ts`:
```ts
// Re-export the shared engine module (same pattern as src/game/rules.ts).
export * from '../../../supabase/functions/_shared/engine/tournament';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/lib/tournament --no-coverage`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/engine/tournament.ts src/lib/tournament
git commit -m "feat(tournament): pure seating + balance engine"
```

---

### Task 2: Database migration

**Files:**
- Create: `supabase/migrations/20261017000000_offline_tournament.sql`
- Test: `supabase/tests/offline_tournament.sql`

**Interfaces:**
- Produces (SQL): tables `tournaments`, `tournament_participants`; columns `rooms.tournament_id`, `rooms.tour_number`, `rooms.table_number`, `rooms.table_claimed`, `room_sessions.tournament_participant_id` (and `auth_user_id` nullable); `get_room_state` room object gains `tournament_id, tour_number, table_number, table_claimed`, and each player gains `is_proxy`; `get_tournament_state(p_code text) → jsonb | null`; `undo_last_bet_action(p_room_id uuid, p_hand_id uuid) → jsonb` (same `{ok, error?, state, version}` envelope as `place_bet_action`).
- `get_tournament_state` shape:
  ```json
  { "tournament": {"id","code","name","max_cards","current_tour","version","admin_session_id"},
    "participants": [{"id","display_name","no_stakes"}],
    "tables": [{"table_number","room_id","stake","claimed","state": <get_room_state>}],
    "leaderboard": [{"participant_id","balance","total_points"}] }
  ```

- [ ] **Step 1: Write the SQL assertion test**

`supabase/tests/offline_tournament.sql` (runs inside a transaction and rolls back):
```sql
BEGIN;
DO $$
DECLARE
  v_t uuid; v_p uuid[]; v_s uuid[]; v_room uuid; v_hand uuid; r jsonb; i int;
BEGIN
  INSERT INTO tournaments (code, name, max_cards, table_secret)
    VALUES ('TSTTST', 'test', 2, 'sec') RETURNING id INTO v_t;
  FOR i IN 1..3 LOOP
    v_p[i] := gen_random_uuid();
    INSERT INTO tournament_participants (id, tournament_id, display_name) VALUES (v_p[i], v_t, 'P'||i);
    INSERT INTO room_sessions (display_name, tournament_participant_id)
      VALUES ('P'||i, v_p[i]) RETURNING id INTO v_s[i];
  END LOOP;
  INSERT INTO rooms (code, host_session_id, player_count, max_cards, mode, phase, tournament_id, tour_number, table_number, stake)
    VALUES ('TSTRM1', v_s[1], 3, 2, 'scorekeeper', 'playing', v_t, 1, 1, 5) RETURNING id INTO v_room;
  FOR i IN 1..3 LOOP
    INSERT INTO room_players (room_id, session_id, seat_index, is_ready) VALUES (v_room, v_s[i], i-1, true);
  END LOOP;
  INSERT INTO hands (room_id, hand_number, cards_per_player, trump_suit, starting_seat, current_seat, phase, deck_seed)
    VALUES (v_room, 1, 2, 'hearts', 0, 0, 'betting', 'x') RETURNING id INTO v_hand;
  UPDATE rooms SET current_hand_id = v_hand WHERE id = v_room;

  -- undo with no bets → error
  r := undo_last_bet_action(v_room, v_hand);
  ASSERT (r->>'ok')::bool = false AND r->>'error' = 'nothing_to_undo', 'undo empty: '||r;

  -- bet seat0, undo → seat0 to bet again
  r := place_bet_action(v_room, v_s[1], v_hand, 1);
  ASSERT (r->>'ok')::bool, 'bet0: '||r;
  r := undo_last_bet_action(v_room, v_hand);
  ASSERT (r->>'ok')::bool, 'undo0: '||r;
  ASSERT (SELECT current_seat FROM hands WHERE id = v_hand) = 0, 'seat back to 0';
  ASSERT (SELECT count(*) FROM hand_scores WHERE hand_id = v_hand) = 0, 'bet row deleted';

  -- all three bet → tricks_recording; undo last → back to betting at seat 2
  PERFORM place_bet_action(v_room, v_s[1], v_hand, 1);
  PERFORM place_bet_action(v_room, v_s[2], v_hand, 0);
  r := place_bet_action(v_room, v_s[3], v_hand, 0);
  ASSERT (SELECT phase FROM hands WHERE id = v_hand) = 'tricks_recording', 'phase tricks: '||r;
  r := undo_last_bet_action(v_room, v_hand);
  ASSERT (r->>'ok')::bool, 'undo in tricks_recording: '||r;
  ASSERT (SELECT phase FROM hands WHERE id = v_hand) = 'betting', 'phase back to betting';
  ASSERT (SELECT current_seat FROM hands WHERE id = v_hand) = 2, 'seat back to 2';
  PERFORM place_bet_action(v_room, v_s[3], v_hand, 0);

  -- record tricks 2/0/0 → scoring; balance zero-sum, stake 5
  PERFORM record_tricks_action(v_room, v_s[1], v_hand, 2);
  PERFORM record_tricks_action(v_room, v_s[2], v_hand, 0);
  PERFORM record_tricks_action(v_room, v_s[3], v_hand, 0);
  ASSERT (SELECT phase FROM hands WHERE id = v_hand) = 'scoring', 'scored';

  r := get_tournament_state('tsttst');
  ASSERT r IS NOT NULL, 'state by lowercase code';
  ASSERT r->'tournament' ? 'table_secret' = false, 'secret not exposed';
  ASSERT jsonb_array_length(r->'tables') = 1, 'one table';
  ASSERT (r->'tables'->0->'state'->'players'->0->>'is_proxy')::bool, 'proxy flag';
  ASSERT abs((SELECT sum((x->>'balance')::numeric) FROM jsonb_array_elements(r->'leaderboard') x)) < 0.0001, 'zero-sum';
  ASSERT (SELECT (x->>'balance')::numeric FROM jsonb_array_elements(r->'leaderboard') x
          WHERE x->>'participant_id' = v_p[1]::text) > 0, 'winner positive';

  -- undo after claims is refused
  r := undo_last_bet_action(v_room, v_hand);
  ASSERT (r->>'ok')::bool = false, 'no undo after scoring';

  -- cleanup_stale_rooms must not delete tournament rooms
  UPDATE rooms SET updated_at = now() - interval '3 days', created_at = now() - interval '3 days' WHERE id = v_room;
  UPDATE room_players SET last_seen_at = now() - interval '3 days' WHERE room_id = v_room;
  PERFORM cleanup_stale_rooms();
  ASSERT EXISTS (SELECT 1 FROM rooms WHERE id = v_room), 'tournament room survives cleanup';

  RAISE NOTICE 'offline_tournament: ALL OK';
END $$;
ROLLBACK;
```

- [ ] **Step 2: Run it to verify it fails**

The local stack must be running (`npx supabase status`). If it isn't, surface that as a blocker; don't start Docker unprompted on this machine.
Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/offline_tournament.sql`
Expected: FAIL, `relation "tournaments" does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20261017000000_offline_tournament.sql`:
```sql
-- Offline tournament mode: a tournament owns N scorekeeper rooms per tour,
-- seated with proxy room_sessions (no auth user). See
-- docs/superpowers/specs/2026-10-17-offline-tournament-design.md.

-- 1. Tables.
CREATE TABLE IF NOT EXISTS public.tournaments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  admin_session_id UUID REFERENCES public.room_sessions(id) ON DELETE SET NULL,
  max_cards        INT  NOT NULL CHECK (max_cards BETWEEN 1 AND 10),
  table_secret     TEXT NOT NULL,
  current_tour     INT  NOT NULL DEFAULT 0,
  version          BIGINT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tournament_participants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  no_stakes     BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (tournament_id, display_name)
);

-- Reads go through get_tournament_state (SECURITY DEFINER); no direct access,
-- so table_secret never leaves the server.
ALTER TABLE public.tournaments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_participants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournaments, public.tournament_participants FROM anon, authenticated;

-- 2. Rooms belong to a tournament tour/table.
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS tournament_id UUID REFERENCES public.tournaments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS tour_number   INT,
  ADD COLUMN IF NOT EXISTS table_number  INT,
  ADD COLUMN IF NOT EXISTS table_claimed BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS rooms_tournament_idx ON public.rooms (tournament_id, tour_number);

-- 3. Proxy sessions: no auth user; UNIQUE(auth_user_id) still holds (NULLs don't collide).
ALTER TABLE public.room_sessions ALTER COLUMN auth_user_id DROP NOT NULL;
ALTER TABLE public.room_sessions
  ADD COLUMN IF NOT EXISTS tournament_participant_id UUID
    REFERENCES public.tournament_participants(id) ON DELETE CASCADE;

-- 4. get_room_state: + tournament fields on room, + is_proxy on players.
--    Body copied from 20260531000000_host_freeze_game.sql; only the two marked lines differ.
CREATE OR REPLACE FUNCTION public.get_room_state(p_room_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH
  room AS (
    SELECT id, code, host_session_id, player_count, max_cards, min_cards_per_hand,
           mode, phase, current_hand_id, version, stake, stake_locked,
           paused_at, paused_lineup,
           tournament_id, tour_number, table_number, table_claimed          -- NEW
    FROM public.rooms WHERE id = p_room_id
  ),
  players AS (
    SELECT json_agg(jsonb_build_object(
      'session_id',   rp.session_id,
      'display_name', rs.display_name,
      'seat_index',   rp.seat_index,
      'is_ready',     rp.is_ready,
      'last_seen_at', rp.last_seen_at,
      'avatar',       au.raw_user_meta_data->>'avatar',
      'avatar_url',   au.raw_user_meta_data->>'avatar_url',
      'avatar_color', au.raw_user_meta_data->>'avatar_color',
      'opt_in_stake', rp.opt_in_stake,
      'is_guest',     COALESCE(au.is_anonymous, false),
      'is_proxy',     rs.tournament_participant_id IS NOT NULL,           -- NEW
      'participant_id', rs.tournament_participant_id                       -- NEW
    ) ORDER BY rp.seat_index) AS list
    FROM public.room_players rp
    JOIN public.room_sessions rs ON rs.id = rp.session_id
    LEFT JOIN auth.users au ON au.id = rs.auth_user_id
    WHERE rp.room_id = p_room_id
  ),
  -- >>> copy every remaining CTE (spectators, current_hand, hand_scores,
  -- current_trick, last_closed_trick, history, claims) and the final SELECT
  -- VERBATIM from 20260531000000_host_freeze_game.sql lines 130–218. <<<
$$;
ALTER FUNCTION public.get_room_state(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_room_state(uuid) TO anon, authenticated;

-- 5. get_tournament_state: public read model for the TV / recorder / admin.
CREATE OR REPLACE FUNCTION public.get_tournament_state(p_code text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH
  t AS (
    SELECT id, code, name, max_cards, current_tour, version, admin_session_id
    FROM public.tournaments WHERE code = upper(p_code)
  ),
  parts AS (
    SELECT json_agg(jsonb_build_object(
      'id', p.id, 'display_name', p.display_name, 'no_stakes', p.no_stakes
    ) ORDER BY p.display_name) AS list
    FROM public.tournament_participants p JOIN t ON p.tournament_id = t.id
  ),
  tour_tables AS (
    SELECT json_agg(jsonb_build_object(
      'table_number', r.table_number,
      'room_id',      r.id,
      'stake',        r.stake,
      'claimed',      r.table_claimed,
      'state',        public.get_room_state(r.id)
    ) ORDER BY r.table_number) AS list
    FROM public.rooms r JOIN t ON r.tournament_id = t.id AND r.tour_number = t.current_tour
  ),
  scored AS (
    SELECT hs.hand_id, rs.tournament_participant_id AS pid, hs.hand_score, r.stake
    FROM public.hand_scores hs
    JOIN public.hands h          ON h.id = hs.hand_id
    JOIN public.rooms r          ON r.id = h.room_id
    JOIN t                       ON r.tournament_id = t.id
    JOIN public.room_sessions rs ON rs.id = hs.session_id
    WHERE h.phase IN ('scoring', 'closed') AND rs.tournament_participant_id IS NOT NULL
  ),
  means AS (
    SELECT hand_id, avg(hand_score)::numeric AS mean FROM scored GROUP BY hand_id
  ),
  board AS (
    SELECT json_agg(jsonb_build_object(
      'participant_id', x.pid, 'balance', x.balance, 'total_points', x.pts
    ) ORDER BY x.balance DESC, x.pts DESC) AS list
    FROM (
      SELECT s.pid,
             sum((s.hand_score - m.mean) * s.stake) AS balance,
             sum(s.hand_score)                      AS pts
      FROM scored s JOIN means m USING (hand_id)
      GROUP BY s.pid
    ) x
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM t) THEN NULL ELSE jsonb_build_object(
    'tournament',   (SELECT to_jsonb(t.*) FROM t),
    'participants', COALESCE((SELECT list FROM parts), '[]'::json),
    'tables',       COALESCE((SELECT list FROM tour_tables), '[]'::json),
    'leaderboard',  COALESCE((SELECT list FROM board), '[]'::json)
  ) END;
$$;
ALTER FUNCTION public.get_tournament_state(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_tournament_state(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tournament_state(text) TO anon, authenticated, service_role;

-- 6. undo_last_bet_action: scorekeeper-only. Bets advance seat +1 (see
--    place_bet_action), so the last bidder is the seat before current_seat
--    while betting, or the seat before starting_seat once the hand moved to
--    tricks_recording (allowed only before any trick claim).
CREATE OR REPLACE FUNCTION public.undo_last_bet_action(p_room_id uuid, p_hand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_mode        TEXT;
  v_hand        RECORD;
  v_n           INT;
  v_bets        INT;
  v_seat        INT;
  v_session     UUID;
  v_new_version BIGINT;
  v_state       JSONB;
  v_err         TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_room_id::text));

  SELECT mode INTO v_mode FROM public.rooms WHERE id = p_room_id;
  SELECT * INTO v_hand FROM public.hands WHERE id = p_hand_id AND room_id = p_room_id FOR UPDATE;
  SELECT COUNT(*) INTO v_n FROM public.room_players WHERE room_id = p_room_id;
  SELECT COUNT(*) INTO v_bets FROM public.hand_scores WHERE hand_id = p_hand_id;

  IF v_mode IS DISTINCT FROM 'scorekeeper' OR v_hand.id IS NULL THEN
    v_err := 'cannot_undo';
  ELSIF v_hand.phase = 'betting' THEN
    IF v_bets = 0 THEN v_err := 'nothing_to_undo';
    ELSE v_seat := (v_hand.current_seat + v_n - 1) % v_n;
    END IF;
  ELSIF v_hand.phase = 'tricks_recording' THEN
    IF EXISTS (SELECT 1 FROM public.game_events WHERE hand_id = p_hand_id AND kind = 'claim_tricks') THEN
      v_err := 'cannot_undo';
    ELSE v_seat := (v_hand.starting_seat + v_n - 1) % v_n;
    END IF;
  ELSE
    v_err := 'cannot_undo';
  END IF;

  IF v_err IS NOT NULL THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', v_err,
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  SELECT session_id INTO v_session FROM public.room_players
   WHERE room_id = p_room_id AND seat_index = v_seat;
  DELETE FROM public.hand_scores WHERE hand_id = p_hand_id AND session_id = v_session;
  UPDATE public.hands SET current_seat = v_seat, phase = 'betting' WHERE id = p_hand_id;

  INSERT INTO public.game_events (room_id, hand_id, session_id, kind, payload)
  VALUES (p_room_id, p_hand_id, v_session, 'bet_undone', jsonb_build_object('seat', v_seat));

  UPDATE public.rooms SET version = version + 1, updated_at = now() WHERE id = p_room_id
    RETURNING version INTO v_new_version;

  SELECT public.get_room_state(p_room_id) INTO v_state;
  RETURN jsonb_build_object('ok', true, 'state', v_state, 'version', v_new_version);
END;
$$;
ALTER FUNCTION public.undo_last_bet_action(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.undo_last_bet_action(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.undo_last_bet_action(uuid, uuid) TO service_role;

-- 7. cleanup_stale_rooms: keep tournament history (balance is derived from it).
--    Body copied from the baseline with one added WHERE.
CREATE OR REPLACE FUNCTION public.cleanup_stale_rooms() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_deleted INT;
BEGIN
  WITH stale AS (
    SELECT r.id
      FROM public.rooms r
      LEFT JOIN public.room_players     rp  ON rp.room_id  = r.id
      LEFT JOIN public.room_spectators  rsp ON rsp.room_id = r.id
     WHERE r.tournament_id IS NULL
     GROUP BY r.id, r.created_at, r.updated_at
    HAVING GREATEST(
             COALESCE(MAX(rp.last_seen_at),  'epoch'::timestamptz),
             COALESCE(MAX(rsp.last_seen_at), 'epoch'::timestamptz),
             r.updated_at,
             r.created_at
           ) < now() - INTERVAL '24 hours'
  )
  DELETE FROM public.rooms
   WHERE id IN (SELECT id FROM stale);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE LOG '[cleanup_stale_rooms] deleted % stale room(s)', v_deleted;
  RETURN v_deleted;
END;
$$;
```

Note on section 4: the implementer must paste the full remaining body of `get_room_state` from `supabase/migrations/20260531000000_host_freeze_game.sql` (the CTEs from `spectators AS (` through the final `SELECT jsonb_build_object(...)`). Do not leave the marker comment in the file. Verify with `grep -c "claim_sessions" supabase/migrations/20261017000000_offline_tournament.sql` → `1`.

`rooms.updated_at` exists (the baseline's `heartbeat` already does `UPDATE public.rooms SET ... updated_at = now()`).

- [ ] **Step 4: Apply locally and run the test**

Run: `npx supabase migration up` and then the same `psql ... -f supabase/tests/offline_tournament.sql`.
Expected: `NOTICE: offline_tournament: ALL OK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261017000000_offline_tournament.sql supabase/tests/offline_tournament.sql
git commit -m "feat(tournament): schema, proxy sessions, tournament state + undo-bet RPCs"
```

---

### Task 3: Shared types + on-behalf actor resolution

**Files:**
- Modify: `supabase/functions/_shared/types.ts` (Action union, RoomSnapshot.room, players)
- Create: `supabase/functions/game-action/onBehalf.ts`
- Test: `supabase/functions/_shared/__tests__/tournament.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts additions
  | { kind: 'place_bet';     room_id: string; hand_id: string; bet: number;    on_behalf_of_seat?: number }
  | { kind: 'record_tricks'; room_id: string; hand_id: string; tricks: number; on_behalf_of_seat?: number }
  | { kind: 'undo_bet'; room_id: string; hand_id: string }
  | { kind: 'tournament_create'; name: string; participants: Array<{ display_name: string; no_stakes: boolean }>; max_cards: number }
  | { kind: 'tournament_update_participants'; tournament_id: string; secret: string; participants: Array<{ display_name: string; no_stakes: boolean }> }
  | { kind: 'tournament_set_max_cards'; tournament_id: string; secret: string; max_cards: number }
  | { kind: 'tournament_start_tour'; tournament_id: string; secret: string; tables: Array<{ seats: string[]; stake: number }>; force?: boolean }  // force: start while a slow table is still finishing
  | { kind: 'tournament_claim_table'; code: string; table_number: number; secret: string }
  // RoomSnapshot.room: tournament_id?: string | null; tour_number?: number | null; table_number?: number | null; table_claimed?: boolean;
  // players[]: is_proxy?: boolean; participant_id?: string | null;

  // onBehalf.ts
  export function canActForTable(
    room: { tournament_id: string | null; host_session_id: string },
    tournamentAdminSessionId: string | null,
    actorSessionId: string,
  ): boolean;
  export async function resolveOnBehalfActor(
    svc: SupabaseClient, actor: ActorContext, room_id: string, seat: number,
  ): Promise<{ ok: true; actor: ActorContext } | { ok: false; error: 'not_tournament' | 'not_recorder' | 'no_such_seat' }>;
  ```

- [ ] **Step 1: Write the failing deno test**

`supabase/functions/_shared/__tests__/tournament.test.ts`:
```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { canActForTable } from '../../game-action/onBehalf.ts';
import { computeBalance, validateSeating } from '../engine/tournament.ts';

Deno.test('canActForTable: host of a tournament room may act', () => {
  assertEquals(canActForTable({ tournament_id: 't', host_session_id: 'h' }, 'a', 'h'), true);
});
Deno.test('canActForTable: tournament admin may act', () => {
  assertEquals(canActForTable({ tournament_id: 't', host_session_id: 'h' }, 'a', 'a'), true);
});
Deno.test('canActForTable: stranger may not act', () => {
  assertEquals(canActForTable({ tournament_id: 't', host_session_id: 'h' }, 'a', 'x'), false);
});
Deno.test('canActForTable: never outside a tournament room', () => {
  assertEquals(canActForTable({ tournament_id: null, host_session_id: 'h' }, null, 'h'), false);
});
Deno.test('engine runs under deno (shared with jest)', () => {
  assertEquals(validateSeating([['a', 'b']], [{ id: 'a', no_stakes: false }, { id: 'b', no_stakes: false }], [0]), null);
  assertEquals(computeBalance([]), {});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `deno test supabase/functions/_shared/__tests__/tournament.test.ts`
Expected: FAIL, module `onBehalf.ts` not found.

- [ ] **Step 3: Implement**

Edit `supabase/functions/_shared/types.ts`: add the action variants and snapshot fields exactly as listed in Interfaces. Add `'undo_bet'` to the `ActionKind` union.

`supabase/functions/game-action/onBehalf.ts`:
```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext } from '../_shared/types.ts';

/**
 * Offline tournament: the table's recorder (room host) or the tournament
 * admin enters bets/tricks for proxy seats. Only ever inside a tournament
 * room — regular rooms keep strict one-session-one-seat semantics.
 */
export function canActForTable(
  room: { tournament_id: string | null; host_session_id: string },
  tournamentAdminSessionId: string | null,
  actorSessionId: string,
): boolean {
  if (!room.tournament_id) return false;
  return room.host_session_id === actorSessionId || tournamentAdminSessionId === actorSessionId;
}

export async function resolveOnBehalfActor(
  svc: SupabaseClient,
  actor: ActorContext,
  room_id: string,
  seat: number,
): Promise<{ ok: true; actor: ActorContext } | { ok: false; error: 'not_tournament' | 'not_recorder' | 'no_such_seat' }> {
  const { data: room } = await svc.from('rooms')
    .select('tournament_id, host_session_id').eq('id', room_id).maybeSingle();
  if (!room?.tournament_id) return { ok: false, error: 'not_tournament' };

  const { data: t } = await svc.from('tournaments')
    .select('admin_session_id').eq('id', room.tournament_id).maybeSingle();
  if (!canActForTable(room, t?.admin_session_id ?? null, actor.session_id)) {
    return { ok: false, error: 'not_recorder' };
  }

  const { data: rp } = await svc.from('room_players')
    .select('session_id, room_sessions!inner(display_name)')
    .eq('room_id', room_id).eq('seat_index', seat).maybeSingle();
  if (!rp) return { ok: false, error: 'no_such_seat' };

  return {
    ok: true,
    actor: {
      auth_user_id: actor.auth_user_id,
      session_id: rp.session_id as string,
      display_name: (rp as any).room_sessions?.display_name ?? 'proxy',
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `deno test supabase/functions/_shared/__tests__/tournament.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/types.ts supabase/functions/game-action/onBehalf.ts supabase/functions/_shared/__tests__/tournament.test.ts
git commit -m "feat(tournament): action types + on-behalf actor resolution"
```

---

### Task 4: Tournament edge actions + dispatcher gates

**Files:**
- Create: `supabase/functions/game-action/actions/tournament.ts`
- Create: `supabase/functions/game-action/actions/undoBet.ts`
- Modify: `supabase/functions/game-action/actions/createRoom.ts` (export `generateCode`)
- Modify: `supabase/functions/game-action/broadcast.ts`
- Modify: `supabase/functions/game-action/actions/continueHand.ts` (settlement guard)
- Modify: `supabase/functions/game-action/index.ts`
- Test: `supabase/functions/_shared/__tests__/tournament.test.ts` (append)

**Interfaces:**
- Consumes: `validateSeating`, `MAX_TABLE`, `STAKE_CHIPS` (Task 1), `resolveOnBehalfActor` (Task 3), `startGame` (existing), `undo_last_bet_action` (Task 2).
- Produces:
  ```ts
  export function isTournamentAdmin(t: { admin_session_id: string | null; table_secret: string }, actorSessionId: string, secret?: string): boolean;
  export function shouldNotify(room: { tournament_id?: string | null } | null | undefined): boolean; // false for tournament rooms
  // tournament_create → { ok: true, tournament_id, code, secret }
  // tournament_update_participants / tournament_set_max_cards → { ok: true }
  // tournament_start_tour → { ok: true, tour_number, rooms: Array<{ table_number, room_id }> }
  // tournament_claim_table → { ok: true, room_id }  (+ room snapshot applied by gameClient)
  // errors: { ok: false, error: 'not_admin' | 'bad_secret' | 'unknown_tournament' | SeatingError | 'bad_stake' | 'tour_in_progress' | 'no_such_table' | 'invalid_participants' }
  // broadcast: channel `tournament:${id}`, event 'tournament_changed', payload { version }
  ```

- [ ] **Step 1: Write failing tests for the pure gates**

Append to `supabase/functions/_shared/__tests__/tournament.test.ts`:
```ts
import { isTournamentAdmin, shouldNotify } from '../../game-action/actions/tournament.ts';

Deno.test('isTournamentAdmin: by session', () => {
  assertEquals(isTournamentAdmin({ admin_session_id: 's', table_secret: 'k' }, 's'), true);
});
Deno.test('isTournamentAdmin: by secret when session lost', () => {
  assertEquals(isTournamentAdmin({ admin_session_id: null, table_secret: 'k' }, 'x', 'k'), true);
});
Deno.test('isTournamentAdmin: wrong secret', () => {
  assertEquals(isTournamentAdmin({ admin_session_id: 's', table_secret: 'k' }, 'x', 'nope'), false);
});
Deno.test('shouldNotify: tournament rooms never notify', () => {
  assertEquals(shouldNotify({ tournament_id: 't' }), false);
  assertEquals(shouldNotify({ tournament_id: null }), true);
  assertEquals(shouldNotify(null), true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test supabase/functions/_shared/__tests__/tournament.test.ts`
Expected: FAIL, module `actions/tournament.ts` not found.

- [ ] **Step 3: Implement**

`createRoom.ts`: change `function generateCode()` to `export function generateCode()`.

`broadcast.ts`, append:
```ts
/** Tournament-level change (new tour, participants). TV refetches on it. */
export async function broadcastTournamentChanged(
  svc: SupabaseClient,
  tournament_id: string,
  version: number,
): Promise<void> {
  const channel = svc.channel(`tournament:${tournament_id}`);
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
    });
  });
  await channel.send({ type: 'broadcast', event: 'tournament_changed', payload: { version } });
  await channel.unsubscribe();
}
```

`actions/tournament.ts`:
```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action } from '../../_shared/types.ts';
import { validateSeating, STAKE_CHIPS, MAX_TABLE } from '../../_shared/engine/tournament.ts';
import { generateCode } from './createRoom.ts';
import { startGame } from './startGame.ts';
import { buildSnapshot } from '../snapshot.ts';
import { broadcastTournamentChanged } from '../broadcast.ts';

type R = Record<string, unknown> & { ok: boolean; error?: string };

export function isTournamentAdmin(
  t: { admin_session_id: string | null; table_secret: string },
  actorSessionId: string,
  secret?: string,
): boolean {
  return t.admin_session_id === actorSessionId || (!!secret && secret === t.table_secret);
}

/** Tournament rooms never reach Telegram or Web Push (spec: Notifications). */
export function shouldNotify(room: { tournament_id?: string | null } | null | undefined): boolean {
  return !room?.tournament_id;
}

function cleanParticipants(list: Array<{ display_name: string; no_stakes: boolean }>) {
  const out = list
    .map((p) => ({ display_name: (p.display_name ?? '').trim().slice(0, 24), no_stakes: !!p.no_stakes }))
    .filter((p) => p.display_name.length > 0);
  const names = new Set(out.map((p) => p.display_name.toLowerCase()));
  if (out.length < 2 || names.size !== out.length || out.length > MAX_TABLE * 6) return null;
  return out;
}

async function loadTournament(svc: SupabaseClient, id: string) {
  const { data } = await svc.from('tournaments')
    .select('id, code, admin_session_id, table_secret, max_cards, current_tour, version')
    .eq('id', id).maybeSingle();
  return data as null | {
    id: string; code: string; admin_session_id: string | null; table_secret: string;
    max_cards: number; current_tour: number; version: number;
  };
}

async function bump(svc: SupabaseClient, t: { id: string; version: number }, patch: Record<string, unknown> = {}) {
  const version = t.version + 1;
  await svc.from('tournaments').update({ ...patch, version }).eq('id', t.id);
  void broadcastTournamentChanged(svc, t.id, version).catch((e) =>
    console.error('[tournament] broadcast failed:', e));
}

export async function tournamentCreate(
  svc: SupabaseClient, actor: ActorContext,
  action: Extract<Action, { kind: 'tournament_create' }>,
): Promise<R> {
  const participants = cleanParticipants(action.participants);
  if (!participants) return { ok: false, error: 'invalid_participants' };
  const max_cards = Math.max(1, Math.min(10, Math.floor(action.max_cards || 10)));
  const secret = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

  let row: { id: string; code: string } | null = null;
  for (let attempt = 0; attempt < 5 && !row; attempt++) {
    const { data, error } = await svc.from('tournaments').insert({
      code: generateCode(), name: (action.name ?? '').trim().slice(0, 40) || 'Tournament',
      admin_session_id: actor.session_id, max_cards, table_secret: secret,
    }).select('id, code').single();
    if (!error) row = data as any;
    else if ((error as any).code !== '23505') throw error;
  }
  if (!row) throw new Error('could_not_allocate_code');

  const { error: pErr } = await svc.from('tournament_participants')
    .insert(participants.map((p) => ({ ...p, tournament_id: row!.id })));
  if (pErr) throw pErr;

  return { ok: true, tournament_id: row.id, code: row.code, secret };
}

export async function tournamentUpdateParticipants(
  svc: SupabaseClient, actor: ActorContext,
  action: Extract<Action, { kind: 'tournament_update_participants' }>,
): Promise<R> {
  const t = await loadTournament(svc, action.tournament_id);
  if (!t) return { ok: false, error: 'unknown_tournament' };
  if (!isTournamentAdmin(t, actor.session_id, action.secret)) return { ok: false, error: 'not_admin' };
  const participants = cleanParticipants(action.participants);
  if (!participants) return { ok: false, error: 'invalid_participants' };

  // Upsert by name: existing participants keep their id (and their balance history).
  const { data: existing } = await svc.from('tournament_participants')
    .select('id, display_name').eq('tournament_id', t.id);
  const byName = new Map((existing ?? []).map((p: any) => [p.display_name.toLowerCase(), p.id]));
  for (const p of participants) {
    const id = byName.get(p.display_name.toLowerCase());
    if (id) await svc.from('tournament_participants').update({ no_stakes: p.no_stakes, display_name: p.display_name }).eq('id', id);
    else await svc.from('tournament_participants').insert({ ...p, tournament_id: t.id });
  }
  // Removing someone who already played would erase their history; only drop never-seated ones.
  const keep = new Set(participants.map((p) => p.display_name.toLowerCase()));
  for (const p of existing ?? []) {
    if (keep.has((p as any).display_name.toLowerCase())) continue;
    const { count } = await svc.from('room_sessions')
      .select('id', { count: 'exact', head: true }).eq('tournament_participant_id', (p as any).id);
    if ((count ?? 0) === 0) await svc.from('tournament_participants').delete().eq('id', (p as any).id);
  }
  await bump(svc, t);
  return { ok: true };
}

export async function tournamentSetMaxCards(
  svc: SupabaseClient, actor: ActorContext,
  action: Extract<Action, { kind: 'tournament_set_max_cards' }>,
): Promise<R> {
  const t = await loadTournament(svc, action.tournament_id);
  if (!t) return { ok: false, error: 'unknown_tournament' };
  if (!isTournamentAdmin(t, actor.session_id, action.secret)) return { ok: false, error: 'not_admin' };
  const max_cards = Math.max(1, Math.min(10, Math.floor(action.max_cards)));
  await bump(svc, t, { max_cards });
  return { ok: true };
}

export async function tournamentStartTour(
  svc: SupabaseClient, actor: ActorContext,
  action: Extract<Action, { kind: 'tournament_start_tour' }>,
): Promise<R> {
  const t = await loadTournament(svc, action.tournament_id);
  if (!t) return { ok: false, error: 'unknown_tournament' };
  if (!isTournamentAdmin(t, actor.session_id, action.secret)) return { ok: false, error: 'not_admin' };

  const stakes = action.tables.map((x) => x.stake);
  if (stakes.some((s) => !(STAKE_CHIPS as readonly number[]).includes(s))) return { ok: false, error: 'bad_stake' };

  const { data: parts } = await svc.from('tournament_participants')
    .select('id, display_name, no_stakes').eq('tournament_id', t.id);
  const seating = action.tables.map((x) => x.seats);
  const err = validateSeating(seating, (parts ?? []) as any, stakes);
  if (err) return { ok: false, error: err };

  // Refuse to start over an unfinished tour (double-tap / two admins).
  if (t.current_tour > 0) {
    const { count } = await svc.from('rooms').select('id', { count: 'exact', head: true })
      .eq('tournament_id', t.id).eq('tour_number', t.current_tour).neq('phase', 'finished');
    if ((count ?? 0) > 0 && !action.force) return { ok: false, error: 'tour_in_progress' };
  }

  const tour = t.current_tour + 1;
  const nameById = new Map((parts ?? []).map((p: any) => [p.id, p.display_name]));
  const rooms: Array<{ table_number: number; room_id: string }> = [];

  for (let i = 0; i < seating.length; i++) {
    const seats = seating[i];
    const { data: sessions, error: sErr } = await svc.from('room_sessions')
      .insert(seats.map((pid) => ({ display_name: nameById.get(pid), tournament_participant_id: pid })))
      .select('id, tournament_participant_id');
    if (sErr) throw sErr;
    const sessionByPid = new Map((sessions ?? []).map((s: any) => [s.tournament_participant_id, s.id]));

    let room: { id: string } | null = null;
    for (let attempt = 0; attempt < 5 && !room; attempt++) {
      const { data, error } = await svc.from('rooms').insert({
        code: generateCode(), host_session_id: actor.session_id,
        player_count: seats.length, max_cards: t.max_cards, mode: 'scorekeeper', phase: 'waiting',
        tournament_id: t.id, tour_number: tour, table_number: i + 1, stake: stakes[i],
      }).select('id').single();
      if (!error) room = data as any;
      else if ((error as any).code !== '23505') throw error;
    }
    if (!room) throw new Error('could_not_allocate_code');

    const { error: rpErr } = await svc.from('room_players').insert(
      seats.map((pid, seat) => ({ room_id: room!.id, session_id: sessionByPid.get(pid), seat_index: seat, is_ready: true })));
    if (rpErr) throw rpErr;

    const started = await startGame(svc, actor, { kind: 'start_game', room_id: room.id });
    if (!started.ok) throw new Error(`start_game_failed:${started.error}`);
    rooms.push({ table_number: i + 1, room_id: room.id });
  }

  await bump(svc, t, { current_tour: tour });
  return { ok: true, tour_number: tour, rooms };
}

export async function tournamentClaimTable(
  svc: SupabaseClient, actor: ActorContext,
  action: Extract<Action, { kind: 'tournament_claim_table' }>,
): Promise<R> {
  const { data: t } = await svc.from('tournaments')
    .select('id, table_secret, current_tour, version').eq('code', action.code.toUpperCase()).maybeSingle();
  if (!t) return { ok: false, error: 'unknown_tournament' };
  if (action.secret !== t.table_secret) return { ok: false, error: 'bad_secret' };

  const { data: room } = await svc.from('rooms').select('id, version, host_session_id')
    .eq('tournament_id', t.id).eq('tour_number', t.current_tour).eq('table_number', action.table_number)
    .maybeSingle();
  if (!room) return { ok: false, error: 'no_such_table' };

  // Idempotent for the current host; a second phone takes over (dead-phone recovery).
  if (room.host_session_id !== actor.session_id) {
    await svc.from('rooms').update({
      host_session_id: actor.session_id, table_claimed: true, version: room.version + 1,
    }).eq('id', room.id);
  } else {
    await svc.from('rooms').update({ table_claimed: true }).eq('id', room.id);
  }
  const state = await buildSnapshot(svc, room.id, actor.session_id);
  return { ok: true, room_id: room.id, state, version: state.room?.version ?? 0 };
}
```

`actions/undoBet.ts`:
```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ActorContext, Action, ActionResult, RoomSnapshot } from '../../_shared/types.ts';
import { buildSnapshot } from '../snapshot.ts';
import { canActForTable } from '../onBehalf.ts';

export async function undoBet(
  svc: SupabaseClient,
  actor: ActorContext,
  action: Extract<Action, { kind: 'undo_bet' }>,
): Promise<ActionResult> {
  const { data: room } = await svc.from('rooms')
    .select('tournament_id, host_session_id').eq('id', action.room_id).maybeSingle();
  const { data: t } = room?.tournament_id
    ? await svc.from('tournaments').select('admin_session_id').eq('id', room.tournament_id).maybeSingle()
    : { data: null };
  if (!room || !canActForTable(room, t?.admin_session_id ?? null, actor.session_id)) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id);
    return { ok: false, error: 'not_recorder', state: s, version: s.room?.version ?? 0 };
  }
  const { data, error } = await svc.rpc('undo_last_bet_action', {
    p_room_id: action.room_id, p_hand_id: action.hand_id,
  });
  if (error) {
    const s = await buildSnapshot(svc, action.room_id, actor.session_id).catch(() => ({} as RoomSnapshot));
    return { ok: false, error: 'rpc_failed', state: s, version: s.room?.version ?? 0 };
  }
  const result = data as ActionResult;
  result.state = await buildSnapshot(svc, action.room_id, actor.session_id);
  return result;
}
```

`continueHand.ts`: in the settlement block change the stake read to also fetch `tournament_id`, and skip when it's set:
```ts
      const { data: roomRow } = await svc
        .from('rooms')
        .select('stake, tournament_id')
        .eq('id', action.room_id)
        .maybeSingle();
      // Tournament stakes are symbolic and tournament-scoped (derived in
      // get_tournament_state) — never touch account rating.
      const stake = roomRow?.tournament_id ? 0 : (roomRow?.stake ?? 0);
```

`index.ts`:
1. Imports: `tournamentCreate, tournamentUpdateParticipants, tournamentSetMaxCards, tournamentStartTour, tournamentClaimTable, shouldNotify` from `./actions/tournament.ts`, `undoBet` from `./actions/undoBet.ts`, `resolveOnBehalfActor` from `./onBehalf.ts`.
2. Add `'undo_bet'` to `GAMEPLAY_WHILE_PAUSED_BLOCKED`.
3. Right after the admin branch, add a tournament branch (no room pipeline, no push):
```ts
  // Tournament management — no room snapshot/push pipeline. Rooms created by
  // start_tour are broadcast by their own state; never notified (spec).
  if (action.kind.startsWith('tournament_')) {
    try {
      let r: Record<string, unknown>;
      switch (action.kind) {
        case 'tournament_create':              r = await tournamentCreate(svc, actor, action); break;
        case 'tournament_update_participants': r = await tournamentUpdateParticipants(svc, actor, action); break;
        case 'tournament_set_max_cards':       r = await tournamentSetMaxCards(svc, actor, action); break;
        case 'tournament_start_tour':          r = await tournamentStartTour(svc, actor, action); break;
        case 'tournament_claim_table':         r = await tournamentClaimTable(svc, actor, action); break;
        default: return respond({ ok: false, error: 'unknown_action' }, 400);
      }
      if (r.ok && typeof r.room_id === 'string') {
        void broadcastStateChanged(svc, r.room_id, (r.version as number) ?? 0).catch(() => {});
      }
      return respond({ ...r, me_session_id: actor.session_id });
    } catch (err) {
      console.error('[game-action] tournament handler threw:', err);
      return respond({ ok: false, error: 'internal_error' }, 500);
    }
  }
```
4. After the pause gate, reject timeouts in tournament rooms and resolve on-behalf actors:
```ts
  const isTournamentRoom = !shouldNotify(prev?.room);
  if (isTournamentRoom && action.kind === 'request_timeout') {
    return respond({ ok: false, error: 'not_applicable', state: prev, version: prev?.room?.version ?? 0 });
  }

  // Tournament recorder acting for a proxy seat. The real actor stays in
  // me_session_id; only the handler sees the proxy.
  let handlerActor = actor;
  if ((action.kind === 'place_bet' || action.kind === 'record_tricks')
      && typeof action.on_behalf_of_seat === 'number') {
    const r = await resolveOnBehalfActor(svc, actor, action.room_id, action.on_behalf_of_seat);
    if (!r.ok) {
      return respond({ ok: false, error: r.error, state: prev, version: prev?.room?.version ?? 0,
                       me_session_id: actor.session_id });
    }
    handlerActor = r.actor;
  }
```
   In the switch, pass `handlerActor` to `placeBet` and `recordTricks`, and add `case 'undo_bet': result = await undoBet(svc, actor, action); break;`.
   `placeBet` / `recordTricks` rebuild the snapshot with `actor.session_id`; with a proxy actor that's still the full public state (proxies have no hand), so no change is needed there.
5. Push step: wrap it in `if (result.ok && !isTournamentRoom) { ... }`.

`prev` is fetched only when `room_id` is set and the kind isn't create/join, which holds for all gated kinds. If `prev` failed to load, `isTournamentRoom` is false. For the push gate that's fail-open, which is acceptable: proxies have no push subscriptions and the recorder isn't a seated player.

- [ ] **Step 4: Run tests + typecheck + local serve smoke**

Run: `deno test supabase/functions/_shared/__tests__/ && npx tsc --noEmit`
Expected: PASS; tsc clean.

Then with the local stack: `npx supabase functions serve game-action` (background; kill it right after) and run this script. It creates a tournament with 4 people, starts tour 1 with one table, bets for seat `current_seat` four times, checks `undo_bet`, and records tricks:

`scripts/tournament-api-check.ts` (scratch file; **don't commit**, keep it in the session scratchpad):
```ts
// usage: npx tsx <path>/tournament-api-check.ts  (reads EXPO_PUBLIC_* from .env.local)
import { createClient } from '@supabase/supabase-js';
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL!, KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const sb = createClient(URL, KEY);
const { data: auth } = await sb.auth.signInAnonymously();
const call = async (action: any) => (await fetch(`${URL}/functions/v1/game-action`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY,
  Authorization: `Bearer ${auth.session!.access_token}` }, body: JSON.stringify({ action }) })).json();
const c = await call({ kind: 'tournament_create', name: 'T', max_cards: 2,
  participants: ['A','B','C','D'].map((n) => ({ display_name: n, no_stakes: false })) });
console.assert(c.ok, c);
const st = (await sb.rpc('get_tournament_state', { p_code: c.code })).data;
const ids = st.participants.map((p: any) => p.id);
const s = await call({ kind: 'tournament_start_tour', tournament_id: c.tournament_id, secret: c.secret,
  tables: [{ seats: ids, stake: 5 }] });
console.assert(s.ok, s);
const claim = await call({ kind: 'tournament_claim_table', code: c.code, table_number: 1, secret: c.secret });
console.assert(claim.ok, claim);
let snap = claim.state;
for (let i = 0; i < 4; i++) {
  const h = snap.current_hand;
  const r = await call({ kind: 'place_bet', room_id: claim.room_id, hand_id: h.id,
    bet: i < 3 ? 0 : 1, on_behalf_of_seat: h.current_seat });
  console.assert(r.ok, 'bet', i, r); snap = r.state;
}
const u = await call({ kind: 'undo_bet', room_id: claim.room_id, hand_id: snap.current_hand.id });
console.assert(u.ok && u.state.current_hand.phase === 'betting', 'undo', u);
const last = await call({ kind: 'place_bet', room_id: claim.room_id, hand_id: u.state.current_hand.id,
  bet: 1, on_behalf_of_seat: u.state.current_hand.current_seat });
for (const [seat, tricks] of [[0, 2], [1, 0], [2, 0], [3, 0]]) {
  const r = await call({ kind: 'record_tricks', room_id: claim.room_id, hand_id: last.state.current_hand.id,
    tricks, on_behalf_of_seat: seat });
  console.assert(r.ok, 'tricks', seat, r);
}
const bad = await call({ kind: 'request_timeout', room_id: claim.room_id, hand_id: last.state.current_hand.id, expected_seat: 0 });
console.assert(bad.error === 'not_applicable', 'timeout rejected', bad);
const fin = (await sb.rpc('get_tournament_state', { p_code: c.code })).data;
console.log(JSON.stringify(fin.leaderboard));
```
Expected: no assertion output. The leaderboard has 4 rows summing to ~0.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/game-action supabase/functions/_shared
git commit -m "feat(tournament): edge actions, on-behalf bets/tricks, undo, no-notify + no-timeout gates"
```

---

### Task 5: Client API + tournament state hook

**Files:**
- Modify: `src/lib/gameClient.ts`
- Create: `src/lib/tournament/types.ts`
- Create: `src/lib/tournament/useTournamentState.ts`
- Test: `src/lib/tournament/__tests__/tournamentView.test.ts`
- Create: `src/lib/tournament/view.ts`

**Interfaces:**
- Consumes: Task 4 action shapes; `get_tournament_state` shape (Task 2).
- Produces:
  ```ts
  // types.ts
  export interface TournamentParticipant { id: string; display_name: string; no_stakes: boolean }
  export interface TournamentTable { table_number: number; room_id: string; stake: number; claimed: boolean; state: RoomSnapshot }
  export interface LeaderRow { participant_id: string; balance: number; total_points: number }
  export interface TournamentState {
    tournament: { id: string; code: string; name: string; max_cards: number; current_tour: number; version: number; admin_session_id: string | null };
    participants: TournamentParticipant[]; tables: TournamentTable[]; leaderboard: LeaderRow[];
  }
  // view.ts
  export interface TablePlayerRow { seat: number; participant_id: string | null; name: string;
    bet: number | null; taken: number | null; hand_score: number | null; total: number; isDealer: boolean; isTurn: boolean }
  export function tableRows(state: RoomSnapshot): TablePlayerRow[];
  export function fullLeaderboard(ts: TournamentState): Array<LeaderRow & { name: string; no_stakes: boolean }>;
  export function formatBalance(n: number): string;   // "+12.5", "−3", "0"
  // useTournamentState.ts
  export function useTournamentState(code: string | undefined): { data: TournamentState | null; loading: boolean; error: string | null; refetch: () => Promise<void> };
  // gameClient additions
  tournamentCreate(name, participants, max_cards) → Promise<{ ok; tournament_id?; code?; secret?; error? }>
  tournamentUpdateParticipants(tournament_id, secret, participants)
  tournamentSetMaxCards(tournament_id, secret, max_cards)
  tournamentStartTour(tournament_id, secret, tables, force?)
  tournamentClaimTable(code, table_number, secret)
  getTournamentState(code) → Promise<TournamentState | null>
  placeBetFor(room_id, hand_id, seat, bet), recordTricksFor(room_id, hand_id, seat, tricks), undoBet(room_id, hand_id)
  ```

- [ ] **Step 1: Write the failing test for view helpers**

`src/lib/tournament/__tests__/tournamentView.test.ts`:
```ts
import { tableRows, fullLeaderboard, formatBalance } from '../view';

const snap: any = {
  room: { id: 'r', max_cards: 2 },
  players: [
    { session_id: 's0', display_name: 'A', seat_index: 0, participant_id: 'a' },
    { session_id: 's1', display_name: 'B', seat_index: 1, participant_id: 'b' },
    { session_id: 's2', display_name: 'C', seat_index: 2, participant_id: 'c' },
  ],
  current_hand: { id: 'h2', hand_number: 2, cards_per_player: 1, starting_seat: 1, current_seat: 2, phase: 'betting' },
  hand_scores: [{ hand_id: 'h2', session_id: 's1', bet: 1, taken_tricks: 0, hand_score: 0 }],
  score_history: [{ hand_number: 1, scores: [
    { session_id: 's0', hand_score: 12 }, { session_id: 's1', hand_score: 1 }, { session_id: 's2', hand_score: 0 }] }],
};

describe('tableRows', () => {
  it('marks dealer and turn, carries bets and totals', () => {
    const rows = tableRows(snap);
    expect(rows.map((r) => r.name)).toEqual(['A', 'B', 'C']);
    expect(rows[2].isTurn).toBe(true);
    expect(rows[2].isDealer).toBe(true);          // dealer = (starting_seat + 1) % n
    expect(rows[1].bet).toBe(1);
    expect(rows[0].bet).toBeNull();
    expect(rows[0].total).toBe(12);
    expect(rows[1].hand_score).toBeNull();          // not scored yet while betting
  });
  it('adds the current hand to totals once it is scored', () => {
    const s = { ...snap, current_hand: { ...snap.current_hand, phase: 'scoring' },
      hand_scores: [{ hand_id: 'h2', session_id: 's0', bet: 0, taken_tricks: 0, hand_score: 10 }] };
    expect(tableRows(s)[0].total).toBe(22);
    expect(tableRows(s).every((r) => !r.isTurn)).toBe(true);
  });
});

describe('fullLeaderboard', () => {
  it('includes participants with no hands yet at zero, sorted by balance', () => {
    const rows = fullLeaderboard({
      tournament: {} as any, tables: [],
      participants: [{ id: 'a', display_name: 'A', no_stakes: false }, { id: 'z', display_name: 'Z', no_stakes: true }],
      leaderboard: [{ participant_id: 'a', balance: -3, total_points: 5 }],
    });
    expect(rows.map((r) => r.name)).toEqual(['Z', 'A']);
    expect(rows[0].balance).toBe(0);
  });
});

describe('formatBalance', () => {
  it('signs and rounds to 1 decimal', () => {
    expect(formatBalance(12.46)).toBe('+12.5');
    expect(formatBalance(-3)).toBe('−3');
    expect(formatBalance(0.04)).toBe('0');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/lib/tournament --no-coverage`
Expected: FAIL, "Cannot find module '../view'".

- [ ] **Step 3: Implement**

`src/lib/tournament/types.ts`: the interfaces from Interfaces, importing `RoomSnapshot` from `'../../../supabase/functions/_shared/types.ts'` (same path style as `roomStore.ts`).

`src/lib/tournament/view.ts`:
```ts
import type { RoomSnapshot } from '../../../supabase/functions/_shared/types.ts';
import { getDealerSeat } from '../offline/handBriefing';
import type { TournamentState, LeaderRow } from './types';

export interface TablePlayerRow {
  seat: number; participant_id: string | null; name: string;
  bet: number | null; taken: number | null; hand_score: number | null;
  total: number; isDealer: boolean; isTurn: boolean;
}

export function tableRows(state: RoomSnapshot): TablePlayerRow[] {
  const hand = state.current_hand;
  const n = state.players.length;
  const scored = hand?.phase === 'scoring' || hand?.phase === 'closed';
  const bySession = new Map(state.hand_scores.map((s) => [s.session_id, s]));
  const totals = new Map<string, number>();
  for (const h of state.score_history ?? []) {
    for (const s of (h as any).scores ?? []) {
      totals.set(s.session_id, (totals.get(s.session_id) ?? 0) + (s.hand_score ?? 0));
    }
  }
  return [...state.players].sort((a, b) => a.seat_index - b.seat_index).map((p) => {
    const hs = bySession.get(p.session_id);
    const recorded = hand?.phase === 'tricks_recording'
      && ((state as any).claim_sessions ?? []).includes(p.session_id);
    return {
      seat: p.seat_index,
      participant_id: (p as any).participant_id ?? null,
      name: p.display_name,
      bet: hs ? hs.bet : null,
      taken: scored || recorded ? (hs?.taken_tricks ?? null) : null,
      hand_score: scored ? (hs?.hand_score ?? null) : null,
      total: (totals.get(p.session_id) ?? 0) + (scored && hs ? hs.hand_score : 0),
      isDealer: !!hand && n > 0 && getDealerSeat(hand.starting_seat, n) === p.seat_index,
      isTurn: hand?.phase === 'betting' && hand.current_seat === p.seat_index,
    };
  });
}

export function fullLeaderboard(ts: TournamentState): Array<LeaderRow & { name: string; no_stakes: boolean }> {
  const byId = new Map(ts.leaderboard.map((r) => [r.participant_id, r]));
  return ts.participants
    .map((p) => ({
      participant_id: p.id, name: p.display_name, no_stakes: p.no_stakes,
      balance: Number(byId.get(p.id)?.balance ?? 0),
      total_points: Number(byId.get(p.id)?.total_points ?? 0),
    }))
    .sort((a, b) => b.balance - a.balance || b.total_points - a.total_points || a.name.localeCompare(b.name));
}

export function formatBalance(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r === 0) return '0';
  const abs = Number.isInteger(r) ? String(Math.abs(r)) : Math.abs(r).toFixed(1);
  return (r > 0 ? '+' : '−') + abs;
}
```

`hand_number` 2 with `score_history` already holding hand 1 works because `score_history` only contains closed hands, so the current scoring hand is never double-counted.

`src/lib/tournament/useTournamentState.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseClient } from '../supabase/client';
import { gameClient } from '../gameClient';
import type { TournamentState } from './types';

const FALLBACK_POLL_MS = 15_000;
const REFETCH_DEBOUNCE_MS = 250;

/**
 * Read model for the TV / recorder / admin screens. Independent of
 * useRoomStore (which holds one room) — subscribes to the tournament
 * channel plus every current-tour room channel and refetches the whole
 * get_tournament_state on any change. A slow poll covers missed broadcasts.
 */
export function useTournamentState(code: string | undefined) {
  const [data, setData] = useState<TournamentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    if (!code) return;
    try {
      const s = await gameClient.getTournamentState(code);
      setData(s);
      setError(s ? null : 'not_found');
    } catch (e: any) {
      setError(e?.message ?? 'fetch_failed');
    } finally {
      setLoading(false);
    }
  }, [code]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void refetch(); }, REFETCH_DEBOUNCE_MS);
  }, [refetch]);

  useEffect(() => {
    void refetch();
    const id = setInterval(() => { void refetch(); }, FALLBACK_POLL_MS);
    return () => { clearInterval(id); if (timer.current) clearTimeout(timer.current); };
  }, [refetch]);

  const tournamentId = data?.tournament.id;
  const roomKey = (data?.tables ?? []).map((t) => t.room_id).join(',');

  useEffect(() => {
    if (!tournamentId) return;
    const supabase = getSupabaseClient();
    const channels: RealtimeChannel[] = [
      supabase.channel(`tournament:${tournamentId}`)
        .on('broadcast', { event: 'tournament_changed' }, schedule),
      ...roomKey.split(',').filter(Boolean).map((rid) =>
        supabase.channel(`room:${rid}`).on('broadcast', { event: 'state_changed' }, schedule)),
    ];
    channels.forEach((c) => c.subscribe());
    return () => { channels.forEach((c) => supabase.removeChannel(c)); };
  }, [tournamentId, roomKey, schedule]);

  return { data, loading, error, refetch };
}
```

Caveat for the implementer: `realtimeBroadcast.subscribeRoom` also opens `room:${id}` on the recorder screen. supabase-js v2 refuses a second `channel()` with the same topic on one client (it returns the existing channel instance). To avoid a clash, the recorder screen uses `subscribeRoom` for its own room and `useTournamentState` only for the board. Pass a second hook argument `{ skipRoomId?: string }` and filter that room id out of `roomKey`. The signature becomes `useTournamentState(code, opts?: { skipRoomId?: string })`.

`gameClient.ts`, inside the `gameClient` object:
```ts
  // --- Offline tournament ---

  tournamentCreate: (name: string, participants: Array<{ display_name: string; no_stakes: boolean }>, max_cards: number) =>
    postAction(null, { kind: 'tournament_create', name, participants, max_cards }) as Promise<any>,

  tournamentUpdateParticipants: (tournament_id: string, secret: string, participants: Array<{ display_name: string; no_stakes: boolean }>) =>
    postAction(null, { kind: 'tournament_update_participants', tournament_id, secret, participants }) as Promise<any>,

  tournamentSetMaxCards: (tournament_id: string, secret: string, max_cards: number) =>
    postAction(null, { kind: 'tournament_set_max_cards', tournament_id, secret, max_cards }) as Promise<any>,

  tournamentStartTour: (tournament_id: string, secret: string, tables: Array<{ seats: string[]; stake: number }>, force = false) =>
    postAction(null, { kind: 'tournament_start_tour', tournament_id, secret, tables, force }) as Promise<any>,

  tournamentClaimTable: (code: string, table_number: number, secret: string) =>
    postAction(null, { kind: 'tournament_claim_table', code, table_number, secret }) as Promise<any>,

  getTournamentState: async (code: string): Promise<TournamentState | null> => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('get_tournament_state', { p_code: code });
    if (error) throw error;
    return (data as TournamentState) ?? null;
  },

  placeBetFor: (room_id: string, hand_id: string, seat: number, bet: number) =>
    postAction(null, { kind: 'place_bet', room_id, hand_id, bet, on_behalf_of_seat: seat }),

  recordTricksFor: (room_id: string, hand_id: string, seat: number, tricks: number) =>
    postAction(null, { kind: 'record_tricks', room_id, hand_id, tricks, on_behalf_of_seat: seat }),

  undoBet: (room_id: string, hand_id: string) =>
    postAction(null, { kind: 'undo_bet', room_id, hand_id }),
```
Add `import type { TournamentState } from './tournament/types';` at the top. `postAction` already applies `state` to `useRoomStore` when present, which `claim_table` relies on.

- [ ] **Step 4: Run tests + tsc**

Run: `npx jest src/lib/tournament --no-coverage && npx tsc --noEmit`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gameClient.ts src/lib/tournament
git commit -m "feat(tournament): client API, view helpers, realtime state hook"
```

---

### Task 6: Shared board components + i18n

**Files:**
- Create: `src/components/tournament/TableBoard.tsx`, `Leaderboard.tsx`, `TableQr.tsx`, `index.ts`
- Modify: `src/i18n/locales/{en,ru,es,fr}.json` (new `tournament` namespace)
- Modify: `package.json` (add `qrcode@1.5.4`, `@types/qrcode@1.5.5` dev)

**Interfaces:**
- Consumes: `tableRows`, `fullLeaderboard`, `formatBalance` (Task 5), `suitGlyph` (existing), `getTotalHands` from `src/game/rules`.
- Produces:
  ```tsx
  <TableBoard table={TournamentTable} size?: 'tv' | 'phone' />          // testID `tournament-table-${n}`
  <Leaderboard state={TournamentState} highlightIds?: string[] />        // testID `tournament-leaderboard`
  <TableQr url={string} size={number} />                                 // testID `tournament-table-qr`
  ```

- [ ] **Step 1: Add the dependency**

Run: `npm install qrcode@1.5.4 && npm install -D @types/qrcode@1.5.5`

- [ ] **Step 2: i18n keys**

Add to `en.json` (top-level `"tournament"` object), and translate the same keys into `ru.json`, `es.json`, `fr.json`:
```json
"tournament": {
  "title": "Tournament",
  "newTitle": "New tournament",
  "name": "Tournament name",
  "participants": "Participants (one per line)",
  "noStakes": "No money",
  "noStakesHint": "Only seated at tables without stakes",
  "tables": "Tables",
  "maxCards": "Max cards per hand",
  "create": "Create tournament",
  "stake": "Stake",
  "stakeNone": "No money",
  "stakeUnits": "{{stake}} per point",
  "pin": "Pin to table",
  "unpinned": "Random",
  "shuffle": "Shuffle seating",
  "startTour": "Start tour {{n}}",
  "nextTour": "Next tour",
  "tourInProgress": "Tables are still playing. Start the next tour anyway?",
  "tour": "Tour {{n}}",
  "table": "Table {{n}}",
  "moveTo": "Move to table",
  "tvLink": "TV screen",
  "adminLink": "Admin link (keep it private)",
  "scanToRecord": "Scan to record this table",
  "hand": "Hand {{n}} / {{total}}",
  "cards": "{{count}} cards",
  "noTrump": "No trump",
  "dealer": "Dealer",
  "bets": "Bets",
  "betsTurn": "{{name}} bets",
  "playing": "Playing — {{name}} leads",
  "scored": "Hand scored",
  "finished": "Game over",
  "colBet": "Bet",
  "colTaken": "Took",
  "colHand": "Hand",
  "colTotal": "Total",
  "colBalance": "Balance",
  "colPoints": "Points",
  "leaderboard": "Standings",
  "undo": "Undo last bet",
  "forbidden": "{{n}} not allowed — someone must be unhappy",
  "tricksTitle": "Tricks taken",
  "tricksSum": "{{sum}} / {{cards}}",
  "submitTricks": "Save hand",
  "nextHand": "Next hand",
  "showBoard": "Table",
  "reconnecting": "Reconnecting…",
  "takenOver": "Recording was taken over by another phone",
  "takeBack": "Take back",
  "errors": {
    "no_stakes_capacity": "Too many “no money” players for the tables without stakes — make one more table stake-free.",
    "no_stakes_at_stake_table": "A “no money” player can't sit at a table with stakes.",
    "table_too_small": "Each table needs at least 2 players.",
    "table_too_large": "At most 6 players per table — add a table.",
    "invalid_participants": "Enter at least 2 unique names.",
    "bad_secret": "This link is no longer valid.",
    "not_admin": "Only the tournament admin can do this.",
    "generic": "Something went wrong — try again."
  }
}
```
RU wording: `"noStakes": "Без денег"`, `"stake": "Ставка"`, `"stakeUnits": "{{stake}} за очко"`, `"betsTurn": "Заказывает {{name}}"`, `"dealer": "Сдаёт"`, `"undo": "Отменить последнюю ставку"`, `"tricksTitle": "Взятки"`, `"submitTricks": "Записать раздачу"`, `"nextHand": "Следующая раздача"`, `"forbidden": "{{n}} нельзя — кто-то должен остаться недовольным"`, `"leaderboard": "Турнирная таблица"`, `"takenOver": "Запись перехвачена другим телефоном"`, `"takeBack": "Забрать обратно"`, `"colBalance": "Баланс"`, `"shuffle": "Раскидать рассадку"`, `"startTour": "Начать тур {{n}}"`.

- [ ] **Step 3: Components**

`TableQr.tsx` (web-first; TV is a browser):
```tsx
import React, { useEffect, useState } from 'react';
import { Image } from 'react-native';
import QRCode from 'qrcode';

export const TableQr: React.FC<{ url: string; size: number }> = ({ url, size }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { margin: 1, width: size }).then((d) => { if (alive) setSrc(d); }).catch(() => {});
    return () => { alive = false; };
  }, [url, size]);
  if (!src) return null;
  return <Image testID="tournament-table-qr" source={{ uri: src }} style={{ width: size, height: size }} />;
};
```

`TableBoard.tsx`: `useTheme()` colors, `useTranslation()`. Layout:
- Header row: `t('tournament.table', {n})` · stake badge (`stakeNone` or `stakeUnits`) · `t('tournament.hand', {n: hand_number, total: getTotalHands(room.max_cards)})` · `t('tournament.cards', {count})` · trump glyph via `suitGlyph`, colored red for hearts/diamonds (use `colors` the same way `OfflineHandBriefing` does) or `noTrump`.
- Status line: betting → `betsTurn` (name at `current_seat`); `tricks_recording` → `playing` with the first-lead name = player at `starting_seat`; `scoring` → `scored`; room `finished` → `finished`.
- Table: one row per `tableRows(state)` with name (bold + accent background if `isTurn`, "🂠"/`dealer` tag if `isDealer`), bet, taken, hand, total. Show `—` for null.
- Fonts: `size === 'tv'` uses typography ≥ 22px for names and numbers (readable from ~4m); `'phone'` uses the default body size.
- testIDs: container `tournament-table-${n}`, row `tournament-row-${n}-${seat}`, status `tournament-status-${n}`.

`Leaderboard.tsx`: `fullLeaderboard(state)` rows with rank, name (+ small "no money" tag if `no_stakes`), `formatBalance(balance)` colored green/red/neutral, and total points. Container testID `tournament-leaderboard`, rows `tournament-leader-${participant_id}`.

`index.ts` re-exports the three.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/tournament src/i18n/locales package.json package-lock.json
git commit -m "feat(tournament): table board, leaderboard, QR components + i18n"
```

---

### Task 7: Recorder screen

**Files:**
- Create: `src/components/tournament/RecorderBetPad.tsx`
- Create: `src/components/tournament/RecorderTricks.tsx`
- Create: `src/screens/tournament/TournamentRecorderScreen.tsx`
- Test: `src/lib/tournament/__tests__/recorder.test.ts`
- Create: `src/lib/tournament/recorder.ts`

**Interfaces:**
- Consumes: `gameClient.tournamentClaimTable/placeBetFor/recordTricksFor/undoBet/continueHand` (Task 5), `subscribeRoom/unsubscribeRoom` (existing), `OfflineHandBriefing` (existing; reads `useRoomStore`), `TableBoard` (Task 6), `getAllowedBets` from `src/game/rules`.
- Produces:
  ```ts
  // recorder.ts (pure)
  export function forbiddenBet(state: RoomSnapshot): number | null;   // value the last bidder may not say, or null
  export function tricksSum(draft: Record<number, number>): number;
  export function canSubmitTricks(draft: Record<number, number>, players: number, cards: number): boolean;
  ```
  Screen props: `{ code: string; tableNumber: number; secret: string }`.

- [ ] **Step 1: Write the failing test**

`src/lib/tournament/__tests__/recorder.test.ts`:
```ts
import { forbiddenBet, tricksSum, canSubmitTricks } from '../recorder';

const base: any = {
  players: [{ seat_index: 0 }, { seat_index: 1 }, { seat_index: 2 }],
  current_hand: { phase: 'betting', cards_per_player: 3, current_seat: 2 },
  hand_scores: [{ bet: 1 }, { bet: 1 }],
};

describe('forbiddenBet', () => {
  it('is cards - sum for the last bidder', () => {
    expect(forbiddenBet(base)).toBe(1);
  });
  it('is null when not the last bidder', () => {
    expect(forbiddenBet({ ...base, hand_scores: [{ bet: 1 }] })).toBeNull();
  });
  it('is null when the sum already exceeds cards', () => {
    expect(forbiddenBet({ ...base, hand_scores: [{ bet: 3 }, { bet: 2 }] })).toBeNull();
  });
});

describe('tricks draft', () => {
  it('sums and validates', () => {
    expect(tricksSum({ 0: 1, 1: 2, 2: 0 })).toBe(3);
    expect(canSubmitTricks({ 0: 1, 1: 2, 2: 0 }, 3, 3)).toBe(true);
    expect(canSubmitTricks({ 0: 1, 1: 1, 2: 0 }, 3, 3)).toBe(false);
    expect(canSubmitTricks({ 0: 3 }, 3, 3)).toBe(false);   // every seat must be present
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/lib/tournament --no-coverage`
Expected: FAIL, "Cannot find module '../recorder'".

- [ ] **Step 3: Implement the pure helpers**

`src/lib/tournament/recorder.ts`:
```ts
import type { RoomSnapshot } from '../../../supabase/functions/_shared/types.ts';

/** Bet the last bidder may not say (sum would equal cards) — mirrors place_bet_action. */
export function forbiddenBet(state: RoomSnapshot): number | null {
  const hand = state.current_hand;
  if (!hand || hand.phase !== 'betting') return null;
  if (state.hand_scores.length !== state.players.length - 1) return null;
  const v = hand.cards_per_player - state.hand_scores.reduce((s, x) => s + x.bet, 0);
  return v >= 0 && v <= hand.cards_per_player ? v : null;
}

export function tricksSum(draft: Record<number, number>): number {
  return Object.values(draft).reduce((s, v) => s + v, 0);
}

export function canSubmitTricks(draft: Record<number, number>, players: number, cards: number): boolean {
  return Object.keys(draft).length === players && tricksSum(draft) === cards;
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/lib/tournament --no-coverage`
Expected: PASS.

- [ ] **Step 5: Components + screen**

`RecorderBetPad.tsx`, props `{ state: RoomSnapshot }`:
- Bidder = player at `current_hand.current_seat`; title `t('tournament.betsTurn', { name })`.
- Buttons `0..cards_per_player` in a wrapping grid, each ≥ 56px square (one-thumb use). The `forbiddenBet(state)` value is disabled and greyed, with the `forbidden` hint below the grid.
- A single in-flight guard: `const [busy, setBusy] = useState(false)`; every button is disabled while `busy`.
- `onPress(n)`: `setBusy(true); const r = await gameClient.placeBetFor(room.id, hand.id, hand.current_seat, n); if (!r.ok && r.error !== 'not_your_turn' && r.error !== 'already_bet') showError(); setBusy(false)`. The returned state is already applied to the store by `postAction`.
- Undo button: shown when `hand_scores.length > 0`, calls `gameClient.undoBet(room.id, hand.id)` under the same guard.
- testIDs: `recorder-bet-${n}`, `recorder-undo`, `recorder-bidder`.

`RecorderTricks.tsx`, props `{ state: RoomSnapshot }`:
- `draft: Record<number, number>`, seeded to 0 for every seat when `current_hand.id` changes. Each row shows name, bet, and a −/value/+ stepper clamped to `0..cards`.
- Sum line `t('tournament.tricksSum', {sum, cards})`, red when not equal.
- **Save hand** is enabled only when `canSubmitTricks(draft, players.length, cards)` and not busy. On press it loops seats in order calling `gameClient.recordTricksFor(room.id, hand.id, seat, draft[seat])`. If any call returns `!ok`, it stops, shows the error and lets the recorder retry. The RPC overwrites `taken_tricks` per seat, so a retry is idempotent.
- Below the steppers, an Undo-last-bet link (allowed until the first claim; the server enforces it).
- testIDs: `recorder-tricks-dec-${seat}`, `recorder-tricks-inc-${seat}`, `recorder-tricks-value-${seat}`, `recorder-tricks-submit`, `recorder-tricks-sum`.

`TournamentRecorderScreen.tsx`:
```tsx
interface Props { code: string; tableNumber: number; secret: string; onExit: () => void }
```
Behaviour:
1. On mount, and whenever `code/tableNumber/secret` change: `useRoomStore.getState().reset()`, then `const r = await gameClient.tournamentClaimTable(code, tableNumber, secret)`. On `ok`: `subscribeRoom(r.room_id)`. On error: a full-screen message from `t('tournament.errors.' + r.error, { defaultValue: t('tournament.errors.generic') })`.
2. On unmount: `unsubscribeRoom()`.
3. Also call `useTournamentState(code, { skipRoomId: roomId })`. When `data.tournament.current_tour` changes to a tour where this table number exists, re-run the claim. This moves the recorder to the next tour automatically on the same QR/URL. If the table number doesn't exist in the new tour, show "Table N is not in tour M" with an exit button.
4. Render from `useRoomStore((s) => s.snapshot)`:
   - top bar: `t('tournament.table', {n})` · a `showBoard` toggle (opens `<TableBoard size="phone">` in a modal) · exit;
   - `<OfflineHandBriefing />` (existing; dealer, order, trump);
   - `phase === 'betting'` → `<RecorderBetPad state={snapshot} />`;
   - `phase === 'tricks_recording'` → `<RecorderTricks state={snapshot} />`;
   - `phase === 'scoring'` → compact result rows (name, bet, took, hand score) + **Next hand** → `gameClient.continueHand(room.id, hand.id)` (busy-guarded; idempotent server-side);
   - `room.phase === 'finished'` → `finished` + `<TableBoard size="phone">`.
5. **Takeover detection:** `const takenOver = !!snapshot?.room && !!myPlayerId && snapshot.room.host_session_id !== myPlayerId` (`myPlayerId` comes from `useRoomStore`, set by `postAction` from `me_session_id`). When `takenOver`, render only a full-width card `t('tournament.takenOver')` + **Take back** button (testID `recorder-take-back`), which re-runs the claim from step 1, plus the read-only `<TableBoard size="phone">`. Hide the bet pad, tricks steppers and Next hand. Also treat an action response with `error === 'not_recorder'` as takenOver (the snapshot in that response already carries the new host).
6. Never mounts `useHeartbeat`, `useTurnTimeout`, `useHostAbsentTicker`, `HostLeftBanner`, `PausedOverlay`, chat.

testIDs: `tournament-recorder`, `recorder-next-hand`, `recorder-board-toggle`, `recorder-taken-over`, `recorder-take-back`.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tournament src/components/tournament src/screens/tournament
git commit -m "feat(tournament): recorder screen — bet pad with undo, all-player tricks, next hand"
```

---

### Task 8: Admin setup screen

**Files:**
- Create: `src/screens/tournament/TournamentSetupScreen.tsx`
- Create: `src/lib/tournament/setupDraft.ts`
- Test: `src/lib/tournament/__tests__/setupDraft.test.ts`

**Interfaces:**
- Consumes: `shuffleSeating`, `validateSeating`, `defaultMaxCards`, `STAKE_CHIPS` (Task 1); `gameClient.tournament*` (Task 5); `useTournamentState` (Task 5).
- Produces:
  ```ts
  // setupDraft.ts
  export function parseParticipants(text: string): Array<{ display_name: string; no_stakes: boolean }>;
  // One name per line; a trailing " -" or " (no money)" marks no_stakes; trims; drops blanks; first spelling wins on case-insensitive duplicates.
  export function moveParticipant(tables: string[][], pid: string, toTable: number): string[][];
  ```
  Screen props: `{ code?: string; secret?: string; initialTableCount?: number; onCreated?: (r: { code: string; secret: string; tableCount: number }) => void }`.

- [ ] **Step 1: Write the failing test**

```ts
import { parseParticipants, moveParticipant } from '../setupDraft';

describe('parseParticipants', () => {
  it('parses names, no-money markers, dedupes', () => {
    expect(parseParticipants('Akula\n  Ryabina -\n\nBob (no money)\nakula\n')).toEqual([
      { display_name: 'Akula', no_stakes: false },
      { display_name: 'Ryabina', no_stakes: true },
      { display_name: 'Bob', no_stakes: true },
    ]);
  });
});

describe('moveParticipant', () => {
  it('moves a player to the end of another table', () => {
    expect(moveParticipant([['a', 'b'], ['c']], 'a', 1)).toEqual([['b'], ['c', 'a']]);
  });
  it('is a no-op for the same table', () => {
    expect(moveParticipant([['a', 'b'], ['c']], 'a', 0)).toEqual([['a', 'b'], ['c']]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/lib/tournament --no-coverage`
Expected: FAIL.

- [ ] **Step 3: Implement the helpers**

```ts
const NO_MONEY = /\s*(?:-|\(no money\)|\(без денег\))\s*$/i;

export function parseParticipants(text: string): Array<{ display_name: string; no_stakes: boolean }> {
  const seen = new Set<string>();
  const out: Array<{ display_name: string; no_stakes: boolean }> = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const no_stakes = NO_MONEY.test(line);
    const display_name = line.replace(NO_MONEY, '').trim().slice(0, 24);
    if (!display_name || seen.has(display_name.toLowerCase())) continue;
    seen.add(display_name.toLowerCase());
    out.push({ display_name, no_stakes });
  }
  return out;
}

export function moveParticipant(tables: string[][], pid: string, toTable: number): string[][] {
  const from = tables.findIndex((t) => t.includes(pid));
  if (from === -1 || from === toTable) return tables;
  return tables.map((t, i) =>
    i === from ? t.filter((x) => x !== pid) : i === toTable ? [...t, pid] : t);
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/lib/tournament --no-coverage`
Expected: PASS.

- [ ] **Step 5: Screen**

`TournamentSetupScreen` has two modes:

**Create (no `code`)**: name input, participants `TextInput multiline` (hint: "one per line, add ' -' for no money"), table count stepper (1–4, default 2), **Create**. It calls `tournamentCreate(name, parseParticipants(text), defaultMaxCards(sizes))`, where `sizes` is the even split of N over the table count. On ok it calls `onCreated({ code, secret, tableCount })`; the navigator puts `t=` in the URL so the admin screen knows the table count on reload.

**Admin (`code` + `secret`)**, using `useTournamentState(code)`:
- Header: name, code, current tour. Links: **TV** (`/tournament/${code}/tv?k=${secret}`), copyable admin link.
- Participants panel (collapsible): the same textarea prefilled from `data.participants` (no-stakes rendered with ` -`) + **Save** → `tournamentUpdateParticipants`. Disabled while a tour is in progress.
- Max cards stepper (1–10) → `tournamentSetMaxCards`. Show the hint `defaultMaxCards(sizes)` for the current split.
- Tour setup (visible when there's no current tour or every current room is `finished`; otherwise behind a **Next tour** button that confirms `tourInProgress` and sets `force`):
  - per table: stake chips `STAKE_CHIPS` (default 0);
  - participant chips: tapping a chip opens a small picker "Pin to table: Random / 1 / 2 / 3", stored in `pins: Record<string, number>`;
  - **Shuffle**: `shuffleSeating({ participants: data.participants, stakes, pins })`. On `!ok`, show `t('tournament.errors.' + reason)`. On ok, store `preview: string[][]`;
  - the preview shows one card per table with names. Tap a name → "Move to table N" → `moveParticipant`, then `validateSeating(preview, participants, stakes)`. If it fails, revert and show the error inline;
  - when a stake changes after a shuffle, re-validate the preview and clear it if it's now invalid;
  - **Start tour N** → `tournamentStartTour(id, secret, preview.map((seats, i) => ({ seats, stake: stakes[i] })), force)`. On ok, clear the preview and list the claim links per table (`/tournament/${code}/table/${n}?k=${secret}`) as a fallback to the TV QR.
- Current tour panel: one compact `<TableBoard size="phone">` per table plus a `<Leaderboard>`.

testIDs: `tournament-setup`, `tournament-name`, `tournament-participants`, `tournament-table-count`, `tournament-create`, `tournament-stake-${i}-${chip}`, `tournament-pin-${pid}`, `tournament-shuffle`, `tournament-preview-${i}`, `tournament-start-tour`, `tournament-error`, `tournament-tv-link`.

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit`, then:
```bash
git add src/lib/tournament src/screens/tournament
git commit -m "feat(tournament): admin setup — participants, stakes, pins, shuffle, start tour"
```

---

### Task 9: TV screen + navigation wiring

**Files:**
- Create: `src/screens/tournament/TournamentTvScreen.tsx`
- Create: `src/screens/tournament/index.ts`
- Modify: `src/navigation/AppNavigator.tsx`

**Interfaces:**
- Consumes: `useTournamentState`, `TableBoard`, `Leaderboard`, `TableQr`.
- Produces: routes `TournamentNew` → `tournament/new`, `TournamentAdmin` → `tournament/:code/admin`, `TournamentTable` → `tournament/:code/table/:n`, `TournamentTv` → `tournament/:code/tv`. Query `k` (secret) and `t` arrive as route params.

- [ ] **Step 1: TV screen**

`TournamentTvScreen({ code, secret })`:
- `const { data, error } = useTournamentState(code)`.
- Full-viewport dark layout, no scroll: title row (name · `tour` n · a `reconnecting` badge when the last refetch errored), then a row of `data.tables.length` equal columns, each `<TableBoard table size="tv" />`. When `secret` is present, every column shows the claim QR `<TableQr url={\`${origin}/tournament/${code}/table/${n}?k=${secret}\`} />`: large (`size={220}` + `scanToRecord`, centered over the board) while `!table.claimed`, and small (`size={96}`, top-right corner of the column, no label) once claimed, so anyone can take over at any time.
- Bottom strip (≈30% height): `<Leaderboard state={data} />`, laid out in 2 columns when there are more than 8 participants.
- Before the first tour, show the participants list and "waiting for tour 1".
- Use `window.location.origin` on web (the TV is always web).
- testID `tournament-tv`.

- [ ] **Step 2: Navigation**

In `AppNavigator.tsx`:
- extend `linking.config.screens`:
  ```ts
      TournamentNew:   'tournament/new',
      TournamentAdmin: 'tournament/:code/admin',
      TournamentTable: 'tournament/:code/table/:n',
      TournamentTv:    'tournament/:code/tv',
  ```
- add four `Stack.Screen`s after `GameTable`, following the existing render-prop style:
  ```tsx
            <Stack.Screen name="TournamentNew">
              {(props) => (
                <TournamentSetupScreen
                  onCreated={({ code, secret, tableCount }) =>
                    (props.navigation as any).navigate('TournamentAdmin', { code, k: secret, t: tableCount })}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="TournamentAdmin">
              {(props) => (
                <TournamentSetupScreen
                  code={props.route?.params?.code}
                  secret={props.route?.params?.k}
                  initialTableCount={Number(props.route?.params?.t) || undefined}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="TournamentTable">
              {(props) => (
                <TournamentRecorderScreen
                  code={props.route?.params?.code}
                  tableNumber={Number(props.route?.params?.n)}
                  secret={props.route?.params?.k}
                  onExit={() => (props.navigation as any).navigate('Lobby')}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="TournamentTv">
              {(props) => (
                <TournamentTvScreen code={props.route?.params?.code} secret={props.route?.params?.k} />
              )}
            </Stack.Screen>
  ```
- Check that `RejoinGuard` / `NavigatorGuard` / `CrossDeviceRejoinGuard` don't redirect away from these routes. The recorder and TV sessions are never `room_players`, so `get_my_active_room` returns null. Still, read `NavigatorGuard` and `RejoinGuard` in `AppNavigator.tsx`. If either redirects unknown or deep-linked routes to Welcome/Lobby when there is no room, add the four route names to its allow-list.
- The `FeedbackButton` overlay shouldn't render on `TournamentTv`: find where `routeName` feeds `<FeedbackButton>` and return `null` for `TournamentTv`.

- [ ] **Step 3: Manual check in the browser**

The `:8081` dev server must be running (`lsof -i :8081`); if it isn't, report that as a blocker. Open `http://localhost:8081/tournament/new`, create a tournament with 5 names and 1 table, start tour 1, open the TV link in a second tab, then the table link in a third. Place 5 bets with one undo, record tricks, press Next hand. The TV tab updates within ~1s at every step; the leaderboard shows 0 for everyone (stake 0).

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit`, then:
```bash
git add src/screens/tournament src/navigation/AppNavigator.tsx
git commit -m "feat(tournament): TV dashboard + deep-link routes"
```

---

### Task 10: e2e + test hygiene + ship

**Files:**
- Create: `tests/e2e/tournament.spec.ts`
- Modify: `package.json` (scripts `test:tournament:local`), `tests.config.json` if `test:all` lists e2e specs there
- Modify: `tests/TEST_TODO.md` (via `--update-todo`)

- [ ] **Step 1: Write the e2e**

`tests/e2e/tournament.spec.ts` follows the setup of `scorekeeper-demo.spec.ts` (same imports from `../fixtures/actions`: `tap`, `exists`, `sleep`). One mobile context (recorder + admin) and one desktop context (TV):
```ts
import { test, expect } from '@playwright/test';
import { tap, exists } from '../fixtures/actions';

const BASE = process.env.DEMO_URL ?? 'http://localhost:8082';

test('tournament: one table, bets with undo, tricks, TV mirrors', async ({ browser }) => {
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();

  await phone.goto(`${BASE}/tournament/new`);
  await phone.fill('[data-testid="tournament-name"]', 'E2E');
  await phone.fill('[data-testid="tournament-participants"]', 'Ann\nBen\nCat\nDan -');
  await tap(phone, 'tournament-create');
  await phone.waitForURL(/\/tournament\/[A-Z0-9]{6}\/admin\?k=/);
  const url = new URL(phone.url());
  const code = url.pathname.split('/')[2];
  const k = url.searchParams.get('k')!;

  await tap(phone, 'tournament-shuffle');
  await expect(phone.locator('[data-testid="tournament-preview-0"]')).toBeVisible();
  await tap(phone, 'tournament-start-tour');

  await tv.goto(`${BASE}/tournament/${code}/tv?k=${k}`);
  await expect(tv.locator('[data-testid="tournament-table-1"]')).toBeVisible();
  await expect(tv.locator('[data-testid="tournament-table-qr"]')).toBeVisible();

  await phone.goto(`${BASE}/tournament/${code}/table/1?k=${k}`);
  await expect(phone.locator('[data-testid="tournament-recorder"]')).toBeVisible();
  // After claim the QR stays, small, for takeover.
  await expect(tv.locator('[data-testid="tournament-table-qr"]')).toHaveCount(1);

  // 4 bets of 0 except the last; undo once in the middle.
  await tap(phone, 'recorder-bet-0');
  await tap(phone, 'recorder-undo');
  for (let i = 0; i < 3; i++) await tap(phone, 'recorder-bet-0');
  // Last bidder: 10 cards, sum so far 0 → saying 10 is forbidden.
  await expect(phone.locator('[data-testid="recorder-bet-10"]')).toBeDisabled();
  await tap(phone, 'recorder-bet-1');

  // Hand 1: max_cards for 4 → 10 cards. Give all 10 to seat 0.
  for (let i = 0; i < 10; i++) await tap(phone, 'recorder-tricks-inc-0');
  await expect(phone.locator('[data-testid="recorder-tricks-submit"]')).toBeEnabled();
  await tap(phone, 'recorder-tricks-submit');
  await expect(phone.locator('[data-testid="recorder-next-hand"]')).toBeVisible();

  await expect(tv.locator('[data-testid="tournament-status-1"]')).toContainText(/scored/i, { timeout: 5000 });
  await expect(tv.locator('[data-testid="tournament-leaderboard"]')).toBeVisible();

  // Takeover: a second phone claims the table; the first phone offers Take back.
  const phone2 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone2.goto(`${BASE}/tournament/${code}/table/1?k=${k}`);
  await expect(phone2.locator('[data-testid="recorder-next-hand"]')).toBeVisible();
  await expect(phone.locator('[data-testid="recorder-taken-over"]')).toBeVisible({ timeout: 5000 });
  await tap(phone, 'recorder-take-back');
  await expect(phone.locator('[data-testid="recorder-next-hand"]')).toBeVisible();
  await expect(phone2.locator('[data-testid="recorder-taken-over"]')).toBeVisible({ timeout: 5000 });
});
```
The default locale under Playwright is EN, so the status text matches `Hand scored`.

Add the script `"test:tournament:local": "LOCAL_SUPABASE=1 HEADLESS=1 DEMO_URL=http://localhost:8082 playwright test tests/e2e/tournament.spec.ts"`. If `tests.config.json` registers e2e specs for `test:all`, add an entry mirroring the scorekeeper one.

- [ ] **Step 2: Run the e2e locally**

The local stack boots via Playwright `globalSetup`, as for scorekeeper (~3 GB RAM). Check memory first (`memory_pressure` / Activity Monitor); this is a short single spec, not `sanity`.
Run: `npm run test:tournament:local`
Expected: 1 passed.

- [ ] **Step 3: Test hygiene**

Run: `npm run test:lint -- --update-todo`
Expected: the new testIDs are listed as uncovered or covered; no orphans introduced. List them to Akula in the final message.

Run: `npm run smoke` (needs `:8081`; if `lsof -i :8081` is empty, report it as a blocker).
Expected: jest + 9 smoke + 2 desktop pass.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/tournament.spec.ts package.json tests.config.json tests/TEST_TODO.md
git commit -m "test(tournament): one-table e2e + TEST_TODO"
```

- [ ] **Step 5: Ship (per spec: ship when ready, Akula tests on prod)**

Confirm with Akula before each outward step:
1. `npx supabase db push` (prod migration).
2. `npx supabase functions deploy game-action`.
3. Merge `feat/offline-tournament` into main (fast-forward; no force-push) and push → Vercel deploys.
4. Tell Akula the URLs: `https://nigels.online/tournament/new`. Remind them about the PWA cache: hard-reload the TV browser.
