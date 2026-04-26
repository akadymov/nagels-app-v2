/**
 * Nagels Online - Event Handler
 *
 * Handles Supabase Realtime subscriptions for room/lobby events
 * and polling-based game state sync from the server.
 *
 * Game actions (bet, play card, continue hand) are no longer processed
 * via Realtime events -- they go through the Edge Function and the
 * client polls game_states every 2s to stay in sync.
 */

import { RealtimeChannel } from '@supabase/supabase-js';
import { subscribeToRoom, getSupabaseClient } from '../supabase/client';
import { useMultiplayerStore } from '../../store/multiplayerStore';
import { useGameStore } from '../../store/gameStore';
import type { DatabaseRoom, DatabaseGameState, DatabaseGameEvent, DatabaseRoomPlayer } from '../supabase/types';
import { startNetworkMonitoring, stopNetworkMonitoring, updateLastSyncVersion, setResubscribeCallback, clearResubscribeCallback } from './networkMonitor';

// ============================================================
// CALLBACK REGISTRY
// ============================================================

let onGameStartedCallback: (() => void) | null = null;

/**
 * Register a callback for when the game starts
 */
export function onGameStarted(callback: () => void): void {
  onGameStartedCallback = callback;
}

/**
 * Clear the game started callback
 */
export function clearGameStartedCallback(): void {
  onGameStartedCallback = null;
}

// ============================================================
// CHANNEL MANAGEMENT
// ============================================================

let currentChannel: RealtimeChannel | null = null;
let currentRoomId: string | null = null;

/**
 * Subscribe to room events
 */
export function subscribeToRoomEvents(roomId: string): RealtimeChannel {
  // Unsubscribe from existing channel if any
  unsubscribeFromRoomEvents();

  currentRoomId = roomId;
  const store = useMultiplayerStore.getState();

  currentChannel = subscribeToRoom(roomId, {
    onRoomChange: (payload) => {
      console.log('[EventHandler] Room changed:', payload);
      handleRoomChange(payload.data as DatabaseRoom);
    },

    onGameStateChange: (payload) => {
      console.log('[EventHandler] Game state changed:', payload);
      handleGameStateChange(payload.data as DatabaseGameState);
    },

    onGameEvent: (payload) => {
      console.log('[EventHandler] Game event raw payload:', JSON.stringify(payload));
      // Handle different payload structures from Supabase Realtime
      const event = payload?.data || payload?.new || payload;
      if (event) {
        handleGameEvent(event as DatabaseGameEvent);
      } else {
        console.error('[EventHandler] Invalid game event payload:', payload);
      }
    },

    onPlayerChange: (payload) => {
      console.log('[EventHandler] Player change raw payload:', payload);
      // Fetch fresh player list when any change occurs
      refreshPlayers(roomId);
    },
  });

  store.setSyncStatus('syncing');
  store.setIsReconnecting(false);
  store.setError(null);
  // isConnected will be set to true only after SUBSCRIBED callback fires in client.ts

  // Initial data load
  refreshRoom(roomId);
  refreshPlayers(roomId);
  refreshGameState(roomId); // Load current game state on reconnect

  // Register resubscribe callback so network monitor can re-establish channel on foreground
  setResubscribeCallback(() => {
    if (currentRoomId) {
      console.log('[EventHandler] Re-subscribing to room after foreground restore:', currentRoomId);
      subscribeToRoomEvents(currentRoomId);
    }
  });

  // Start network monitoring for disconnect recovery
  startNetworkMonitoring();

  return currentChannel;
}

/**
 * Unsubscribe from room events
 */
export function unsubscribeFromRoomEvents(): void {
  if (currentChannel) {
    currentChannel.unsubscribe();
    currentChannel = null;
  }

  currentRoomId = null;
  clearGameStartedCallback();
  clearResubscribeCallback();

  // Stop network monitoring
  stopNetworkMonitoring();

  const store = useMultiplayerStore.getState();
  store.setSyncStatus('disconnected');
  store.setIsConnected(false);
}

/**
 * Refresh room data from database
 */
async function refreshRoom(roomId: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { data: room, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', roomId)
      .single();

    if (error || !room) {
      console.error('[EventHandler] Error fetching room:', error);
      return;
    }

    const store = useMultiplayerStore.getState();
    store.setCurrentRoom({
      id: room.id,
      roomCode: room.room_code,
      hostId: room.host_id,
      status: room.status,
      playerCount: room.player_count,
      maxPlayers: room.max_players,
      players: store.currentRoom?.players || [],
      gameConfig: room.game_config as any,
      createdAt: room.created_at,
      lastActivityAt: room.last_activity_at,
    });

    // Check if game just started
    if (room.status === 'playing' && store.currentRoom?.status !== 'playing') {
      console.log('[EventHandler] Game started detected!');
      if (onGameStartedCallback) {
        onGameStartedCallback();
      }
    }
  } catch (error) {
    console.error('[EventHandler] Error refreshing room:', error);
  }
}

