/**
 * Nägels Online - Supabase Type Definitions
 *
 * TypeScript types matching the Supabase database schema
 */

// ============================================================
// DATABASE TABLES
// ============================================================

/**
 * rooms table - Game rooms
 */
export interface DatabaseRoom {
  id: string;
  room_code: string;
  host_id: string;
  status: RoomStatus;
  player_count: number;
  max_players: number;
  game_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

export type RoomStatus = 'waiting' | 'playing' | 'finished' | 'abandoned';

/**
 * room_players table - Players in a room
 */
export interface DatabaseRoomPlayer {
  id: string;
  room_id: string;
  player_id: string;
  player_name: string;
  player_index: number; // 0-3 for seating position
  is_bot: boolean;
  is_ready: boolean;
  connected_at: string;
  last_seen_at: string;
}

/**
 * game_states table - Authoritative game state
 */
export interface DatabaseGameState {
  id: string;
  room_id: string;
  hand_number: number;
  phase: GamePhase;
  current_player_index: number;
  trump_suit: string;
  cards_per_player: number;
  players: unknown; // JSONB - serialized Player[]
  current_trick: unknown; // JSONB - serialized Trick
  tricks: unknown; // JSONB - serialized Trick[]
  deck: unknown; // JSONB - serialized Card[]
  version: number;
  game_state?: unknown; // JSONB - Optional extended game state for remote sync
  created_at: string;
  updated_at: string;
}

export type GamePhase = 'lobby' | 'betting' | 'playing' | 'scoring' | 'finished';

/**
 * game_events table - Event log for reconciliation
 */
export interface DatabaseGameEvent {
  id: string;
  room_id: string;
  event_type: GameEventType;
  event_data: Record<string, unknown>;
  player_id: string;
  version: number;
  created_at: string;
}

export type GameEventType =
  | 'player_joined'
  | 'player_left'
  | 'player_ready'
  | 'game_started'
  | 'betting_started'
  | 'bet_placed'
  | 'playing_started'
  | 'card_played'
  | 'trick_completed'
  | 'hand_completed'
  | 'game_finished'
  | 'chat_message';

/**
 * player_sessions table - Guest authentication
 */
export interface DatabasePlayerSession {
  id: string;
  device_id: string;
  player_name: string | null;
  language: string;
  created_at: string;
  last_seen_at: string;
}

// ============================================================
// SUPABASE TABLE TYPES (for select queries)
// ============================================================

export type Tables = {
  rooms: {
    Row: DatabaseRoom;
    Insert: Omit<DatabaseRoom, 'id' | 'created_at' | 'updated_at' | 'last_activity_at'>;
    Update: Partial<DatabaseRoom>;
  };
  room_players: {
    Row: DatabaseRoomPlayer;
    Insert: Omit<DatabaseRoomPlayer, 'id' | 'connected_at' | 'last_seen_at'>;
    Update: Partial<DatabaseRoomPlayer>;
  };
  game_states: {
    Row: DatabaseGameState;
    Insert: Omit<DatabaseGameState, 'id' | 'created_at' | 'updated_at'>;
    Update: Partial<DatabaseGameState>;
  };
  game_events: {
    Row: DatabaseGameEvent;
    Insert: Omit<DatabaseGameEvent, 'id' | 'created_at'>;
    Update: Partial<DatabaseGameEvent>;
  };
  player_sessions: {
    Row: DatabasePlayerSession;
    Insert: Omit<DatabasePlayerSession, 'id' | 'created_at' | 'last_seen_at'>;
    Update: Partial<DatabasePlayerSession>;
  };
};

// ============================================================
// APPLICATION TYPES
// ============================================================

/**
 * Room - Combined room data with players
 */
export interface Room {
  id: string;
  roomCode: string;
  hostId: string;
  status: RoomStatus;
  playerCount: number;
  maxPlayers: number;
  players: RoomPlayer[];
  gameConfig: GameConfig;
  createdAt: string;
  lastActivityAt: string;
}

export interface GameConfig {
  playerCount: number;
  maxCards: number;
  autoStart: boolean;
}

/**
 * RoomPlayer - Player in a room (application level)
 */
export interface RoomPlayer {
  id: string;
  roomId: string;
  playerId: string;
  playerName: string;
  playerIndex: number;
  isBot: boolean;
  isReady: boolean;
  isConnected: boolean;
}

/**
 * Guest Session - Current player's session
 */
export interface GuestSession {
  sessionId: string;   // Supabase Auth user.id (or legacy player_sessions.id)
  deviceId: string;
  playerName: string;
  language: 'en' | 'ru' | 'es';
  createdAt: string;
  lastSeenAt: string;
  isGuest: boolean;    // true = anonymous; false = registered email account
  email: string | null;
}

/**
 * Game Event - Real-time game event
 */
export interface GameEvent {
  id: string;
  roomId: string;
  type: GameEventType;
  data: Record<string, unknown>;
  playerId: string;
  version: number;
  timestamp: string;
}

/**
 * Sync Status - Multiplayer sync state
 */
export type SyncStatus = 'connected' | 'syncing' | 'disconnected';

/**
 * Multiplayer State - Application multiplayer state
 */
export interface MultiplayerState {
  currentRoom: Room | null;
  myPlayerId: string | null;
  myPlayerIndex: number | null;
  isHost: boolean;
  syncStatus: SyncStatus;
  error: string | null;
}

// ============================================================
// RPC FUNCTION TYPES
// ============================================================

export interface PlaceBetParams {
  room_id: string;
  player_id: string;
  bet: number;
  version: number;
}

export interface PlayCardParams {
  room_id: string;
  player_id: string;
  card_id: string;
  version: number;
}

export interface StartGameParams {
  room_id: string;
}

export interface NextHandParams {
  room_id: string;
}
