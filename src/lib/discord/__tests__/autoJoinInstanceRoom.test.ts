// Mock the orchestrator's transitive deps so jest (node env) doesn't choke on
// react-native / Expo modules pulled in via gameClient & friends. This suite
// only exercises the pure decideAutoJoinRole function.
jest.mock('../bootstrap', () => ({ getDiscordInstanceId: jest.fn(() => null) }));
jest.mock('../context', () => ({ isDiscordActivity: jest.fn(() => false) }));
jest.mock('../../gameClient', () => ({ gameClient: {} }));
jest.mock('../../activeRoom', () => ({ getActiveRoom: jest.fn(), setActiveRoom: jest.fn() }));
jest.mock('../../realtimeBroadcast', () => ({ subscribeRoom: jest.fn() }));
jest.mock('../../../store/roomStore', () => ({ useRoomStore: { getState: jest.fn() } }));

import { decideAutoJoinRole } from '../autoJoinInstanceRoom';

describe('decideAutoJoinRole', () => {
  it('seats a player when waiting and a seat is free', () => {
    expect(decideAutoJoinRole({ phase: 'waiting', player_count: 4, seats_taken: 2 })).toBe('player');
  });
  it('spectates when waiting but full', () => {
    expect(decideAutoJoinRole({ phase: 'waiting', player_count: 4, seats_taken: 4 })).toBe('spectator');
  });
  it('spectates when a game is in progress even with a free seat', () => {
    expect(decideAutoJoinRole({ phase: 'playing', player_count: 4, seats_taken: 2 })).toBe('spectator');
  });
});
