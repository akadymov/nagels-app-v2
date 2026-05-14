import { create } from 'zustand';
import type { RoomSnapshot } from '../../supabase/functions/_shared/types.ts';

interface RoomState {
  snapshot: RoomSnapshot | null;
  version: number;
  myPlayerId: string | null; // = session_id
  isSpectator: boolean;
  connState: 'idle' | 'syncing' | 'connected' | 'reconnecting' | 'error';
  setMyPlayerId: (id: string | null) => void;
  setIsSpectator: (v: boolean) => void;
  applySnapshot: (s: RoomSnapshot, version: number) => void;
  setConnState: (s: RoomState['connState']) => void;
  reset: () => void;
}

export const useRoomStore = create<RoomState>((set) => ({
  snapshot: null,
  version: 0,
  myPlayerId: null,
  isSpectator: false,
  connState: 'idle',
  setMyPlayerId: (id) => set({ myPlayerId: id }),
  setIsSpectator: (isSpectator) => set({ isSpectator }),
  applySnapshot: (snapshot, version) =>
    set((st) => (version >= st.version ? { snapshot, version } : st)),
  setConnState: (connState) => set({ connState }),
  reset: () => set({ snapshot: null, version: 0, connState: 'idle', isSpectator: false }),
}));
