import { validateHandEdit, handScore, editableHands } from '../recorder';

describe('handScore', () => {
  it('adds 10 for an exact bet, otherwise just tricks', () => {
    expect(handScore(2, 2)).toBe(12);
    expect(handScore(0, 0)).toBe(10);
    expect(handScore(1, 3)).toBe(3);
  });
});

describe('validateHandEdit', () => {
  const e = (pairs: Array<[number, number]>) => pairs.map(([bet, taken], seat) => ({ seat, bet, taken }));
  it('accepts a consistent hand', () => {
    expect(validateHandEdit(e([[1, 2], [0, 0], [1, 1]]), 3)).toBeNull();
  });
  it('rejects tricks that do not sum to cards', () => {
    expect(validateHandEdit(e([[1, 1], [0, 0], [1, 1]]), 3)).toBe('tricks_sum');
  });
  it('rejects bets that sum to cards (someone must be unhappy)', () => {
    expect(validateHandEdit(e([[1, 1], [1, 1], [1, 1]]), 3)).toBe('bets_sum');
  });
  it('rejects values outside 0..cards', () => {
    expect(validateHandEdit(e([[4, 3], [0, 0], [0, 0]]), 3)).toBe('range');
    expect(validateHandEdit(e([[-1, 3], [0, 0], [0, 0]]), 3)).toBe('range');
  });
});

describe('editableHands', () => {
  const players = [
    { session_id: 's0', display_name: 'A', seat_index: 0 },
    { session_id: 's1', display_name: 'B', seat_index: 1 },
  ];
  const base: any = {
    room: { id: 'r', max_cards: 10, min_cards_per_hand: 1 },
    players,
    score_history: [
      { hand_number: 1, closed_at: 'x', scores: [
        { hand_id: 'h1', session_id: 's0', bet: 1, taken_tricks: 1, hand_score: 11 },
        { hand_id: 'h1', session_id: 's1', bet: 0, taken_tricks: 9, hand_score: 9 },
      ] },
    ],
    current_hand: { id: 'h2', hand_number: 2, cards_per_player: 9, trump_suit: 'hearts', phase: 'betting' },
    hand_scores: [{ hand_id: 'h2', session_id: 's0', bet: 3, taken_tricks: 0, hand_score: 0 }],
  };

  it('lists closed hands with seat-ordered rows, newest first', () => {
    const hs = editableHands(base);
    expect(hs.map((h) => h.hand_id)).toEqual(['h1']);
    expect(hs[0].cards).toBe(10);
    expect(hs[0].rows.map((r) => [r.seat, r.name, r.bet, r.taken, r.score])).toEqual([
      [0, 'A', 1, 1, 11], [1, 'B', 0, 9, 9],
    ]);
  });

  it('includes the current hand once it is scored, and not twice when closed', () => {
    const scoring = { ...base, current_hand: { ...base.current_hand, phase: 'scoring' },
      hand_scores: [
        { hand_id: 'h2', session_id: 's0', bet: 3, taken_tricks: 3, hand_score: 13 },
        { hand_id: 'h2', session_id: 's1', bet: 0, taken_tricks: 6, hand_score: 6 },
      ] };
    expect(editableHands(scoring).map((h) => h.hand_id)).toEqual(['h2', 'h1']);
    expect(editableHands(scoring)[0].cards).toBe(9);

    const closedTwice = { ...base, current_hand: { ...base.current_hand, id: 'h1', hand_number: 1, phase: 'closed' } };
    expect(editableHands(closedTwice).map((h) => h.hand_id)).toEqual(['h1']);
  });
});
