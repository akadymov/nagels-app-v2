import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Send a state_changed event to the room channel.
 * Consumed by clients subscribed to supabase.channel(`room:${room_id}`).
 */
export async function broadcastStateChanged(
  svc: SupabaseClient,
  room_id: string,
  version: number,
): Promise<void> {
  const channel = svc.channel(`room:${room_id}`);
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
    });
  });
  await channel.send({
    type: 'broadcast',
    event: 'state_changed',
    payload: { version },
  });
  await channel.unsubscribe();
}
