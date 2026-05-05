import { getSupabaseClient } from './supabase/client';
import { useRoomStore } from '../store/roomStore';
import { useChatStore, type ChatMessage } from '../store/chatStore';
import { gameClient } from './gameClient';
import type { RealtimeChannel } from '@supabase/supabase-js';

let channel: RealtimeChannel | null = null;
let currentRoomId: string | null = null;
let isSubscribed = false;

export function subscribeRoom(room_id: string) {
  if (channel && currentRoomId === room_id) return;

  unsubscribeRoom();
  currentRoomId = room_id;
  isSubscribed = false;
  // Wipe chat from any previous room so messages don't leak across.
  useChatStore.getState().reset();
  const supabase = getSupabaseClient();
  // broadcast.self=true so the sender of a chat message also receives
  // their own broadcast through the listener — otherwise the user
  // never sees their own message rendered. The listener already
  // dedupes by id, so it's safe.
  channel = supabase.channel(`room:${room_id}`, {
    config: { broadcast: { self: true } },
  });

  channel.on('broadcast', { event: 'state_changed' }, async ({ payload }) => {
    const local = useRoomStore.getState().version;
    if (typeof payload?.version === 'number' && payload.version > local) {
      useRoomStore.getState().setConnState('syncing');
      await gameClient.refreshSnapshot(room_id);
      useRoomStore.getState().setConnState('connected');
    }
  });

  channel.on('broadcast', { event: 'chat' }, ({ payload }) => {
    if (!payload || typeof payload !== 'object') return;
    const m = payload as Partial<ChatMessage>;
    if (!m.id || !m.body || !m.sessionId || !m.displayName) return;
    useChatStore.getState().addMessage({
      id: String(m.id),
      sessionId: String(m.sessionId),
      displayName: String(m.displayName),
      body: String(m.body),
      ts: typeof m.ts === 'number' ? m.ts : Date.now(),
      avatar: m.avatar ?? null,
      avatarColor: m.avatarColor ?? null,
    });
  });

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      isSubscribed = true;
      useRoomStore.getState().setConnState('connected');
      // Initial pull on subscribe — guarantees fresh state.
      void gameClient.refreshSnapshot(room_id);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      isSubscribed = false;
      useRoomStore.getState().setConnState('reconnecting');
    } else if (status === 'CLOSED') {
      isSubscribed = false;
      useRoomStore.getState().setConnState('idle');
    }
  });
}

/**
 * Send a chat message on the current room channel.
 * Echoes back to the sender via the same broadcast subscription, so
 * we don't optimistically add — the listener handles it.
 * Returns false if there's no live channel.
 */
export async function sendChatMessage(message: ChatMessage): Promise<boolean> {
  if (!channel || !isSubscribed) return false;
  try {
    await channel.send({
      type: 'broadcast',
      event: 'chat',
      payload: message,
    });
    return true;
  } catch (err) {
    console.warn('[chat] send failed:', err);
    return false;
  }
}

export function unsubscribeRoom() {
  if (channel) {
    const supabase = getSupabaseClient();
    supabase.removeChannel(channel);
    channel = null;
    currentRoomId = null;
    isSubscribed = false;
  }
}
