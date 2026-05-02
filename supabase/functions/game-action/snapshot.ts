import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { RoomSnapshot } from '../_shared/types.ts';

export async function buildSnapshot(
  svc: SupabaseClient,
  room_id: string,
  caller_session_id: string,
): Promise<RoomSnapshot> {
  const { data, error } = await svc.rpc('get_room_state', { p_room_id: room_id });
  if (error) throw error;

  const snapshot = (data ?? {
    room: null, players: [], current_hand: null,
    hand_scores: [], current_trick: null, last_closed_trick: null, score_history: [],
  }) as RoomSnapshot;

  const handId = snapshot.current_hand?.id;
  if (handId) {
    const { data: hand } = await svc.rpc('get_my_hand', {
      p_hand_id: handId,
      p_session_id: caller_session_id,
    });
    snapshot.my_hand = (hand as string[]) ?? [];
  } else {
    snapshot.my_hand = [];
  }

  return snapshot;
}
