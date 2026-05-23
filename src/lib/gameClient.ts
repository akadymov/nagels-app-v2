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
  let { data: { session } } = await supabase.auth.getSession();
  // Race: AppNavigator launches getGuestSession() fire-and-forget on mount;
  // if the user taps a button before the anonymous sign-in completes,
  // there is no session yet. Trigger one inline and use the resulting session.
  //
  // We retry with exponential backoff because supabase's /signup endpoint
  // is project-wide rate-limited (30/hour). When several fresh contexts
  // hit it at once (e.g. the multi-player demo, or simply a busy lobby),
  // some get 429 and would otherwise throw 'not_signed_in' to the user.
  if (!session) {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 5 && !session; attempt++) {
      if (attempt > 0) {
        // 600ms, 1.2s, 2.4s, 4.8s
        await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt)));
      }
      const { data, error } = await supabase.auth.signInAnonymously();
      if (!error && data.session) {
        session = data.session;
        break;
      }
      lastErr = error;
    }
    if (!session) {
      console.warn('[gameClient] signInAnonymously failed after retries:', lastErr);
      throw new Error('not_signed_in');
    }
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

// Admin actions and other auth-only endpoints. Skips the anon-sign-in
// retry loop (admin actions require a real logged-in user; if no
// session, fail fast) and does NOT push a snapshot to useRoomStore
// (admin actions don't mutate room state).
async function postAdminAction(action: Action): Promise<any> {
  const supabase = getSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('not_signed_in');
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
    },
    body: JSON.stringify({ action }),
  });
  return res.json();
}

// Playwright (and other WebDriver-driven contexts) sets
// navigator.webdriver = true. We use that as the canonical "running
// under automation" signal so test rooms don't spam the prod Telegram
// channel via createRoom's side-effect. Wrapped so non-DOM contexts
// (jest unit tests, Node demo scripts) safely report false.
function isAutomatedContext(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.webdriver === true;
  } catch {
    return false;
  }
}

