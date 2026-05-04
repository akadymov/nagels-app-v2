import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  sessionId: string;
  displayName: string;
  body: string;
  ts: number;       // ms since epoch
  avatar?: string | null;
  avatarColor?: string | null;
}

interface ChatStore {
  messages: ChatMessage[];
  unread: number;
  addMessage: (m: ChatMessage) => void;
  markRead: () => void;
  reset: () => void;
}

const MAX_MESSAGES = 200;

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  unread: 0,
  addMessage: (m) =>
    set((st) => {
      // Drop dupes (broadcast can echo back to sender via realtime).
      if (st.messages.some((x) => x.id === m.id)) return st;
      const next = st.messages.concat(m);
      if (next.length > MAX_MESSAGES) next.splice(0, next.length - MAX_MESSAGES);
      return { messages: next, unread: st.unread + 1 };
    }),
  markRead: () => set({ unread: 0 }),
  reset: () => set({ messages: [], unread: 0 }),
}));
