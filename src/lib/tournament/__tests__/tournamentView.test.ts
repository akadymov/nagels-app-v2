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
