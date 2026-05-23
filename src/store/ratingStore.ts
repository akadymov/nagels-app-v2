import { create } from 'zustand';
import { gameClient } from '../lib/gameClient';

interface RatingState {
  balance: number | null;
  loading: boolean;
  load: () => Promise<void>;
  set: (n: number) => void;
}

export const useRatingStore = create<RatingState>((set) => ({
  balance: null,
  loading: false,
  load: async () => {
    set({ loading: true });
    try {
      const n = await gameClient.getMyRating();
      set({ balance: n, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  set: (n) => set({ balance: n }),
}));
