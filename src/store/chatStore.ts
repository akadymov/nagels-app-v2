import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  sessionId: string;
  displayName: string;
  body: string;
  ts: number;       // ms since epoch
  avatar?: string | null;
  avatarUrl?: string | null;
  avatarColor?: string | null;
  /** True when the sender was a spectator at the time the message was
   *  broadcast. Optional for backwards-compat with older payloads. */
  fromSpectator?: boolean;
}

interface ChatStore {
  /** Tracks which room these messages belong to so we don't leak
   *  messages across rooms after refresh. */
  roomId: string | null;
  messages: ChatMessage[];
  unread: number;
  /** True while a ChatPanel is mounted-and-visible. addMessage uses this
   *  to skip the unread counter when the user is already looking at the
   *  chat — otherwise a single Modal-remount race would leave a stale
   *  badge after every incoming message. */
  chatOpen: boolean;
  /** Idempotently bind the store to a room: if the persisted roomId
   *  matches, keep the messages (refresh case). Otherwise rehydrate
   *  from localStorage (per-room key) or start empty. */
  setRoom: (roomId: string) => void;
  addMessage: (m: ChatMessage) => void;
  markRead: () => void;
  setChatOpen: (open: boolean) => void;
  reset: () => void;
}

const MAX_MESSAGES = 200;
const STORAGE_PREFIX = 'nagels-chat-';

function readStored(roomId: string): ChatMessage[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + roomId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStored(roomId: string | null, messages: ChatMessage[]): void {
  if (!roomId || typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + roomId, JSON.stringify(messages));
  } catch {
    /* quota / disabled — chat just won't persist this session */
  }
}

function clearStored(roomId: string | null): void {
  if (!roomId || typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + roomId);
  } catch {
    /* ignore */
  }
}

export const useChatStore = create<ChatStore>((set, get) => ({
  roomId: null,
  messages: [],
  unread: 0,
  chatOpen: false,
  setRoom: (roomId) => {
    const current = get();
    if (current.roomId === roomId) return; // already bound
    const restored = readStored(roomId);
    set({ roomId, messages: restored, unread: 0 });
  },
  addMessage: (m) => {
    set((st) => {
      // Drop dupes (broadcast can echo back to sender via realtime).
      if (st.messages.some((x) => x.id === m.id)) return st;
      const next = st.messages.concat(m);
      if (next.length > MAX_MESSAGES) next.splice(0, next.length - MAX_MESSAGES);
      writeStored(st.roomId, next);
      return { messages: next, unread: st.chatOpen ? 0 : st.unread + 1 };
    });
  },
  markRead: () => set({ unread: 0 }),
  setChatOpen: (open) => set(open ? { chatOpen: true, unread: 0 } : { chatOpen: false }),
  reset: () => {
    clearStored(get().roomId);
    set({ roomId: null, messages: [], unread: 0, chatOpen: false });
  },
}));
