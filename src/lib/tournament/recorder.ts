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