/**
 * Refresh players list from database
 */
async function refreshPlayers(roomId: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { data: players, error } = await supabase
      .from('room_players')
      .select('*')
      .eq('room_id', roomId)
      .order('player_index', { ascending: true });

    if (error) {
      console.error('[EventHandler] Error fetching players:', error);
      return;
    }

    if (!players || players.length === 0) {
      console.warn('[EventHandler] No players found in room');
      return;
    }

    const store = useMultiplayerStore.getState();

    const roomPlayers = players.map((p: DatabaseRoomPlayer) => ({
      id: p.id,
      roomId: p.room_id,
      playerId: p.player_id,
      playerName: p.player_name,
      playerIndex: p.player_index,
      isBot: p.is_bot,
      isReady: p.is_ready,
      isConnected: true, // TODO: Track with last_seen_at
    }));

    console.log('[EventHandler] Updated players:', roomPlayers.map(p => `${p.playerName} (${p.playerId})`));
    store.setRoomPlayers(roomPlayers);
  } catch (error) {
    console.error('[EventHandler] Error refreshing players:', error);
  }
}

/**
 * Refresh game state from database.
 * Always force-applies the server state (server is the source of truth).
 */
export async function refreshGameState(roomId: string, force = false): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { data: gameState, error } = await supabase
      .from('game_states')
      .select('*')
      .eq('room_id', roomId)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      console.log('[EventHandler] No game state found (game may not have started yet)');
      return;
    }

    if (!gameState) {
      console.log('[EventHandler] No game state in database');
      return;
    }

    console.log('[EventHandler] Loaded game state from database:', {
      phase: gameState.phase,
      handNumber: gameState.hand_number,
      currentPlayerIndex: gameState.current_player_index,
      version: gameState.version,
    });

    handleGameStateChange(gameState as DatabaseGameState);
  } catch (error) {
    console.error('[EventHandler] Error refreshing game state:', error);
  }
}

// ============================================================
// EVENT HANDLERS
// ============================================================

/**
 * Handle room status changes
 */
function handleRoomChange(payload: any): void {
  const store = useMultiplayerStore.getState();

  console.log('[EventHandler] Raw room change payload:', JSON.stringify(payload));

  // Supabase Realtime v2 payload structure
  // The actual record is in different places depending on the library version
  let room: DatabaseRoom | null = null;

  // Try different payload structures
  if (payload?.new) {
    room = payload.new as DatabaseRoom;
  } else if (payload?.data?.new) {
    room = payload.data.new as DatabaseRoom;
  } else if (payload?.record) {
    room = payload.record as DatabaseRoom;
  } else if (payload?.data) {
    room = payload.data as DatabaseRoom;
  }

  if (!room) {
    console.error('[EventHandler] Room data not found in payload:', payload);
    console.error('[EventHandler] Payload keys:', payload ? Object.keys(payload) : 'payload is null/undefined');
    return;
  }

  console.log('[EventHandler] Room status changed:', room.status);

  // Update room in store
  store.setCurrentRoom({
    id: room.id,
    roomCode: room.room_code,
    hostId: room.host_id,
    status: room.status,
    playerCount: room.player_count,
    maxPlayers: room.max_players,
    players: store.currentRoom?.players || [],
    gameConfig: room.game_config as any,
    createdAt: room.created_at,
    lastActivityAt: room.last_activity_at,
  });

  // Trigger game started callback if status changed to playing
  if (room.status === 'playing' && onGameStartedCallback) {
    console.log('[EventHandler] Triggering game started callback');
    onGameStartedCallback();
  }
}

/**
 * Handle game state changes from server.
 * Always force-applies since the server is the single source of truth.
 */
