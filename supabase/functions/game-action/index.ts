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
      result = await withRoomLock(svc, room_id, async () => {
        switch (action.kind) {
          case 'leave_room':      return leaveRoom(svc, actor, action);
          case 'ready':           return setReady(svc, actor, action);
          case 'start_game':      return startGame(svc, actor, action);
          case 'place_bet':       return placeBet(svc, actor, action);
          case 'play_card':       return playCard(svc, actor, action);
          case 'continue_hand':   return continueHand(svc, actor, action);
          case 'request_timeout': return requestTimeout(svc, actor, action);
          default:                throw new Error('unknown_action');
        }
      });
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

  return jsonResponse(result);
});

async function withRoomLock<T>(
  svc: any,
  room_id: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  if (!room_id) return fn();
  const { error } = await svc.rpc('acquire_room_lock', { p_room_id: room_id });
  if (error) throw error;
  try {
    return await fn();
  } finally {
    await svc.rpc('release_room_lock', { p_room_id: room_id });
  }
}
