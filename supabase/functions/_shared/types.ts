export type ActionKind =
  | 'create_room' | 'join_room' | 'leave_room'
  | 'ready' | 'start_game'
  | 'place_bet' | 'play_card' | 'continue_hand'
  | 'request_timeout';

export type Action =
  | { kind: 'create_room'; player_count: number; max_cards?: number; display_name: string }
  | { kind: 'join_room';   code: string; display_name: string }
  | { kind: 'leave_room';  room_id: string }
  | { kind: 'ready';       room_id: string; is_ready: boolean }
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
  current_hand: any | null;
  hand_scores: any[];
  current_trick: any | null;
  score_history: any[];
  my_hand?: string[];
}

export type ActionResult =
  | { ok: true; state: RoomSnapshot; version: number }
  | { ok: false; error: string; state: RoomSnapshot; version: number };
