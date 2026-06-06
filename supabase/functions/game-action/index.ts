/**
 * Nägels Online — Server-Authoritative Game Action
 *
 * Single endpoint. All game mutations go through this function.
 * Pipeline: JWT verify → advisory lock → action handler → snapshot →
 * broadcast → response.
 */

import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import type { Action, ActionResult, ActorContext, RoomSnapshot } from '../_shared/types.ts';
import { authenticate, makeServiceClient } from './auth.ts';
import { broadcastStateChanged } from './broadcast.ts';
import { buildSnapshot } from './snapshot.ts';
import { detectTransitions, type ActionKind } from '../_shared/push/transitions.ts';
import { notifyPush } from '../_shared/push/notifyPush.ts';

import { createRoom }     from './actions/createRoom.ts';
import { joinRoom }       from './actions/joinRoom.ts';
import { leaveRoom }      from './actions/leaveRoom.ts';
import { setReady }       from './actions/ready.ts';
import { startGame }      from './actions/startGame.ts';
import { placeBet }       from './actions/placeBet.ts';
import { playCard }       from './actions/playCard.ts';
import { continueHand }   from './actions/continueHand.ts';
import { recordTricks }   from './actions/recordTricks.ts';
import { requestTimeout } from './actions/requestTimeout.ts';
import { restartGame }    from './actions/restartGame.ts';
import { setDisplayName } from './actions/setDisplayName.ts';
import { setStake }       from './actions/setStake.ts';
import { toggleStakeOptin } from './actions/toggleStakeOptin.ts';
import { pauseGame } from './actions/pauseGame.ts';
import { resumeGame } from './actions/resumeGame.ts';
import { adminCheck }      from './actions/adminCheck.ts';
import { adminSearchUsers } from './actions/adminSearchUsers.ts';
import { adminResetRating, adminResetAllRatings } from './actions/adminResetRating.ts';
import { adminGrantTelegram }  from './actions/adminGrantTelegram.ts';
import { adminRevokeTelegram } from './actions/adminRevokeTelegram.ts';

// Gameplay mutations rejected while a room is paused (see the pause gate below).
// Module scope: built once, not per request.
const GAMEPLAY_WHILE_PAUSED_BLOCKED = new Set([
  'place_bet', 'play_card', 'continue_hand', 'record_tricks', 'request_timeout',
  'ready', 'start_game', 'restart_game', 'set_stake', 'toggle_stake_optin',
]);

