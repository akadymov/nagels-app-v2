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
      // A 'closed' current hand (finished room) is already in score_history.
      total: (totals.get(p.session_id) ?? 0) + (hand?.phase === 'scoring' && hs ? hs.hand_score : 0),
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
      place_points: Number(byId.get(p.id)?.place_points ?? 0),
    }))
    .sort((a, b) => b.place_points - a.place_points || b.balance - a.balance || a.name.localeCompare(b.name));
}

/** Place points: whole, or .5 when tied players split places. */
export function formatPoints(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function formatBalance(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r === 0) return '0';
  const abs = Number.isInteger(r) ? String(Math.abs(r)) : Math.abs(r).toFixed(1);
  return (r > 0 ? '+' : '−') + abs;
}
