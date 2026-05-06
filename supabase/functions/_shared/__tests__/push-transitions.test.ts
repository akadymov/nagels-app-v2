import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { detectTransitions } from '../push/transitions.ts';
import type { RoomSnapshot, ActorContext } from '../types.ts';

function emptySnap(): RoomSnapshot {
  return {
    room: null, players: [], current_hand: null,
    hand_scores: [], current_trick: null, last_closed_trick: null,
    score_history: [], my_hand: [],
  };
}
function room(id: string, code: string, host_session_id: string, phase = 'waiting') {
  return { id, code, host_session_id, phase, current_hand_id: null,
           player_count: 4, max_cards: 10, version: 1, created_at: '2026-05-06T00:00:00Z' };
}
function player(seat: number, session_id: string, display_name: string) {
  return { seat_index: seat, session_id, display_name,
           is_ready: true, is_connected: true, last_seen_at: '2026-05-06T00:00:00Z' };
}
function hand(phase: 'betting' | 'playing' | 'scoring' | 'closed', current_seat: number) {
  return { id: 'h1', room_id: 'r1', hand_number: 1, cards_per_player: 5,
           trump_suit: 'S', starting_seat: 0, current_seat, phase,
           deck_seed: 'x', started_at: '2026-05-06T00:00:00Z',
           closed_at: phase === 'closed' ? '2026-05-06T00:01:00Z' : null };
}
const ACTOR: ActorContext = { auth_user_id: 'u1', session_id: 's1', display_name: 'Akula' };

Deno.test('game_start fires when current_hand transitions null → set', () => {
  const prev = { ...emptySnap(),
    room: room('r1', 'AB12CD', 's-host', 'waiting'),
    players: [player(0, 's-host', 'Host'), player(1, 's2', 'B'), player(2, 's3', 'C'), player(3, 's4', 'D')],
  };
  const next = { ...prev,
    room: { ...prev.room!, phase: 'playing' },
    current_hand: hand('betting', 0),
  };
  const events = detectTransitions(prev, next, ACTOR, 'start_game');
  assertEquals(events.length, 1);
  assertEquals(events[0].type, 'game_start');
  assertEquals((events[0] as any).recipients.sort(), ['s-host', 's2', 's3', 's4']);
});

Deno.test('your_bid fires for the seated session when current_seat changes in betting', () => {
  const players = [player(0, 'sA', 'A'), player(1, 'sB', 'B')];
  const prev = { ...emptySnap(), room: room('r1', 'AB12CD', 'sA', 'playing'),
    players, current_hand: hand('betting', 0) };
  const next = { ...prev, current_hand: hand('betting', 1) };
  const events = detectTransitions(prev, next, ACTOR, 'place_bet');
  assertEquals(events.map(e => e.type), ['your_bid']);
  assertEquals((events[0] as any).recipient, 'sB');
});

Deno.test('your_turn fires for the seated session when current_seat changes in playing', () => {
  const players = [player(0, 'sA', 'A'), player(1, 'sB', 'B')];
  const prev = { ...emptySnap(), room: room('r1', 'AB12CD', 'sA', 'playing'),
    players, current_hand: hand('playing', 0) };
  const next = { ...prev, current_hand: hand('playing', 1) };
  const events = detectTransitions(prev, next, ACTOR, 'play_card');
  assertEquals(events.map(e => e.type), ['your_turn']);
  assertEquals((events[0] as any).recipient, 'sB');
});

Deno.test('your_turn does NOT fire when current_seat is unchanged (snapshot replay)', () => {
  const players = [player(0, 'sA', 'A'), player(1, 'sB', 'B')];
  const prev = { ...emptySnap(), room: room('r1', 'AB12CD', 'sA', 'playing'),
    players, current_hand: hand('playing', 1) };
  const next = { ...prev };
  const events = detectTransitions(prev, next, ACTOR, 'play_card');
  assertEquals(events, []);
});

Deno.test('hand_end fires when phase transitions to closed', () => {
  const players = [player(0, 'sA', 'A'), player(1, 'sB', 'B')];
  const prev = { ...emptySnap(), room: room('r1', 'AB12CD', 'sA', 'playing'),
    players, current_hand: hand('scoring', 0) };
  const next = { ...prev, current_hand: hand('closed', 0),
    hand_scores: [
      { hand_id: 'h1', session_id: 'sA', bet: 2, taken_tricks: 2, hand_score: 12 },
      { hand_id: 'h1', session_id: 'sB', bet: 1, taken_tricks: 0, hand_score: -1 },
    ],
  };
  const events = detectTransitions(prev, next, ACTOR, 'play_card');
  assertEquals(events.length, 1);
  assertEquals(events[0].type, 'hand_end');
  assertEquals((events[0] as any).recipients.sort(), ['sA', 'sB']);
});

Deno.test('player_joined fires for join_room (prev null), recipient is host only', () => {
  const next = { ...emptySnap(),
    room: room('r1', 'AB12CD', 's-host', 'waiting'),
    players: [player(0, 's-host', 'Host'), player(1, 's-new', 'NewGuy')],
  };
  const actor: ActorContext = { auth_user_id: 'u-new', session_id: 's-new', display_name: 'NewGuy' };
  const events = detectTransitions(null, next, actor, 'join_room');
  assertEquals(events.length, 1);
  assertEquals(events[0].type, 'player_joined');
  assertEquals((events[0] as any).recipient, 's-host');
  assertEquals((events[0] as any).joiner_name, 'NewGuy');
});

Deno.test('player_joined does NOT fire when host themselves rejoins (no length change)', () => {
  const players = [player(0, 's-host', 'Host'), player(1, 's2', 'B')];
  const prev = { ...emptySnap(), room: room('r1', 'AB12CD', 's-host', 'waiting'), players };
  const next = { ...prev };
  const events = detectTransitions(prev, next, ACTOR, 'ready');
  assertEquals(events, []);
});

Deno.test('game_end fires when room.phase transitions to finished', () => {
  const players = [player(0, 'sA', 'A'), player(1, 'sB', 'B')];
  const prev = { ...emptySnap(), room: room('r1', 'AB12CD', 'sA', 'playing'), players };
  const next = { ...prev, room: { ...prev.room!, phase: 'finished' },
    score_history: [
      { hand_number: 1, closed_at: 'x',
        scores: [
          { hand_id: 'h1', session_id: 'sA', bet: 2, taken_tricks: 2, hand_score: 22 },
          { hand_id: 'h1', session_id: 'sB', bet: 0, taken_tricks: 1, hand_score: -1 },
        ] },
    ],
  };
  const events = detectTransitions(prev, next, ACTOR, 'play_card');
  assertEquals(events.length, 1);
  assertEquals(events[0].type, 'game_end');
  assertEquals((events[0] as any).winner_session_id, 'sA');
});

Deno.test('create_room emits no events (prev null, action_kind create_room)', () => {
  const next = { ...emptySnap(),
    room: room('r1', 'AB12CD', 's-host', 'waiting'),
    players: [player(0, 's-host', 'Host')],
  };
  const events = detectTransitions(null, next, ACTOR, 'create_room');
  assertEquals(events, []);
});
