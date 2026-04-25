/**
 * Nägels Online - Event Handler
 *
 * Handles Supabase Realtime subscriptions for game events
 */

import { RealtimeChannel } from '@supabase/supabase-js';
import { subscribeToRoom, getSupabaseClient } from '../supabase/client';
import { useMultiplayerStore } from '../../store/multiplayerStore';
import { useGameStore } from '../../store/gameStore';
import type { DatabaseRoom, DatabaseGameState, DatabaseGameEvent, DatabaseRoomPlayer } from '../supabase/types';
import type { Card } from '../../game';
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
 * @param force - bypass guards in setRemoteState
 * @param minVersion - only apply if server version > minVersion (prevents stale overwrites)
 */
export async function refreshGameState(roomId: string, force = false, minVersion = 0): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { data: gameState, error } = await supabase
      .from('game_states')
      .select('*')
      .eq('room_id', roomId)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (error || !gameState) return;

    // Skip if server version is not newer than local
    if (minVersion > 0 && (gameState.version || 0) <= minVersion) return;

    if (force) {
      handleGameStateChange(gameState as DatabaseGameState, true);
    } else {
      handleGameStateChange(gameState as DatabaseGameState);
    }
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
 * Handle game state changes from server
 */
function handleGameStateChange(state: DatabaseGameState, force = false): void {
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
      console.log('[EventHandler] Syncing game state from server...', force ? '(FORCE)' : '');
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

      if (force) {
        gameStore.forceRemoteState(remoteData);
      } else {
        gameStore.setRemoteState(remoteData);
      }
    }
  }
}

/**
 * Handle game events
 */
function handleGameEvent(event: DatabaseGameEvent | null | undefined): void {
  if (!event) {
    console.warn('[EventHandler] Received null/undefined event');
    return;
  }

  const store = useMultiplayerStore.getState();

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

    case 'bet_placed':
      handleBetPlaced(event);
      break;

    case 'card_played':
      handleCardPlayed(event);
      break;

    case 'chat_message':
      handleChatMessage(event);
      break;

    case 'trick_completed':
      handleTrickCompleted(event);
      break;

    case 'hand_completed':
      handleHandCompleted(event);
      break;

    case 'game_finished':
      handleGameFinished(event);
      break;

    default:
      console.warn('[EventHandler] Unknown event type:', event.event_type);
  }
}

// ============================================================
// SPECIFIC EVENT HANDLERS
// ============================================================

function handlePlayerJoined(event: DatabaseGameEvent): void {
  const { player_id, player_name } = event.event_data as { player_id: string; player_name: string };
  console.log('[EventHandler] Player joined event:', player_name);

  // Refresh player list to get updated data
  if (currentRoomId) {
    refreshPlayers(currentRoomId);
  }
}

function handlePlayerLeft(event: DatabaseGameEvent): void {
  const { player_id, player_name } = event.event_data as { player_id: string; player_name: string };
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

function handleBetPlaced(event: DatabaseGameEvent): void {
  const { player_id, bet } = event.event_data as { player_id: string; bet: number };
  console.log('[EventHandler] Bet placed event:', player_id, bet);

  // Apply bet to gameStore (for other players' bets)
  const gameStore = useGameStore.getState();
  if (gameStore.myPlayerId !== player_id) {
    gameStore.applyRemoteBet(player_id, bet);
  }
}

function handleCardPlayed(event: DatabaseGameEvent): void {
  const { player_id, card_id, card: cardData } = event.event_data as {
    player_id: string;
    card_id: string;
    card?: { id: string; suit: string; rank: string };
  };
  console.log('[EventHandler] Card played event:', player_id, card_id);

  // Apply card play to gameStore (for other players' card plays)
  const gameStore = useGameStore.getState();
  const player = gameStore.players.find(p => p.id === player_id);

  if (player && gameStore.myPlayerId !== player_id) {
    // Try to find the card in the player's hand
    let card = player.hand.find(c => c.id === card_id);

    // If not found in hand (might not be synced), use card data from event
    if (!card && cardData) {
      card = {
        id: cardData.id,
        suit: cardData.suit as any,
        rank: cardData.rank as any,
      };
      console.log('[EventHandler] Using card data from event:', card);
    }

    if (card) {
      gameStore.applyRemoteCardPlay(player_id, card);
    } else {
      console.error('[EventHandler] Card not found in player hand:', card_id);
    }
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

function handleTrickCompleted(event: DatabaseGameEvent): void {
  const { winner_id, cards } = event.event_data as {
    winner_id: string;
    cards: unknown[];
  };
  console.log('[EventHandler] Trick completed event, winner:', winner_id);

  // TODO: Update gameStore with trick result
}

function handleHandCompleted(event: DatabaseGameEvent): void {
  const { hand_number, scores } = event.event_data as {
    hand_number: number;
    scores: unknown[];
  };
  console.log('[EventHandler] Hand completed event:', hand_number, scores);

  // TODO: Update gameStore with hand results
  // TODO: Show scoreboard modal
}

function handleGameFinished(event: DatabaseGameEvent): void {
  const { final_scores } = event.event_data as { final_scores: unknown[] };
  console.log('[EventHandler] Game finished event!', final_scores);

  // TODO: Show final results
}

// ============================================================
// UTILITIES
// ============================================================

/**
 * Replay missed game events from the database.
 * Called on manual Sync to recover from lost realtime events.
 * Fetches the last N card_played / bet_placed events and re-processes any
 * that haven't been applied to the local game state yet.
 */
export async function replayMissedEvents(roomId: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();

    // Fetch the 50 most recent gameplay events (card plays + bets)
    const { data: events, error } = await supabase
      .from('game_events')
      .select('*')
      .eq('room_id', roomId)
      .in('event_type', ['card_played', 'bet_placed'])
      .order('created_at', { ascending: true })
      .limit(50);

    if (error || !events?.length) {
      console.log('[EventHandler] replayMissedEvents: no events or error', error);
      return;
    }

    console.log('[EventHandler] Replaying', events.length, 'missed events');
    for (const event of events) {
      handleGameEvent(event as DatabaseGameEvent);
    }
  } catch (e) {
    console.error('[EventHandler] replayMissedEvents failed:', e);
  }
}

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
