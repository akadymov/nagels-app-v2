/**
 * Nägels Online — Server-Authoritative Game Action
 *
 * Single endpoint. All game mutations go through this function.
 * Pipeline: JWT verify → advisory lock → action handler → snapshot →
 * broadcast → response.
 */

import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import type { Action, ActionResult, ActorContext } from '../_shared/types.ts';
import { authenticate, makeServiceClient } from './auth.ts';
import { broadcastStateChanged } from './broadcast.ts';

import { createRoom }     from './actions/createRoom.ts';
import { joinRoom }       from './actions/joinRoom.ts';
import { leaveRoom }      from './actions/leaveRoom.ts';
import { setReady }       from './actions/ready.ts';
import { startGame }      from './actions/startGame.ts';
import { placeBet }       from './actions/placeBet.ts';
import { playCard }       from './actions/playCard.ts';
import { continueHand }   from './actions/continueHand.ts';
import { requestTimeout } from './actions/requestTimeout.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST')   return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);

  let body: { display_name?: string; action: Action };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }

  let actor: ActorContext;
  try {
    actor = await authenticate(req, body.display_name ?? null);
  } catch {
    return jsonResponse({ ok: false, error: 'auth_failed' }, 401);
  }

  const svc = makeServiceClient();
  const action = body.action;
  const room_id = (action as any).room_id ?? null;

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
        case 'request_timeout': result = await requestTimeout(svc, actor, action); break;
        default:                throw new Error('unknown_action');
      }
    }
  } catch (err) {
    console.error('[game-action] handler threw:', err);
    return jsonResponse({ ok: false, error: 'internal_error' }, 500);
  }

  if (result.ok && room_id) {
    void broadcastStateChanged(svc, room_id, result.version).catch((e) =>
      console.error('[game-action] broadcast failed:', e),
    );
  }

  // Always include the actor's session_id so the client can identify itself
  // in the players list (auth.users.id ≠ room_sessions.id).
  return jsonResponse({ ...result, me_session_id: actor.session_id });
});
