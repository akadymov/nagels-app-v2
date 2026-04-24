/**
 * Nägels Online - Multiplayer State Management
 *
 * Zustand store for multiplayer-specific state (rooms, sync, connection)
 */

import { create } from 'zustand';
import type { Room, RoomPlayer, SyncStatus, GuestSession } from '../lib/supabase/types';

// ============================================================
// CHAT TYPES
// ============================================================

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  timestamp: number;
}

// ============================================================
// STORE TYPES
// ============================================================

export interface MultiplayerStore {
  // Session
  guestSession: GuestSession | null;

  // Current room
  currentRoom: Room | null;
  roomPlayers: RoomPlayer[];
  myPlayerId: string | null;
  myPlayerIndex: number | null;
  isHost: boolean;

  // Connection state
  syncStatus: SyncStatus;
  isConnected: boolean;
  isReconnecting: boolean;
  error: string | null;

  // Chat
  chatMessages: ChatMessage[];
  unreadChatCount: number;
  hasUnreadChat: boolean;
  addChatMessage: (message: ChatMessage) => void;
  clearUnreadCount: () => void;

  // Actions
  setGuestSession: (session: GuestSession | null) => void;
  setCurrentRoom: (room: Room | null) => void;
  setRoomPlayers: (players: RoomPlayer[]) => void;
  addRoomPlayer: (player: RoomPlayer) => void;
  removeRoomPlayer: (playerId: string) => void;
  updateRoomPlayer: (playerId: string, updates: Partial<RoomPlayer>) => void;

  setMyPlayerId: (playerId: string | null) => void;
  setMyPlayerIndex: (index: number | null) => void;
  setIsHost: (isHost: boolean) => void;

  setSyncStatus: (status: SyncStatus) => void;
  setIsConnected: (connected: boolean) => void;
  setIsReconnecting: (reconnecting: boolean) => void;
  setError: (error: string | null) => void;

  // Computed
  amIReady: () => boolean;
  getRoomPlayerCount: () => number;
  getReadyPlayerCount: () => number;
  canStartGame: () => boolean;
}

// ============================================================
// INITIAL STATE
// ============================================================

const initialState = {
  guestSession: null,
  currentRoom: null,
  roomPlayers: [],
  myPlayerId: null,
  myPlayerIndex: null,
  isHost: false,
  syncStatus: 'disconnected' as SyncStatus,
  isConnected: false,
  isReconnecting: false,
  error: null,
  chatMessages: [] as ChatMessage[],
  unreadChatCount: 0,
  hasUnreadChat: false,
};

// ============================================================
// STORE
// ============================================================

export const useMultiplayerStore = create<MultiplayerStore>((set, get) => ({
  ...initialState,

  // ============================================================
  // ACTIONS
  // ============================================================

  addChatMessage: (message) => {
    set((state) => {
      // Skip if exact ID already exists (polling re-delivery)
      if (state.chatMessages.some((m) => m.id === message.id)) {
        return {};
      }

      // Deduplicate: if an optimistic message with same playerId+text exists within 5s,
      // replace it with the server version
      const optimisticIdx = state.chatMessages.findIndex(
        (m) =>
          m.id.startsWith('local-') &&
          m.playerId === message.playerId &&
          m.text === message.text &&
          Math.abs(m.timestamp - message.timestamp) < 5000
      );
      if (optimisticIdx !== -1) {
        const updated = [...state.chatMessages];
        updated[optimisticIdx] = { ...updated[optimisticIdx], id: message.id };
        return { chatMessages: updated };
      }

      return {
        chatMessages: [...state.chatMessages, message],
        hasUnreadChat: true,
      };
    });
  },

  clearUnreadCount: () => set({ unreadChatCount: 0, hasUnreadChat: false }),

  setGuestSession: (session) => set({ guestSession: session }),

  setCurrentRoom: (room) => set({ currentRoom: room }),

  setRoomPlayers: (players) => set({ roomPlayers: players }),

  addRoomPlayer: (player) => {
    set((state) => ({
      roomPlayers: [...state.roomPlayers, player],
    }));
  },

  removeRoomPlayer: (playerId) => {
    set((state) => ({
      roomPlayers: state.roomPlayers.filter((p) => p.playerId !== playerId),
    }));
  },

  updateRoomPlayer: (playerId, updates) => {
    set((state) => ({
      roomPlayers: state.roomPlayers.map((p) =>
        p.playerId === playerId ? { ...p, ...updates } : p
      ),
    }));
  },

  setMyPlayerId: (playerId) => set({ myPlayerId: playerId }),

  setMyPlayerIndex: (index) => set({ myPlayerIndex: index }),

  setIsHost: (isHost) => set({ isHost }),

  setSyncStatus: (status) => set({ syncStatus: status }),

  setIsConnected: (connected) => set({ isConnected: connected }),

  setIsReconnecting: (reconnecting) => set({ isReconnecting: reconnecting }),

  setError: (error) => set({ error }),

  // ============================================================
  // COMPUTED GETTERS
  // ============================================================

  amIReady: () => {
    const state = get();
    if (!state.myPlayerId) return false;
    const me = state.roomPlayers.find((p) => p.playerId === state.myPlayerId);
    return me?.isReady ?? false;
  },

  getRoomPlayerCount: () => {
    return get().roomPlayers.length;
  },

  getReadyPlayerCount: () => {
    return get().roomPlayers.filter((p) => p.isReady).length;
  },

  canStartGame: () => {
    const state = get();
    const playerCount = state.roomPlayers.length;
    // Host is implicitly ready - only check non-host players
    const nonHostPlayers = state.roomPlayers.filter((p) => p.playerId !== state.myPlayerId);
    const readyCount = nonHostPlayers.filter((p) => p.isReady).length;
    return state.isHost && playerCount >= 2 && readyCount === nonHostPlayers.length;
  },

  // ============================================================
  // RESET
  // ============================================================

  reset: () => set(initialState),
}));

// ============================================================
// SELECTORS
// ============================================================

/**
 * Select current room state
 */
export const selectCurrentRoom = (state: MultiplayerStore) => state.currentRoom;

/**
 * Select my player info
 */
export const selectMyPlayer = (state: MultiplayerStore) => {
  const { myPlayerId, roomPlayers } = state;
  if (!myPlayerId) return null;
  return roomPlayers.find((p) => p.playerId === myPlayerId) || null;
};

/**
 * Select players in room (sorted by index)
 */
export const selectRoomPlayersSorted = (state: MultiplayerStore) => {
  return [...state.roomPlayers].sort((a, b) => a.playerIndex - b.playerIndex);
};

/**
 * Select connection state
 */
export const selectConnectionState = (state: MultiplayerStore) => ({
  status: state.syncStatus,
  isConnected: state.isConnected,
  isReconnecting: state.isReconnecting,
  error: state.error,
});

/**
 * Select if can start game
 */
export const selectCanStartGame = (state: MultiplayerStore) => state.canStartGame();