export const gameClient = {
  createRoom: (
    displayName: string,
    player_count: number,
    max_cards = 10,
    mode: 'standard' | 'scorekeeper' = 'standard',
  ) =>
    postAction(displayName, {
      kind: 'create_room',
      display_name: displayName,
      player_count,
      max_cards,
      mode,
      // Tests + automation must not fire the new-room Telegram
      // notification. See docs/principles.md §8 "Test side-effect
      // hygiene".
      silent: isAutomatedContext(),
    }),

  joinRoom: (displayName: string, code: string) =>
    postAction(displayName, { kind: 'join_room', display_name: displayName, code }),

  leaveRoom: async (room_id: string, target_session_id?: string) => {
    const result = await postAction(null, { kind: 'leave_room', room_id, target_session_id });
    if (result.ok && !target_session_id) {
      const { clearActiveRoom } = await import('./activeRoom');
      await clearActiveRoom();
    }
    return result;
  },

  joinRoomAsSpectator: async (code: string) => {
    const supabase = getSupabaseClient();
    const { data: joinRes, error: rpcErr } = await supabase.rpc('join_room_as_spectator', {
      p_room_code: code,
    });
    if (rpcErr || !joinRes) {
      return { ok: false as const, error: rpcErr?.message ?? 'unknown' };
    }
    const { room_id: roomId, session_id: sessionId } = joinRes as {
      room_id: string; session_id: string;
    };
    const { data: snap, error: snapErr } = await supabase.rpc('get_room_state', {
      p_room_id: roomId,
    });
    if (snapErr || !snap) {
      return { ok: false as const, error: snapErr?.message ?? 'no_state' };
    }
    return { ok: true as const, room_id: roomId, session_id: sessionId, state: snap };
  },

  leaveRoomAsSpectator: async (room_id: string) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc('leave_room_as_spectator', {
      p_room_id: room_id,
    });
    return { ok: !error, error: error?.message };
  },

  setReady: (room_id: string, is_ready: boolean, target_session_id?: string) =>
    postAction(null, { kind: 'ready', room_id, is_ready, target_session_id }),

  startGame: (room_id: string) =>
    postAction(null, { kind: 'start_game', room_id }),

  setMinCardsPerHand: async (room_id: string, min: number) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc('set_min_cards_per_hand', {
      p_room_id: room_id,
      p_min: min,
    });
    return { ok: !error, error: error?.message };
  },

  placeBet: (room_id: string, hand_id: string, bet: number) =>
    postAction(null, { kind: 'place_bet', room_id, hand_id, bet }),

  playCard: (room_id: string, hand_id: string, card: string) =>
    postAction(null, { kind: 'play_card', room_id, hand_id, card }),

  continueHand: (room_id: string, hand_id: string) =>
    postAction(null, { kind: 'continue_hand', room_id, hand_id }),

  recordTricks: (room_id: string, hand_id: string, tricks: number) =>
    postAction(null, { kind: 'record_tricks', room_id, hand_id, tricks }),

  requestTimeout: (room_id: string, hand_id: string, expected_seat: number) =>
    postAction(null, { kind: 'request_timeout', room_id, hand_id, expected_seat }),

  restartGame: (room_id: string) =>
    postAction(null, { kind: 'restart_game', room_id }),

  // --- Stakes cluster ---

  setStake: (room_id: string, stake: number) =>
    postAction(null, { kind: 'set_stake', room_id, stake }),

  toggleStakeOptin: (room_id: string, opted_in: boolean) =>
    postAction(null, { kind: 'toggle_stake_optin', room_id, opted_in }),

  getMyRating: async (): Promise<number> => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('get_my_rating');
    if (error) throw error;
    return typeof data === 'number' ? data : 0;
  },

  getRatingSettlement: async (
    room_id: string,
  ): Promise<{
    old_balance: number;
    new_balance: number;
    rows: Array<{ user_id: string; display_name: string; score: number; delta: number }>;
  } | null> => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('get_rating_settlement', { p_room_id: room_id });
    if (error) throw error;
    return (data as any) ?? null;
  },

  adminCheck: (): Promise<{ ok: true; is_admin: boolean }> =>
    postAdminAction({ kind: 'admin_check' }),

  adminSearchUsers: (
    q: string,
  ): Promise<{ ok: boolean; error?: string; rows?: Array<{ id: string; email: string | null; display_name: string | null; balance: number }> }> =>
    postAdminAction({ kind: 'admin_search_users', q }),

  adminResetRating: (target_user_id: string): Promise<{ ok: boolean; error?: string; affected?: number }> =>
    postAdminAction({ kind: 'admin_reset_rating', target_user_id }),

  adminResetAllRatings: (): Promise<{ ok: boolean; error?: string; affected?: number }> =>
    postAdminAction({ kind: 'admin_reset_all_ratings' }),

  setDisplayName: (display_name: string, room_id?: string) =>
    postAction(null, { kind: 'set_display_name', display_name, room_id }),

  refreshSnapshot: async (room_id: string): Promise<void> => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('get_room_state', { p_room_id: room_id });
    if (error) {
      useRoomStore.getState().setConnState('error');
      return;
    }
    const snapshot = data as unknown as RoomSnapshot;

    // get_room_state doesn't include the caller's private hand. Always
    // derive the session_id from the live auth.uid() instead of trusting
    // the cached myPlayerId in roomStore — the cached value can outlast
    // a session refresh, login switch, or the brief gap during reconnect
    // and would point at the wrong player's hand. The server-side
    // get_my_hand authz guard (migration 016) is the second line of
    // defense; this is the first.
    const handId = snapshot.current_hand?.id;
    if (handId) {
      const { data: sid } = await supabase.rpc('get_my_session_id');
      const mySession = (sid as string | null) ?? null;
      if (mySession) {
        if (mySession !== useRoomStore.getState().myPlayerId) {
          useRoomStore.getState().setMyPlayerId(mySession);
        }
        const { data: myHand } = await supabase.rpc('get_my_hand', {
          p_hand_id: handId,
          p_session_id: mySession,
        });
        snapshot.my_hand = (myHand as unknown as string[]) ?? [];
      } else {
        // Auth not ready — keep whatever we had rather than render nothing
        // or, worse, somebody else's cards.
        snapshot.my_hand = useRoomStore.getState().snapshot?.my_hand ?? [];
      }
    }

    useRoomStore.getState().applySnapshot(snapshot, snapshot.room?.version ?? 0);
  },
};
