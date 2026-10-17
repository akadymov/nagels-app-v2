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
