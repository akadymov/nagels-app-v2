/**
 * Nägels Online - useMultiplayer Hook
 *
 * Main hook for multiplayer functionality
 */

import { useEffect, useCallback, useState } from 'react';
import { useMultiplayerStore } from '../store/multiplayerStore';
import type { MultiplayerStore } from '../store/multiplayerStore';
import {
  getGuestSession,
  getPlayerName as getPlayerNameFromStorage,
  setPlayerName as setPlayerNameInStorage,
} from '../lib/supabase/auth';
import {
  quickMatch,
  joinRoom,
  createRoom,
  leaveRoom,
  setPlayerReady,
  startGame,
  loadRoom,
} from '../lib/multiplayer/roomManager';
import {
  subscribeToRoomEvents,
  unsubscribeFromRoomEvents,
} from '../lib/multiplayer/eventHandler';
import { manualReconnect } from '../lib/multiplayer/networkMonitor';
import { isSupabaseConfigured } from '../lib/supabase/client';
import type { Room, GameConfig, GuestSession, RoomPlayer, SyncStatus } from '../lib/supabase/types';

export interface UseMultiplayerReturn {
  // Session
  guestSession: GuestSession | null;
  playerName: string;
  setPlayerName: (name: string) => Promise<void>;

  // Room
  currentRoom: Room | null;
  roomPlayers: RoomPlayer[];
  myPlayerId: string | null;
  myPlayerIndex: number | null;
  isHost: boolean;
  amIReady: boolean;
  playerCount: number;
  readyCount: number;
  canStartGame: boolean;

  // Connection
  syncStatus: SyncStatus;
  isConnected: boolean;
  isReconnecting: boolean;
  error: string | null;
  isConfigured: boolean;

  // Actions
  quickMatch: () => Promise<Room>;
  joinRoom: (code: string) => Promise<Room>;
  createRoom: (config?: Partial<GameConfig>) => Promise<Room>;
  setReady: (ready: boolean) => Promise<void>;
  startGame: () => Promise<void>;
  leaveRoom: () => Promise<void>;
  refreshRoom: () => Promise<void>;
  reconnect: () => void;
}

/**
 * Main multiplayer hook
 */
export function useMultiplayer(): UseMultiplayerReturn {
  const [playerName, setPlayerNameState] = useState<string>('Shark');

  const guestSession = useMultiplayerStore((s) => s.guestSession);
  const currentRoom = useMultiplayerStore((s) => s.currentRoom);
  const roomPlayers = useMultiplayerStore((s) => s.roomPlayers);
  const myPlayerId = useMultiplayerStore((s) => s.myPlayerId);
  const myPlayerIndex = useMultiplayerStore((s) => s.myPlayerIndex);
  const isHost = useMultiplayerStore((s) => s.isHost);
  const syncStatus = useMultiplayerStore((s) => s.syncStatus);
  const isConnected = useMultiplayerStore((s) => s.isConnected);
  const isReconnecting = useMultiplayerStore((s) => s.isReconnecting);
  const error = useMultiplayerStore((s) => s.error);
  const amIReady = useMultiplayerStore((s) => s.amIReady());
  const playerCount = useMultiplayerStore((s) => s.getRoomPlayerCount());
  const readyCount = useMultiplayerStore((s) => s.getReadyPlayerCount());
  const canStartGame = useMultiplayerStore((s) => s.canStartGame());

  // Initialize guest session on mount
  useEffect(() => {
    const initSession = async () => {
      const session = await getGuestSession();
      if (session) {
        useMultiplayerStore.getState().setGuestSession(session);
        setPlayerNameState(session.playerName);
      }
    };

    initSession();
  }, []);

  // Load player name from storage
  useEffect(() => {
    const loadPlayerName = async () => {
      const name = await getPlayerNameFromStorage();
      setPlayerNameState(name);
    };
    loadPlayerName();
  }, []);

  // Subscribe to room events when in a room.
  // NOTE: Do NOT unsubscribe in the cleanup here. The channel lifecycle is
  // managed at the module level in eventHandler.ts. Calling channel.unsubscribe()
  // on unmount causes a stale CLOSED event that overrides the new channel's
  // connected state when navigating between screens (CreateRoom → WaitingRoom).
  // Unsubscription happens automatically inside subscribeToRoomEvents() on the
  // next call, and explicitly via unsubscribeFromRoomEvents() when leaving a room.
  useEffect(() => {
    if (currentRoom) {
      subscribeToRoomEvents(currentRoom.id);
    } else {
      unsubscribeFromRoomEvents();
    }
  }, [currentRoom?.id]);

  // Actions
  const handleQuickMatch = useCallback(async () => {
    const room = await quickMatch();
    useMultiplayerStore.getState().setCurrentRoom(room);
    useMultiplayerStore.getState().setRoomPlayers(room.players);
    return room;
  }, []);

  const handleJoinRoom = useCallback(async (code: string) => {
    const room = await joinRoom(code);
    useMultiplayerStore.getState().setCurrentRoom(room);
    useMultiplayerStore.getState().setRoomPlayers(room.players);
    return room;
  }, []);

  const handleCreateRoom = useCallback(async (config?: Partial<GameConfig>) => {
    const room = await createRoom(config);
    useMultiplayerStore.getState().setCurrentRoom(room);
    useMultiplayerStore.getState().setRoomPlayers(room.players);
    return room;
  }, []);

  const handleSetReady = useCallback(async (ready: boolean) => {
    await setPlayerReady(ready);
  }, []);

  const handleStartGame = useCallback(async () => {
    await startGame();
  }, []);

  const handleLeaveRoom = useCallback(async () => {
    await leaveRoom();
    // Room state is cleared in leaveRoom function
  }, []);

  const handleSetPlayerName = useCallback(async (name: string) => {
    await setPlayerNameInStorage(name);
    setPlayerNameState(name);
  }, []);

  const handleRefreshRoom = useCallback(async () => {
    if (!currentRoom) return;
    const room = await loadRoom(currentRoom.id);
    if (room) {
      useMultiplayerStore.getState().setCurrentRoom(room);
      useMultiplayerStore.getState().setRoomPlayers(room.players);
    }
  }, [currentRoom?.id]);

  return {
    // Session
    guestSession,
    playerName,
    setPlayerName: handleSetPlayerName,

    // Room
    currentRoom,
    roomPlayers,
    myPlayerId,
    myPlayerIndex,
    isHost,
    amIReady,
    playerCount,
    readyCount,
    canStartGame,

    // Connection
    syncStatus,
    isConnected,
    isReconnecting,
    error,
    isConfigured: isSupabaseConfigured(),

    // Actions
    quickMatch: handleQuickMatch,
    joinRoom: handleJoinRoom,
    createRoom: handleCreateRoom,
    setReady: handleSetReady,
    startGame: handleStartGame,
    leaveRoom: handleLeaveRoom,
    refreshRoom: handleRefreshRoom,
    reconnect: manualReconnect,
  };
}
