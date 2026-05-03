/**
 * Nägels Online - Game Table Screen
 *
 * Multiplayer mode: server-authoritative state via useRoomStore + gameClient.
 * Single-player mode: legacy useGameStore engine (bots, no network).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
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
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { Colors, Spacing, Radius, TextStyles, SuitSymbols } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { useGameStore } from '../store';
import { useRoomStore } from '../store/roomStore';
import { useTurnTimeout } from '../lib/turnTimeout';
import { useHeartbeat } from '../lib/heartbeat';
import { useReconnectOnFocus } from '../lib/reconnectOnFocus';
import { OnboardingTip } from '../components/OnboardingTip';
import { gameClient } from '../lib/gameClient';
import { subscribeRoom, unsubscribeRoom } from '../lib/realtimeBroadcast';
import { useSettingsStore, type ThemePreference } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';
import { useTranslation } from 'react-i18next';
import {
  isCardPlayable,
  getPlayableCards as engineGetPlayableCards,
} from '../../supabase/functions/_shared/engine/rules';
import type { PlayerScore } from './ScoreboardModal';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

export interface GameTableScreenProps {
  onExit?: () => void;
  playerName?: string;
  isMultiplayer?: boolean;
  botDifficulty?: 'easy' | 'medium' | 'hard';
  botCount?: number;
}

const BOT_NAMES_BY_LANG: Record<string, string[]> = {
  ru: ['Перебор', 'Нулёвый', 'Козырной', 'Авось', 'Хитрец'],
  en: ['Overkill', 'Nil', 'Trumpster', 'Longshot', 'Trickster'],
  es: ['Farol', 'Cero', 'Triunfo', 'Temerario', 'Artero'],
};

// Convert "spades-9" → { id, suit, rank } for components that expect Card-like objects.
function parseCard(s: string): { id: string; suit: any; rank: any } {
  const [suit, rankStr] = s.split('-');
  const rank: string | number = /^\d+$/.test(rankStr) ? parseInt(rankStr, 10) : rankStr;
  return { id: s, suit, rank };
}

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

  // Settings & auth for in-game settings panel
  const themePreference = useSettingsStore((s) => s.themePreference);
  const setThemePreference = useSettingsStore((s) => s.setThemePreference);
  const fourColorDeck = useSettingsStore((s) => s.fourColorDeck);
  const setFourColorDeck = useSettingsStore((s) => s.setFourColorDeck);
  const isGuest = useAuthStore((s) => s.isGuest);
  const authDisplayName = useAuthStore((s) => s.displayName);

  // ── Multiplayer state ──────────────────────────────────────
  const snapshot = useRoomStore((s) => s.snapshot);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);

  // Turn timeout watcher — any client posts request_timeout after 30s
  // of no progress; the Edge Function idempotently auto-advances.
  useTurnTimeout();

  // Mark this player online (last_seen_at = now()) every 10s. Other clients
  // read room_players.is_connected via the snapshot to detect drop-offs.
  useHeartbeat();

  // Force a fresh snapshot when the tab returns to foreground / online.
  useReconnectOnFocus();

  const room = snapshot?.room ?? null;
  const mpPlayers = snapshot?.players ?? [];
  const hand = snapshot?.current_hand ?? null;
  const handScores = snapshot?.hand_scores ?? [];
  const currentTrick = snapshot?.current_trick ?? null;
  const lastClosedTrick = snapshot?.last_closed_trick ?? null;
  const myHandStrings = snapshot?.my_hand ?? [];

  // After the 4th card lands, the server immediately opens a fresh empty
  // trick — the closed one disappears from `current_trick` instantly. Hold
  // the just-completed trick on the table for ~1.5 s so players can see
  // the final card and who took the trick.
  const TRICK_HOLD_MS = 1500;
  const [trickHoldUntil, setTrickHoldUntil] = useState<number>(0);
  const lastClosedIdRef = useRef<string | null>(null);
  useEffect(() => {
    const closedId = lastClosedTrick?.id ?? null;
    if (!closedId || closedId === lastClosedIdRef.current) return;
    lastClosedIdRef.current = closedId;
    setTrickHoldUntil(Date.now() + TRICK_HOLD_MS);
    const t = setTimeout(() => setTrickHoldUntil(0), TRICK_HOLD_MS);
    return () => clearTimeout(t);
  }, [lastClosedTrick?.id]);
  const holdTrickActive =
    trickHoldUntil > Date.now() &&
    !!lastClosedTrick &&
    (currentTrick?.cards?.length ?? 0) === 0;

  // ── Single-player state (legacy engine for bots) ───────────
  const sp = useGameStore();

  // Subscribe / unsubscribe to the room channel for the lifetime of GameTable.
  useEffect(() => {
    if (!isMultiplayer) return;
    const roomId = room?.id;
    if (!roomId) return;
    subscribeRoom(roomId);
    return () => {
      unsubscribeRoom();
    };
  }, [isMultiplayer, room?.id]);

  // Pull-to-refresh
  const [isRefreshing, setIsRefreshing] = useState(false);
  const handlePullRefresh = useCallback(async () => {
    if (!isMultiplayer || !room?.id) return;
    setIsRefreshing(true);
    try {
      await gameClient.refreshSnapshot(room.id);
    } finally {
      setIsRefreshing(false);
    }
  }, [isMultiplayer, room?.id]);

  // ── Single-player init (unchanged behavior) ────────────────
  useEffect(() => {
    if (isMultiplayer) return;
    if (sp.players.length > 0) return;
    const totalPlayers = botCount + 1;
    const gamePlayers = Array.from({ length: totalPlayers }, (_, i) => ({
      id: `player-${i}`,
      name: i === 0 ? playerName : botNames[i - 1],
      isBot: i !== 0,
    }));
    sp.setBotDifficulty(botDifficulty);
    sp.initGame(gamePlayers, 'player-0');
    setTimeout(() => sp.startBetting(), 500);
    return () => {
      sp.reset();
    };
  }, [isMultiplayer]);

  // Single-player: start betting when game is ready
  useEffect(() => {
    if (isMultiplayer) return;
    if (sp.phase === 'lobby' && sp.players.length > 0 && sp.handNumber === 1) {
      setTimeout(() => sp.startBetting(), 500);
    }
  }, [isMultiplayer, sp.phase, sp.players.length, sp.handNumber]);

  // Single-player: start betting for hands 2+
  useEffect(() => {
    if (isMultiplayer) return;
    if (sp.phase === 'lobby' && sp.handNumber > 1 && sp.players.length > 0) {
      const timer = setTimeout(() => sp.startBetting(), 300);
      return () => clearTimeout(timer);
    }
  }, [isMultiplayer, sp.phase, sp.handNumber]);

  // Single-player: auto-start playing when all bets are placed
  useEffect(() => {
    if (isMultiplayer) return;
    const allBetsPlaced = sp.players.every((p) => p.bet !== null);
    if (sp.phase === 'betting' && allBetsPlaced) {
      setTimeout(() => sp.startPlaying(), 1000);
    }
  }, [isMultiplayer, sp.players, sp.phase]);

  // Single-player: bot betting
  useEffect(() => {
    if (isMultiplayer) return;
    if (sp.phase === 'betting' && sp.isBotTurn()) {
      const timer = setTimeout(() => sp.placeBotBet(), 1000 + Math.random() * 500);
      return () => clearTimeout(timer);
    }
  }, [isMultiplayer, sp.phase, sp.bettingPlayerIndex]);

  // Single-player: bot card play
  useEffect(() => {
    if (isMultiplayer) return;
    const botTurn = sp.isBotTurn();
    const currentPlayer = sp.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.hand.length === 0) return;
    const trickCompleting = sp.currentTrick && sp.currentTrick.cards.length >= sp.playerCount;
    if (sp.phase === 'playing' && botTurn && !trickCompleting) {
      const timer = setTimeout(() => sp.playBotCard(), 800 + Math.random() * 400);
      return () => clearTimeout(timer);
    }
  }, [isMultiplayer, sp.phase, sp.currentTrick, sp.currentPlayerIndex]);

  // ── Unified view-model ─────────────────────────────────────
  type VMPlayer = {
    id: string;
    name: string;
    seatIndex: number;
    isBot: boolean;
    bet: number | null;
    tricksWon: number;
    score: number;
    bonus: number;
    hand: Array<{ id: string; suit: any; rank: any }>;
    /** ms since the player's last heartbeat. null in single-player mode. */
    msSinceSeen: number | null;
    /** Avatar emoji chosen by the player; null/undefined → use initial. */
    avatar?: string | null;
    /** Avatar background color hex; null/undefined → seat-based default. */
    avatarColor?: string | null;
  };

  const vm = useMemo(() => {
    if (isMultiplayer) {
      const players: VMPlayer[] = mpPlayers.map((p) => {
        const score = handScores.find((s) => s.session_id === p.session_id);
        // Aggregated history-derived totals
        const history = snapshot?.score_history ?? [];
        let total = 0;
        for (const h of history) {
          const row = h.scores?.find((s) => s.session_id === p.session_id);
          if (row) total += row.hand_score;
        }
        const seenTs = p.last_seen_at ? Date.parse(p.last_seen_at) : NaN;
        const msSinceSeen = Number.isNaN(seenTs) ? Infinity : Date.now() - seenTs;
        return {
          id: p.session_id,
          name: p.display_name,
          seatIndex: p.seat_index,
          isBot: false,
          bet: score?.bet ?? null,
          tricksWon: score?.taken_tricks ?? 0,
          score: total,
          bonus: 0,
          hand: p.session_id === myPlayerId ? myHandStrings.map(parseCard) : [],
          msSinceSeen,
          avatar: (p as any).avatar ?? null,
          avatarColor: (p as any).avatar_color ?? null,
        };
      });
      players.sort((a, b) => a.seatIndex - b.seatIndex);

      const phase: 'lobby' | 'betting' | 'playing' | 'scoring' | 'finished' = (() => {
        if (!hand) return 'lobby';
        if (room?.phase === 'finished') return 'finished';
        if (hand.phase === 'closed' || hand.phase === 'scoring') return 'scoring';
        if (hand.phase === 'playing') return 'playing';
        return 'betting';
      })();

      const currentPlayer = hand
        ? players.find((p) => p.seatIndex === hand.current_seat) ?? null
        : null;
      const myPlayer = players.find((p) => p.id === myPlayerId) ?? null;

      const totalHands = (room?.max_cards ?? 10) * 2;
      const handNumber = hand?.hand_number ?? 1;
      const cardsPerPlayer = hand?.cards_per_player ?? 0;
      const trumpSuit = (hand?.trump_suit ?? 'diamonds') as any;

      const RANK_ORDER: Record<string, number> = { '2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8, J: 9, Q: 10, K: 11, A: 12 };
      const SUIT_ORDER: Record<string, number> = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
      const sortMyHand = (cards: Array<{ id: string; suit: string; rank: string }>) => {
        const tw = (s: string) => (s === trumpSuit ? -1 : SUIT_ORDER[s] ?? 9);
        return [...cards].sort((a, b) => {
          const ds = tw(a.suit) - tw(b.suit);
          if (ds !== 0) return ds;
          return (RANK_ORDER[b.rank] ?? 0) - (RANK_ORDER[a.rank] ?? 0);
        });
      };
      for (const p of players) {
        if (p.id === myPlayerId) p.hand = sortMyHand(p.hand);
      }

      // Trick translation: server uses {seat, card} → ui needs {playerId, card}
      const trickCards = (currentTrick?.cards ?? []).map((c) => {
        const seatPlayer = players.find((p) => p.seatIndex === c.seat);
        return {
          playerId: seatPlayer?.id ?? '',
          card: parseCard(c.card),
        };
      });
      const trickWinnerId =
        currentTrick?.winner_seat != null
          ? players.find((p) => p.seatIndex === currentTrick.winner_seat)?.id ?? ''
          : '';
      // Cosmetic-only: while `holdTrickActive`, render the just-closed trick
      // on the table for ~1.5 s so players see the final card. Logic/playable
      // checks always use the real currentTrick above.
      const displayTrickCards = holdTrickActive && lastClosedTrick
        ? lastClosedTrick.cards.map((c) => {
            const seatPlayer = players.find((p) => p.seatIndex === c.seat);
            return { playerId: seatPlayer?.id ?? '', card: parseCard(c.card) };
          })
        : trickCards;
      const displayTrickWinnerId = holdTrickActive && lastClosedTrick && lastClosedTrick.winner_seat != null
        ? players.find((p) => p.seatIndex === lastClosedTrick.winner_seat)?.id ?? ''
        : trickWinnerId;

      // Last closed trick (for the "previous trick" modal). Server snapshot
      // only carries one closed trick at a time — enough for the UI button.
      const lastTricks = lastClosedTrick
        ? [
            {
              cards: lastClosedTrick.cards.map((c) => {
                const seatPlayer = players.find((p) => p.seatIndex === c.seat);
                return {
                  playerId: seatPlayer?.id ?? '',
                  card: parseCard(c.card),
                };
              }),
              winnerId:
                lastClosedTrick.winner_seat != null
                  ? players.find((p) => p.seatIndex === lastClosedTrick.winner_seat)?.id ?? ''
                  : '',
            },
          ]
        : [];

      const startingSeat = hand?.starting_seat ?? 0;

      return {
        phase,
        handNumber,
        totalHands,
        cardsPerPlayer,
        trumpSuit,
        playerCount: players.length,
        startingPlayerIndex: startingSeat,
        currentPlayer,
        myPlayer,
        players,
        currentTrick: trickCards.length || trickWinnerId
          ? { cards: trickCards, winnerId: trickWinnerId, leadSuit: (trickCards[0]?.card.suit as any) ?? 'diamonds' }
          : null,
        // Cosmetic-only display trick: lingers the just-closed trick on the
        // table for the hold window. Falls back to currentTrick.
        displayTrick: displayTrickCards.length || displayTrickWinnerId
          ? { cards: displayTrickCards, winnerId: displayTrickWinnerId, leadSuit: (displayTrickCards[0]?.card.suit as any) ?? 'diamonds' }
          : null,
        // Snapshot carries only the most recent closed trick — enough for the
        // "previous trick" modal. Empty when no trick has closed yet this hand.
        tricks: lastTricks,
      };
    }

    // Single-player: map sp store into the same shape
    const players: VMPlayer[] = sp.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      seatIndex: i,
      isBot: !!p.isBot,
      bet: p.bet,
      tricksWon: p.tricksWon,
      score: p.score,
      bonus: p.bonus,
      hand: p.hand,
      msSinceSeen: null,
    }));
    return {
      phase: sp.phase,
      handNumber: sp.handNumber,
      totalHands: sp.totalHands,
      cardsPerPlayer: sp.cardsPerPlayer,
      trumpSuit: sp.trumpSuit,
      playerCount: sp.playerCount,
      startingPlayerIndex: sp.startingPlayerIndex,
      currentPlayer: sp.getCurrentPlayer()
        ? players.find((p) => p.id === sp.getCurrentPlayer()!.id) ?? null
        : null,
      myPlayer: sp.getMyPlayer() ? players.find((p) => p.id === sp.getMyPlayer()!.id) ?? null : null,
      players,
      currentTrick: sp.currentTrick
        ? {
            cards: sp.currentTrick.cards,
            winnerId: sp.currentTrick.winnerId,
            leadSuit: sp.currentTrick.leadSuit,
          }
        : null,
      // Single-player has no inter-trick gap, so display = current.
      displayTrick: sp.currentTrick
        ? {
            cards: sp.currentTrick.cards,
            winnerId: sp.currentTrick.winnerId,
            leadSuit: sp.currentTrick.leadSuit,
          }
        : null,
      tricks: sp.tricks,
    };
  }, [isMultiplayer, snapshot, room, mpPlayers, hand, handScores, currentTrick, lastClosedTrick, holdTrickActive, myHandStrings, myPlayerId, sp]);

  // ── UI state ───────────────────────────────────────────────
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [isViewingScores, setIsViewingScores] = useState(false);
  const [showLastTrick, setShowLastTrick] = useState(false);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showBetBanner, setShowBetBanner] = useState(false);

  const totalBets = vm.players.reduce((sum, p) => sum + (p.bet ?? 0), 0);
  const tricksDiff = totalBets - vm.cardsPerPlayer;
  const hasAllBets =
    vm.players.length > 0 && vm.players.every((p) => p.bet !== null);

  useEffect(() => {
    if (hasAllBets && vm.phase === 'betting') {
      setShowBetBanner(true);
      const t = setTimeout(() => setShowBetBanner(false), 3000);
      return () => clearTimeout(t);
    } else if (vm.phase === 'playing') {
      setShowBetBanner(false);
    }
  }, [hasAllBets, vm.phase]);

  useEffect(() => {
    if (vm.phase === 'scoring' || vm.phase === 'finished') {
      setShowScoreboard(true);
      setIsViewingScores(false);
    }
  }, [vm.phase]);

  // Compute playable cards
  const playableCards = useMemo(() => {
    if (!vm.myPlayer || vm.phase !== 'playing') return [];
    if (vm.myPlayer.hand.length === 0) return [];

    if (isMultiplayer) {
      const leadCard = vm.currentTrick?.cards[0]?.card ?? null;
      try {
        const cards = engineGetPlayableCards(vm.myPlayer.hand as any, {
          leadCard: leadCard as any,
          trumpSuit: vm.trumpSuit,
          playedCards: (vm.currentTrick?.cards as any) ?? [],
        });
        return cards;
      } catch {
        return vm.myPlayer.hand;
      }
    }
    return sp.getPlayableCards(vm.myPlayer.id);
  }, [isMultiplayer, vm.myPlayer, vm.phase, vm.currentTrick, vm.trumpSuit, sp]);

  const isMyTurnPlaying =
    vm.phase === 'playing' && vm.currentPlayer?.id === vm.myPlayer?.id;

  // Card press handler: two-tap confirmation
  const handleCardPress = useCallback(
    (cardId: string) => {
      const myPlayer = vm.myPlayer;
      if (!myPlayer || vm.phase !== 'playing') return;
      if (vm.currentPlayer?.id !== myPlayer.id) return;
      if (vm.currentTrick?.winnerId) return; // trick already complete

      const card = myPlayer.hand.find((c) => c.id === cardId);
      if (!card) return;

      // Validate playability
      const leadCard = vm.currentTrick?.cards[0]?.card ?? null;
      const playable = isCardPlayable(card as any, {
        handCards: myPlayer.hand as any,
        leadCard: leadCard as any,
        trumpSuit: vm.trumpSuit as any,
        playedCards: (vm.currentTrick?.cards as any) ?? [],
      });
      if (!playable.playable) {
        setSelectedCard(null);
        return;
      }

      if (selectedCard === cardId) {
        // Confirm play
        setSelectedCard(null);
        if (isMultiplayer) {
          if (room?.id && hand?.id) {
            gameClient
              .playCard(room.id, hand.id, cardId)
              .catch((err) => console.error('[GameTable] playCard failed:', err));
          }
        } else {
          sp.playCard(myPlayer.id, card as any);
        }
      } else {
        setSelectedCard(cardId);
      }
    },
    [vm, selectedCard, isMultiplayer, room?.id, hand?.id, sp]
  );

  // Continue from scoreboard
  const handleScoreboardContinue = () => {
    const wasViewingScores = isViewingScores;
    setShowScoreboard(false);
    setIsViewingScores(false);

    if (wasViewingScores) return;

    if (isMultiplayer) {
      if (room?.id && hand?.id) {
        gameClient
          .continueHand(room.id, hand.id)
          .catch((err) => console.error('[GameTable] continueHand failed:', err));
      }
    } else if (sp.handNumber >= sp.totalHands) {
      sp.endGame();
    } else {
      sp.nextHand();
    }
  };

  const handleScoreboardClose = () => {
    setShowScoreboard(false);
    setIsViewingScores(false);
  };

  // Trump display helpers
  const getTrumpSymbol = (trump: string): string => {
    if (trump === 'notrump') return 'NT';
    return SuitSymbols[trump as keyof typeof SuitSymbols] || trump;
  };
  const getTrumpColor = (trump: string): string => {
    if (trump === 'notrump') return Colors.textMuted;
    return (Colors[trump as keyof typeof Colors] as string) || Colors.textSecondary;
  };

  // Player positioning around the table
  const getPlayerPosition = (playerIndex: number, totalPlayers: number) => {
    const myIndex = vm.players.findIndex((p) => p.id === vm.myPlayer?.id);
    if (myIndex === -1) return playerIndex;
    return (playerIndex - myIndex + totalPlayers) % totalPlayers;
  };

  const opponents = vm.players.filter((p) => p.id !== vm.myPlayer?.id);

  const getOpponentClockPosition = (relativeIndex: number, totalPlayers: number) => {
    const clockPositions: Record<number, number[]> = {
      2: [0],
      3: [2, 10],
      4: [3, 0, 9],
      5: [3, 1, 11, 9],
      6: [4, 2, 0, 10, 8],
    };
    const positions = clockPositions[totalPlayers as keyof typeof clockPositions] || [0];
    return positions[relativeIndex - 1] || 0;
  };

  const PROFILE_W = 110;
  const PROFILE_H = 90;
  const clockToScreen = (clockPosition: number) => {
    const angle = (clockPosition * 30 - 90) * (Math.PI / 180);
    const radius = 38;
    let top = 50 + radius * Math.sin(angle);
    let left = 50 + radius * Math.cos(angle);
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

  const getPlayerCardOffset = (playerId: string): { dx: number; dy: number } => {
    const RADIUS = 40;
    const playerIdx = vm.players.findIndex((p) => p.id === playerId);
    const myIndex = vm.players.findIndex((p) => p.id === vm.myPlayer?.id);
    if (playerIdx === -1 || myIndex === -1) return { dx: 0, dy: 0 };
    const relativeIndex = (playerIdx - myIndex + vm.playerCount) % vm.playerCount;
    const clockPositions: Record<number, number[]> = {
      2: [0],
      3: [2, 10],
      4: [3, 0, 9],
      5: [3, 1, 11, 9],
      6: [4, 2, 0, 10, 8],
    };
    let clockPos: number;
    if (relativeIndex === 0) {
      clockPos = 6;
    } else {
      const positions = clockPositions[vm.playerCount as keyof typeof clockPositions] || [0];
      clockPos = positions[relativeIndex - 1] ?? 0;
    }
    const angleRad = (clockPos * 30 - 90) * (Math.PI / 180);
    const dx = Math.round(Math.cos(angleRad) * RADIUS);
    let dy: number;
    if (vm.playerCount === 6) {
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
    return vm.players
      .map((p, i) => {
        const lastHandBonus = p.bet !== null && p.tricksWon === p.bet ? 10 : 0;
        const lastHandPoints = p.tricksWon + lastHandBonus;
        const isDuplicate = vm.players.filter((other) => other.name === p.name).length > 1;
        const displayName = isDuplicate ? `${p.name} #${i + 1}` : p.name;
        return {
          id: p.id,
          name: displayName,
          rank: i + 1,
          totalScore: p.score + p.bonus,
          lastBet: p.bet || 0,
          lastTricks: p.tricksWon,
          lastBonus: lastHandBonus,
          lastPoints: lastHandPoints,
          madeBet: p.bet !== null && p.tricksWon === p.bet,
          avatar: p.avatar ?? null,
          avatarColor: p.avatarColor ?? null,
        };
      })
      .sort((a, b) => b.totalScore - a.totalScore)
      .map((p, i) => ({ ...p, rank: i + 1 }));
  }, [vm.players]);

  const getTurnLabel = (): string => {
    if (!vm.currentPlayer) return t('game.waiting');
    if (vm.currentPlayer.id === vm.myPlayer?.id) return t('game.yourTurn');
    return t('game.playerTurn', { name: vm.currentPlayer.name });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      {/* First-time onboarding tips. The component itself self-gates on
          settingsStore.shownTips so once dismissed it never shows again. */}
      {vm.trumpSuit === 'notrump' ? (
        <OnboardingTip
          name="noTrump"
          titleKey="onboarding.noTrumpTitle"
          bodyKey="onboarding.noTrumpBody"
        />
      ) : (
        <OnboardingTip
          name="trumpRank"
          titleKey="onboarding.trumpRankTitle"
          bodyKey="onboarding.trumpRankBody"
          delayMs={800}
        />
      )}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        scrollEnabled={false}
        refreshControl={
          isMultiplayer ? <RefreshControl refreshing={isRefreshing} onRefresh={handlePullRefresh} /> : undefined
        }
      >
        {/* Top Bar */}
        <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.glassLight }]}>
          <View style={styles.topBarRow1}>
            <GameLogo size="xs" />
          </View>
          <View style={styles.topBarRow2}>
            <Text style={[styles.handInfo, { color: colors.textPrimary }]}>
              {t('game.hand')} {vm.handNumber}/{vm.totalHands}
            </Text>
            <View
              style={[
                styles.trumpBadgeGame,
                {
                  backgroundColor: isDark ? 'rgba(19,66,143,0.2)' : 'rgba(19,66,143,0.08)',
                  borderColor: colors.accent,
                },
              ]}
            >
              <Text style={[styles.trumpBadgeText, { color: getTrumpColor(vm.trumpSuit) }]}>
                {vm.trumpSuit === 'notrump'
                  ? t('game.noTrump')
                  : `${getTrumpSymbol(vm.trumpSuit)} ${t('game.trump')}`}
              </Text>
            </View>
          </View>
          <View style={styles.topBarRow3}>
            <Pressable
              onPress={onExit}
              style={[styles.iconBtn, { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight }]}
              testID="game-btn-exit"
            >
              <Text style={[styles.iconBtnText, { color: colors.iconButtonText }]}>←</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowSettingsModal(true)}
              style={[styles.iconBtn, { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight }]}
              testID="game-btn-settings"
            >
              <Text style={styles.iconBtnEmoji}>⚙️</Text>
            </Pressable>
            {isMultiplayer && (
              <Pressable
                onPress={handlePullRefresh}
                disabled={isRefreshing}
                style={[
                  styles.iconBtn,
                  {
                    backgroundColor: colors.iconButtonBg,
                    borderColor: colors.glassLight,
                    opacity: isRefreshing ? 0.5 : 1,
                  },
                ]}
                testID="game-btn-sync"
              >
                <Text style={styles.iconBtnEmoji}>{isRefreshing ? '⏳' : '🔄'}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                if (vm.tricks.length > 0) setShowLastTrick(true);
              }}
              disabled={vm.tricks.length === 0}
              style={[
                styles.iconBtn,
                { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight, opacity: vm.tricks.length === 0 ? 0.3 : 1 },
              ]}
              testID="game-btn-last-trick"
            >
              <Text style={styles.iconBtnEmoji}>↩</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setIsViewingScores(true);
                setShowScoreboard(true);
              }}
              style={[styles.iconBtn, { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight }]}
              testID="game-btn-scores"
            >
              <Text style={styles.iconBtnEmoji}>🏆</Text>
            </Pressable>
            <Pressable
              disabled
              style={[styles.iconBtn, { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight, opacity: 0.3 }]}
              testID="game-btn-chat"
            >
              <Text style={styles.iconBtnEmoji}>💬</Text>
            </Pressable>
          </View>
        </View>

        {/* Main Game Area */}
        <View style={styles.gameArea}>
          <View style={styles.cardTable}>
            <View
              style={[
                styles.tableEdge,
                { backgroundColor: isDark ? colors.table : '#33734D', borderColor: isDark ? colors.tableBorder : '#4D8C63' },
              ]}
            />
            <LinearGradient
              colors={isDark ? ['#3a3f4d', '#525868', '#3a3f4d'] : ['#003e00', '#009c00', '#005d00']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.tableFelt}
            >
              <View style={styles.suitRow}>
                {(['spades', 'hearts', 'clubs', 'diamonds'] as const).map((suit) => {
                  const isTrump = vm.trumpSuit === suit;
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

              {vm.phase === 'playing' && (
                <View style={styles.tableInfoArea}>
                  {vm.currentPlayer?.id === vm.myPlayer?.id && (
                    <View style={styles.yourTurnBadge}>
                      <Text style={styles.yourTurnText}>▶ {t('game.yourTurn')}</Text>
                    </View>
                  )}
                  {vm.currentTrick && vm.currentTrick.cards.length > 0 && (
                    <Text style={styles.mustFollowText}>
                      {t('game.mustFollow', 'Must follow')} {SuitSymbols[vm.currentTrick.cards[0].card.suit as keyof typeof SuitSymbols]}
                    </Text>
                  )}
                </View>
              )}
            </LinearGradient>
          </View>

          {/* My profile */}
          {vm.myPlayer && (() => {
            const isMyTurnNow = vm.currentPlayer?.id === vm.myPlayer.id;
            const isFirstPlayer =
              vm.startingPlayerIndex === vm.players.findIndex((p) => p.id === vm.myPlayer!.id);
            return (
              <View style={styles.youLabelAtTable}>
                <View
                  style={[
                    styles.profileCard,
                    isMyTurnNow && { borderColor: colors.activePlayerBorder, borderWidth: 2 },
                    !isMyTurnNow && { borderColor: colors.accent, borderWidth: 1.5 },
                  ]}
                >
                  {isFirstPlayer && <Text style={styles.firstPlayerBadge}>▶</Text>}
                  <View style={[
                    styles.profileAvatar,
                    { backgroundColor: vm.myPlayer.avatarColor || colors.accent },
                  ]}>
                    <Text style={styles.profileAvatarText}>
                      {vm.myPlayer.avatar || vm.myPlayer.name[0]}
                    </Text>
                  </View>
                  <Text style={styles.profileName} numberOfLines={1}>{vm.myPlayer.name}</Text>
                  <Text style={styles.profileStats}>Bet:{vm.myPlayer.bet ?? '-'} Won:{vm.myPlayer.tricksWon}</Text>
                </View>
              </View>
            );
          })()}

          <View style={styles.turnOrderIndicator}>
            <Text style={styles.turnOrderText}>↻</Text>
            <Text style={styles.turnOrderLabel}>{t('game.turnOrder')}</Text>
          </View>

          {/* Opponents */}
          {opponents.map((player, i) => {
            const relativeIndex = getPlayerPosition(vm.players.indexOf(player), vm.playerCount);
            const clockPosition = getOpponentClockPosition(relativeIndex, vm.playerCount);
            const positionStyle = clockToScreen(clockPosition);
            const isCurrentPlayer = vm.currentPlayer?.id === player.id;
            const isFirstPlayer = vm.startingPlayerIndex === vm.players.indexOf(player);
            const avatarColors = ['#3380CC', '#CC4D80', '#66B366', '#9966CC', '#CC9933'];
            // Prefer the player's chosen color (from user_metadata), fall back
            // to a deterministic seat-based color.
            const avatarBg = player.avatarColor || avatarColors[i % avatarColors.length];
            // Offline = no heartbeat for >30s. msSinceSeen=null is single-player.
            const isOffline = player.msSinceSeen !== null && player.msSinceSeen > 30_000;
            return (
              <View
                key={player.id}
                style={[styles.opponentContainer, { top: positionStyle.top, left: positionStyle.left } as any]}
              >
                <View
                  style={[
                    styles.profileCard,
                    { marginTop: positionStyle.marginTop, marginLeft: positionStyle.marginLeft },
                    isCurrentPlayer && { borderColor: colors.activePlayerBorder, borderWidth: 2 },
                    isOffline && { opacity: 0.45 },
                  ]}
                >
                  {isFirstPlayer && <Text style={styles.firstPlayerBadge}>▶</Text>}
                  {isOffline && <Text style={styles.offlineBadge}>📡</Text>}
                  <View style={[styles.profileAvatar, { backgroundColor: avatarBg }]}>
                    <Text style={styles.profileAvatarText}>
                      {player.avatar || player.name[0]}
                    </Text>
                  </View>
                  <Text style={styles.profileName} numberOfLines={1}>{player.name}</Text>
                  <Text style={styles.profileStats}>Bet:{player.bet ?? '-'} Won:{player.tricksWon}</Text>
                </View>
              </View>
            );
          })}

          {/* Center Play Area */}
          <View style={styles.playArea}>
            {vm.displayTrick && vm.displayTrick.cards.length > 0 ? (
              <View style={styles.trickPile}>
                {vm.displayTrick.cards.map((played, playOrder) => {
                  const { dx, dy } = getPlayerCardOffset(played.playerId);
                  return (
                    <View
                      key={played.playerId || playOrder}
                      style={[
                        styles.trickCardAbsolute,
                        {
                          transform: [{ translateX: dx }, { translateY: dy }] as any,
                          zIndex: playOrder + 1,
                        },
                      ]}
                    >
                      <PlayingCard suit={played.card.suit} rank={played.card.rank} size="tiny" />
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.waitingText}>{getTurnLabel()}</Text>
            )}
          </View>
        </View>

        {/* Bet balance overlay */}
        <Modal
          visible={showBetBanner && tricksDiff !== 0}
          transparent
          animationType="fade"
          onRequestClose={() => setShowBetBanner(false)}
        >
          <View style={styles.betBannerOverlay}>
            <View
              style={[
                styles.betBannerModal,
                tricksDiff > 0 ? styles.betBannerFight : styles.betBannerGive,
                { backgroundColor: isDark ? colors.surface : undefined },
              ]}
            >
              <Pressable style={styles.betBannerCloseBtn} onPress={() => setShowBetBanner(false)}>
                <Text style={[styles.betBannerCloseText, { color: isDark ? colors.textMuted : undefined }]}>✕</Text>
              </Pressable>
              <Text style={[styles.betBannerText, { color: colors.textPrimary }]}>
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

        {/* Your Hand */}
        {vm.myPlayer && (
          <View style={[styles.handSection, { backgroundColor: colors.surface, borderTopColor: colors.accent }]}>
            <View testID="my-hand">
              <CardHand
                cards={vm.myPlayer.hand.map((c) => ({ id: c.id, suit: c.suit, rank: c.rank })) as any}
                selectedCards={selectedCard ? [selectedCard] : []}
                playableCards={playableCards.map((c: any) => c.id)}
                onCardPress={handleCardPress}
                size="small"
                horizontal={false}
              />
            </View>
          </View>
        )}

        {/* Betting Phase Modal */}
        <BettingPhase
          visible={vm.phase === 'betting'}
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
          handNumber={vm.handNumber}
          totalHands={vm.totalHands}
          players={scoreboardPlayers}
          startingPlayerIndex={vm.startingPlayerIndex}
          isGameOver={vm.handNumber >= vm.totalHands || vm.phase === 'finished'}
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

              {vm.tricks.length > 0 && (() => {
                const lastTrick = vm.tricks[vm.tricks.length - 1];
                const useLarge = vm.playerCount <= 4;
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
                        const player = vm.players.find((p) => p.id === played.playerId);
                        const isWinner = lastTrick.winnerId === played.playerId;
                        return (
                          <View
                            key={index}
                            style={[
                              styles.lastTrickCard,
                              { backgroundColor: colors.surfaceSecondary },
                              !useLarge && styles.lastTrickCardCompact,
                              isWinner && styles.winnerCard,
                            ]}
                          >
                            <PlayingCard
                              suit={played.card.suit as any}
                              rank={played.card.rank as any}
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

                    <Text style={styles.lastTrickWinner}>
                      {(() => {
                        const winner = vm.players.find((p) => p.id === lastTrick.winnerId);
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
            <Pressable
              onPress={() => {}}
              style={[styles.settingsPanel, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}
            >
              <Text style={[styles.settingsPanelTitle, { color: colors.textPrimary }]}>{t('settings.title')}</Text>

              {!isGuest && (
                <View style={styles.settingsSection}>
                  <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>{t('profile.title')}</Text>
                  <Text style={[styles.settingsValue, { color: colors.textPrimary }]}>{authDisplayName}</Text>
                </View>
              )}

              <View style={styles.settingsSection}>
                <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>{t('settings.language')}</Text>
                <LanguageSwitcher />
              </View>

              <View style={styles.settingsSection}>
                <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>{t('settings.theme')}</Text>
                <View style={[styles.settingsPills, { borderColor: colors.glassLight }]}>
                  {(['system', 'light', 'dark'] as ThemePreference[]).map((opt) => {
                    const themeLabels: Record<string, string> = {
                      system: t('settings.system'),
                      light: t('settings.light'),
                      dark: t('settings.dark'),
                    };
                    const isActive = themePreference === opt;
                    return (
                      <Pressable
                        key={opt}
                        style={[styles.settingsPill, isActive && { backgroundColor: colors.accent }]}
                        onPress={() => setThemePreference(opt)}
                      >
                        <Text
                          style={[
                            styles.settingsPillText,
                            { color: colors.textSecondary },
                            isActive && { color: '#fff', fontWeight: '700' },
                          ]}
                        >
                          {themeLabels[opt]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

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
                        <Text
                          style={[
                            styles.settingsPillText,
                            { color: colors.textSecondary },
                            isActive && { color: '#fff', fontWeight: '700' },
                          ]}
                        >
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
  handInfo: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700' as const,
  },
  gameArea: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    // Raised from 32% to 24% so the "Your turn" badge and "Must follow ♦"
    // notification stay visible on the smallest layout (4+ players, 2 rows
    // of cards in hand). Cards used to overlap this row.
    top: '24%',
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
  youLabelAtTable: {
    position: 'absolute',
    bottom: '6%',
    left: '50%',
    transform: [{ translateX: '-50%' }],
    alignItems: 'center',
    zIndex: 20,
  },
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
  opponentContainer: {
    position: 'absolute',
    zIndex: 20,
    alignItems: 'center',
  },
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
  offlineBadge: {
    position: 'absolute',
    top: 3,
    right: 3,
    fontSize: 11,
    opacity: 0.85,
  },
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
  trickPile: {
    width: 112,
    height: 170,
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
  handSection: {
    borderTopWidth: 2,
    borderTopColor: Colors.accent,
    paddingHorizontal: Spacing.xs,
    paddingTop: Spacing.xs,
    paddingBottom: 80,
    backgroundColor: '#ffffff',
    maxHeight: SCREEN_HEIGHT * 0.42,
  },
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
