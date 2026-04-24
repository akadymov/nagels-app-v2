/**
 * Nägels Online - Room Manager
 *
 * Handles room creation, joining, leaving, and management
 */

import { getSupabaseClient, isSupabaseConfigured } from '../supabase/client';
import { getGuestSession } from '../supabase/auth';
import { useMultiplayerStore } from '../../store/multiplayerStore';
import { saveActiveRoom, clearActiveRoom } from './rejoinManager';
import type { Room, RoomPlayer, GameConfig } from '../supabase/types';

// ============================================================
// ROOM CODE GENERATION
// ============================================================

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 to avoid confusion
const CODE_LENGTH = 6;

/**
 * Generate a random 6-character room code
 */
export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  }
  return code;
}

/**
 * Validate room code format
 */
export function isValidRoomCode(code: string): boolean {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code.toUpperCase());
}

// ============================================================
// ROOM CREATION
// ============================================================

/**
 * Create a new private room
 */
export async function createRoom(config: Partial<GameConfig> = {}): Promise<Room> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  const session = await getGuestSession();
  if (!session) {
    throw new Error('No guest session');
  }

  const supabase = getSupabaseClient();
  const roomCode = generateRoomCode();

  // Create room
  const maxPlayers = config.playerCount ?? 4;

  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .insert({
      room_code: roomCode,
      host_id: session.sessionId,
      status: 'waiting',
      player_count: 1,
      max_players: maxPlayers,
      game_config: {
        playerCount: maxPlayers,
        maxCards: 10,
        autoStart: false,
        ...config,
      },
    })
    .select()
    .single();

  if (roomError) {
    console.error('[RoomManager] Error creating room:', roomError);
    throw new Error('Failed to create room');
  }

  // Add host as first player
  const { data: player, error: playerError } = await supabase
    .from('room_players')
    .insert({
      room_id: room.id,
      player_id: session.sessionId,
      player_name: session.playerName,
      player_index: 0,
      is_bot: false,
      is_ready: false,
    })
    .select()
    .single();

  if (playerError) {
    console.error('[RoomManager] Error adding host to room:', playerError);
    // Rollback room creation
    await supabase.from('rooms').delete().eq('id', room.id);
    throw new Error('Failed to join room');
  }

  // Update local store
  useMultiplayerStore.getState().setMyPlayerId(session.sessionId);
  useMultiplayerStore.getState().setMyPlayerIndex(0);
  useMultiplayerStore.getState().setIsHost(true);

  const result = dbRoomToRoom(room, [player]);
  // Persist so the player can rejoin after a refresh
  await saveActiveRoom(result.id, result.roomCode, 'WaitingRoom');

  return result;
}

/**
 * Create a room for quick match
 */
export async function createQuickMatchRoom(): Promise<Room> {
  return createRoom({
    autoStart: true,
  });
}

// ============================================================
// ROOM JOINING
// ============================================================

/**
 * Join a room by code
 */
export async function joinRoom(roomCode: string): Promise<Room> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  if (!isValidRoomCode(roomCode)) {
    throw new Error('Invalid room code');
  }

  const session = await getGuestSession();
  if (!session) {
    throw new Error('No guest session');
  }

  const supabase = getSupabaseClient();

  // Find room
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('*')
    .eq('room_code', roomCode.toUpperCase())
    .single();

  if (roomError || !room) {
    throw new Error('Room not found');
  }

  if (room.status !== 'waiting') {
    throw new Error('Room is not accepting players');
  }

  // Get existing players
  const { data: existingPlayers, error: playersError } = await supabase
    .from('room_players')
    .select('*')
    .eq('room_id', room.id);

  if (playersError) {
    throw new Error('Failed to load room players');
  }

  // Check if room is full
  if (existingPlayers && existingPlayers.length >= room.max_players) {
    throw new Error('Room is full');
  }

  // Determine player index (next available)
  const playerIndex = existingPlayers ? existingPlayers.length : 0;

  // Check if already in room
  const alreadyInRoom = existingPlayers?.find((p) => p.player_id === session.sessionId);
  if (alreadyInRoom) {
    // Already joined, just return room
    useMultiplayerStore.getState().setMyPlayerId(session.sessionId);
    useMultiplayerStore.getState().setMyPlayerIndex(alreadyInRoom.player_index);
    useMultiplayerStore.getState().setIsHost(session.sessionId === room.host_id);
    const existing = dbRoomToRoom(room, existingPlayers);
    await saveActiveRoom(existing.id, existing.roomCode, 'WaitingRoom');
    return existing;
  }

  // Add player to room
  const { data: newPlayer, error: joinError } = await supabase
    .from('room_players')
    .insert({
      room_id: room.id,
      player_id: session.sessionId,
      player_name: session.playerName,
      player_index: playerIndex,
      is_bot: false,
      is_ready: false,
    })
    .select()
    .single();

  if (joinError) {
    console.error('[RoomManager] Error joining room:', joinError);
    throw new Error('Failed to join room');
  }

  // Update room player count
  await supabase
    .from('rooms')
    .update({ player_count: (existingPlayers?.length || 0) + 1 })
    .eq('id', room.id);

  // Update local store
  useMultiplayerStore.getState().setMyPlayerId(session.sessionId);
  useMultiplayerStore.getState().setMyPlayerIndex(playerIndex);
  useMultiplayerStore.getState().setIsHost(session.sessionId === room.host_id);

  const joined = dbRoomToRoom(room, [...(existingPlayers || []), newPlayer]);
  await saveActiveRoom(joined.id, joined.roomCode, 'WaitingRoom');
  return joined;
}

