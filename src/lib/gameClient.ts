import { getSupabaseClient } from './supabase/client';
import { useRoomStore } from '../store/roomStore';
import { getDiscordInstanceId } from './discord/bootstrap';
import type {
  Action, ActionResult, RoomSnapshot,
} from '../../supabase/functions/_shared/types.ts';

export type RatingEvent = {
  id: string;
  reason: 'settle' | 'admin_reset' | 'transfer_in' | 'transfer_out';
  delta: number;
  created_at: string;
  room_id: string | null;
  counterparty_display_name: string | null;
};

export type LookupRecipientResult =
  | { found: false }
  | { ok: false; error: 'rate_limited' }
  | { found: true; is_self: true }
  | {
      found: true;
      is_self: false;
      recipient: {
        display_name: string | null;
        masked_email: string;
        avatar: string | null;
        avatar_url: string | null;
        avatar_color: string | null;
      };
    };

export type TransferRatingResult =
  | {
      ok: true;
      new_balance: number;
      recipient: { display_name: string | null; masked_email: string };
    }
  | {
      ok: false;
      error:
        | 'unauthenticated'
        | 'invalid_amount'
        | 'recipient_not_found'
        | 'self_transfer'
        | 'insufficient_balance';
    };

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

// Dev/preview builds hit the same prod Supabase edge function as the
// prod build, so the server can't distinguish them. Gate Telegram
// side-effects on the client: only production builds should announce
// new rooms. __DEV__ is Expo's canonical dev signal (true under
// `expo start`, false in production builds, web+native).
function isDevBuild(): boolean {
  try {
    if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  } catch {}
  try {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') return true;
  } catch {}
  return false;
}

function shouldSilenceTelegram(): boolean {
  return isAutomatedContext() || isDevBuild();
}

export const gameClient = {
  createRoom: (
    displayName: string,
    player_count: number,
    max_cards = 10,
    mode: 'standard' | 'scorekeeper' = 'standard',
    announce: boolean = false,
  ) =>
    postAction(displayName, {
      kind: 'create_room',
      display_name: displayName,
      player_count,
      max_cards,
      mode,
      // silent = test/dev gate (automation + non-prod builds).
      // announce = explicit host intent + server-enforced allow-list.
      // Both must align for Telegram to fire.
      // See docs/principles.md §8 "Test side-effect hygiene".
      silent: shouldSilenceTelegram(),
      announce,
      discord_instance_id: getDiscordInstanceId(),
    }),

  joinRoom: (displayName: string, code: string) =>
    postAction(displayName, { kind: 'join_room', display_name: displayName, code }),

  /** Look up the current open room for a Discord Activity instance. */
  getActiveRoomForInstance: async (
    instanceId: string,
  ): Promise<
    | { room_id: string; code: string; phase: string; player_count: number; seats_taken: number }
    | null
  > => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('get_active_room_for_instance', {
      p_instance_id: instanceId,
    });
    if (error || !data) return null;
    return data as {
      room_id: string; code: string; phase: string; player_count: number; seats_taken: number;
    };
  },

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

  switchRole: async (
    room_id: string,
    target_session_id: string,
    to_role: 'player' | 'spectator',
  ) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc('switch_role', {
      p_room_id: room_id,
      p_target_session_id: target_session_id,
      p_to_role: to_role,
    });
    return { ok: !error, error: error?.message };
  },

  setReady: (room_id: string, is_ready: boolean, target_session_id?: string) =>
    postAction(null, { kind: 'ready', room_id, is_ready, target_session_id }),

  startGame: (room_id: string) =>
    postAction(null, { kind: 'start_game', room_id }),

  pauseGame: (room_id: string) =>
    postAction(null, { kind: 'pause_game', room_id }),

  resumeGame: (room_id: string) =>
    postAction(null, { kind: 'resume_game', room_id }),

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

  getMyActiveRoom: async (): Promise<
    | { room_id: string; code: string; phase: 'waiting' | 'playing' | 'paused' | 'scoring'; role: 'player' | 'spectator'; paused_at?: string | null }
    | null
  > => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('get_my_active_room');
    if (error) throw error;
    return (data as any) ?? null;
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

  lookupRatingRecipient: async (email: string): Promise<LookupRecipientResult> => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('lookup_rating_recipient', { p_email: email });
    if (error) throw error;
    return data as LookupRecipientResult;
  },

  transferRating: async (toEmail: string, amount: number): Promise<TransferRatingResult> => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('transfer_rating', {
      p_to_email: toEmail,
      p_amount: amount,
    });
    if (error) throw error;
    return data as TransferRatingResult;
  },

  getMyRatingEvents: async (limit = 20): Promise<RatingEvent[]> => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('get_my_rating_events', { p_limit: limit });
    if (error) throw error;
    return (data as RatingEvent[]) ?? [];
  },

  adminCheck: (): Promise<{ ok: true; is_admin: boolean }> =>
    postAdminAction({ kind: 'admin_check' }),

  adminSearchUsers: (
    q: string,
  ): Promise<{ ok: boolean; error?: string; rows?: Array<{ id: string; email: string | null; display_name: string | null; balance: number; can_announce: boolean }> }> =>
    postAdminAction({ kind: 'admin_search_users', q }),

  adminResetRating: (target_user_id: string): Promise<{ ok: boolean; error?: string; affected?: number }> =>
    postAdminAction({ kind: 'admin_reset_rating', target_user_id }),

  adminResetAllRatings: (): Promise<{ ok: boolean; error?: string; affected?: number }> =>
    postAdminAction({ kind: 'admin_reset_all_ratings' }),

  canAnnounceTelegram: async (): Promise<boolean> => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('can_announce_telegram');
    if (error) throw error;
    return data === true;
  },

  adminGrantTelegram: (target_user_id: string): Promise<{ ok: boolean; error?: string }> =>
    postAdminAction({ kind: 'admin_grant_telegram', target_user_id }),

  adminRevokeTelegram: (target_user_id: string): Promise<{ ok: boolean; error?: string; affected?: number }> =>
    postAdminAction({ kind: 'admin_revoke_telegram', target_user_id }),

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
