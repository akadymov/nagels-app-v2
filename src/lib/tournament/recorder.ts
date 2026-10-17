import type { RoomSnapshot } from '../../../supabase/functions/_shared/types.ts';
import { getHandCards, getTrumpForHand } from '../../game/rules';

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

/** Nägels hand score — mirrors public._compute_hand_score. */
export function handScore(bet: number, taken: number): number {
  return taken + (bet === taken ? 10 : 0);
}

export interface HandEditEntry { seat: number; bet: number; taken: number }
export type HandEditError = 'range' | 'tricks_sum' | 'bets_sum';

/** Same rules edit_hand_action enforces: values in 0..cards, tricks sum to cards, bets don't. */
export function validateHandEdit(entries: HandEditEntry[], cards: number): HandEditError | null {
  if (entries.some((e) => e.bet < 0 || e.bet > cards || e.taken < 0 || e.taken > cards)) return 'range';
  if (entries.reduce((s, e) => s + e.taken, 0) !== cards) return 'tricks_sum';
  if (entries.reduce((s, e) => s + e.bet, 0) === cards) return 'bets_sum';
  return null;
}

export interface EditableHand {
  hand_id: string;
  hand_number: number;
  cards: number;
  trump: string;
  rows: Array<{ seat: number; session_id: string; name: string; bet: number; taken: number; score: number }>;
}

/**
 * Hands of the table's current game that the recorder may correct: every
 * closed hand plus the current one once scored. Newest first. Cards and
 * trump of closed hands are derived from the hand number (score_history
 * doesn't carry them).
 */
export function editableHands(state: RoomSnapshot): EditableHand[] {
  const room = state.room;
  if (!room) return [];
  const bySession = new Map(state.players.map((p) => [p.session_id, p]));
  const toRows = (scores: Array<{ session_id: string; bet: number; taken_tricks: number; hand_score: number }>) =>
    scores
      .filter((s) => bySession.has(s.session_id))
      .map((s) => {
        const p = bySession.get(s.session_id)!;
        return { seat: p.seat_index, session_id: s.session_id, name: p.display_name,
                 bet: s.bet, taken: s.taken_tricks, score: s.hand_score };
      })
      .sort((a, b) => a.seat - b.seat);

  const out: EditableHand[] = (state.score_history ?? [])
    .filter((h) => h.scores && h.scores.length > 0)
    .map((h) => ({
      hand_id: h.scores[0].hand_id,
      hand_number: h.hand_number,
      cards: getHandCards(h.hand_number, room.max_cards, room.min_cards_per_hand ?? 1),
      trump: getTrumpForHand(h.hand_number),
      rows: toRows(h.scores),
    }));

  const cur = state.current_hand;
  if (cur && cur.phase === 'scoring' && !out.some((h) => h.hand_id === cur.id)) {
    out.push({ hand_id: cur.id, hand_number: cur.hand_number, cards: cur.cards_per_player,
               trump: cur.trump_suit, rows: toRows(state.hand_scores) });
  }
  return out.sort((a, b) => b.hand_number - a.hand_number);
}
