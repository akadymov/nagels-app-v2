/**
 * Nägels Online - Multiplayer Game Actions
 *
 * Sends game actions to Supabase for multiplayer sync
 */

import { getSupabaseClient } from '../supabase/client';
import { useMultiplayerStore } from '../../store/multiplayerStore';

// ============================================================
// BET ACTIONS
// ============================================================

/**
 * Place a bet (multiplayer mode)
 * Updates local gameStore and syncs to server
 */
export async function multiplayerPlaceBet(playerId: string, bet: number): Promise<void> {
  const state = useMultiplayerStore.getState();
  if (!state.currentRoom?.id) {
    throw new Error('Not in a room');
  }

  const supabase = getSupabaseClient();
  const roomId = state.currentRoom.id;

  // Insert bet event
  const { error } = await supabase
    .from('game_events')
    .insert({
      room_id: roomId,
      event_type: 'bet_placed',
      event_data: {
        player_id: playerId,
        bet: bet,
      },
      player_id: playerId,
      version: 1,
    });

  if (error) {
    console.error('[GameActions] Error placing bet:', error);
    throw new Error('Failed to place bet');
  }

  console.log('[GameActions] Bet placed:', playerId, bet);
}

// ============================================================
// CARD PLAY ACTIONS
// ============================================================

/**
 * Play a card (multiplayer mode)
 * Updates local gameStore and syncs to server
 */
export async function multiplayerPlayCard(playerId: string, cardId: string, card: any): Promise<void> {
  const state = useMultiplayerStore.getState();
  if (!state.currentRoom?.id) {
    throw new Error('Not in a room');
  }

  const supabase = getSupabaseClient();
  const roomId = state.currentRoom.id;

  // Insert card played event
  const { error } = await supabase
    .from('game_events')
    .insert({
      room_id: roomId,
      event_type: 'card_played',
      event_data: {
        player_id: playerId,
        card_id: cardId,
        card: card, // Include full card data for other players
      },
      player_id: playerId,
      version: 1,
    });

  if (error) {
    console.error('[GameActions] Error playing card:', error);
    throw new Error('Failed to play card');
  }

  console.log('[GameActions] Card played:', playerId, cardId);
}

// ============================================================
// CHAT ACTIONS
// ============================================================

/**
 * Send a chat message (multiplayer mode)
 */
export async function multiplayerSendChat(
  playerId: string,
  playerName: string,
  text: string
): Promise<void> {
  const state = useMultiplayerStore.getState();
  if (!state.currentRoom?.id) {
    throw new Error('Not in a room');
  }

  const supabase = getSupabaseClient();
  const roomId = state.currentRoom.id;

  const { error } = await supabase
    .from('game_events')
    .insert({
      room_id: roomId,
      event_type: 'chat_message',
      event_data: {
        player_id: playerId,
        player_name: playerName,
        text,
        timestamp: Date.now(),
      },
      player_id: playerId,
      version: 1,
    });

  if (error) {
    console.error('[GameActions] Error sending chat:', error);
    throw new Error('Failed to send message');
  }
}
