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
  ScrollView,
  RefreshControl,
  useWindowDimensions,
  Share,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { buildInviteLink } from '../utils/inviteLink';
import { GlassCard } from '../components/glass';
import { GameLogo } from '../components/GameLogo';
import { BettingPhase } from '../components/betting';
import { TricksRecorder } from '../components/scorekeeper';
import { Icon } from '../components/Icon';
import { ScoreboardModal } from './ScoreboardModal';
import { RatingSettlementModal } from './RatingSettlementModal';
import { ChatPanel } from '../components/ChatPanel';
import { PlayerChatTooltip } from '../components/PlayerChatTooltip';
import { TurnTimer } from '../components/TurnTimer';
import { useChatTooltipListener } from '../hooks/useChatTooltipListener';
import { useChatTooltipStore } from '../store/chatTooltipStore';
import { useChatStore } from '../store/chatStore';
import { PlayingCard, CardHand } from '../components/cards';
import { Colors, Spacing, Radius, TextStyles, SuitSymbols } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { useIsDesktop, useIsTrueDesktop } from '../hooks/useIsDesktop';
import { useGameStore } from '../store';
import { useRoomStore } from '../store/roomStore';
import { useAuthStore } from '../store/authStore';
import { useTurnTimeout } from '../lib/turnTimeout';
import { useHeartbeat } from '../lib/heartbeat';
import { useReconnectOnFocus } from '../lib/reconnectOnFocus';
import { OnboardingTip } from '../components/OnboardingTip';
import { gameClient } from '../lib/gameClient';
import { leaveWithConfirm } from '../lib/leaveWithConfirm';
import { subscribeRoom, unsubscribeRoom } from '../lib/realtimeBroadcast';
import { useSettingsStore } from '../store/settingsStore';
import { useSettingsUIStore } from '../store/settingsUIStore';
import { useDesktopGameUI } from './desktop/DesktopGameContext';
import { SaveProgressModal } from '../components/SaveProgressModal';
import { shouldShowAfterGame } from '../lib/auth/promptGate';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  isCardPlayable,
  getPlayableCards as engineGetPlayableCards,
} from '../../supabase/functions/_shared/engine/rules';
import type { PlayerScore } from './ScoreboardModal';
import { avatarColorFor } from '../utils/avatarColor';
import { UserAvatar } from '../components/UserAvatar';
import { bonusEarnedHaptic, gameWonHaptic } from '../utils/haptics';


export interface GameTableScreenProps {
  onExit?: () => void;
  playerName?: string;
  isMultiplayer?: boolean;
  botDifficulty?: 'easy' | 'medium' | 'hard';
  botCount?: number;
  /** Desktop wrappers hoist Chat into a side pane; suppress GameTable's
   *  own modal mount so we don't render two chats. */
  hideChat?: boolean;
}

const BOT_NAMES_BY_LANG: Record<string, string[]> = {
  ru: ['Перебор', 'Нулёвый', 'Козырной', 'Авось', 'Хитрец'],
  en: ['Overkill', 'Nil', 'Trumpster', 'Longshot', 'Trickster'],
  es: ['Farol', 'Cero', 'Triunfo', 'Temerario', 'Artero'],
};

