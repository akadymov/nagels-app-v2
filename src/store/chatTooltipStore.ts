import { create } from 'zustand';

export const TOOLTIP_DURATION_MS = 5000;

export interface Tooltip {
  body: string;
  ts: number;
}

interface ChatTooltipState {
  tooltips: Record<string, Tooltip>;
  show: (sessionId: string, body: string) => void;
  dismiss: (sessionId: string) => void;
  dismissAll: () => void;
}

// Module-scope timers so they survive store re-creations during HMR and
// don't get serialized into state. One timer per sessionId.
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(sessionId: string): void {
  const t = timers.get(sessionId);
  if (t !== undefined) {
    clearTimeout(t);
    timers.delete(sessionId);
  }
}

export const useChatTooltipStore = create<ChatTooltipState>((set, get) => ({
  tooltips: {},
  show: (sessionId, body) => {
    clearTimer(sessionId);
    timers.set(
      sessionId,
      setTimeout(() => get().dismiss(sessionId), TOOLTIP_DURATION_MS),
    );
    set((s) => ({
      tooltips: { ...s.tooltips, [sessionId]: { body, ts: Date.now() } },
    }));
  },
  dismiss: (sessionId) => {
    clearTimer(sessionId);
    set((s) => {
      if (!(sessionId in s.tooltips)) return s;
      const next = { ...s.tooltips };
      delete next[sessionId];
      return { tooltips: next };
    });
  },
  dismissAll: () => {
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    set({ tooltips: {} });
  },
}));
