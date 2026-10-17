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
    expect(canSubmitTricks({ 0: 3 }, 3, 3)).toBe(false);
  });
});
