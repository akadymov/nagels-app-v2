/**
 * Nägels Online — offline (scorekeeper) hand-briefing helpers.
 *
 * Pure, dependency-light derivations for the offline instructions card.
 * The engine has NO dealer concept — the dealer is derived here from
 * `starting_seat`. Play is counter-clockwise by INCREASING seat index:
 * the server RPCs (place_bet_action, play_card_action) advance
 * current_seat to (seat + 1) % N.
 */

import { SuitSymbols } from '../../constants/colors';

export type TrumpSuit = 'diamonds' | 'hearts' | 'clubs' | 'spades' | 'notrump';

export interface BriefingPlayer {
  session_id: string;
  display_name: string;
  seat_index: number;
}

/**
 * The dealer is the player who, in play direction, immediately precedes the
 * first player: the dealer deals and the next player counter-clockwise leads.
 * Since next(seat) = (seat + 1) % N, the predecessor of the starting seat
 * is (startingSeat - 1 + N) % N. The dealer is also the last bidder, so the
 * forbidden-sum rule lands on this seat.
 */
export function getDealerSeat(startingSeat: number, playerCount: number): number {
  return (startingSeat + playerCount - 1) % playerCount;
}

/**
 * Players in play order: starts at the first player (`startingSeat`) and steps
 * counter-clockwise. The last element is always the dealer. Seats are assumed
 * to be 0..players.length-1 (true for an active hand).
 */
export function getPlayOrder(
  players: BriefingPlayer[],
  startingSeat: number,
): BriefingPlayer[] {
  const n = players.length;
  if (n === 0) return [];
  const bySeat = new Map(players.map((p) => [p.seat_index, p]));
  const order: BriefingPlayer[] = [];
  for (let i = 0; i < n; i++) {
    const seat = (startingSeat + i) % n;
    const p = bySeat.get(seat);
    if (p) order.push(p);
  }
  return order;
}

/** Suit glyph for the trump line; empty string for no-trump. */
export function suitGlyph(suit: TrumpSuit): string {
  return suit === 'notrump' ? '' : SuitSymbols[suit];
}

/** i18n key for the localised suit name (reuses the existing `trumps` namespace). */
export function suitLabelKey(suit: TrumpSuit): string {
  return `trumps.${suit}`;
}
