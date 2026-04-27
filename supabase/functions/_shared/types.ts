export type ActionKind =
  | 'create_room' | 'join_room' | 'leave_room'
  | 'ready' | 'start_game'
  | 'place_bet' | 'play_card' | 'continue_hand'
  | 'request_timeout';

export type Action =
  | { kind: 'create_room'; player_count: number; max_cards?: number; display_name: string }
  | { kind: 'join_room';   code: string; display_name: string }
  | { kind: 'leave_room';  room_id: string; target_session_id?: string }
  | { kind: 'ready';       room_id: string; is_ready: boolean; target_session_id?: string }
  | { kind: 'start_game';  room_id: string }
  | { kind: 'place_bet';   room_id: string; hand_id: string; bet: number }
  | { kind: 'play_card';   room_id: string; hand_id: string; card: string }
  | { kind: 'continue_hand'; room_id: string; hand_id: string }
  | { kind: 'request_timeout'; room_id: string; hand_id: string; expected_seat: number };

export interface ActorContext {
  auth_user_id: string;
  session_id: string;
  display_name: string;
}

export interface RoomSnapshot {
  room: {
    id: string;
    code: string;
    host_session_id: string;
    player_count: number;
    max_cards: number;
    phase: 'waiting' | 'playing' | 'finished';
    current_hand_id: string | null;
    version: number;
  } | null;
  players: Array<{
    session_id: string;
    display_name: string;
    seat_index: number;
    is_ready: boolean;
    is_connected: boolean;
    last_seen_at: string;
  }>;
  current_hand: {
    id: string;
    room_id: string;
    hand_number: number;
    cards_per_player: number;
    trump_suit: string;
    starting_seat: number;
    current_seat: number;
    phase: 'betting' | 'playing' | 'scoring' | 'closed';
    deck_seed: string;
    started_at: string;
    closed_at: string | null;
  } | null;
  hand_scores: Array<{
    hand_id: string;
    session_id: string;
    bet: number;
    taken_tricks: number;
    hand_score: number;
  }>;
  current_trick: {
    id: string;
    trick_number: number;
    lead_seat: number;
    winner_seat: number | null;
    cards: Array<{ seat: number; card: string }>;
  } | null;
  score_history: Array<{
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
  my_hand?: string[];
}

export type ActionResult =
  | { ok: true; state: RoomSnapshot; version: number; me_session_id?: string }
  | { ok: false; error: string; state: RoomSnapshot; version: number; me_session_id?: string };
