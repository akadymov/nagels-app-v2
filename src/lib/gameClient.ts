import { getSupabaseClient } from './supabase/client';
import { useRoomStore } from '../store/roomStore';
import type {
  Action, ActionResult, RoomSnapshot,
} from '../../supabase/functions/_shared/types.ts';

const FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/game-action`;

async function postAction(
  displayName: string | null,
  action: Action,
): Promise<ActionResult> {
  const supabase = getSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('not_signed_in');
  }

  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
    },
    body: JSON.stringify({ display_name: displayName, action }),
  });

  const json = (await res.json()) as ActionResult;
  if ((json as any).state) {
    useRoomStore.getState().applySnapshot(
      (json as any).state as RoomSnapshot,
      (json as any).version ?? 0,
    );
  }
  // Server-supplied identity: room_sessions.id of the actor.
  // Client cannot derive this from auth.user.id (different UUIDs).
  const me = (json as any).me_session_id as string | undefined;
  if (me) {
    useRoomStore.getState().setMyPlayerId(me);
  }
  return json;
}

export const gameClient = {
  createRoom: (displayName: string, player_count: number, max_cards = 10) =>
    postAction(displayName, {
      kind: 'create_room',
      display_name: displayName,
      player_count,
      max_cards,
    }),

  joinRoom: (displayName: string, code: string) =>
    postAction(displayName, { kind: 'join_room', display_name: displayName, code }),

  leaveRoom: (room_id: string) =>
    postAction(null, { kind: 'leave_room', room_id }),

  setReady: (room_id: string, is_ready: boolean) =>
    postAction(null, { kind: 'ready', room_id, is_ready }),

  startGame: (room_id: string) =>
    postAction(null, { kind: 'start_game', room_id }),

  placeBet: (room_id: string, hand_id: string, bet: number) =>
    postAction(null, { kind: 'place_bet', room_id, hand_id, bet }),

  playCard: (room_id: string, hand_id: string, card: string) =>
    postAction(null, { kind: 'play_card', room_id, hand_id, card }),

  continueHand: (room_id: string, hand_id: string) =>
    postAction(null, { kind: 'continue_hand', room_id, hand_id }),

  requestTimeout: (room_id: string, hand_id: string, expected_seat: number) =>
    postAction(null, { kind: 'request_timeout', room_id, hand_id, expected_seat }),

  refreshSnapshot: async (room_id: string): Promise<void> => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('get_room_state', { p_room_id: room_id });
    if (error) {
      useRoomStore.getState().setConnState('error');
      return;
    }
    const snapshot = data as unknown as RoomSnapshot;

    // get_room_state doesn't include the caller's private hand. Pull it
    // separately if there's an active hand and we know our session_id.
    const handId = snapshot.current_hand?.id;
    if (handId) {
      let mySession = useRoomStore.getState().myPlayerId;
      if (!mySession) {
        const { data: sid } = await supabase.rpc('get_my_session_id');
        if (sid) {
          mySession = sid as string;
          useRoomStore.getState().setMyPlayerId(mySession);
        }
      }
      if (mySession) {
        const { data: myHand } = await supabase.rpc('get_my_hand', {
          p_hand_id: handId,
          p_session_id: mySession,
        });
        const fetched = (myHand as unknown as string[]) ?? [];
        // Only overwrite if we actually got cards back. If the fetch returned
        // empty for an active hand, prefer the existing local my_hand to
        // avoid the "cards disappear" flicker.
        const local = useRoomStore.getState().snapshot;
        const localHandId = local?.current_hand?.id;
        if (fetched.length > 0 || localHandId !== handId) {
          snapshot.my_hand = fetched;
        } else {
          snapshot.my_hand = local?.my_hand ?? [];
        }
      } else {
        // No session yet — preserve whatever we had so far.
        snapshot.my_hand = useRoomStore.getState().snapshot?.my_hand ?? [];
      }
    }

    useRoomStore.getState().applySnapshot(snapshot, snapshot.room?.version ?? 0);
  },
};
