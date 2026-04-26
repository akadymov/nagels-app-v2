/**
 * Nagels Online - Multiplayer Game Actions
 *
 * All game actions go through the Supabase Edge Function.
 * The server is the single source of truth.
 */

import { useMultiplayerStore } from '../../store/multiplayerStore';
import { useGameStore } from '../../store/gameStore';
import { getSupabaseClient } from '../supabase/client';

const EDGE_FUNCTION_URL = process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1/game-action';

async function callGameAction(
  actionType: string,
  actionData?: Record<string, unknown>,
): Promise<{ success: boolean; state?: Record<string, unknown>; version?: number; error?: string }> {
  const multiplayerState = useMultiplayerStore.getState();
  const roomId = multiplayerState.currentRoom?.id;
  const gameState = useGameStore.getState();
  const playerId = gameState.myPlayerId;

  if (!roomId || !playerId) {
    return { success: false, error: 'Not in a room' };
  }

  try {
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        room_id: roomId,
        player_id: playerId,
        action_type: actionType,
        action_data: actionData,
      }),
    });

    const result = await response.json();

    if (result.success && result.state) {
      // Apply server state immediately (actor gets instant feedback)
      useGameStore.getState().forceRemoteState({
        ...result.state,
        version: result.version,
        players: result.state.players,
      });
    }

    return result;
  } catch (error) {
    console.error('[GameActions] Edge Function call failed:', error);
    return { success: false, error: 'Network error' };
  }
}

export async function multiplayerPlaceBet(playerId: string, bet: number): Promise<void> {
  const result = await callGameAction('place_bet', { bet });
  if (!result.success) {
    console.error('[GameActions] Place bet failed:', result.error);
    throw new Error(result.error || 'Failed to place bet');
  }
}

export async function multiplayerPlayCard(playerId: string, cardId: string): Promise<void> {
  const result = await callGameAction('play_card', { cardId });
  if (!result.success) {
    console.error('[GameActions] Play card failed:', result.error);
    throw new Error(result.error || 'Failed to play card');
  }
}

export async function multiplayerContinueHand(): Promise<void> {
  const result = await callGameAction('continue_hand');
  if (!result.success) {
    console.error('[GameActions] Continue hand failed:', result.error);
  }
}

export async function multiplayerStartGame(
  players: Array<{ id: string; name: string }>,
  firstHandStartingPlayerIndex: number,
): Promise<void> {
  const multiplayerState = useMultiplayerStore.getState();
  const roomId = multiplayerState.currentRoom?.id;
  const result = await callGameAction('start_game', {
    players,
    roomId,
    firstHandStartingPlayerIndex,
  });
  if (!result.success) {
    throw new Error(result.error || 'Failed to start game');
  }
}

/**
 * Send a chat message (unchanged -- still writes to game_events)
 */
export async function multiplayerSendChat(
  playerId: string,
  playerName: string,
  text: string,
): Promise<void> {
  const state = useMultiplayerStore.getState();
  if (!state.currentRoom?.id) throw new Error('Not in a room');

  const supabase = getSupabaseClient();
  const { error } = await supabase.from('game_events').insert({
    room_id: state.currentRoom.id,
    event_type: 'chat_message',
    event_data: { player_id: playerId, player_name: playerName, text, timestamp: Date.now() },
    player_id: playerId,
    version: 1,
  });

  if (error) throw new Error('Failed to send message');
}
