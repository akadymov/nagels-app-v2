import { useEffect } from 'react';
import { useChatStore } from '../store/chatStore';
import { useRoomStore } from '../store/roomStore';
import { useChatTooltipStore } from '../store/chatTooltipStore';

const PREVIEW_LIMIT = 60;

interface Args {
  selfSessionId: string | null;
  isChatOpen: boolean;
  /**
   * When false, the listener does not subscribe and produces no side
   * effects. Use this when two screens with their own chat state would
   * otherwise mount the hook simultaneously (e.g. GameTable + BettingPhase
   * during the betting overlay) — exactly one should be active at a time.
   * Defaults to true.
   */
  active?: boolean;
}

/**
 * Mount once per host screen that renders player containers (Waiting/
 * Betting/GameTable, mobile + desktop). Subscribes to chatStore and
 * pushes a tooltip into chatTooltipStore for each incoming message
 * that should surface above its sender's card.
 *
 * On unmount, clears every tooltip so timers from a previous room
 * don't fire on a new screen.
 */
export function useChatTooltipListener({ selfSessionId, isChatOpen, active = true }: Args): void {
  useEffect(() => {
    if (!active) return;

    let lastSeenId: string | null = useChatStore.getState().messages.at(-1)?.id ?? null;

    const unsub = useChatStore.subscribe((state) => {
      const last = state.messages.at(-1);
      if (!last || last.id === lastSeenId) return;
      lastSeenId = last.id;

      if (isChatOpen) return;
      if (selfSessionId && last.sessionId === selfSessionId) return;
      if (last.fromSpectator === true) return;

      const players = useRoomStore.getState().snapshot?.players ?? [];
      const senderInRoom = players.some((p) => p.session_id === last.sessionId);
      if (!senderInRoom) return;

      const body =
        last.body.length > PREVIEW_LIMIT
          ? `${last.body.slice(0, PREVIEW_LIMIT)}…`
          : last.body;
      useChatTooltipStore.getState().show(last.sessionId, body);
    });

    return () => {
      unsub();
      useChatTooltipStore.getState().dismissAll();
    };
  }, [selfSessionId, isChatOpen, active]);
}
