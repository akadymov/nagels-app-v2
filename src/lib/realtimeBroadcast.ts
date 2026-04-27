import { getSupabaseClient } from './supabase/client';
import { useRoomStore } from '../store/roomStore';
import { gameClient } from './gameClient';
import type { RealtimeChannel } from '@supabase/supabase-js';

let channel: RealtimeChannel | null = null;
let currentRoomId: string | null = null;

export function subscribeRoom(room_id: string) {
  if (channel && currentRoomId === room_id) return;

  unsubscribeRoom();
  currentRoomId = room_id;
  const supabase = getSupabaseClient();
  channel = supabase.channel(`room:${room_id}`);

  channel.on('broadcast', { event: 'state_changed' }, async ({ payload }) => {
    const local = useRoomStore.getState().version;
    if (typeof payload?.version === 'number' && payload.version > local) {
      useRoomStore.getState().setConnState('syncing');
      await gameClient.refreshSnapshot(room_id);
      useRoomStore.getState().setConnState('connected');
    }
  });

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      useRoomStore.getState().setConnState('connected');
      // Initial pull on subscribe — guarantees fresh state.
      void gameClient.refreshSnapshot(room_id);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      useRoomStore.getState().setConnState('reconnecting');
    } else if (status === 'CLOSED') {
      useRoomStore.getState().setConnState('idle');
    }
  });
}

export function unsubscribeRoom() {
  if (channel) {
    const supabase = getSupabaseClient();
    supabase.removeChannel(channel);
    channel = null;
    currentRoomId = null;
  }
}