// ============================================================
// QUICK MATCH
// ============================================================

/**
 * Find an available room or create a new one
 */
export async function quickMatch(): Promise<Room> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  const supabase = getSupabaseClient();

  // Find available waiting rooms with space
  const { data: availableRooms, error } = await supabase
    .from('rooms')
    .select('*, room_players(*)')
    .eq('status', 'waiting')
    .lt('player_count', 4)
    .order('created_at', { ascending: true })
    .limit(10);

  if (error) {
    console.error('[RoomManager] Error finding rooms:', error);
    // Fall back to creating new room
    return createQuickMatchRoom();
  }

  // Filter rooms that actually have space (player_count might be stale)
  const roomsWithSpace = (availableRooms || []).filter(
    (r) => (r as any).room_players && (r as any).room_players.length < 4
  );

  if (roomsWithSpace.length > 0) {
    // Join the first available room
    const roomToJoin = roomsWithSpace[0];
    try {
      return await joinRoom(roomToJoin.room_code);
    } catch (error) {
      console.error('[RoomManager] Error joining quick match room:', error);
      // Try next room or create new
      if (roomsWithSpace.length > 1) {
        return await joinRoom(roomsWithSpace[1].room_code);
      }
    }
  }

  // No available rooms, create new one
  return createQuickMatchRoom();
}

// ============================================================
// ROOM ACTIONS
// ============================================================

/**
 * Set player ready status
 */
export async function setPlayerReady(isReady: boolean): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  const state = useMultiplayerStore.getState();
  if (!state.myPlayerId || !state.currentRoom) {
    throw new Error('Not in a room');
  }

  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('room_players')
    .update({ is_ready: isReady })
    .eq('room_id', state.currentRoom.id)
    .eq('player_id', state.myPlayerId);

  if (error) {
    console.error('[RoomManager] Error setting ready status:', error);
    throw new Error('Failed to update ready status');
  }

  // Update local store optimistically
  state.updateRoomPlayer(state.myPlayerId, { isReady });
}

/**
 * Leave the current room
 */
export async function leaveRoom(): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  const state = useMultiplayerStore.getState();
  if (!state.myPlayerId || !state.currentRoom) {
    return; // Not in a room
  }

  const supabase = getSupabaseClient();

  // Remove player from room
  const { error } = await supabase
    .from('room_players')
    .delete()
    .eq('room_id', state.currentRoom.id)
    .eq('player_id', state.myPlayerId);

  if (error) {
    console.error('[RoomManager] Error leaving room:', error);
  }

  // Update room player count
  await supabase
    .from('rooms')
    .update({ player_count: Math.max(0, state.roomPlayers.length - 1) })
    .eq('id', state.currentRoom.id);

  // Clear active room from storage (no more rejoin needed)
  await clearActiveRoom();

  // Clear local store
  state.setCurrentRoom(null);
  state.setRoomPlayers([]);
  state.setMyPlayerId(null);
  state.setMyPlayerIndex(null);
  state.setIsHost(false);
}

/**
 * Start the game (host only)
 */
