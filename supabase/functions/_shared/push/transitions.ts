import type { RoomSnapshot, ActorContext } from '../types.ts';

export type PushEvent =
  | { type: 'game_start';     room_id: string; room_code: string; recipients: string[] }
  | { type: 'your_bid';       room_id: string; room_code: string; recipient: string }
  | { type: 'your_turn';      room_id: string; room_code: string; recipient: string;
                              hand_id: string; trick_number: number }
  | { type: 'hand_end';       room_id: string; room_code: string; recipients: string[];
                              hand_number: number;
                              scores: Array<{ session_id: string; hand_score: number }> }
  | { type: 'player_joined';  room_id: string; room_code: string; recipient: string;
                              joiner_name: string }
  | { type: 'game_end';       room_id: string; room_code: string; recipients: string[];
                              winner_session_id: string };

export type ActionKind =
  | 'create_room' | 'join_room' | 'leave_room' | 'ready' | 'start_game'
  | 'place_bet'   | 'play_card' | 'continue_hand' | 'request_timeout' | 'restart_game';

/**
 * A structurally compatible but deliberately looser version of RoomSnapshot
 * that accepts string-typed phase fields. This allows test fixtures that build
 * room objects from helper functions (where TypeScript widens the literal type
 * to string) to pass without requiring `as any` at every call site.
 *
 * Production callers can pass a real RoomSnapshot — the type is a supertype.
 */
type LooseRoom = {
  id: string;
  code: string;
  host_session_id: string;
  phase: string;
  current_hand_id: string | null;
  player_count: number;
  max_cards: number;
  version: number;
  [key: string]: unknown;
} | null;

type LoosePlayer = {
  session_id: string;
  display_name: string;
  seat_index: number;
  is_ready: boolean;
  is_connected: boolean;
  last_seen_at: string;
  [key: string]: unknown;
};

type LooseHand = {
  id: string;
  room_id: string;
  hand_number: number;
  cards_per_player: number;
  trump_suit: string;
  starting_seat: number;
  current_seat: number;
  phase: string;
  deck_seed: string;
  started_at: string;
  closed_at: string | null;
} | null;

type LooseHandScore = {
  hand_id: string;
  session_id: string;
  bet: number;
  taken_tricks: number;
  hand_score: number;
};

type LooseTrick = {
  id?: string;
  trick_number: number;
  lead_seat?: number;
  winner_seat?: number | null;
  cards?: Array<{ seat: number; card: string }>;
} | null;

type LooseScoreHistory = Array<{
  hand_number: number;
  closed_at: string | null;
  scores: Array<{
    hand_id: string;
    session_id: string;
    bet: number;
    taken_tricks: number;
    hand_score: number;
  }>;
}>;

type LooseSnapshot = {
  room: LooseRoom;
  players: LoosePlayer[];
  current_hand: LooseHand;
  hand_scores: LooseHandScore[];
  current_trick: LooseTrick;
  last_closed_trick?: LooseTrick;
  score_history: LooseScoreHistory;
  my_hand?: string[];
};

// Verify that a real RoomSnapshot is assignable to LooseSnapshot at compile time.
// If this line errors, LooseSnapshot has drifted from the production type.
const _typeCheck: LooseSnapshot = null as unknown as RoomSnapshot;
void _typeCheck;

function seatToSession(snap: LooseSnapshot, seat: number): string | null {
  return snap.players.find((p) => p.seat_index === seat)?.session_id ?? null;
}

function allSessionIds(snap: LooseSnapshot): string[] {
  return snap.players.map((p) => p.session_id);
}

export function detectTransitions(
  prev: LooseSnapshot | null,
  next: LooseSnapshot,
  actor: ActorContext,
  action_kind: ActionKind,
): PushEvent[] {
  const events: PushEvent[] = [];
  if (!next.room) return events;
  const room_id = next.room.id;
  const room_code = next.room.code;

  // player_joined — prev may be null (join_room first time room visible to actor)
  if (action_kind === 'join_room') {
    const host = next.room.host_session_id;
    if (host !== actor.session_id) {
      const joiner = next.players.find((p) => p.session_id === actor.session_id);
      if (joiner) {
        events.push({
          type: 'player_joined',
          room_id, room_code,
          recipient: host,
          joiner_name: joiner.display_name,
        });
      }
    }
    return events;
  }

  // create_room — never emits push events (the host is the only person there).
  if (action_kind === 'create_room' || !prev) return events;

  // game_start: current_hand transitioned null → set
  if (prev.current_hand === null && next.current_hand !== null) {
    events.push({
      type: 'game_start',
      room_id, room_code,
      recipients: allSessionIds(next),
    });
  }

  // game_end: room.phase transitioned to 'finished'
  if (prev.room?.phase !== 'finished' && next.room.phase === 'finished') {
    const totals = new Map<string, number>();
    for (const h of next.score_history) {
      for (const s of h.scores) {
        totals.set(s.session_id, (totals.get(s.session_id) ?? 0) + s.hand_score);
      }
    }
    let winner: string = next.players[0]?.session_id ?? '';
    let max = -Infinity;
    for (const [sid, total] of totals) {
      if (total > max) { max = total; winner = sid; }
    }
    events.push({
      type: 'game_end',
      room_id, room_code,
      recipients: allSessionIds(next),
      winner_session_id: winner,
    });
  }

  // hand_end: current_hand.phase transitioned !closed → closed
  const prevPhase = prev.current_hand?.phase ?? null;
  const nextPhase = next.current_hand?.phase ?? null;
  if (prevPhase !== 'closed' && nextPhase === 'closed') {
    events.push({
      type: 'hand_end',
      room_id, room_code,
      recipients: allSessionIds(next),
      hand_number: next.current_hand!.hand_number,
      scores: next.hand_scores
        .filter((s) => s.hand_id === next.current_hand!.id)
        .map((s) => ({ session_id: s.session_id, hand_score: s.hand_score })),
    });
  }

  // your_bid / your_turn: current_seat changed in betting/playing phase
  if (prev.current_hand && next.current_hand
      && prev.current_hand.current_seat !== next.current_hand.current_seat) {
    const recipient = seatToSession(next, next.current_hand.current_seat);
    if (recipient) {
      if (next.current_hand.phase === 'betting') {
        events.push({ type: 'your_bid', room_id, room_code, recipient });
      } else if (next.current_hand.phase === 'playing') {
        events.push({
          type: 'your_turn',
          room_id, room_code,
          recipient,
          hand_id: next.current_hand.id,
          trick_number: next.current_trick?.trick_number ?? 0,
        });
      }
    }
  }

  return events;
}
