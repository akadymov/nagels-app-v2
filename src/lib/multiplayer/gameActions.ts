/**
 * Nägels Online - Multiplayer Game Actions
 *
 * Sends game actions to Supabase for multiplayer sync
 */

import { getSupabaseClient } from '../supabase/client';
import { useMultiplayerStore } from '../../store/multiplayerStore';
import { useGameStore } from '../../store/gameStore';

// ============================================================
// GAME STATE SNAPSHOTS
// ============================================================

/**
 * Save game state to server via RPC with optimistic locking.
 * Only the acting client calls this after computing the new state.
 * All other clients pick up the state via polling.
 */
export async function saveGameSnapshot(): Promise<void> {
  const multiplayerState = useMultiplayerStore.getState();
  const roomId = multiplayerState.currentRoom?.id;
  if (!roomId) return;

  const gs = useGameStore.getState();
  const supabase = getSupabaseClient();

  const playerData = gs.players.map(p => ({
    id: p.id,
    name: p.name,
    hand: p.hand,
    bet: p.bet,
    tricksWon: p.tricksWon,
    score: p.score,
    bonus: p.bonus,
    isReady: p.isReady,
  }));

  const gameState = {
    phase: gs.phase,
    handNumber: gs.handNumber,
    totalHands: gs.totalHands,
    playerCount: gs.playerCount,
    maxCardsPerPlayer: gs.maxCardsPerPlayer,
    cardsPerPlayer: gs.cardsPerPlayer,
    currentPlayerIndex: gs.currentPlayerIndex,
    startingPlayerIndex: gs.startingPlayerIndex,
    firstHandStartingPlayerIndex: gs.firstHandStartingPlayerIndex,
    bettingPlayerIndex: gs.bettingPlayerIndex,
    hasAllBets: gs.hasAllBets,
    trumpSuit: gs.trumpSuit,
    currentTrick: gs.currentTrick,
    tricks: gs.tricks,
    players: playerData,
    scoreHistory: gs.scoreHistory,
  };

  try {
    // Try RPC with version lock first
    const { data, error } = await supabase.rpc('update_game_state', {
      p_room_id: roomId,
      p_expected_version: gs.version || 0,
      p_phase: gs.phase,
      p_hand_number: gs.handNumber,
      p_current_player_index: gs.currentPlayerIndex,
      p_trump_suit: gs.trumpSuit,
      p_cards_per_player: gs.cardsPerPlayer,
      p_game_state: gameState,
    });

    if (error) {
      // RPC failed — fallback to upsert (e.g. first write for this room)
      console.log('[GameActions] RPC failed, falling back to upsert:', error.message);
      const { error: upsertErr } = await supabase
        .from('game_states')
        .upsert({
          room_id: roomId,
          hand_number: gs.handNumber,
          phase: gs.phase,
          current_player_index: gs.currentPlayerIndex,
          trump_suit: gs.trumpSuit,
          cards_per_player: gs.cardsPerPlayer,
          players: playerData,
          current_trick: gs.currentTrick ?? { cards: [], winnerId: '', leadSuit: '' },
          tricks: gs.tricks,
          deck: gs.deck ?? [],
          version: (gs.version || 0) + 1,
          game_state: gameState,
        }, { onConflict: 'room_id' });

      if (upsertErr) {
        console.error('[GameActions] Upsert also failed:', upsertErr.message);
      }
    } else if (data?.success) {
      // Update local version to match server
      useGameStore.setState({ version: data.version });
    } else if (data && !data.success) {
      console.log('[GameActions] Version conflict, server at v' + data.version);
    }
  } catch (e) {
    console.error('[GameActions] saveGameSnapshot exception:', e);
  }
}

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

  // Save full game state snapshot (fire-and-forget)
  saveGameSnapshot();
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

  // Save full game state snapshot (fire-and-forget)
  saveGameSnapshot();
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