function handleGameStateChange(state: DatabaseGameState): void {
  const multiplayerStore = useMultiplayerStore.getState();
  const gameStore = useGameStore.getState();

  // Update sync status
  multiplayerStore.setSyncStatus('connected');

  // Update last sync version for disconnect recovery
  if (state.version) {
    updateLastSyncVersion(state.version);
  }

  console.log('[EventHandler] Game state updated:', {
    phase: state.phase,
    handNumber: state.hand_number,
    currentPlayerIndex: state.current_player_index,
    trumpSuit: state.trump_suit,
    version: state.version,
  });

  // Sync game state with gameStore
  // This ensures game state is restored after reconnection
  if (state.game_state) {
    const remoteGameState = state.game_state as any;

    // Only sync if we have players (game is initialized)
    if (gameStore.players.length > 0) {
      console.log('[EventHandler] Syncing game state from server...');
      const remoteData = {
        phase: remoteGameState.phase ?? state.phase,
        handNumber: remoteGameState.handNumber ?? state.hand_number,
        totalHands: remoteGameState.totalHands ?? gameStore.totalHands,
        playerCount: remoteGameState.playerCount ?? gameStore.playerCount,
        maxCardsPerPlayer: remoteGameState.maxCardsPerPlayer ?? gameStore.maxCardsPerPlayer,
        currentPlayerIndex: remoteGameState.currentPlayerIndex ?? state.current_player_index,
        startingPlayerIndex: remoteGameState.startingPlayerIndex ?? gameStore.startingPlayerIndex,
        firstHandStartingPlayerIndex: remoteGameState.firstHandStartingPlayerIndex ?? gameStore.firstHandStartingPlayerIndex,
        trumpSuit: remoteGameState.trumpSuit ?? state.trump_suit,
        cardsPerPlayer: remoteGameState.cardsPerPlayer ?? state.cards_per_player,
        bettingPlayerIndex: remoteGameState.bettingPlayerIndex ?? gameStore.bettingPlayerIndex,
        hasAllBets: remoteGameState.hasAllBets ?? gameStore.hasAllBets,
        currentTrick: remoteGameState.currentTrick,
        tricks: remoteGameState.tricks ?? [],
        players: remoteGameState.players ?? gameStore.players,
        scoreHistory: remoteGameState.scoreHistory ?? gameStore.scoreHistory,
        version: state.version ?? 0,
      };

      gameStore.forceRemoteState(remoteData);
    }
  }
}

/**
 * Handle game events (lobby/chat only -- game actions go through Edge Function)
 */
function handleGameEvent(event: DatabaseGameEvent | null | undefined): void {
  if (!event) {
    console.warn('[EventHandler] Received null/undefined event');
    return;
  }

  switch (event.event_type) {
    case 'player_joined':
      handlePlayerJoined(event);
      break;

    case 'player_left':
      handlePlayerLeft(event);
      break;

    case 'player_ready':
      handlePlayerReady(event);
      break;

    case 'game_started':
      handleGameStartedEvent(event);
      break;

    case 'chat_message':
      handleChatMessage(event);
      break;

    default:
      console.log('[EventHandler] Ignoring event type:', event.event_type);
  }
}

// ============================================================
// SPECIFIC EVENT HANDLERS
// ============================================================

function handlePlayerJoined(event: DatabaseGameEvent): void {
  const { player_name } = event.event_data as { player_id: string; player_name: string };
  console.log('[EventHandler] Player joined event:', player_name);

  // Refresh player list to get updated data
  if (currentRoomId) {
    refreshPlayers(currentRoomId);
  }
}

function handlePlayerLeft(event: DatabaseGameEvent): void {
  const { player_name } = event.event_data as { player_id: string; player_name: string };
  console.log('[EventHandler] Player left event:', player_name);

  // Refresh player list to get updated data
  if (currentRoomId) {
    refreshPlayers(currentRoomId);
  }
}

function handlePlayerReady(event: DatabaseGameEvent): void {
  const { player_id, is_ready } = event.event_data as { player_id: string; is_ready: boolean };
  console.log('[EventHandler] Player ready event:', player_id, is_ready);

  // Optimistic update
  const store = useMultiplayerStore.getState();
  store.updateRoomPlayer(player_id, { isReady: is_ready });
}

function handleGameStartedEvent(event: DatabaseGameEvent): void {
  console.log('[EventHandler] Game started event!');

  // Trigger callback if registered
  if (onGameStartedCallback) {
    onGameStartedCallback();
  }
}

function handleChatMessage(event: DatabaseGameEvent): void {
  const { player_id, player_name, text, timestamp } = event.event_data as {
    player_id: string;
    player_name: string;
    text: string;
    timestamp: number;
  };
  console.log('[EventHandler] Chat message from:', player_name, text);

  const store = useMultiplayerStore.getState();
  store.addChatMessage({
    id: event.id || `${player_id}-${timestamp}`,
    playerId: player_id,
    playerName: player_name,
    text,
    timestamp,
  });
}

// ============================================================
// UTILITIES
// ============================================================

/**
 * Check if currently subscribed to a room
 */
export function isSubscribed(): boolean {
  return currentChannel !== null;
}

/**
 * Get current channel
 */
export function getCurrentChannel(): RealtimeChannel | null {
  return currentChannel;
}
