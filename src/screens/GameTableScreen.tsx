/**
 * Nägels Online - Game Table Screen
 * Main play interface with cards and opponents
 * Connected to Zustand game store
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Modal,
  Platform,
  Dimensions,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassCard } from '../components/glass';
import { GameLogo } from '../components/GameLogo';
import { BettingPhase } from '../components/betting';
import { ScoreboardModal } from './ScoreboardModal';
import { PlayingCard, CardHand } from '../components/cards';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { ChatPanel, ChatButton } from '../components/ChatPanel';
import { refreshGameState } from '../lib/multiplayer/eventHandler';
import { multiplayerContinueHand } from '../lib/multiplayer/gameActions';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { Colors, Spacing, Radius, TextStyles, SuitSymbols } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { useGameStore } from '../store';
import { useMultiplayerStore } from '../store/multiplayerStore';
import { useSettingsStore, type ThemePreference } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';
import { useTranslation } from 'react-i18next';
import type { PlayerScore } from './ScoreboardModal';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

export interface GameTableScreenProps {
  onExit?: () => void;
  playerName?: string;
  isMultiplayer?: boolean;
  botDifficulty?: 'easy' | 'medium' | 'hard';
  botCount?: number;
}

/**
 * GameTableScreen - Main game interface
 *
 * Features:
 * - Connected to Zustand game store
 * - Betting phase modal
 * - Card play with rule validation
 * - Player cards showing bet AND tricks won
 * - Center trick area with player-positioned cards
 * - Turn indicator highlighting active player
 * - Scoreboard modal between hands
 */
// Bot nicknames reflect common Nägels player archetypes, inspired by
// the classic Microsoft Hearts bots (Pauline, Michelle, etc.) but with
// a gameplay twist.  Each name hints at a bidding/play style:
//   Перебор / Overkill / Farol     — always overbids
//   Нулёвый / Nil      / Cero      — hunts for zero bets
//   Козырной/ Trumpster/ Triunfo   — trump-card fanatic
//   Авось   / Longshot / Temerario — plays on pure luck
//   Хитрец  / Trickster/ Artero    — counts tricks, plays sly
const BOT_NAMES_BY_LANG: Record<string, string[]> = {
  ru: ['Перебор', 'Нулёвый', 'Козырной', 'Авось', 'Хитрец'],
  en: ['Overkill', 'Nil', 'Trumpster', 'Longshot', 'Trickster'],
  es: ['Farol', 'Cero', 'Triunfo', 'Temerario', 'Artero'],
};

