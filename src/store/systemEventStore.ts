import { create } from 'zustand';

export interface LeftMidGameEvent {
  display_name: string;
  at: string;
}

interface SystemEventState {
  lastLeftMidGame: LeftMidGameEvent | null;
  setLeftMidGame: (ev: LeftMidGameEvent) => void;
  clearLeftMidGame: () => void;
}

export const useSystemEventStore = create<SystemEventState>((set) => ({
  lastLeftMidGame: null,
  setLeftMidGame: (ev) => {
    set({ lastLeftMidGame: ev });
    setTimeout(() => {
      set((state) => state.lastLeftMidGame === ev ? { lastLeftMidGame: null } : state);
    }, 30_000);
  },
  clearLeftMidGame: () => set({ lastLeftMidGame: null }),
}));
