export type ActionKind =
  | 'create_room' | 'join_room' | 'leave_room'
  | 'ready' | 'start_game'
  | 'place_bet' | 'play_card' | 'continue_hand'
  | 'record_tricks'
  | 'request_timeout'
  | 'restart_game'
  | 'set_display_name';

export type RoomMode = 'standard' | 'scorekeeper';

export type Action =
  | { kind: 'create_room'; player_count: number; max_cards?: number; display_name: string; mode?: RoomMode; silent?: boolean; announce?: boolean }
  | { kind: 'join_room';   code: string; display_name: string }
  | { kind: 'leave_room';  room_id: string; target_session_id?: string }
  | { kind: 'ready';       room_id: string; is_ready: boolean; target_session_id?: string }
  | { kind: 'start_game';  room_id: string }
  | { kind: 'place_bet';   room_id: string; hand_id: string; bet: number }
  | { kind: 'play_card';   room_id: string; hand_id: string; card: string }
  | { kind: 'continue_hand'; room_id: string; hand_id: string }
  | { kind: 'record_tricks'; room_id: string; hand_id: string; tricks: number }
  | { kind: 'request_timeout'; room_id: string; hand_id: string; expected_seat: number }
  | { kind: 'restart_game'; room_id: string }
  | { kind: 'set_display_name'; display_name: string; room_id?: string }
  | { kind: 'set_stake';                 room_id: string; stake: number }
  | { kind: 'toggle_stake_optin';        room_id: string; opted_in: boolean }
  | { kind: 'admin_check' }
  | { kind: 'admin_search_users';        q: string }
  | { kind: 'admin_reset_rating';        target_user_id: string }
  | { kind: 'admin_reset_all_ratings' }
  | { kind: 'admin_grant_telegram';  target_user_id: string }
  | { kind: 'admin_revoke_telegram'; target_user_id: string };

export interface ActorContext {
  auth_user_id: string;
  session_id: string;
  display_name: string;
}

export interface Spectator {
  session_id: string;
  display_name: string;
  avatar?: string | null;
  avatar_url?: string | null;
  avatar_color?: string | null;
  joined_at: string;
}

export interface RoomSnapshot {
  room: {
    id: string;
    code: string;
    host_session_id: string;
    player_count: number;
    max_cards: number;
    /** Host-chosen floor for cards-per-hand. 1 = standard ladder
     *  (includes the two 1-card hands). 2 = "Skip 1-card rounds" —
     *  the centre of the ladder stays at 2 cards. Optional for
     *  backwards-compat with older snapshots that pre-date 029. */
    min_cards_per_hand?: number;
    /** Room game mode. 'standard' (default) deals cards through the app.
     *  'scorekeeper' is an offline-arbitrator mode: no cards are dealt,
     *  players record trick results manually after betting. Fixed at
     *  room creation. Optional for backwards-compat with old snapshots. */
    mode?: RoomMode;
    phase: 'waiting' | 'playing' | 'finished';
    current_hand_id: string | null;
    version: number;
    stake: number;
    stake_locked: boolean;
  } | null;
  players: Array<{
    session_id: string;
    display_name: string;
    seat_index: number;
    is_ready: boolean;
    is_connected: boolean;
    last_seen_at: string;
    /** User-chosen avatar emoji from auth.users.raw_user_meta_data.avatar.
     *  Null/undefined → render initial+color fallback (default avatar). */
    avatar?: string | null;
    /** Profile picture URL (Google `avatar_url` / `picture`). Wins over
     *  the emoji when both are set. */
    avatar_url?: string | null;
    /** User-chosen avatar color hex (#RRGGBB). Null → seat-based default. */
    avatar_color?: string | null;
    opt_in_stake: boolean;
  }>;
  spectators: Spectator[];
  current_hand: {
    id: string;
    room_id: string;
    hand_number: number;
    cards_per_player: number;
    trump_suit: string;
    starting_seat: number;
    current_seat: number;
    phase: 'betting' | 'playing' | 'tricks_recording' | 'scoring' | 'closed';
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
  last_closed_trick: {
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
  /** Scorekeeper mode: session_ids that have submitted a claim
   *  (record_tricks_action) for the current hand. Used by the client to
   *  distinguish "claimed 0" from "not claimed yet" without adding a
   *  column to hand_scores. Empty in standard mode. */
  claim_sessions?: string[];
}

export type ActionResult =
  | { ok: true; state: RoomSnapshot; version: number; me_session_id?: string }
  | { ok: false; error: string; state: RoomSnapshot; version: number; me_session_id?: string };
