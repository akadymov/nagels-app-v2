import { create } from 'zustand';
import { gameClient } from '../lib/gameClient';
import type { RatingEvent, TransferRatingResult } from '../lib/gameClient';

interface RatingState {
  balance: number | null;
  loading: boolean;
  events: RatingEvent[];
  eventsLoading: boolean;
  load: () => Promise<void>;
  loadEvents: () => Promise<void>;
  set: (n: number) => void;
  transfer: (email: string, amount: number) => Promise<TransferRatingResult>;
}

export const useRatingStore = create<RatingState>((set, get) => ({
  balance: null,
  loading: false,
  events: [],
  eventsLoading: false,

  load: async () => {
    set({ loading: true });
    try {
      const n = await gameClient.getMyRating();
      set({ balance: n, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  loadEvents: async () => {
    set({ eventsLoading: true });
    try {
      const events = await gameClient.getMyRatingEvents(20);
      set({ events, eventsLoading: false });
    } catch {
      set({ eventsLoading: false });
    }
  },

  set: (n) => set({ balance: n }),

  transfer: async (email, amount) => {
    const result = await gameClient.transferRating(email, amount);
    if (result.ok) {
      set({ balance: result.new_balance });
      // fire-and-forget refresh; don't block the modal
      get().loadEvents();
    }
    return result;
  },
}));