export const GameTableScreen: React.FC<GameTableScreenProps> = ({
  onExit,
  playerName = 'Player',
  isMultiplayer = false,
  botDifficulty = 'medium',
  botCount = 3,
}) => {
  const { t, i18n } = useTranslation();
  const { colors, isDark } = useTheme();
  const botNames = BOT_NAMES_BY_LANG[i18n.language] ?? BOT_NAMES_BY_LANG.en;

  // Multiplayer store for multiplayer mode
  const multiplayerStore = useMultiplayerStore();

  // Settings & auth for in-game settings panel
  const themePreference = useSettingsStore((s) => s.themePreference);
  const setThemePreference = useSettingsStore((s) => s.setThemePreference);
  const fourColorDeck = useSettingsStore((s) => s.fourColorDeck);
  const setFourColorDeck = useSettingsStore((s) => s.setFourColorDeck);
  const isGuest = useAuthStore((s) => s.isGuest);
  const authDisplayName = useAuthStore((s) => s.displayName);

  // Game store selectors
  const {
    phase,
    handNumber,
    totalHands,
    playerCount,
    players,
    trumpSuit,
    cardsPerPlayer,
    currentPlayerIndex,
    startingPlayerIndex,
    bettingPlayerIndex,
    currentTrick,
    tricks,
    hasAllBets,
    myPlayerId,
    initGame,
    startBetting,
    placeBet,
    placeBotBet,
    startPlaying,
    playCard,
    playBotCard,
    completeHand,
    nextHand,
    endGame,
    reset,
    setMultiplayerMode,
    setBotDifficulty,
    getCurrentPlayer,
    getMyPlayer,
    getPlayableCards,
    canPlayCard,
    isBotTurn,
  } = useGameStore();

  // Scoreboard state
  const [showScoreboard, setShowScoreboard] = React.useState(false);
  const [isViewingScores, setIsViewingScores] = React.useState(false); // mid-game view

  // Last trick modal state
  const [showLastTrick, setShowLastTrick] = React.useState(false);

  // Selected card for playing
  const [selectedCard, setSelectedCard] = React.useState<string | null>(null);

  // Chat state
  const [showChat, setShowChat] = React.useState(false);
  const hasUnreadChat = useMultiplayerStore((s) => s.hasUnreadChat);

  // Language modal
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const currentRoom = useMultiplayerStore((s) => s.currentRoom);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const handlePullRefresh = useCallback(async () => {
    if (!currentRoom?.id) return;
    setIsRefreshing(true);
    try {
      await refreshGameState(currentRoom.id, true);
    } finally {
      setIsRefreshing(false);
    }
  }, [currentRoom?.id]);

  // Poll server game_states every 2s in multiplayer to stay in sync.
  // The Edge Function is the single source of truth.
  useEffect(() => {
    if (!isMultiplayer || !currentRoom?.id) return;
    const roomId = currentRoom.id;

    const interval = setInterval(async () => {
      try {
        await refreshGameState(roomId, true);
      } catch (_) {}
    }, 2000);

    return () => clearInterval(interval);
  }, [isMultiplayer, currentRoom?.id]);

  // Poll for chat messages (Realtime fallback)
  useEffect(() => {
    if (!isMultiplayer || !currentRoom?.id) return;
    const headers = {
      'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
      'Authorization': `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || ''}`,
    };
    const pollChat = async () => {
      try {
        const res = await fetch(
          `${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/game_events?room_id=eq.${currentRoom.id}&event_type=eq.chat_message&select=*&order=created_at.desc&limit=20`,
          { headers }
        );
        if (!res.ok) return;
        const events = await res.json();
        if (!events?.length) return;
        const store = useMultiplayerStore.getState();
        for (const e of events.reverse()) {
          const data = e.event_data;
          if (!data) continue;
          store.addChatMessage({
            id: e.id,
            playerId: data.player_id,
            playerName: data.player_name,
            text: data.text,
            timestamp: data.timestamp,
          });
        }
      } catch { /* ignore */ }
    };
    const interval = setInterval(pollChat, 5000);
    return () => clearInterval(interval);
  }, [isMultiplayer, currentRoom?.id]);

  const handleSync = async () => {
    if (!isMultiplayer || isSyncing) return;
    const roomId = currentRoom?.id;
    if (!roomId) return;
    setIsSyncing(true);
    try {
      const { subscribeToRoomEvents } = await import('../lib/multiplayer/eventHandler');
      // Re-subscribe to refresh room/player data and the realtime channel
      subscribeToRoomEvents(roomId);
      // Force-refresh game state from server
      await refreshGameState(roomId, true);
    } catch (e) {
      console.error('[Sync] Failed:', e);
    } finally {
      setTimeout(() => setIsSyncing(false), 1500);
    }
  };

  // "X to give / X to fight" banner — shown when all bets are in
  const [showBetBanner, setShowBetBanner] = React.useState(false);
  const totalBets = players.reduce((sum, p) => sum + (p.bet ?? 0), 0);
  const tricksDiff = totalBets - cardsPerPlayer; // negative = to give, positive = to fight

  // Show banner automatically when all bets placed, auto-hide after 3s
  useEffect(() => {
    if (hasAllBets && phase === 'betting') {
      setShowBetBanner(true);
      const t = setTimeout(() => setShowBetBanner(false), 3000);
      return () => clearTimeout(t);
    } else if (phase === 'playing') {
      setShowBetBanner(false);
    }
  }, [hasAllBets, phase]);

  // Initialize game on mount
  useEffect(() => {
    // Skip if already initialized
    if (players.length > 0) {
      return;
    }

    if (isMultiplayer) {
      // Multiplayer mode: use players from multiplayerStore
      const { roomPlayers, myPlayerId } = multiplayerStore;

      if (roomPlayers.length >= 2 && myPlayerId) {
        // Set multiplayer mode in gameStore
        setMultiplayerMode(true);

        // Convert RoomPlayer to Player format
        const gamePlayers = roomPlayers.map((rp) => ({
          id: rp.playerId,
          name: rp.playerName,
          isBot: rp.isBot,
        }));

        console.log('[GameTable] Initializing multiplayer game with players:', gamePlayers.map(p => p.name));
        initGame(gamePlayers, myPlayerId);

        // Start betting after a short delay
        setTimeout(() => {
          startBetting();
        }, 500);
      } else {
        console.log('[GameTable] Waiting for players...', roomPlayers.length, '/ 2');
      }
    } else {
      // Single-player mode: create bot players (botCount bots + 1 human)
      const totalPlayers = botCount + 1;
      const gamePlayers = Array.from({ length: totalPlayers }, (_, i) => ({
        id: `player-${i}`,
        name: i === 0 ? playerName : botNames[i - 1],
        isBot: i !== 0,
      }));

      // Set bot difficulty for single-player mode
      setBotDifficulty(botDifficulty);

      initGame(gamePlayers, 'player-0');

      // Start first hand
      setTimeout(() => {
        startBetting();
      }, 500);
    }

    return () => {
      reset();
    };
  }, [isMultiplayer, multiplayerStore.roomPlayers.length]);

  // Multiplayer mode: start betting when game is ready (ONLY for hand 1)
  useEffect(() => {
    // Only auto-start betting for the first hand (handNumber === 1)
    // For subsequent hands, wait for explicit nextHand() call
    if (isMultiplayer && phase === 'lobby' && players.length > 0 && handNumber === 1) {
      console.log('[GameTable] Multiplayer game ready, starting betting for hand 1...');
      setTimeout(() => {
        startBetting();
      }, 500);
    }
  }, [isMultiplayer, phase, players.length, handNumber]);

  // Start betting for hands 2+ when phase becomes 'lobby' (both single-player and multiplayer)
  useEffect(() => {
    if (phase === 'lobby' && handNumber > 1 && players.length > 0) {
      console.log('[GameTable] Hand', handNumber, 'lobby phase detected, starting betting...');
      const timer = setTimeout(() => {
        startBetting();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [phase, handNumber]);

  // Auto-start playing when all bets are placed
  useEffect(() => {
    const allBetsPlaced = players.every(p => p.bet !== null);
    if (phase === 'betting' && allBetsPlaced) {
      setTimeout(() => {
        startPlaying();
      }, 1000);
    }
  }, [players, phase]);

  // Show scoreboard when hand scoring or game finished
  useEffect(() => {
    if (phase === 'scoring' || phase === 'finished') {
      setShowScoreboard(true);
      setIsViewingScores(false);
    }
  }, [phase]);

  // Stuck detection: if all cards played but still in playing phase, force completeHand
  useEffect(() => {
    if (!isMultiplayer || phase !== 'playing') return;
    const allCardsPlayed = players.every(p => p.hand.length === 0);
    if (!allCardsPlayed || currentTrick) return;

    // All cards gone, no active trick, still in playing — we're stuck
    const timer = setTimeout(() => {
      const currentState = useGameStore.getState();
      if (currentState.phase === 'playing' && currentState.players.every(p => p.hand.length === 0) && !currentState.currentTrick) {
        console.log('[StuckDetect] All cards played, no trick, forcing completeHand');
        currentState.completeHand();
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [isMultiplayer, phase, players, currentTrick]);

  // Bot betting automation (skip in multiplayer)
  useEffect(() => {
    if (!isMultiplayer && phase === 'betting' && isBotTurn()) {
      const timer = setTimeout(() => {
        placeBotBet();
      }, 1000 + Math.random() * 500); // 1-1.5s delay for realism
      return () => clearTimeout(timer);
    }
  }, [isMultiplayer, phase, bettingPlayerIndex, isBotTurn, placeBotBet]);

  // Bot card play automation (skip in multiplayer)
  useEffect(() => {
    if (isMultiplayer) return; // Skip bot automation in multiplayer

    const botTurn = isBotTurn();
    const currentPlayer = getCurrentPlayer();

    // Don't trigger if bot has no cards left
    if (!currentPlayer || currentPlayer.hand.length === 0) {
      return;
    }

    console.log('[BotAutomation] phase:', phase, 'isBotTurn:', botTurn, 'currentPlayerIndex:', currentPlayerIndex);

    // Don't trigger if trick is completing (has 4 cards but hasn't been cleared yet)
    const trickCompleting = currentTrick && currentTrick.cards.length >= playerCount;

    if (phase === 'playing' && botTurn && !trickCompleting) {
      const timer = setTimeout(() => {
        console.log('[BotAutomation] Triggering playBotCard');
        playBotCard();
      }, 800 + Math.random() * 400); // 0.8-1.2s delay for realism
      return () => clearTimeout(timer);
    }
  }, [phase, currentTrick, currentPlayerIndex, isBotTurn, playBotCard, getCurrentPlayer]);

  // Get current player
  const currentPlayer = getCurrentPlayer();
  const myPlayer = getMyPlayer();

  // Get turn label text
  const getTurnLabel = (): string => {
    if (!currentPlayer) return t('game.waiting');
    if (currentPlayer.id === myPlayerId) return t('game.yourTurn');
    return t('game.playerTurn', { name: currentPlayer.name }); // e.g., "Ivan's turn"
  };

  // Get playable cards for my player
  const playableCards = useMemo(() => {
    if (!myPlayer) return [];
    return getPlayableCards(myPlayer.id);
  }, [myPlayer, getPlayableCards]);

  // Handle card play — two-tap confirmation to avoid misclicks on mobile
  const handleCardPress = (cardId: string) => {
    if (!myPlayer || phase !== 'playing') return;

    // Check if it's my turn
    if (currentPlayer?.id !== myPlayer.id) return;

    const card = myPlayer.hand.find(c => c.id === cardId);
    if (!card) return;

    // Check if card is playable — silently ignore invalid picks
    // (playable cards are already visually highlighted; no need for an alert)
    if (!canPlayCard(myPlayer.id, card)) {
      setSelectedCard(null);
      return;
    }

    if (selectedCard === cardId) {
      // Second tap on the same card — confirm and play
      playCard(myPlayer.id, card);
      setSelectedCard(null);
    } else {
      // First tap — select the card (highlight it)
      setSelectedCard(cardId);
    }
  };

  // Handle scoreboard continue
  const handleScoreboardContinue = () => {
    const wasViewingScores = isViewingScores; // capture before async setter
    setShowScoreboard(false);
    setIsViewingScores(false);

    if (wasViewingScores) {
      // Just viewing scores mid-game - don't advance
      return;
    }

    if (isMultiplayer) {
      // In multiplayer, tell the server to advance to next hand (or finish).
      // The server response will update local state via forceRemoteState.
      multiplayerContinueHand().catch(err => {
        console.error('[GameTable] Continue hand failed:', err);
      });
    } else if (handNumber >= totalHands) {
      // Game over (single-player)
      endGame();
    } else {
      // Next hand (single-player)
      nextHand();
      // startBetting() is triggered by the useEffect watching phase === 'lobby'
    }
  };

  // Handle scoreboard close (for mid-game viewing)
  const handleScoreboardClose = () => {
    setShowScoreboard(false);
    setIsViewingScores(false);
  };

  // Get trump symbol and color
  const getTrumpSymbol = (trump: string): string => {
    if (trump === 'notrump') return 'NT';
    return SuitSymbols[trump as keyof typeof SuitSymbols] || trump;
  };

  const getTrumpColor = (trump: string): string => {
    if (trump === 'notrump') return Colors.textMuted;
    return (Colors[trump as keyof typeof Colors] as string) || Colors.textSecondary;
  };

  // Get player position for circular layout around the table
  // Returns the position of a player in the circle (excluding YOU)
  const getPlayerPosition = (playerIndex: number, totalPlayers: number) => {
    // Find where YOU is in the players array
    const myIndex = players.findIndex(p => p.id === myPlayerId);
    if (myIndex === -1) return playerIndex;

    // Calculate relative position (YOU is always at position 6 - bottom/6 o'clock)
    // Other players are positioned clockwise around the table
    const relativeIndex = (playerIndex - myIndex + totalPlayers) % totalPlayers;

    // Map relative position to clock position (0-11, where 6 is YOU at bottom)
    // For 2 players: opponent at 12 o'clock (position 0)
    // For 3 players: opponents at 10 o'clock (position 4), 2 o'clock (position 8)
    // For 4 players: opponents at 9, 12, 3 o'clock (positions 3, 0, 9)
    // etc.
    return relativeIndex;
  };

  // Check if a player is YOU (should be rendered separately at bottom)
  const isMe = (player: typeof players[0]) => player.id === myPlayerId;

  // Get only opponents (not YOU)
  const opponents = players.filter(p => p.id !== myPlayerId);

  // Calculate position style for each opponent on a clock face
  // YOU is always at 6 o'clock (bottom), opponents are arranged clockwise
  const getOpponentClockPosition = (relativeIndex: number, totalPlayers: number) => {
    // Map relative index to clock position (0-11, where 6 is YOU)
    // Start from position above YOU and go clockwise
    // Positions go screen-CCW from YOU (clock 6 = bottom), matching the
    // CCW trick-pile spiral.  Each step subtracts 360/N degrees so that
    // the seating order around the table is identical to the turn order.
    const clockPositions: Record<number, number[]> = {
      2: [0],            // 12 o'clock
      3: [2, 10],        // upper-right, upper-left (120° apart)
      4: [3, 0, 9],      // right, top, left (90° apart)
      5: [3, 1, 11, 9],  // right, upper-right, upper-left, left (≈72° apart)
      6: [4, 2, 0, 10, 8], // lower-right, upper-right, top, upper-left, lower-left (60° apart)
    };

    const positions = clockPositions[totalPlayers as keyof typeof clockPositions] || [0];
    return positions[relativeIndex - 1] || 0;
  };

  // Convert clock position (0-11) to screen coordinates
  // Profile card dimensions for centering
  const PROFILE_W = 110;
  const PROFILE_H = 90;

  const clockToScreen = (clockPosition: number) => {
    const angle = (clockPosition * 30 - 90) * (Math.PI / 180);
    const radius = 38;

    let top = 50 + radius * Math.sin(angle);
    let left = 50 + radius * Math.cos(angle);

    // Clamp so profile doesn't overflow screen edges
    // Convert % to consider profile size relative to screen
    const halfWPct = (PROFILE_W / 2 / SCREEN_WIDTH) * 100;
    const halfHPct = (PROFILE_H / 2 / SCREEN_HEIGHT) * 100;
    left = Math.max(halfWPct + 1, Math.min(100 - halfWPct - 1, left));
    top = Math.max(halfHPct, Math.min(100 - halfHPct, top));

    return {
      top: `${top}%`,
      left: `${left}%`,
      marginTop: -(PROFILE_H / 2),
      marginLeft: -(PROFILE_W / 2),
    };
  };

  // Get position number for display (1=first player after YOU in clockwise order)
  const getPlayerNumber = (relativeIndex: number) => {
    if (relativeIndex === 0) return ''; // YOU has no number
    return relativeIndex.toString();
  };

  /**
   * Returns the (dx, dy) offset for a card played by `playerId`.
   * The card is placed in the direction of the player's seat on the table,
   * so a player sitting at upper-right will always have their card in the
   * upper-right quadrant of the trick pile — regardless of play order.
   *
   * For 6 players we use equal vertical spacing (13 px steps) so every
   * card's rank+suit corner stays visible even at top and bottom seats.
   */
  const getPlayerCardOffset = (playerId: string): { dx: number; dy: number } => {
    const RADIUS = 40;

    const playerIdx = players.findIndex(p => p.id === playerId);
    const myIndex   = players.findIndex(p => p.id === myPlayerId);
    if (playerIdx === -1 || myIndex === -1) return { dx: 0, dy: 0 };

    const relativeIndex = (playerIdx - myIndex + playerCount) % playerCount;

    // Same clockPositions table used for seating layout
    const clockPositions: Record<number, number[]> = {
      2: [0],
      3: [2, 10],
      4: [3, 0, 9],
      5: [3, 1, 11, 9],
      6: [4, 2, 0, 10, 8],
    };

    let clockPos: number;
    if (relativeIndex === 0) {
      clockPos = 6; // ME = bottom
    } else {
      const positions = clockPositions[playerCount as keyof typeof clockPositions] || [0];
      clockPos = positions[relativeIndex - 1] ?? 0;
    }

    const angleRad = (clockPos * 30 - 90) * (Math.PI / 180);
    const dx = Math.round(Math.cos(angleRad) * RADIUS);

    let dy: number;
    if (playerCount === 6) {
      // Equal vertical spacing: 4 levels with 26 px gaps
      // Indexed by CCW-from-top position: 0=top, 1=upper-left, 2=lower-left,
      //   3=bottom, 4=lower-right, 5=upper-right
      const S = 18;
      const equalDY = [-3 * S, -S, S, 3 * S, S, -S];
      const ccwPos = ((12 - clockPos) / 2 + 6) % 6;
      dy = equalDY[ccwPos];
    } else {
      dy = Math.round(Math.sin(angleRad) * RADIUS);
    }

    return { dx, dy };
  };

  // Convert players to scoreboard format
  const scoreboardPlayers: PlayerScore[] = useMemo(() => {
    return players
      .map((p, i) => {
        // Calculate points earned in last hand (tricks + potential bonus)
        const lastHandBonus = (p.bet !== null && p.tricksWon === p.bet) ? 10 : 0;
        const lastHandPoints = p.tricksWon + lastHandBonus;

        // Disambiguate duplicate names by appending seat index
        const isDuplicate = players.filter(other => other.name === p.name).length > 1;
        const displayName = isDuplicate ? `${p.name} #${i + 1}` : p.name;

        return {
          id: p.id,
          name: displayName,
          rank: i + 1,
          totalScore: p.score + p.bonus, // Total score includes both points and bonus
          lastBet: p.bet || 0,
          lastTricks: p.tricksWon,
          lastBonus: lastHandBonus, // Bonus from last hand only
          lastPoints: lastHandPoints, // Points from last hand (tricks + bonus)
          madeBet: p.bet !== null && p.tricksWon === p.bet,
        };
      })
      .sort((a, b) => b.totalScore - a.totalScore)
      .map((p, i) => ({ ...p, rank: i + 1 }));
  }, [players]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        scrollEnabled={false}
        refreshControl={
          isMultiplayer ? (
            <RefreshControl refreshing={isRefreshing} onRefresh={handlePullRefresh} />
          ) : undefined
        }
      >

      {/* Connection Status (multiplayer only) */}
      {isMultiplayer && <ConnectionStatus />}

      {/* Top Bar — two rows: logo centered, hand info below */}
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.glassLight }]}>
        {/* Row 1: logo centered */}
        <View style={styles.topBarRow1}>
          <GameLogo size="xs" />
        </View>
        {/* Row 2: hand info + trump */}
        <View style={styles.topBarRow2}>
          <Text style={[styles.handInfo, { color: colors.textPrimary }]}>
            {t('game.hand')} {handNumber}/{totalHands}
          </Text>
          <View style={[styles.trumpBadgeGame, { backgroundColor: isDark ? 'rgba(19,66,143,0.2)' : 'rgba(19,66,143,0.08)', borderColor: colors.accent }]}>
            <Text style={[styles.trumpBadgeText, { color: getTrumpColor(trumpSuit) }]}>
              {getTrumpSymbol(trumpSuit)} {t('game.trump')}
            </Text>
          </View>
        </View>
        {/* Row 3: icon buttons */}
        <View style={styles.topBarRow3}>
          <Pressable onPress={onExit} style={[styles.iconBtn, { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight }]} testID="game-btn-exit">
            <Text style={[styles.iconBtnText, { color: colors.iconButtonText }]}>←</Text>
          </Pressable>
          <Pressable onPress={() => setShowSettingsModal(true)} style={[styles.iconBtn, { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight }]} testID="game-btn-settings">
            <Text style={styles.iconBtnEmoji}>⚙️</Text>
          </Pressable>
          {isMultiplayer && (
            <Pressable
              onPress={handlePullRefresh}
              disabled={isRefreshing}
              style={[styles.iconBtn, { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight, opacity: isRefreshing ? 0.5 : 1 }]}
              testID="game-btn-sync"
            >
              <Text style={styles.iconBtnEmoji}>{isRefreshing ? '⏳' : '🔄'}</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => { if (tricks.length > 0) setShowLastTrick(true); }}
            disabled={tricks.length === 0}
            style={[styles.iconBtn, { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight, opacity: tricks.length === 0 ? 0.3 : 1 }]}
            testID="game-btn-last-trick"
          >
            <Text style={styles.iconBtnEmoji}>↩</Text>
          </Pressable>
          <Pressable
            onPress={() => { setIsViewingScores(true); setShowScoreboard(true); }}
            style={[styles.iconBtn, { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight }]}
            testID="game-btn-scores"
          >
            <Text style={styles.iconBtnEmoji}>🏆</Text>
          </Pressable>
          <Pressable
            onPress={isMultiplayer ? () => setShowChat(true) : undefined}
            disabled={!isMultiplayer}
            style={[styles.iconBtn, { backgroundColor: isMultiplayer ? colors.accent : colors.iconButtonBg, borderColor: isMultiplayer ? colors.accent : colors.glassLight, opacity: isMultiplayer ? 1 : 0.3 }]}
            testID="game-btn-chat"
          >
            <Text style={styles.iconBtnEmoji}>💬</Text>
            {isMultiplayer && hasUnreadChat && (
              <View style={styles.chatBadgeDot} />
            )}
          </Pressable>
        </View>
      </View>

      {/* Main Game Area - Circular layout for card table */}
      <View style={styles.gameArea}>
        {/* Card Table - oval green felt table */}
        <View style={styles.cardTable}>
          <View style={[styles.tableEdge, { backgroundColor: isDark ? colors.table : '#33734D', borderColor: isDark ? colors.tableBorder : '#4D8C63' }]} />
          <LinearGradient
            colors={isDark ? ['#3a3f4d', '#525868', '#3a3f4d'] : ['#003e00', '#009c00', '#005d00']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.tableFelt}
          >
            {/* Suit symbols in a compact centered row at top of table */}
            <View style={styles.suitRow}>
              {(['spades', 'hearts', 'clubs', 'diamonds'] as const).map((suit) => {
                const isTrump = trumpSuit === suit;
                return (
                  <Text
                    key={suit}
                    style={[
                      styles.tableSuitSymbol,
                      isTrump
                        ? { color: '#d0d0d0', opacity: 0.95, fontSize: 22 }
                        : { color: '#ffffff', opacity: 0.12 },
                    ]}
                  >
                    {SuitSymbols[suit]}
                  </Text>
                );
              })}
            </View>

            {/* Turn info — centered on table, below suits */}
            {phase === 'playing' && (
              <View style={styles.tableInfoArea}>
                {currentPlayer?.id === myPlayerId && (
                  <View style={styles.yourTurnBadge}>
                    <Text style={styles.yourTurnText}>▶ {t('game.yourTurn')}</Text>
                  </View>
                )}
                {currentTrick && currentTrick.cards.length > 0 && (
                  <Text style={styles.mustFollowText}>
                    {t('game.mustFollow', 'Must follow')} {SuitSymbols[currentTrick.cards[0].card.suit]}
                  </Text>
                )}
              </View>
            )}
          </LinearGradient>
        </View>

        {/* My profile at bottom edge of table — same style as opponents */}
        {myPlayer && (() => {
          const isMyTurnNow = currentPlayer?.id === myPlayer.id;
          const isFirstPlayer = startingPlayerIndex === players.indexOf(myPlayer);
          return (
            <View style={styles.youLabelAtTable}>
              <View style={[
                styles.profileCard,
                isMyTurnNow && { borderColor: colors.activePlayerBorder, borderWidth: 2 },
                !isMyTurnNow && { borderColor: colors.accent, borderWidth: 1.5 },
              ]}>
                {isFirstPlayer && <Text style={styles.firstPlayerBadge}>▶</Text>}
                <View style={[styles.profileAvatar, { backgroundColor: colors.accent }]}>
                  <Text style={styles.profileAvatarText}>{myPlayer.name[0]}</Text>
                </View>
                <Text style={styles.profileName} numberOfLines={1}>{myPlayer.name}</Text>
                <Text style={styles.profileStats}>Bet:{myPlayer.bet ?? '-'} Won:{myPlayer.tricksWon}</Text>
              </View>
            </View>
          );
        })()}

        {/* Turn order indicator - bottom-right corner */}
        <View style={styles.turnOrderIndicator}>
          <Text style={styles.turnOrderText}>↻</Text>
          <Text style={styles.turnOrderLabel}>{t('game.turnOrder')}</Text>
        </View>

        {/* Opponents arranged around the table — Figma style profiles */}
        {opponents.map((player, i) => {
          const relativeIndex = getPlayerPosition(players.indexOf(player), playerCount);
          const clockPosition = getOpponentClockPosition(relativeIndex, playerCount);
          const positionStyle = clockToScreen(clockPosition);
          const isCurrentPlayer = currentPlayer?.id === player.id;
          const isFirstPlayer = startingPlayerIndex === players.indexOf(player);
          const hasPlayedThisTrick = currentTrick?.cards.some(c => c.playerId === player.id);
          // Assign avatar colors based on player index
          const avatarColors = ['#3380CC', '#CC4D80', '#66B366', '#9966CC', '#CC9933'];
          const avatarBg = avatarColors[i % avatarColors.length];

          return (
            <View
              key={player.id}
              style={[
                styles.opponentContainer,
                { top: positionStyle.top, left: positionStyle.left } as any,
              ]}
            >
              <View
                style={[
                  styles.profileCard,
                  { marginTop: positionStyle.marginTop, marginLeft: positionStyle.marginLeft },
                  isCurrentPlayer && { borderColor: colors.activePlayerBorder, borderWidth: 2 },
                ]}
              >
                {isFirstPlayer && <Text style={styles.firstPlayerBadge}>▶</Text>}
                <View style={[styles.profileAvatar, { backgroundColor: avatarBg }]}>
                  <Text style={styles.profileAvatarText}>{player.name[0]}</Text>
                </View>
                {/* Check badges removed — distracting */}
                <Text style={styles.profileName} numberOfLines={1}>{player.name}</Text>
                <Text style={styles.profileStats}>Bet:{player.bet ?? '-'} Won:{player.tricksWon}</Text>
              </View>
            </View>
          );
        })}

        {/* Center Play Area - Stacked trick cards (radial pile) */}
        <View style={styles.playArea}>
          {currentTrick && currentTrick.cards.length > 0 ? (
            <View style={styles.trickPile}>
              {currentTrick.cards.map((played, playOrder) => {
                const { dx, dy } = getPlayerCardOffset(played.playerId);
                return (
                  <View
                    key={played.playerId}
                    style={[
                      styles.trickCardAbsolute,
                      {
                        transform: [{ translateX: dx }, { translateY: dy }] as any,
                        zIndex: playOrder + 1,
                      },
                    ]}
                  >
                    <PlayingCard
                      suit={played.card.suit}
                      rank={played.card.rank}
                      size="tiny"
                    />
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.waitingText}>
              {getTurnLabel()}
            </Text>
          )}
        </View>
      </View>

      {/* Bet balance overlay: "X to give / X to fight" */}
      <Modal
        visible={showBetBanner && tricksDiff !== 0}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBetBanner(false)}
      >
        <View style={styles.betBannerOverlay}>
          <View style={[styles.betBannerModal, tricksDiff > 0 ? styles.betBannerFight : styles.betBannerGive, { backgroundColor: isDark ? colors.surface : undefined }]}>
            <Pressable style={styles.betBannerCloseBtn} onPress={() => setShowBetBanner(false)}>
              <Text style={[styles.betBannerCloseText, { color: isDark ? colors.textMuted : undefined }]}>✕</Text>
            </Pressable>
            <Text style={[styles.betBannerText, { color: isDark ? colors.textPrimary : colors.textPrimary }]}>
              {tricksDiff > 0
                ? t('game.toFight', { count: tricksDiff })
                : t('game.toGive', { count: Math.abs(tricksDiff) })}
            </Text>
            <Pressable style={styles.betBannerGotItBtn} onPress={() => setShowBetBanner(false)}>
              <Text style={styles.betBannerGotItText}>{t('game.gotIt')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Your Hand - Fixed at bottom, clearly showing YOU are at the table */}
      {myPlayer && (
        <View style={[styles.handSection, { backgroundColor: colors.surface, borderTopColor: colors.accent }]}>
          {/* Your cards */}
          <View testID="my-hand">
            <CardHand
              cards={myPlayer.hand.map(c => ({
                id: c.id,
                suit: c.suit,
                rank: c.rank,
              }))}
              selectedCards={selectedCard ? [selectedCard] : []}
              playableCards={playableCards.map(c => c.id)}
              onCardPress={handleCardPress}
              size="small"
              horizontal={false}
            />
          </View>
        </View>
      )}

      {/* Action bar removed — icons are in top bar row 2 */}

      {/* Chat Panel (multiplayer only) */}
      {isMultiplayer && myPlayer && (
        <ChatPanel
          visible={showChat}
          onClose={() => setShowChat(false)}
          myPlayerId={myPlayer.id}
          myPlayerName={myPlayer.name}
        />
      )}

      {/* Betting Phase Modal */}
      <BettingPhase
        visible={phase === 'betting'}
        isMultiplayer={isMultiplayer}
        onClose={onExit}
        onShowScore={() => {
          setIsViewingScores(true);
          setShowScoreboard(true);
        }}
      />

      {/* Scoreboard Modal */}
      <ScoreboardModal
        visible={showScoreboard}
        handNumber={handNumber}
        totalHands={totalHands}
        players={scoreboardPlayers}
        scoreHistory={useGameStore.getState().scoreHistory}
        startingPlayerIndex={startingPlayerIndex}
        isGameOver={handNumber >= totalHands || phase === 'finished'}
        isMidGame={isViewingScores}
        onContinue={handleScoreboardContinue}
        onClose={isViewingScores ? handleScoreboardClose : handleScoreboardContinue}
      />

      {/* Last Trick Modal */}
      <Modal
        visible={showLastTrick}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLastTrick(false)}
      >
        <View style={styles.modalOverlay}>
          <GlassCard style={styles.lastTrickModal}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>{t('game.lastTrick')}</Text>
              <Pressable onPress={() => setShowLastTrick(false)} hitSlop={12}>
                <Text style={[styles.modalClose, { color: colors.textMuted }]}>✕</Text>
              </Pressable>
            </View>

            {tricks.length > 0 && (() => {
              const lastTrick = tricks[tricks.length - 1];
              // Use smaller cards and 2-column grid for 5+ players to fit on screen
              const useLarge = playerCount <= 4;
              return (
                <>
                  <ScrollView
                    style={styles.lastTrickScroll}
                    contentContainerStyle={[
                      styles.lastTrickContent,
                      !useLarge && styles.lastTrickContentGrid,
                    ]}
                    showsVerticalScrollIndicator={false}
                  >
                    {lastTrick.cards.map((played, index) => {
                      const player = players.find(p => p.id === played.playerId);
                      const isWinner = lastTrick.winnerId === played.playerId;
                      return (
                        <View key={index} style={[
                          styles.lastTrickCard,
                          { backgroundColor: colors.surfaceSecondary },
                          !useLarge && styles.lastTrickCardCompact,
                          isWinner && styles.winnerCard,
                        ]}>
                          <PlayingCard
                            suit={played.card.suit}
                            rank={played.card.rank}
                            size={useLarge ? 'small' : 'tiny'}
                          />
                          <Text style={[styles.lastTrickPlayerName, { color: colors.textSecondary }]} numberOfLines={1}>
                            {player?.name || '?'}
                            {isWinner && ' 👑'}
                          </Text>
                        </View>
                      );
                    })}
                  </ScrollView>

                  {/* Winner info */}
                  <Text style={styles.lastTrickWinner}>
                    {(() => {
                      const winner = players.find(p => p.id === lastTrick.winnerId);
                      return winner ? `${winner.name} ${t('game.wonTrick')}` : '';
                    })()}
                  </Text>
                </>
              );
            })()}

            <Pressable
              style={styles.modalButton}
              onPress={() => setShowLastTrick(false)}
              testID="last-trick-close"
            >
              <Text style={styles.modalButtonText}>{t('common.close')}</Text>
            </Pressable>
          </GlassCard>
        </View>
      </Modal>
      {/* Settings Modal */}
      <Modal
        visible={showSettingsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSettingsModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowSettingsModal(false)}>
          <Pressable onPress={() => {}} style={[styles.settingsPanel, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
            <Text style={[styles.settingsPanelTitle, { color: colors.textPrimary }]}>{t('settings.title')}</Text>

            {/* Profile section (logged-in users only) */}
            {!isGuest && (
              <View style={styles.settingsSection}>
                <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>{t('profile.title')}</Text>
                <Text style={[styles.settingsValue, { color: colors.textPrimary }]}>
                  {authDisplayName}
                </Text>
              </View>
            )}

            {/* Language */}
            <View style={styles.settingsSection}>
              <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>{t('settings.language')}</Text>
              <LanguageSwitcher />
            </View>

            {/* Theme */}
            <View style={styles.settingsSection}>
              <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>{t('settings.theme')}</Text>
              <View style={[styles.settingsPills, { borderColor: colors.glassLight }]}>
                {(['system', 'light', 'dark'] as ThemePreference[]).map((opt) => {
                  const themeLabels: Record<string, string> = { system: t('settings.system'), light: t('settings.light'), dark: t('settings.dark') };
                  const isActive = themePreference === opt;
                  return (
                    <Pressable
                      key={opt}
                      style={[styles.settingsPill, isActive && { backgroundColor: colors.accent }]}
                      onPress={() => setThemePreference(opt)}
                    >
                      <Text style={[styles.settingsPillText, { color: colors.textSecondary }, isActive && { color: '#fff', fontWeight: '700' }]}>
                        {themeLabels[opt]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Deck Colors */}
            <View style={styles.settingsSection}>
              <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>{t('settings.deckStyle')}</Text>
              <View style={[styles.settingsPills, { borderColor: colors.glassLight }]}>
                {[false, true].map((fc) => {
                  const isActive = fourColorDeck === fc;
                  return (
                    <Pressable
                      key={String(fc)}
                      style={[styles.settingsPill, isActive && { backgroundColor: colors.accent }]}
                      onPress={() => setFourColorDeck(fc)}
                    >
                      <Text style={[styles.settingsPillText, { color: colors.textSecondary }, isActive && { color: '#fff', fontWeight: '700' }]}>
                        {fc ? t('settings.fourColor') : t('settings.classic')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Pressable style={[styles.modalButton, { marginTop: Spacing.md }]} onPress={() => setShowSettingsModal(false)}>
              <Text style={styles.modalButtonText}>{t('common.close')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  topBar: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.glassLight,
    backgroundColor: '#ffffff',
    paddingHorizontal: Spacing.xs,
    paddingTop: 2,
    paddingBottom: 3,
  },
  topBarRow1: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  topBarBack: {
    width: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  topBarLogoWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarRow2: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
    paddingBottom: 2,
  },
  trumpBadgeGame: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  trumpBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  topBarRow3: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  iconBtnEmoji: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  chatBadgeDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.error,
  },
  backButton: {
    ...TextStyles.h3,
    color: Colors.accent,
    fontSize: 18,
    paddingHorizontal: Spacing.xs,
  },
  handInfo: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700' as const,
  },

  // Game Area - Circular table layout
  gameArea: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Card Table - oval green felt table (legacy-style)
  cardTable: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: '-50%' }, { translateY: '-50%' }],
    width: '92%',
    height: '82%',
    zIndex: 1,
  },
  tableEdge: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 200,
    borderWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  tableFelt: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderRadius: 194,
    overflow: 'hidden',
  },
  tableCenterDecor: {
    // kept for TS compatibility but not rendered
    display: 'none',
  },
  // Compact row of 4 suit symbols at the top of the felt
  suitRow: {
    position: 'absolute',
    top: '22%',
    left: '30%',
    right: '30%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tableSuitSymbol: {
    fontSize: 18,
  },
  tableInfoArea: {
    position: 'absolute',
    top: '32%',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 4,
    zIndex: 10,
  },
  yourTurnBadge: {
    backgroundColor: 'rgba(230, 191, 51, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  yourTurnText: {
    color: '#1a1a1a',
    fontSize: 12,
    fontWeight: '700',
  },
  mustFollowText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '500',
  },

  // My avatar at bottom edge of table
  youLabelAtTable: {
    position: 'absolute',
    bottom: '6%',
    left: '50%',
    transform: [{ translateX: '-50%' }],
    alignItems: 'center',
    zIndex: 20,
  },
  myTableAvatar: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
    width: SCREEN_WIDTH > 600 ? 40 : 32,
    height: SCREEN_WIDTH > 600 ? 40 : 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },
  myTableAvatarInitial: {
    color: '#ffffff',
    fontSize: SCREEN_WIDTH > 600 ? 18 : 14,
    fontWeight: '700' as const,
  },

  // Turn order indicator - bottom-right corner
  turnOrderIndicator: {
    position: 'absolute',
    bottom: Spacing.sm,
    right: Spacing.sm,
    opacity: 0.55,
    zIndex: 2,
    alignItems: 'center',
  },
  turnOrderText: {
    fontSize: 18,
    color: Colors.textMuted,
  },
  turnOrderLabel: {
    ...TextStyles.small,
    color: Colors.textMuted,
    fontSize: 8,
    textAlign: 'center',
  },

  // Opponent containers - positioned absolutely around the table
  opponentContainer: {
    position: 'absolute',
    zIndex: 20,
    alignItems: 'center',
  },
  // Figma-style profile card — dark semi-transparent, fixed size
  profileCard: {
    width: 110,
    height: 90,
    borderRadius: Radius.lg,
    backgroundColor: 'rgba(8, 10, 14, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
    overflow: 'visible',
  },
  profileAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  profileAvatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  profileName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
    textAlign: 'center',
    maxWidth: 104,
  },
  profileStats: {
    fontSize: 10,
    color: '#C0C0C7',
    textAlign: 'center',
  },
  firstPlayerBadge: {
    position: 'absolute',
    top: 3,
    left: 3,
    fontSize: 12,
    color: '#308552',
  },
  profileCheckBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#308552',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCheckText: {
    fontSize: 8,
    color: '#ffffff',
    fontWeight: '700',
  },
  positionBadge: {
    backgroundColor: Colors.highlight,
    width: 20,
    height: 20,
    borderRadius: Radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
    borderWidth: 2,
    borderColor: Colors.textPrimary,
  },
  positionBadgeText: {
    ...TextStyles.caption,
    color: Colors.textPrimary,
    fontWeight: 'bold',
    fontSize: 10,
  },
  opponentCard: {
    padding: SCREEN_WIDTH > 600 ? Spacing.sm : Spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: SCREEN_WIDTH > 600 ? 80 : 60,
    backgroundColor: '#ffffff',
  },

  // Avatar styles (shared)
  avatar: {
    width: SCREEN_WIDTH > 600 ? 40 : 28,
    height: SCREEN_WIDTH > 600 ? 40 : 28,
    borderRadius: Radius.full,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.glassLight,
    marginBottom: 2,
  },
  activeAvatar: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  avatarInitial: {
    ...TextStyles.body,
    color: Colors.textPrimary,
    fontSize: SCREEN_WIDTH > 600 ? 16 : 12,
    fontWeight: '600' as const,
  },

  // Opponent specific styles
  opponentName: {
    ...TextStyles.small,
    color: Colors.textPrimary,
    fontSize: SCREEN_WIDTH > 600 ? 12 : 9,
    textAlign: 'center',
    marginBottom: 2,
  },
  opponentStats: {
    alignItems: 'center',
    gap: 0,
  },
  opponentStat: {
    ...TextStyles.small,
    color: Colors.textSecondary,
    fontSize: SCREEN_WIDTH > 600 ? 11 : 8,
  },
  statValue: {
    color: Colors.accent,
    fontWeight: '600' as const,
  },

  // Active player highlight
  activePlayer: {
    shadowColor: '#E6BF33',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 6,
  },

  // Turn and played indicators
  playStatus: {
    marginTop: 2,
    minHeight: 16,
  },
  turnIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  turnDot: {
    color: Colors.accent,
    fontSize: 10,
  },
  turnText: {
    ...TextStyles.small,
    color: Colors.accent,
    fontWeight: '600' as const,
    fontSize: 9,
  },
  playedBadge: {
    width: 18,
    height: 18,
    borderRadius: Radius.full,
    backgroundColor: Colors.success,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playedText: {
    fontSize: 12,
    color: '#ffffff',
    fontWeight: 'bold' as const,
  },

  // Trick Area - Centered on the table
  playArea: {
    position: 'absolute',
    top: '58%',
    left: '50%',
    transform: [{ translateX: '-50%' }, { translateY: '-50%' }],
    alignItems: 'center',
    justifyContent: 'center',
    width: '65%',
    zIndex: 5,
  },
  // Radial trick pile — cards are absolutely positioned inside this box
  trickPile: {
    width: 112,   // 60px card + 26px max offset × 2
    height: 170,  // 84px card + 39px (3×13) max offset × 2 (for 6-player equal spacing)
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trickCardAbsolute: {
    position: 'absolute',
  },
  waitingText: {
    ...TextStyles.body,
    color: 'rgba(255,255,255,0.8)',
    fontStyle: 'italic' as const,
    fontSize: 13,
    textAlign: 'center',
  },

  // Your Hand - Fixed at bottom with YOU badge
  handSection: {
    borderTopWidth: 2,
    borderTopColor: Colors.accent,
    paddingHorizontal: Spacing.xs,
    paddingTop: Spacing.xs,
    paddingBottom: 80,
    backgroundColor: '#ffffff',
    maxHeight: SCREEN_HEIGHT * 0.42,
  },
  youBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xs,
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.glassLight,
  },
  myHandAvatar: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
    width: 28,
    height: 28,
    marginRight: Spacing.sm,
  },
  myHandAvatarInitial: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700' as const,
  },
  youStats: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  youStat: {
    ...TextStyles.caption,
    color: Colors.textSecondary,
    fontSize: 9,
  },

  // Action Bar - Fixed height
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: Colors.glassLight,
    height: SCREEN_HEIGHT * 0.05,
  },
  actionButton: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    borderRadius: Radius.sm,
  },
  actionLabel: {
    ...TextStyles.caption,
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  actionLabelDisabled: {
    color: Colors.textMuted,
    opacity: 0.5,
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  lastTrickModal: {
    width: '100%',
    maxWidth: 360,
    padding: Spacing.lg,
    maxHeight: SCREEN_HEIGHT * 0.75,
    overflow: 'visible',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  modalTitle: {
    ...TextStyles.h3,
    color: Colors.textPrimary,
  },
  modalClose: {
    ...TextStyles.h2,
    color: Colors.textSecondary,
    paddingHorizontal: Spacing.sm,
  },
  lastTrickScroll: {
    maxHeight: SCREEN_HEIGHT * 0.45,
  },
  lastTrickContent: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  // 2-column grid layout for 5-6 players
  lastTrickContentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  lastTrickCard: {
    alignItems: 'center',
    gap: Spacing.xs,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
  },
  lastTrickCardCompact: {
    padding: Spacing.xs,
    width: '45%',
    margin: '2%',
  },
  winnerCard: {
    backgroundColor: 'rgba(48, 133, 82, 0.1)',
    borderWidth: 2,
    borderColor: Colors.success,
  },
  lastTrickPlayerName: {
    ...TextStyles.caption,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  winnerBadge: {
    color: Colors.success,
    fontWeight: 'bold' as const,
  },
  lastTrickWinner: {
    ...TextStyles.body,
    color: Colors.accent,
    textAlign: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  modalButton: {
    backgroundColor: Colors.accent,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.md,
    alignSelf: 'center',
  },
  modalButtonText: {
    ...TextStyles.body,
    color: '#ffffff',
    fontWeight: '600' as const,
  },
  settingsPanel: {
    width: '100%',
    maxWidth: 340,
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.lg,
  },
  settingsPanelTitle: {
    ...TextStyles.h3,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  settingsSection: {
    marginBottom: Spacing.md,
  },
  settingsSectionTitle: {
    ...TextStyles.caption,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  settingsValue: {
    ...TextStyles.body,
    fontWeight: '600',
  },
  settingsPills: {
    flexDirection: 'row',
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.glassLight,
    padding: 3,
  },
  settingsPill: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: Radius.lg,
    alignItems: 'center',
  },
  settingsPillText: {
    ...TextStyles.small,
    fontWeight: '500',
  },
  betBannerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  betBannerModal: {
    width: '78%',
    borderRadius: Radius.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
  },
  betBannerFight: {
    backgroundColor: '#fff0f0',
  },
  betBannerGive: {
    backgroundColor: '#f0f5ff',
  },
  betBannerCloseBtn: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    padding: Spacing.xs,
  },
  betBannerCloseText: {
    ...TextStyles.body,
    color: Colors.textMuted,
    fontSize: 18,
  },
  betBannerText: {
    ...TextStyles.h1,
    fontWeight: '800' as const,
    color: Colors.textPrimary,
    letterSpacing: 1.5,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  betBannerGotItBtn: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.accent,
  },
  betBannerGotItText: {
    ...TextStyles.body,
    fontWeight: '600' as const,
    color: '#ffffff',
  },
});

export default GameTableScreen;