Deno.serve(async (req: Request) => {
  // Origin-aware CORS bound to this request (see _shared/cors.ts).
  const respond = (body: unknown, status = 200) => jsonResponse(body, status, req);
  const preflight = () => handleOptions(req);

  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST')   return respond({ ok: false, error: 'method_not_allowed' }, 405);

  let body: { display_name?: string; action: Action };
  try {
    body = await req.json();
  } catch {
    return respond({ ok: false, error: 'invalid_json' }, 400);
  }

  let actor: ActorContext;
  try {
    actor = await authenticate(req, body.display_name ?? null);
  } catch {
    return respond({ ok: false, error: 'auth_failed' }, 401);
  }

  const svc = makeServiceClient();
  const action = body.action;
  const room_id = (action as any).room_id ?? null;

  // Admin actions are read-only and don't touch room state — bypass the
  // snapshot/broadcast/push pipeline entirely.
  if (action.kind.startsWith('admin_')) {
    try {
      if (action.kind === 'admin_check') {
        const r = await adminCheck(svc, actor);
        return respond(r, 200);
      }
      if (action.kind === 'admin_search_users') {
        const r = await adminSearchUsers(svc, actor, action);
        return respond(r, r.ok ? 200 : 403);
      }
      if (action.kind === 'admin_reset_rating') {
        const r = await adminResetRating(svc, actor, action);
        return respond(r, r.ok ? 200 : 403);
      }
      if (action.kind === 'admin_reset_all_ratings') {
        const r = await adminResetAllRatings(svc, actor);
        return respond(r, r.ok ? 200 : 403);
      }
      if (action.kind === 'admin_grant_telegram') {
        const r = await adminGrantTelegram(svc, actor, action);
        return respond(r, r.ok ? 200 : 403);
      }
      if (action.kind === 'admin_revoke_telegram') {
        const r = await adminRevokeTelegram(svc, actor, action);
        return respond(r, r.ok ? 200 : 403);
      }
      return respond({ ok: false, error: 'unknown_action' }, 400);
    } catch (err) {
      console.error('[game-action] admin handler threw:', err);
      return respond({ ok: false, error: 'internal_error' }, 500);
    }
  }

  // Snapshot of room state BEFORE the action — needed by the push detector.
  // Skipped for create_room (room doesn't exist yet) and join_room (the
  // detector handles join_room with prev=null using actor + action_kind).
  let prev: RoomSnapshot | null = null;
  if (room_id && action.kind !== 'create_room' && action.kind !== 'join_room') {
    try {
      prev = await buildSnapshot(svc, room_id, actor.session_id);
    } catch (err) {
      console.warn('[game-action] prev snapshot failed (push detector will skip):', err);
    }
  }

  // Pause gate: while a room is frozen, reject every gameplay mutation. Allowed
  // during pause: resume_game, leave_room, set_display_name (+ join_room rejoin,
  // heartbeat, chat — which don't reach this switch). This one check also
  // neutralizes request_timeout auto-play of absent seats.
  //
  // Fail CLOSED: the downstream handlers do NOT re-check room.phase, so this gate
  // is the only guard. If the `prev` snapshot fetch failed (transient DB error),
  // re-read just the phase rather than letting a gameplay action slip through.
  if (room_id && GAMEPLAY_WHILE_PAUSED_BLOCKED.has(action.kind)) {
    let isPaused = prev?.room?.phase === 'paused';
    if (!prev) {
      const { data: r } = await svc.from('rooms').select('phase').eq('id', room_id).maybeSingle();
      isPaused = r?.phase === 'paused';
    }
    if (isPaused) {
      return respond(
        prev
          ? { ok: false, error: 'game_paused', state: prev, version: prev.room?.version ?? 0 }
          : { ok: false, error: 'game_paused' },
        200,
      );
    }
  }

  let result: ActionResult;
  try {
    if (action.kind === 'create_room') {
      result = await createRoom(svc, actor, action);
    } else if (action.kind === 'join_room') {
      result = await joinRoom(svc, actor, action);
    } else {
      // No JS-level advisory lock: session-level pg_advisory_lock is unreliable
      // through Supabase's pooled connections. Atomicity comes from:
      //   - placeBet/playCard: their own PL/pgSQL functions with pg_advisory_xact_lock
      //   - other handlers: UNIQUE constraints + last-writer-wins semantics
      switch (action.kind) {
        case 'leave_room':      result = await leaveRoom(svc, actor, action); break;
        case 'ready':           result = await setReady(svc, actor, action); break;
        case 'start_game':      result = await startGame(svc, actor, action); break;
        case 'place_bet':       result = await placeBet(svc, actor, action); break;
        case 'play_card':       result = await playCard(svc, actor, action); break;
        case 'continue_hand':   result = await continueHand(svc, actor, action); break;
        case 'record_tricks':   result = await recordTricks(svc, actor, action); break;
        case 'request_timeout': result = await requestTimeout(svc, actor, action); break;
        case 'restart_game':    result = await restartGame(svc, actor, action); break;
        case 'set_display_name': result = await setDisplayName(svc, actor, action); break;
        case 'set_stake':       result = await setStake(svc, actor, action); break;
        case 'toggle_stake_optin': result = await toggleStakeOptin(svc, actor, action); break;
        case 'pause_game':      result = await pauseGame(svc, actor, action); break;
        case 'resume_game':     result = await resumeGame(svc, actor, action); break;
        default:                throw new Error('unknown_action');
      }
    }
  } catch (err) {
    console.error('[game-action] handler threw:', err);
    return respond({ ok: false, error: 'internal_error' }, 500);
  }

  if (result.ok && room_id) {
    void broadcastStateChanged(svc, room_id, result.version).catch((e) =>
      console.error('[game-action] broadcast failed:', e),
    );
  }

  // Fire-and-forget Web Push for every event the action triggered. Awaited
  // (in parallel) only so 410-cleanup deletes and last_used_at updates settle
  // before the function context tears down — sequential await would stack
  // up to 3s × N events of latency on the response.
  if (result.ok) {
    try {
      const events = detectTransitions(prev, result.state, actor, action.kind as ActionKind);
      await Promise.all(events.map((ev) => notifyPush(svc, ev)));
    } catch (err) {
      console.warn('[game-action] push detection threw:', err);
    }
  }

  // Always include the actor's session_id so the client can identify itself
  // in the players list (auth.users.id ≠ room_sessions.id).
  return respond({ ...result, me_session_id: actor.session_id });
});