export async function startGame(): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  const state = useMultiplayerStore.getState();
  if (!state.isHost || !state.currentRoom) {
    throw new Error('Only the host can start the game');
  }

  const supabase = getSupabaseClient();

  // Update room status
  const { error } = await supabase
    .from('rooms')
    .update({ status: 'playing' })
    .eq('id', state.currentRoom.id);

  if (error) {
    console.error('[RoomManager] Error starting game:', error);
    throw new Error('Failed to start game');
  }
}

// ============================================================
// ROOM LOADING
// ============================================================

/**
 * Load room details by ID
 */
export async function loadRoom(roomId: string): Promise<Room | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = getSupabaseClient();

  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single();

  if (roomError || !room) {
    return null;
  }

  const { data: players, error: playersError } = await supabase
    .from('room_players')
    .select('*')
    .eq('room_id', roomId);

  if (playersError) {
    console.error('[RoomManager] Error loading players:', playersError);
    return dbRoomToRoom(room, []);
  }

  return dbRoomToRoom(room, players || []);
}

/**
 * Add a bot to the current room (host only)
 */
export async function addBotToRoom(): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Not configured');

  const store = useMultiplayerStore.getState();
  const room = store.currentRoom;
  if (!room) {
    console.error('[RoomManager] addBotToRoom: no currentRoom in store');
    throw new Error('No active room');
  }

  const currentPlayers = store.roomPlayers;
  console.log('[RoomManager] addBotToRoom: room', room.id, 'players:', currentPlayers.length, '/', room.maxPlayers);

  if (currentPlayers.length >= room.maxPlayers) {
    throw new Error('Room is full');
  }

  // Bot names
  const botNames = ['Overkill', 'Nil', 'Trumpster', 'Longshot', 'Trickster'];
  const botIndex = currentPlayers.filter(p => p.isBot).length;
  const botName = botNames[botIndex % botNames.length];
  // Generate a proper UUID for the bot (player_id column is UUID type)
  const botId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'b0700000-' + Math.random().toString(16).slice(2, 6) + '-4000-8000-' + Date.now().toString(16).padStart(12, '0');

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('room_players')
    .insert({
      room_id: room.id,
      player_id: botId,
      player_name: botName,
      player_index: currentPlayers.length,
      is_bot: true,
      is_ready: true, // Bots are always ready
    });

  if (error) {
    console.error('[RoomManager] Error adding bot:', error.message, error.code, error.details);
    throw new Error(`Failed to add bot: ${error.message}`);
  }

  // Update player count in room
  await supabase
    .from('rooms')
    .update({ player_count: currentPlayers.length + 1 })
    .eq('id', room.id);

  console.log('[RoomManager] Bot added:', botName);
}

/**
 * Remove a bot from the current room (host only)
 */
export async function removeBotFromRoom(botPlayerId: string): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Not configured');

  const store = useMultiplayerStore.getState();
  const room = store.currentRoom;
  if (!room) throw new Error('No active room');

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('room_players')
    .delete()
    .eq('room_id', room.id)
    .eq('player_id', botPlayerId);

  if (error) {
    console.error('[RoomManager] Error removing bot:', error.message);
    throw new Error(`Failed to remove bot: ${error.message}`);
  }

  // Update player count
  const currentPlayers = store.roomPlayers;
  await supabase
    .from('rooms')
    .update({ player_count: Math.max(0, currentPlayers.length - 1) })
    .eq('id', room.id);

  console.log('[RoomManager] Bot removed:', botPlayerId);
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Convert database room to app room
 */
function dbRoomToRoom(dbRoom: any, dbPlayers: any[]): Room {
  return {
    id: dbRoom.id,
    roomCode: dbRoom.room_code,
    hostId: dbRoom.host_id,
    status: dbRoom.status,
    playerCount: dbRoom.player_count,
    maxPlayers: dbRoom.max_players,
    players: dbPlayers.map((p) => ({
      id: p.id,
      roomId: p.room_id,
      playerId: p.player_id,
      playerName: p.player_name,
      playerIndex: p.player_index,
      isBot: p.is_bot,
      isReady: p.is_ready,
      isConnected: true, // TODO: Track with last_seen_at
    })),
    gameConfig: dbRoom.game_config as GameConfig,
    createdAt: dbRoom.created_at,
    lastActivityAt: dbRoom.last_activity_at,
  };
}