// Module-level stable empty array — used as the fallback for Zustand
// selectors that may return undefined. Inlining `?? []` creates a new
// reference on every call (broken referential equality), which forces
// extra renders under Zustand v5.
const EMPTY_ARRAY: any[] = Object.freeze([]) as any;

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
  hideChat = false,
}) => {
  const { t, i18n } = useTranslation();
  const { colors, isDark } = useTheme();
  const isDesktop = useIsDesktop();
  // Strict mouse-driven check used only for huge cards — keeps
  // iPad Safari (touch, no hover) on the mobile card scale.
  const isTrueDesktop = useIsTrueDesktop();
  // Live viewport — iOS Safari recomputes innerHeight after Modal opens
  // (URL bar collapse). Capturing it once at module load left the table /
  // hand sections sized to a stale value, leaking blank space below.
  const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = useWindowDimensions();
  const botNames = BOT_NAMES_BY_LANG[i18n.language] ?? BOT_NAMES_BY_LANG.en;

  const fourColorDeck = useSettingsStore((s) => s.fourColorDeck);
  const biddingTipDismissed = useSettingsStore((s) => s.shownTips.bidding);

  // Subscribe to the auth user's metadata so SP vm picks up a fresh
  // Google avatar after sign-in without needing a page refresh. Stored
  // on the user record (set once on OAuth); selector returns the same
  // object reference until the user/metadata actually changes.
  const authUserMeta = useAuthStore((s) => s.user?.user_metadata ?? null) as
    | Record<string, unknown>
    | null;

  // ── Multiplayer state ──────────────────────────────────────
  const snapshot = useRoomStore((s) => s.snapshot);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const isSpectator = useRoomStore((s) => s.isSpectator);
  // Read spectators off the already-subscribed snapshot. A separate
  // selector with `?? []` would return a fresh array each call — under
  // Zustand v5 that triggers extra renders / can compound into "Max
  // update depth" loops when combined with other reactive paths.
  const spectators = snapshot?.spectators ?? EMPTY_ARRAY;
  const [showSpectators, setShowSpectators] = useState(false);

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

  // Desktop wrapper (DesktopGameLayout) injects a UI context so its
  // side panes can be toggled from the in-game top bar. Null in mobile.
  const desktopUI = useDesktopGameUI();

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

  const isHost = isMultiplayer && !!room && !!myPlayerId && room.host_session_id === myPlayerId;
  const handleEndGame = useCallback(async () => {
    // Single-player bot game: ask once, then drop the local game state and exit.
    if (!isMultiplayer) {
      const msg = String(t('game.leaveBotGameConfirm', 'Leave this game? Your progress will be lost.'));
      const accept = typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(msg)
        : true;
      if (!accept) return;
      try { sp.reset(); } catch {}
      onExit?.();
      return;
    }
    if (!room?.id) return;
    if (useRoomStore.getState().isSpectator) {
      try {
        await gameClient.leaveRoomAsSpectator(room.id);
      } catch (err) {
        console.error('[GameTable] leaveRoomAsSpectator failed:', err);
      }
      unsubscribeRoom();
      useRoomStore.getState().reset();
      onExit?.();
      return;
    }
    await leaveWithConfirm(room.id, t, { isHost: true });
  }, [room?.id, t, onExit, isMultiplayer, sp]);

  // Logo-tap leave: same surface as the exit button, but available
  // to non-host players too. Spectators leave without confirm; SP
  // and multiplayer participants (host + non-host) see a confirm
  // dialog with role-appropriate wording.
  const handleLogoLeave = useCallback(async () => {
    if (!isMultiplayer) {
      const msg = String(t('game.leaveBotGameConfirm', 'Leave this game? Your progress will be lost.'));
      const accept = typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(msg)
        : true;
      if (!accept) return;
      try { sp.reset(); } catch {}
      onExit?.();
      return;
    }
    if (!room?.id) return;
    if (useRoomStore.getState().isSpectator) {
      try {
        await gameClient.leaveRoomAsSpectator(room.id);
      } catch (err) {
        console.error('[GameTable] leaveRoomAsSpectator failed:', err);
      }
      unsubscribeRoom();
      useRoomStore.getState().reset();
      onExit?.();
      return;
    }
    const ok = await leaveWithConfirm(room.id, t, { isHost });
    if (!ok) return;
    onExit?.();
  }, [isMultiplayer, room?.id, t, sp, isHost, onExit]);

  // Spectator leave — no confirm prompt, just detach and exit.
  const handleSpectatorLeave = useCallback(async () => {
    const roomId = room?.id;
    if (roomId) {
      try {
        await gameClient.leaveRoomAsSpectator(roomId);
      } catch (err) {
        console.error('[GameTable] leaveRoomAsSpectator failed:', err);
      }
    }
    unsubscribeRoom();
    useRoomStore.getState().reset();
    onExit?.();
  }, [room?.id, onExit]);

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
    /** Profile picture URL (Google `avatar_url`/`picture`); wins over emoji. */
    avatarUrl?: string | null;
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
          avatarUrl: (p as any).avatar_url ?? null,
          avatarColor: (p as any).avatar_color ?? null,
        };
      });
      players.sort((a, b) => a.seatIndex - b.seatIndex);

      const phase: 'lobby' | 'betting' | 'playing' | 'scoring' | 'finished' = (() => {
        if (!hand) return 'lobby';
        if (room?.phase === 'finished') return 'finished';
        if (hand.phase === 'closed' || hand.phase === 'scoring') return 'scoring';
        // Scorekeeper-mode 'tricks_recording' shares the same outer-table
        // chrome as 'playing' (no betting modal, scoreboard available);
        // the TricksRecorder overlay renders on top instead of cards.
        if (hand.phase === 'playing' || hand.phase === 'tricks_recording') return 'playing';
        return 'betting';
      })();

      const isTricksRecording =
        (room as { mode?: string } | null)?.mode === 'scorekeeper' &&
        hand?.phase === 'tricks_recording';

      const currentPlayer = hand
        ? players.find((p) => p.seatIndex === hand.current_seat) ?? null
        : null;
      const myPlayer = players.find((p) => p.id === myPlayerId) ?? null;

      const totalHands = (room?.max_cards ?? 10) * 2;
      const handNumber = hand?.hand_number ?? 1;
      const cardsPerPlayer = hand?.cards_per_player ?? 0;
      const trumpSuit = (hand?.trump_suit ?? 'diamonds') as any;

      // Within the trump suit Nägels promotes Jack to the very top and
      // Nine to second — so a left-to-right sort within trump goes
      // J · 9 · A · K · Q · 10 · 8 …, not A · K · Q · J · 10 · 9 …
      const NORMAL_RANK: Record<string, number> = { '2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8, J: 9, Q: 10, K: 11, A: 12 };
      const TRUMP_RANK:  Record<string, number> = { '2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '10': 7, Q: 8, K: 9, A: 10, '9': 11, J: 12 };
      const SUIT_ORDER: Record<string, number> = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
      const sortMyHand = (cards: Array<{ id: string; suit: string; rank: string }>) => {
        const tw = (s: string) => (s === trumpSuit ? -1 : SUIT_ORDER[s] ?? 9);
        return [...cards].sort((a, b) => {
          const ds = tw(a.suit) - tw(b.suit);
          if (ds !== 0) return ds;
          const map = a.suit === trumpSuit ? TRUMP_RANK : NORMAL_RANK;
          return (map[b.rank] ?? 0) - (map[a.rank] ?? 0);
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
        isTricksRecording,
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

    // Single-player: map sp store into the same shape.
    // The human always has !p.isBot; pull their avatar from auth metadata
    // so a Google-signed-in player sees their own picture vs. bots.
    const meta = authUserMeta ?? {};
    const myAvatarUrl = (meta.avatar_url as string | undefined) ?? null;
    const myAvatar = (meta.avatar as string | undefined) ?? null;
    const myAvatarColor = (meta.avatar_color as string | undefined) ?? null;
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
      avatar: p.isBot ? null : myAvatar,
      avatarUrl: p.isBot ? null : myAvatarUrl,
      avatarColor: p.isBot ? null : myAvatarColor,
    }));
    return {
      phase: sp.phase,
      isTricksRecording: false,
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
  }, [isMultiplayer, snapshot, room, mpPlayers, hand, handScores, currentTrick, lastClosedTrick, holdTrickActive, myHandStrings, myPlayerId, sp, authUserMeta]);

  // ── UI state ───────────────────────────────────────────────
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [showSettlement, setShowSettlement] = useState(false);
  // Opt-in stake players see the RatingSettlementModal after the
  // scoreboard at game end; suppresses ScoreboardModal's own Play
  // Again so the restart action funnels through the settlement.
  const meOptIn = !!(mpPlayers.find((p) => p.session_id === myPlayerId) as any)?.opt_in_stake;
  const roomStake = room?.stake ?? 0;
  useEffect(() => {
    if (vm.phase === 'finished' && roomStake > 0 && meOptIn) {
      setShowSettlement(true);
    }
  }, [vm.phase, roomStake, meOptIn]);
  const [showChat, setShowChat] = useState(false);
  useChatTooltipListener({
    selfSessionId: vm.myPlayer?.id ?? null,
    isChatOpen: desktopUI ? !!desktopUI.chatVisible : showChat,
    // BettingPhase owns its own chat state during the betting overlay;
    // it mounts the listener itself, so this one steps aside.
    active: vm.phase !== 'betting',
  });
  const chatUnread = useChatStore((s) => s.unread);
  const [isViewingScores, setIsViewingScores] = useState(false);

  const handleShareSpectator = useCallback(async () => {
    if (!isMultiplayer || !room) return;
    const link = `${buildInviteLink(room.code)}?as=spectator`;
    const message = `${t('spectator.shareMessage')}\n${link}`;
    try {
      await Share.share(
        { message, title: 'Nägels Online' },
        { dialogTitle: t('spectator.shareLink') },
      );
    } catch {
      await Clipboard.setStringAsync(link);
      Alert.alert(t('multiplayer.codeCopied'), link);
    }
  }, [isMultiplayer, room, t]);
  const [showLastTrick, setShowLastTrick] = useState(false);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [showBetBanner, setShowBetBanner] = useState(false);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const navigation = useNavigation<any>();

  const totalBets = vm.players.reduce((sum, p) => sum + (p.bet ?? 0), 0);
  const tricksDiff = totalBets - vm.cardsPerPlayer;
  const hasAllBets =
    vm.players.length > 0 && vm.players.every((p) => p.bet !== null);

  // The "X to fight / X to give" banner: server transitions the hand
  // atomically from 'betting' → 'playing' the moment the last bet is
  // placed, so the client almost never observes phase==='betting' with
  // hasAllBets===true. We instead trigger on the first appearance of
  // phase==='playing' for a given hand_id, before any card has been
  // laid. We also lock the diff at trigger time into bannerDiffRef so
  // the banner shows a stable number even if the snapshot briefly
  // re-renders between sub-snapshots.
  const handIdForBanner = snapshot?.current_hand?.id ?? null;
  const bannerShownForHandRef = useRef<string | null>(null);
  const bannerDiffRef = useRef<number>(0);

  // 1) Trigger: open banner once per hand at phase→playing transition.
  useEffect(() => {
    const noCardsPlayedYet = (currentTrick?.cards?.length ?? 0) === 0;
    if (
      hasAllBets &&
      vm.phase === 'playing' &&
      noCardsPlayedYet &&
      tricksDiff !== 0 &&
      handIdForBanner &&
      bannerShownForHandRef.current !== handIdForBanner
    ) {
      bannerShownForHandRef.current = handIdForBanner;
      bannerDiffRef.current = tricksDiff;
      setShowBetBanner(true);
    } else if (vm.phase === 'finished' || vm.phase === 'scoring' || vm.phase === 'lobby') {
      setShowBetBanner(false);
    }
  }, [hasAllBets, vm.phase, tricksDiff, handIdForBanner, currentTrick?.cards?.length]);

  // 2) Auto-hide: separate effect so the 3 s timer isn't cancelled by
  // every unrelated re-render that re-runs the trigger effect's deps.
  useEffect(() => {
    if (!showBetBanner) return;
    const t = setTimeout(() => setShowBetBanner(false), 3000);
    return () => clearTimeout(t);
  }, [showBetBanner]);

  useEffect(() => {
    if (vm.phase === 'scoring' || vm.phase === 'finished') {
      // Defer the scoreboard so every player sees the final card on the
      // table before the modal covers it. Server transitions to 'scoring'
      // the moment the last trick closes, but the actor's pane is the
      // only one that already knows what was played — broadcast
      // refreshSnapshot needs a beat to land on the rest. We reuse the
      // same 1500 ms TRICK_HOLD_MS so the trick-hold visual and the
      // scoreboard delay stay in lockstep.
      const t = setTimeout(() => {
        // On desktop the scoreboard already lives in the left pane —
        // popping a modal on top of it would just duplicate. Force the
        // pane to 'scoreboard' so it's visible if the player had a
        // different panel open. Mobile (no desktopUI) keeps the modal.
        if (desktopUI) {
          desktopUI.showScoreboard();
        } else {
          setShowScoreboard(true);
          setIsViewingScores(false);
        }
      }, TRICK_HOLD_MS);
      return () => clearTimeout(t);
    }
  }, [vm.phase, desktopUI]);

  // Desktop auto-advance: with the modal suppressed, there's no
  // "Continue" button for the player to click after a hand closes.
  // Wait a generous beat so the score can be read, then advance the
  // hand the same way handleScoreboardContinue would. Game-over
  // ('finished') is skipped — that state needs an explicit host
  // action ("Play Again") on the embedded scoreboard.
  useEffect(() => {
    if (!desktopUI) return;
    if (vm.phase !== 'scoring') return;
    const DESKTOP_AUTO_CONTINUE_MS = 6000;
    const t = setTimeout(() => {
      if (isMultiplayer) {
        if (room?.id && hand?.id) {
          gameClient
            .continueHand(room.id, hand.id)
            .catch((err) => console.error('[GameTable] auto continueHand failed:', err));
        }
      } else if (sp.handNumber < sp.totalHands) {
        sp.nextHand();
      }
    }, DESKTOP_AUTO_CONTINUE_MS);
    return () => clearTimeout(t);
  }, [vm.phase, desktopUI, isMultiplayer, room?.id, hand?.id, sp]);

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
      if (isSpectator) return;
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
    [vm, selectedCard, isMultiplayer, room?.id, hand?.id, sp, isSpectator]
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

  // "Play Again" — host-only, available on the game-over scoreboard.
  // Asks the server to wipe hand history and flip phase=waiting; every
  // client (including the host) then auto-routes from GameTable back to
  // WaitingRoom via the phase-change effect below.
  const handleScoreboardPlayAgain = () => {
    if (!isMultiplayer || !room?.id) {
      // Single-player: behave like a fresh start.
      sp.endGame();
      setShowScoreboard(false);
      setIsViewingScores(false);
      return;
    }
    gameClient
      .restartGame(room.id)
      .then(() => {
        setShowScoreboard(false);
        setIsViewingScores(false);
      })
      .catch((err) => console.error('[GameTable] restartGame failed:', err));
  };

  // After a game ends, the host hits "Play Again" → server flips
  // room.phase 'finished' → 'waiting'. Every client (host + guests)
  // should pop back to WaitingRoom so they can confirm readiness for
  // the next match.
  const wasFinishedRef = useRef(false);
  useEffect(() => {
    if (room?.phase === 'finished') {
      wasFinishedRef.current = true;
    } else if (room?.phase === 'waiting' && wasFinishedRef.current) {
      wasFinishedRef.current = false;
      setShowScoreboard(false);
      setIsViewingScores(false);
      onExit?.();
    }
  }, [room?.phase, onExit]);

  // Haptic feedback on key gameplay milestones. We refire only on the
  // edge of the phase transition (refs gate per-hand / per-game) so a
  // mid-snapshot re-render doesn't double-buzz the device.
  const bonusFiredForHandRef = useRef<number | null>(null);
  const winFiredForGameRef = useRef(false);
  useEffect(() => {
    // Bonus haptic — fires once per hand when the local player nailed
    // their bid exactly. Triggers on the playing→scoring edge so the
    // buzz lands right as the scoreboard opens.
    if (vm.phase === 'scoring' && bonusFiredForHandRef.current !== vm.handNumber) {
      const me = vm.myPlayer;
      if (me && me.bet !== null && me.tricksWon === me.bet) {
        bonusEarnedHaptic();
      }
      bonusFiredForHandRef.current = vm.handNumber;
    }
    if (vm.phase === 'lobby' || vm.phase === 'betting') {
      // Reset gates as we move into the next hand.
      bonusFiredForHandRef.current = null;
    }

    // Game-won haptic — fires once when phase first becomes 'finished'
    // and the local player is the leader.
    if (vm.phase === 'finished' && !winFiredForGameRef.current) {
      const sorted = [...vm.players].sort((a, b) => (b.score + b.bonus) - (a.score + a.bonus));
      if (sorted[0]?.id === vm.myPlayer?.id) {
        gameWonHaptic();
      }
      winFiredForGameRef.current = true;
    }
    if (vm.phase === 'lobby') {
      winFiredForGameRef.current = false;
    }
  }, [vm.phase, vm.handNumber]);

  // Save Progress auto-prompt: fire once on transition into game-over.
  // Subsequent finished games on the same device are gated by the
  // dismissal flag in promptGate.
  useEffect(() => {
    if (vm.phase !== 'finished') return;
    let cancelled = false;
    void (async () => {
      if (!cancelled && (await shouldShowAfterGame())) {
        setShowSavePrompt(true);
      }
    })();
    return () => { cancelled = true; };
  }, [vm.phase]);

  // Trump display helpers
  const getTrumpSymbol = (trump: string): string => {
    if (trump === 'notrump') return 'NT';
    return SuitSymbols[trump as keyof typeof SuitSymbols] || trump;
  };
  const getTrumpColor = (trump: string): string => {
    if (trump === 'notrump') return colors.accent;
    // Dark suits sit on a dark backdrop here (top-bar badge, on-felt icon),
    // so lift them to a light gray. Cards keep their original near-black
    // because they render on a white face.
    if (isDark && (trump === 'spades' || (trump === 'clubs' && !fourColorDeck))) {
      return '#D4D4D8';
    }
    return (colors[trump as keyof typeof colors] as string) || colors.textSecondary;
  };
  const getTrumpBgColor = (trump: string): string => {
    // Tinted backdrop in the suit's own color so the trump is recognizable at a glance.
    const map: Record<string, [string, string]> = {
      diamonds: ['rgba(0, 148, 255, 0.16)', 'rgba(0, 148, 255, 0.30)'],
      hearts:   ['rgba(190, 25, 49, 0.16)', 'rgba(190, 25, 49, 0.32)'],
      clubs:    ['rgba(48, 133, 82, 0.18)', 'rgba(48, 133, 82, 0.32)'],
      spades:   ['rgba(26, 26, 26, 0.12)',  'rgba(255, 255, 255, 0.18)'],
      notrump:  ['rgba(19, 66, 143, 0.10)', 'rgba(93, 194, 252, 0.22)'],
    };
    const pair = map[trump] ?? map.notrump;
    return isDark ? pair[1] : pair[0];
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
          avatarUrl: p.avatarUrl ?? null,
          avatarColor: p.avatarColor ?? null,
          seatIndex: p.seatIndex,
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
      {/* First-time onboarding tips. Tips self-gate on
          settingsStore.shownTips so once dismissed they never show again.
          We also chain the trump-related tip after the bidding tip: it
          mounts only once shownTips.bidding is true, so the bidding modal
          dismisses first, then the trump explanation pops as the next
          step (instead of stacking two Modals on top of each other). */}
      {biddingTipDismissed && (
        vm.trumpSuit === 'notrump' ? (
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
            delayMs={400}
          />
        )
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
            <GameLogo
              size="xs"
              onPress={handleLogoLeave}
              testID="app-logo-button"
              accessibilityLabel={t('multiplayer.leaveConfirmTitle')}
            />
          </View>
          <View style={styles.topBarRow2}>
            <Text style={[styles.handInfo, { color: colors.textPrimary }]}>
              {t('game.hand')} {vm.handNumber}/{vm.totalHands}
            </Text>
            {isMultiplayer && (
              <TurnTimer
                label={
                  vm.currentPlayer
                    ? (vm.currentPlayer.id === vm.myPlayer?.id
                        ? t('game.yourTurn')
                        : vm.currentPlayer.name)
                    : null
                }
              />
            )}
            <View
              style={[
                styles.trumpBadgeGame,
                {
                  backgroundColor: getTrumpBgColor(vm.trumpSuit),
                  borderColor: getTrumpColor(vm.trumpSuit),
                },
              ]}
            >
              <Text
                style={[
                  vm.trumpSuit === 'notrump' ? styles.trumpBadgeNT : styles.trumpBadgeSymbol,
                  { color: getTrumpColor(vm.trumpSuit) },
                ]}
              >
                {getTrumpSymbol(vm.trumpSuit)}
              </Text>
              <Text style={[styles.trumpBadgeLabel, { color: colors.textSecondary }]}>
                {vm.trumpSuit === 'notrump' ? t('game.noTrump') : t('game.trump')}
              </Text>
            </View>
          </View>
          <View style={styles.topBarRow3}>
            <Pressable
              onPress={() => {
                if (desktopUI) desktopUI.toggleLeftPanel('settings');
                else useSettingsUIStore.getState().open();
              }}
              style={[
                isDesktop ? styles.iconBtnLabeled : styles.iconBtn,
                { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight },
                desktopUI?.leftPanel === 'settings' && { backgroundColor: colors.accent, borderColor: colors.accent },
              ]}
              testID="game-btn-settings"
            >
              <Icon
                name="settings"
                color={desktopUI?.leftPanel === 'settings' ? '#ffffff' : colors.iconButtonText}
                size={20}
              />
              {isDesktop && (
                <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.iconBtnLabel, { color: desktopUI?.leftPanel === 'settings' ? '#ffffff' : colors.iconButtonText }]}>
                  {t('settings.title')}
                </Text>
              )}
            </Pressable>
            {/* Exit button: visible to the SP player (bot game) and to the
                multiplayer host. Non-host MP players use ready/leave from the
                waiting flow; mid-game leave is gated to host per spec. */}
            {(!isMultiplayer || isHost) && (
              <Pressable
                onPress={handleEndGame}
                style={({ pressed }) => [
                  isDesktop ? styles.iconBtnLabeled : styles.iconBtn,
                  {
                    backgroundColor: colors.iconButtonBg,
                    borderColor: colors.glassLight,
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
                testID="game-btn-end"
                accessibilityLabel={t('multiplayer.endGameConfirmTitle')}
              >
                <Icon name="door" color={colors.iconButtonText} size={20} />
                {isDesktop && (
                  <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.iconBtnLabel, { color: colors.iconButtonText }]}>
                    {t('game.exit')}
                  </Text>
                )}
              </Pressable>
            )}
            {isMultiplayer && (
              <Pressable
                onPress={handlePullRefresh}
                disabled={isRefreshing}
                style={[
                  isDesktop ? styles.iconBtnLabeled : styles.iconBtn,
                  {
                    backgroundColor: colors.iconButtonBg,
                    borderColor: colors.glassLight,
                    opacity: isRefreshing ? 0.5 : 1,
                  },
                ]}
                testID="game-btn-sync"
              >
                <Icon
                  name={isRefreshing ? 'hourglass' : 'refresh'}
                  color={colors.iconButtonText}
                  size={20}
                />
                {isDesktop && (
                  <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.iconBtnLabel, { color: colors.iconButtonText }]}>
                    {t('game.sync')}
                  </Text>
                )}
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                if (vm.tricks.length === 0) return;
                if (desktopUI) desktopUI.toggleLeftPanel('lastTrick');
                else setShowLastTrick(true);
              }}
              disabled={vm.tricks.length === 0}
              style={[
                isDesktop ? styles.iconBtnLabeled : styles.iconBtn,
                { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight, opacity: vm.tricks.length === 0 ? 0.3 : 1 },
                desktopUI?.leftPanel === 'lastTrick' && { backgroundColor: colors.accent, borderColor: colors.accent },
              ]}
              testID="game-btn-last-trick"
            >
              <Icon
                name="corner-up-left"
                color={desktopUI?.leftPanel === 'lastTrick' ? '#ffffff' : colors.iconButtonText}
                size={20}
              />
              {isDesktop && (
                <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.iconBtnLabel, { color: desktopUI?.leftPanel === 'lastTrick' ? '#ffffff' : colors.iconButtonText }]}>
                  {t('game.lastTrick')}
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => {
                if (desktopUI) {
                  desktopUI.toggleLeftPanel('scoreboard');
                } else {
                  setIsViewingScores(true);
                  setShowScoreboard(true);
                }
              }}
              style={[
                isDesktop ? styles.iconBtnLabeled : styles.iconBtn,
                { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight },
                desktopUI?.leftPanel === 'scoreboard' && { backgroundColor: colors.accent, borderColor: colors.accent },
              ]}
              testID="game-btn-scores"
            >
              <Icon
                name="trophy"
                color={desktopUI?.leftPanel === 'scoreboard' ? '#ffffff' : colors.iconButtonText}
                size={20}
              />
              {isDesktop && (
                <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.iconBtnLabel, { color: desktopUI?.leftPanel === 'scoreboard' ? '#ffffff' : colors.iconButtonText }]}>
                  {t('game.score')}
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => {
                if (!isMultiplayer) return;
                if (desktopUI) desktopUI.toggleChat();
                else {
                  setShowChat(true);
                  useChatTooltipStore.getState().dismissAll();
                }
              }}
              disabled={!isMultiplayer}
              style={[
                isDesktop ? styles.iconBtnLabeled : styles.iconBtn,
                { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight },
                !isMultiplayer && { opacity: 0.3 },
                desktopUI?.chatVisible && isMultiplayer && { backgroundColor: colors.accent, borderColor: colors.accent },
              ]}
              testID="game-btn-chat"
            >
              <Icon
                name="chat"
                color={desktopUI?.chatVisible && isMultiplayer ? '#ffffff' : colors.iconButtonText}
                size={20}
              />
              {isDesktop && (
                <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.iconBtnLabel, { color: desktopUI?.chatVisible && isMultiplayer ? '#ffffff' : colors.iconButtonText }]}>
                  {t('game.chat')}
                </Text>
              )}
              {isMultiplayer && chatUnread > 0 && (
                <View style={{
                  position: 'absolute', top: -4, right: -4,
                  minWidth: 16, height: 16, paddingHorizontal: 4,
                  borderRadius: 8, backgroundColor: colors.error,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                    {chatUnread > 9 ? '9+' : chatUnread}
                  </Text>
                </View>
              )}
            </Pressable>
            {isMultiplayer && !isSpectator && !!room && (
              <Pressable
                testID="game-btn-share-spectator"
                onPress={handleShareSpectator}
                accessibilityLabel={t('spectator.shareLink')}
                style={[
                  isDesktop ? styles.iconBtnLabeled : styles.iconBtn,
                  { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight },
                ]}
              >
                <Text style={{ fontSize: 18, color: colors.iconButtonText }}>👁</Text>
                {isDesktop && (
                  <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.iconBtnLabel, { color: colors.iconButtonText }]}>
                    {t('spectator.shareLink')}
                  </Text>
                )}
              </Pressable>
            )}
            {spectators.length > 0 && (
              <Pressable
                testID="spectator-count"
                onPress={() => setShowSpectators(true)}
                hitSlop={8}
                accessibilityLabel={t('spectator.count', { count: spectators.length })}
                style={[
                  isDesktop ? styles.iconBtnLabeled : styles.spectatorCountBtn,
                  { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.spectatorIndicator, { color: colors.iconButtonText }]}
                >
                  {/* On desktop the labeled text below already includes
                      the count ("2 watching") — show just the eye to
                      avoid the "👁 2  2 watching" dupe. */}
                  {isDesktop ? '👁' : `👁 ${spectators.length}`}
                </Text>
                {isDesktop && (
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[styles.iconBtnLabel, { color: colors.iconButtonText }]}
                  >
                    {t('spectator.count', { count: spectators.length })}
                  </Text>
                )}
              </Pressable>
            )}
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
                          ? styles.tableSuitSymbolTrump
                          : { color: '#ffffff', opacity: 0.12 },
                        isTrump ? { color: getTrumpColor(suit) } : null,
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
                  {isFirstPlayer && (
                    <Text
                      style={styles.firstPlayerBadge}
                      accessibilityLabel={t('game.dealerButton', 'First to act')}
                      testID="dealer-button"
                    >D</Text>
                  )}
                  <UserAvatar
                    avatarUrl={vm.myPlayer.avatarUrl}
                    emoji={vm.myPlayer.avatar}
                    fallback={vm.myPlayer.name[0]}
                    backgroundColor={vm.myPlayer.avatarColor || avatarColorFor(vm.myPlayer.id)}
                    size={36}
                    textSize={16}
                    style={{ marginBottom: 3 }}
                  />
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
            // Prefer the player's chosen color (from user_metadata), fall back
            // to a session-id-hashed color (random-looking, stable per player).
            const avatarBg = player.avatarColor || avatarColorFor(player.id);
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
                  {isFirstPlayer && (
                    <Text
                      style={styles.firstPlayerBadge}
                      accessibilityLabel={t('game.dealerButton', 'First to act')}
                      testID="dealer-button"
                    >D</Text>
                  )}
                  {isOffline && <Text style={styles.offlineBadge}>📡</Text>}
                  <UserAvatar
                    avatarUrl={player.avatarUrl}
                    emoji={player.avatar}
                    fallback={player.name[0]}
                    backgroundColor={avatarBg}
                    size={36}
                    textSize={16}
                    style={{ marginBottom: 3 }}
                  />
                  <Text style={styles.profileName} numberOfLines={1}>{player.name}</Text>
                  <Text style={styles.profileStats}>Bet:{player.bet ?? '-'} Won:{player.tricksWon}</Text>
                </View>
                <PlayerChatTooltip
                  sessionId={player.id}
                  onPress={() => {
                    if (desktopUI) {
                      if (!desktopUI.chatVisible) desktopUI.toggleChat();
                    } else {
                      setShowChat(true);
                    }
                    useChatTooltipStore.getState().dismissAll();
                  }}
                />
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

        {/* Bet balance overlay. The diff is locked into bannerDiffRef
            at trigger time so the banner doesn't flicker if the
            snapshot transiently re-renders with a different total. */}
        <Modal
          visible={showBetBanner}
          transparent
          animationType="fade"
          onRequestClose={() => setShowBetBanner(false)}
        >
          <View style={styles.betBannerOverlay}>
            <View
              style={[
                styles.betBannerModal,
                bannerDiffRef.current > 0 ? styles.betBannerFight : styles.betBannerGive,
                { backgroundColor: isDark ? colors.surface : undefined },
              ]}
            >
              <Pressable style={styles.betBannerCloseBtn} onPress={() => setShowBetBanner(false)}>
                <Text style={[styles.betBannerCloseText, { color: isDark ? colors.textMuted : undefined }]}>✕</Text>
              </Pressable>
              <Text style={[styles.betBannerText, { color: colors.textPrimary }]}>
                {bannerDiffRef.current > 0
                  ? t('game.toFight', { count: bannerDiffRef.current })
                  : t('game.toGive', { count: Math.abs(bannerDiffRef.current) })}
              </Text>
              <Pressable style={styles.betBannerGotItBtn} onPress={() => setShowBetBanner(false)}>
                <Text style={styles.betBannerGotItText}>{t('game.gotIt')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Your Hand — replaced with spectator strip when watching */}
        {isSpectator ? (
          <Pressable
            testID="spectator-strip"
            onPress={handleSpectatorLeave}
            style={[styles.spectatorStrip, { backgroundColor: colors.accent + '22', borderTopColor: colors.accent }]}
            accessibilityLabel={t('spectator.youAreWatching')}
          >
            <Text style={[styles.spectatorStripText, { color: colors.accent }]}>
              👁 {t('spectator.youAreWatching')}
            </Text>
          </Pressable>
        ) : (
          vm.myPlayer && (
            <View style={[styles.handSection, { backgroundColor: colors.surface, borderTopColor: colors.accent, maxHeight: SCREEN_HEIGHT * 0.42 }]}>
              <View testID="my-hand">
                <CardHand
                  cards={vm.myPlayer.hand.map((c) => ({ id: c.id, suit: c.suit, rank: c.rank })) as any}
                  selectedCards={selectedCard ? [selectedCard] : []}
                  playableCards={playableCards.map((c: any) => c.id)}
                  onCardPress={handleCardPress}
                  size={isTrueDesktop ? 'huge' : 'small'}
                  horizontal={false}
                />
              </View>
            </View>
          )
        )}

        {/* Chat panel — multiplayer only; SP has no peers to chat with.
            Desktop wrappers set hideChat=true and mount their own side-pane chat. */}
        {isMultiplayer && !hideChat && (() => {
          const me = mpPlayers.find((p) => p.session_id === myPlayerId) ?? null;
          const sp = !me && isSpectator && myPlayerId
            ? spectators.find((s: any) => s.session_id === myPlayerId) ?? null
            : null;
          const senderSrc: any = me ?? sp;
          return (
            <ChatPanel
              visible={showChat}
              onClose={() => setShowChat(false)}
              sender={senderSrc ? {
                sessionId: senderSrc.session_id,
                displayName: senderSrc.display_name,
                avatar: senderSrc.avatar ?? null,
                avatarUrl: senderSrc.avatar_url ?? null,
                avatarColor: senderSrc.avatar_color ?? null,
              } : null}
              testIdPrefix="chat"
            />
          );
        })()}

        {/* Betting Phase Modal — hidden for spectators */}
        {!isSpectator && (
          <BettingPhase
            visible={vm.phase === 'betting'}
            isMultiplayer={isMultiplayer}
            onClose={onExit}
            onShowScore={() => {
              setIsViewingScores(true);
              setShowScoreboard(true);
            }}
          />
        )}

        {/* Scorekeeper-mode tricks recorder — replaces the cards/trick area
            while the hand sits in 'tricks_recording' after betting. */}
        {!isSpectator && (
          <TricksRecorder visible={vm.isTricksRecording === true} />
        )}

        {/* Scoreboard Modal — also handles the game-over celebration
            via its built-in winner banner (see ScoreboardModal). */}
        <ScoreboardModal
          visible={showScoreboard}
          handNumber={vm.handNumber}
          totalHands={vm.totalHands}
          players={scoreboardPlayers}
          scoreHistory={isMultiplayer ? undefined : sp.scoreHistory}
          startingPlayerIndex={vm.startingPlayerIndex}
          // Game-over is the SERVER's "room.phase='finished'" signal,
          // not just a hand-count match. Using vm.handNumber >=
          // vm.totalHands flagged the scoreboard as final the moment
          // hand N (the last hand) was DEALT — we hadn't actually
          // played it yet. The host's button then read "Play Again"
          // instead of "Continue", a Play Again click hit the
          // restart_game RPC which rejected with 'not_finished'
          // (room.phase was still 'playing'), and the table froze
          // mid-betting on hand N. Now we wait for the real signal:
          // continueHand on hand N flips room to 'finished', the
          // snapshot lands, vm.phase becomes 'finished', and only
          // THEN do we render the game-over scoreboard.
          isGameOver={vm.phase === 'finished'}
          isHost={isMultiplayer && room?.host_session_id === myPlayerId}
          isMidGame={isViewingScores}
          onContinue={handleScoreboardContinue}
          onPlayAgain={handleScoreboardPlayAgain}
          onClose={isViewingScores ? handleScoreboardClose : handleScoreboardContinue}
          // Game-over Leave button — reuses the existing logo-leave flow
          // (confirm dialog + leaveRoom + onExit) so each player can
          // bail to the lobby without waiting for the host's decision.
          onLeaveRoom={isMultiplayer ? handleLogoLeave : undefined}
          suppressPlayAgain={meOptIn && roomStake > 0}
        />

        {/* Opt-in stake settlement — surfaces after scoreboard at game end
            and replaces the in-scoreboard Play Again CTA. */}
        <RatingSettlementModal
          visible={showSettlement}
          roomId={room?.id ?? null}
          onClose={() => setShowSettlement(false)}
          showPlayAgain={isMultiplayer && !!room && room.host_session_id === myPlayerId}
          onPlayAgain={() => { setShowSettlement(false); handleScoreboardPlayAgain(); }}
        />

        {/* Save Progress auto-prompt (anonymous, after first finished game) */}
        <SaveProgressModal
          visible={showSavePrompt}
          trigger="afterGame"
          onResolved={() => setShowSavePrompt(false)}
          onUseEmail={() => {
            setShowSavePrompt(false);
            navigation.navigate('Auth');
          }}
        />

        {/* Last Trick Modal */}
        <Modal
          visible={showLastTrick}
          transparent
          animationType="fade"
          onRequestClose={() => setShowLastTrick(false)}
        >
          <View style={styles.modalOverlay}>
            <GlassCard style={[styles.lastTrickModal, { maxHeight: SCREEN_HEIGHT * 0.75 }]}>
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
                      style={[styles.lastTrickScroll, { maxHeight: SCREEN_HEIGHT * 0.45 }]}
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

      </ScrollView>

      {/* Spectator list sheet — sits above ScrollView so the backdrop
          covers the full screen. */}
      {showSpectators && (
        <Pressable
          style={styles.spectatorSheetBackdrop}
          onPress={() => setShowSpectators(false)}
        >
          <View style={[styles.spectatorSheet, { backgroundColor: colors.surface ?? colors.background }]}>
            <Text style={[styles.spectatorSheetTitle, { color: colors.textPrimary }]}>
              {t('spectator.title')}
            </Text>
            {spectators.map((s) => (
              <Text key={s.session_id} style={[styles.spectatorRow, { color: colors.textPrimary }]}>
                {s.display_name}
              </Text>
            ))}
          </View>
        </Pressable>
      )}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 3,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
  },
  trumpBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  trumpBadgeSymbol: {
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 26,
    includeFontPadding: false,
  },
  trumpBadgeNT: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
    lineHeight: 22,
  },
  trumpBadgeLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
  // Desktop variant — pill with icon + text label. Self-contained
  // (alignItems / justifyContent / borderWidth) so it can be used
  // INSTEAD OF iconBtn via a ternary — array-merging the two left
  // width:30 from iconBtn winning over width:undefined here, which
  // squished the label letter-under-letter.
  iconBtnLabeled: {
    height: 36,
    minWidth: 120, // fits the longest localized label (e.g. RU "Настройки")
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  iconBtnLabel: {
    fontSize: 13,
    fontWeight: '500',
    flexShrink: 1,
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
    // Sit just under the top opponent's profile card. The previous 22%
    // overlapped 'Your turn' / 'Must follow ♦' messages that render at
    // ~24%; now they have clean space below the suit row.
    top: '12%',
    left: '30%',
    right: '30%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tableSuitSymbol: {
    fontSize: 18,
  },
  tableSuitSymbolTrump: {
    fontSize: 40,
    fontWeight: '900',
    opacity: 1,
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
  // Turn order indicator — shifted left so the global feedback FAB
  // (48 px @ Spacing.md from edge) doesn't overlap.
  turnOrderIndicator: {
    position: 'absolute',
    bottom: Spacing.sm,
    right: Spacing.sm + 48 + Spacing.xs,
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
  // Poker-style dealer button next to the player who acts first in
  // the hand. Sits half-overlapping the right edge of the player card
  // (the "right of the first-to-act" placement from the backlog).
  firstPlayerBadge: {
    position: 'absolute',
    top: '50%',
    right: -14,
    marginTop: -12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#1a1a1a',
    color: '#1a1a1a',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 20,
    overflow: 'hidden',
    // Soft shadow so the chip pops off the player card.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
    elevation: 3,
    zIndex: 10,
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
  lastTrickScroll: {},
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
  betBannerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  betBannerModal: {
    width: '78%',
    maxWidth: 420,
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
  spectatorStrip: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  spectatorStripText: {
    fontSize: 15,
    fontWeight: '600',
  },
  spectatorIndicator: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Mobile spectator-count chip. Auto-width row with min 44pt touch
  // target per the mobile-first rule — the original `iconBtn` (30x30)
  // squashed "👁 N" onto two lines once N was a digit.
  spectatorCountBtn: {
    minWidth: 44,
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  spectatorSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  spectatorSheet: {
    minWidth: 220,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  spectatorSheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  spectatorRow: {
    fontSize: 14,
    paddingVertical: 4,
  },
});

export default GameTableScreen;
