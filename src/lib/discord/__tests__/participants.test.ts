// Mock the hook's transitive deps so jest doesn't choke on react-native /
// Expo modules (this test only exercises the pure diffParticipants function).
jest.mock('../../../store/roomStore', () => ({ useRoomStore: jest.fn() }));
jest.mock('../../gameClient', () => ({ gameClient: { refreshSnapshot: jest.fn() } }));
jest.mock('../../supabase/client', () => ({ getSupabaseClient: jest.fn(() => ({ rpc: jest.fn() })) }));
jest.mock('../context', () => ({ isDiscordActivity: jest.fn(() => false) }));
jest.mock('../bootstrap', () => ({ getDiscordSdk: jest.fn(() => null) }));
jest.mock('react', () => ({ useEffect: jest.fn(), useRef: jest.fn(() => ({ current: 0 })) }));

import { diffParticipants } from '../participants';

describe('diffParticipants', () => {
  it('reports ids that were present before but not now', () => {
    const prev = new Set(['a', 'b', 'c']);
    const r = diffParticipants(prev, ['a', 'c']);
    expect(r.left).toEqual(['b']);
    expect([...r.next].sort()).toEqual(['a', 'c']);
  });

  it('reports no departures when everyone stays or joins', () => {
    const prev = new Set(['a']);
    const r = diffParticipants(prev, ['a', 'b']);
    expect(r.left).toEqual([]);
    expect([...r.next].sort()).toEqual(['a', 'b']);
  });

  it('handles an empty previous set', () => {
    const r = diffParticipants(new Set<string>(), ['a']);
    expect(r.left).toEqual([]);
    expect([...r.next]).toEqual(['a']);
  });

  it('reports everyone as left when the new list is empty', () => {
    const r = diffParticipants(new Set(['a', 'b']), []);
    expect(r.left.sort()).toEqual(['a', 'b']);
    expect([...r.next]).toEqual([]);
  });
});
