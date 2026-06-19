/**
 * Desktop Game Table layout — toggleable-left | center game | optional chat.
 *
 * Left pane (always visible on desktop, both single-player vs bots
 * and multiplayer rooms) — tabbed:
 *   - Scoreboard (default)
 *   - Last trick
 *   - Settings (SettingsBody)
 *
 * Right pane (chat) — multiplayer only; SP bot games skip it because
 * there's no-one to chat with.
 *
 * Mobile keeps the existing modal flow regardless.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { useIsDiscordActivity } from '../../hooks/useIsDiscordActivity';
import { leaveWithConfirm } from '../../lib/leaveWithConfirm';
import { Radius, Spacing } from '../../constants';
import { useRoomStore } from '../../store/roomStore';
import { useGameStore, type GameStore } from '../../store/gameStore';
import { GameTableScreen, type GameTableScreenProps } from '../GameTableScreen';
import { ChatPanel } from '../../components/ChatPanel';
import { SettingsBody } from '../../components/SettingsBody';
import { PlayingCard, type Rank } from '../../components/cards';
import { ScoreboardModal, type PlayerScore } from '../ScoreboardModal';
import { RatingSettlementModal } from '../RatingSettlementModal';
import { gameClient } from '../../lib/gameClient';
import { useChatTooltipStore } from '../../store/chatTooltipStore';
import { useAuthStore } from '../../store/authStore';
import { getDiscordProfile } from '../../lib/discord/bootstrap';
import { DesktopGameUIContext, type LeftPanel } from './DesktopGameContext';

type Props = GameTableScreenProps;

const PANEL_TITLES: Record<LeftPanel, string> = {
  scoreboard: 'Scoreboard',
  lastTrick: 'Last trick',
  settings: 'Settings',
};

// Unified data model for the left pane — fed by either the multiplayer
// snapshot or the single-player gameStore so the renderers stay simple.
interface LeftRow {
  id: string;
  name: string;
  bet: number | null;
  won: number;
  total: number;
  isMe: boolean;
}
interface LeftHandInfo {
  handNumber: number;
  totalHands: number;
  cardsPerPlayer: number;
  trump: string;
}
interface LeftLastTrickCard {
  playerName: string;
  // Parsed suit + rank so we can render an actual PlayingCard.
  // Akula: "слева сейчас показываются названия и коды карт — этого
  // недостаточно, нужны изображения".
  suit: 'spades' | 'hearts' | 'clubs' | 'diamonds';
  rank: Rank;
  isWinner: boolean;
}

// Snapshot encodes face cards as 'jack'/'queen'/'king'/'ace';
// PlayingCard expects single-letter Rank literals.
function parseRank(raw: string | undefined): Rank {
  if (!raw) return 2;
  if (/^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    if (n >= 2 && n <= 10) return n as Rank;
  }
  switch (raw.toLowerCase()) {
    case 'j': case 'jack':  return 'J';
    case 'q': case 'queen': return 'Q';
    case 'k': case 'king':  return 'K';
    case 'a': case 'ace':   return 'A';
    default: return 2;
  }
}
interface LeftLastTrick {
  cards: LeftLastTrickCard[];
  winnerName: string | null;
}

export const DesktopGameLayout: React.FC<Props> = (props) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const isMultiplayer = props.isMultiplayer ?? false;
  const isDiscord = useIsDiscordActivity();

  // ── Multiplayer data sources ──
  const snapshot = useRoomStore((s) => s.snapshot);
  const mpMyPlayerId = useRoomStore((s) => s.myPlayerId);
  const isSpectator = useRoomStore((s) => s.isSpectator);

  // ── Single-player data sources ──
  const sp = useGameStore();

  // Build the unified view-model for the left pane.
  const { rows, handInfo, lastTrick } = buildLeftPaneData({
    isMultiplayer,
    snapshot,
    mpMyPlayerId,
    sp,
  });

  // Sender for inline chat — MP only.
  const me = (snapshot?.players ?? []).find((p) => p.session_id === mpMyPlayerId) ?? null;
  const spectatorMe = !me && isSpectator && mpMyPlayerId
    ? (snapshot?.spectators ?? []).find((s: any) => s.session_id === mpMyPlayerId) ?? null
    : null;
  const senderSrc: any = me ?? spectatorMe;
  const sender = senderSrc ? {
    sessionId: senderSrc.session_id,
    displayName: senderSrc.display_name,
    avatar: senderSrc.avatar ?? null,
    avatarUrl: senderSrc.avatar_url ?? null,
    avatarColor: senderSrc.avatar_color ?? null,
  } : null;

  const [leftPanel, setLeftPanel] = useState<LeftPanel | null>('scoreboard');
  // Multiplayer rooms default chat ON; SP has no chat at all; Discord never shows chat.
  const [chatVisible, setChatVisible] = useState(isMultiplayer && !isDiscord);
  const ui = useMemo(() => ({
    leftPanel,
    toggleLeftPanel: (next: LeftPanel) =>
      setLeftPanel((current) => (current === next ? null : next)),
    showScoreboard: () => setLeftPanel('scoreboard'),
    chatVisible,
    toggleChat: () =>
      setChatVisible((v) => {
        const next = !v;
        if (next) useChatTooltipStore.getState().dismissAll();
        return next;
      }),
  }), [leftPanel, chatVisible]);

  const renderPaneHeader = (title: string) => (
    <View style={[styles.paneHeader, { borderBottomColor: colors.glassLight }]}>
      <Text style={[styles.paneHeaderText, { color: colors.textPrimary }]}>{title}</Text>
    </View>
  );

  // The local human's avatar for the single-player scoreboard. sp.players are
  // built bare (no avatar), so — like GameTableScreen — pull it from the auth
  // metadata, falling back to the Discord profile inside an Activity.
  const myMeta = useAuthStore((s) => s.user?.user_metadata ?? null) as Record<string, unknown> | null;
  const myAvatarUrl = (myMeta?.avatar_url as string | undefined) ?? getDiscordProfile()?.avatar_url ?? null;
  const myAvatar = (myMeta?.avatar as string | undefined) ?? null;
  const myAvatarColor = (myMeta?.avatar_color as string | undefined) ?? null;

  // Build PlayerScore[] for the embedded ScoreboardModal. Mirrors
  // the construction in GameTableScreen so the same renderer can be
  // reused without an intermediate adapter.
  const playerScores: PlayerScore[] = isMultiplayer
    ? (() => {
        const players = snapshot?.players ?? [];
        const handScores = snapshot?.hand_scores ?? [];
        const history = snapshot?.score_history ?? [];
        const totals: Record<string, number> = {};
        for (const h of history) {
          for (const row of h.scores ?? []) {
            totals[row.session_id] = (totals[row.session_id] ?? 0) + (row.hand_score ?? 0);
          }
        }
        return players
          .map((p: any) => {
            const score = handScores.find((s: any) => s.session_id === p.session_id);
            const bet = score?.bet ?? null;
            const won = score?.taken_tricks ?? 0;
            const madeBet = bet !== null && bet === won;
            const bonus = madeBet ? 10 : 0;
            return {
              id: p.session_id,
              name: p.display_name,
              rank: 0,
              totalScore: totals[p.session_id] ?? 0,
              lastBet: bet ?? 0,
              lastTricks: won,
              lastBonus: bonus,
              lastPoints: won + bonus,
              madeBet,
              avatar: p.avatar ?? null,
              avatarUrl: p.avatar_url ?? null,
              avatarColor: p.avatar_color ?? null,
              seatIndex: p.seat_index,
            };
          })
          .sort((a: PlayerScore, b: PlayerScore) => b.totalScore - a.totalScore)
          .map((p: PlayerScore, i: number) => ({ ...p, rank: i + 1 }));
      })()
    : sp.players
        .map((p, i) => {
          const bet = p.bet;
          const won = p.tricksWon ?? 0;
          const madeBet = bet != null && bet === won;
          const bonus = madeBet ? 10 : 0;
          return {
            id: p.id,
            name: p.name,
            rank: 0,
            totalScore: (p.score ?? 0) + (p.bonus ?? 0),
            lastBet: bet ?? 0,
            lastTricks: won,
            lastBonus: bonus,
            lastPoints: won + bonus,
            madeBet,
            avatar: p.isBot ? null : myAvatar,
            avatarUrl: p.isBot ? null : myAvatarUrl,
            avatarColor: p.isBot ? null : myAvatarColor,
            seatIndex: i,
          };
        })
        .sort((a, b) => b.totalScore - a.totalScore)
        .map((p, i) => ({ ...p, rank: i + 1 }));

  const isHost = isMultiplayer && !!snapshot?.room && snapshot.room.host_session_id === mpMyPlayerId;
  const isGameOver = isMultiplayer
    ? snapshot?.room?.phase === 'finished'
    : sp.phase === 'finished';

  // Opt-in stake players see RatingSettlementModal at game end. The
  // embedded scoreboard suppresses its own Play Again so the restart
  // funnels through that modal.
  const meOptIn = !!(
    (snapshot?.players ?? []).find((p: any) => p.session_id === mpMyPlayerId) as any
  )?.opt_in_stake;
  const roomStake = snapshot?.room?.stake ?? 0;
  const [showSettlement, setShowSettlement] = useState(false);
  useEffect(() => {
    if (isMultiplayer && isGameOver && roomStake > 0 && meOptIn) {
      setShowSettlement(true);
    }
  }, [isMultiplayer, isGameOver, roomStake, meOptIn]);

  const handlePlayAgain = () => {
    if (!isMultiplayer) {
      try { sp.reset(); } catch {}
      return;
    }
    const roomId = snapshot?.room?.id;
    if (!roomId) return;
    gameClient.restartGame(roomId).catch((err) => {
      console.error('[DesktopGameLayout] restartGame failed:', err);
    });
  };

  // Game-over Leave button — confirm + leaveRoom + onExit. Lets every
  // player drop out to the lobby without waiting for the host's "Play
  // Again" decision. SP games don't surface this button (no room).
  const handleLeaveRoom = async () => {
    const roomId = snapshot?.room?.id;
    if (!isMultiplayer || !roomId) return;
    const ok = await leaveWithConfirm(roomId, t, { isHost, context: 'room' });
    if (!ok) return;
    props.onExit?.();
  };

  const renderScoreboard = () => (
    <View style={{ flex: 1 }}>
      <ScoreboardModal
        embedded
        visible
        handNumber={handInfo?.handNumber ?? 0}
        totalHands={handInfo?.totalHands ?? 0}
        players={playerScores}
        scoreHistory={isMultiplayer ? undefined : sp.scoreHistory}
        isGameOver={isGameOver}
        isHost={isHost}
        isMidGame
        onContinue={() => { /* no-op — embedded mode has no Continue */ }}
        onPlayAgain={handlePlayAgain}
        onLeaveRoom={isMultiplayer ? handleLeaveRoom : undefined}
        suppressPlayAgain={meOptIn && roomStake > 0}
      />
      <RatingSettlementModal
        visible={showSettlement}
        roomId={snapshot?.room?.id ?? null}
        onClose={() => setShowSettlement(false)}
        showPlayAgain={isHost}
        onPlayAgain={() => { setShowSettlement(false); handlePlayAgain(); }}
      />
    </View>
  );

  const renderLastTrick = () => (
    <View style={styles.lastTrickWrap}>
      <Text style={[styles.scoreTitle, { color: colors.textPrimary, padding: Spacing.md }]}>
        Last trick
      </Text>
      {!lastTrick ? (
        <Text style={[styles.scoreCell, { color: colors.textMuted, padding: Spacing.md }]}>
          No tricks closed yet.
        </Text>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.lastTrickList}>
            {lastTrick.cards.map((c, i) => (
              <View
                key={i}
                style={[
                  styles.lastTrickRow,
                  {
                    backgroundColor: c.isWinner ? colors.surfaceSecondary : 'transparent',
                    borderColor: c.isWinner ? colors.highlight : colors.glassLight,
                  },
                ]}
              >
                <Text style={[styles.scoreName, { color: colors.textPrimary }]} numberOfLines={1}>
                  {c.playerName}{c.isWinner ? ' 👑' : ''}
                </Text>
                <PlayingCard suit={c.suit} rank={c.rank} size="small" />
              </View>
            ))}
          </ScrollView>
          {lastTrick.winnerName && (
            <Text style={[styles.lastTrickFooter, { color: colors.success }]}>
              {lastTrick.winnerName} won the trick
            </Text>
          )}
        </>
      )}
    </View>
  );

  return (
    <DesktopGameUIContext.Provider value={ui}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        {leftPanel && (
          <View
            style={[
              styles.sidePane,
              styles.leftPane,
              { backgroundColor: colors.surface, borderColor: colors.glassLight },
            ]}
          >
            {renderPaneHeader(PANEL_TITLES[leftPanel])}
            <View style={styles.leftBody}>
              {leftPanel === 'scoreboard' && renderScoreboard()}
              {leftPanel === 'lastTrick' && renderLastTrick()}
              {leftPanel === 'settings' && <SettingsBody onClose={() => {}} />}
            </View>
          </View>
        )}

        <View style={styles.centerWrap}>
          <View style={styles.center}>
            <GameTableScreen {...props} hideChat={isMultiplayer} />
          </View>
        </View>

        {isMultiplayer && chatVisible && !isDiscord && (
          <View
            style={[
              styles.sidePane,
              styles.rightPane,
              { backgroundColor: colors.surface, borderColor: colors.glassLight },
            ]}
          >
            <ChatPanel
              mode="inline"
              visible
              onClose={() => setChatVisible(false)}
              sender={sender}
              testIdPrefix="chat"
            />
          </View>
        )}
      </View>
    </DesktopGameUIContext.Provider>
  );
};

function buildLeftPaneData(args: {
  isMultiplayer: boolean;
  snapshot: any;
  mpMyPlayerId: string | null;
  sp: GameStore;
}): {
  rows: LeftRow[];
  handInfo: LeftHandInfo | null;
  lastTrick: LeftLastTrick | null;
} {
  const { isMultiplayer, snapshot, mpMyPlayerId, sp } = args;

  if (isMultiplayer) {
    const players = snapshot?.players ?? [];
    const handScores = snapshot?.hand_scores ?? [];
    const history = snapshot?.score_history ?? [];
    const room = snapshot?.room ?? null;
    const hand = snapshot?.current_hand ?? null;
    const last = snapshot?.last_closed_trick ?? null;

    const totals: Record<string, number> = {};
    for (const h of history) {
      for (const row of h.scores ?? []) {
        totals[row.session_id] = (totals[row.session_id] ?? 0) + (row.hand_score ?? 0);
      }
    }

    const rows: LeftRow[] = players.map((p: any) => {
      const score = handScores.find((s: any) => s.session_id === p.session_id);
      return {
        id: p.session_id,
        name: p.display_name,
        bet: score?.bet ?? null,
        won: score?.taken_tricks ?? 0,
        total: totals[p.session_id] ?? 0,
        isMe: p.session_id === mpMyPlayerId,
      };
    });

    const handInfo: LeftHandInfo | null = (hand && room) ? {
      handNumber: hand.hand_number,
      totalHands: room.max_cards * 2,
      cardsPerPlayer: hand.cards_per_player,
      trump: hand.trump_suit,
    } : null;

    let lastTrick: LeftLastTrick | null = null;
    if (last) {
      const winnerPlayer = last.winner_seat != null
        ? players.find((p: any) => p.seat_index === last.winner_seat) ?? null
        : null;
      lastTrick = {
        cards: (last.cards ?? []).map((c: any) => {
          const player = players.find((p: any) => p.seat_index === c.seat) ?? null;
          // Snapshot stores cards as "spades-9" / "hearts-king".
          const [rawSuit, rawRank] = String(c.card ?? '').split('-');
          return {
            playerName: player?.display_name ?? `Seat ${c.seat}`,
            suit: (rawSuit as LeftLastTrickCard['suit']) ?? 'spades',
            rank: parseRank(rawRank),
            isWinner: last.winner_seat === c.seat,
          };
        }),
        winnerName: winnerPlayer?.display_name ?? null,
      };
    }

    return { rows, handInfo, lastTrick };
  }

  // Single-player — read from useGameStore.
  const myId = sp.myPlayerId;
  const rows: LeftRow[] = sp.players.map((p) => ({
    id: p.id,
    name: p.name,
    bet: p.bet ?? null,
    won: p.tricksWon ?? 0,
    total: (p.score ?? 0) + (p.bonus ?? 0),
    isMe: p.id === myId,
  }));

  const handInfo: LeftHandInfo | null = sp.players.length > 0 ? {
    handNumber: sp.handNumber,
    totalHands: sp.totalHands,
    cardsPerPlayer: sp.cardsPerPlayer,
    trump: sp.trumpSuit,
  } : null;

  // Last fully-played trick from the current hand's history.
  const tricks = sp.tricks ?? [];
  const last = tricks.length > 0 ? tricks[tricks.length - 1] : null;
  let lastTrick: LeftLastTrick | null = null;
  if (last) {
    const winnerPlayer = sp.players.find((p) => p.id === last.winnerId) ?? null;
    lastTrick = {
      cards: last.cards.map((c) => {
        const player = sp.players.find((p) => p.id === c.playerId) ?? null;
        return {
          playerName: player?.name ?? '?',
          suit: c.card.suit as LeftLastTrickCard['suit'],
          rank: c.card.rank,
          isWinner: c.playerId === last.winnerId,
        };
      }),
      winnerName: winnerPlayer?.name ?? null,
    };
  }

  return { rows, handInfo, lastTrick };
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  centerWrap: { flex: 1, minWidth: 0, alignItems: 'center' },
  center: { flex: 1, width: '100%' },
  sidePane: {
    width: 400,
    margin: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  leftPane: { marginRight: 0 },
  rightPane: { marginLeft: 0 },
  paneHeader: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  paneHeaderText: { fontSize: 16, fontWeight: '700' },
  leftBody: { flex: 1 },
  scoreHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: 4,
  },
  scoreTitle: { fontSize: 18, fontWeight: '700' },
  scoreMeta: { fontSize: 12, fontWeight: '500', paddingRight: Spacing.md },
  scoreSub: { fontSize: 12, paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
  scoreList: { flex: 1, paddingHorizontal: Spacing.sm },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: 6,
    gap: 8,
  },
  scoreName: { flex: 1, fontSize: 13, fontWeight: '600' },
  scoreCell: { fontSize: 11, fontWeight: '500' },
  scoreTotal: { fontSize: 14, fontWeight: '700', minWidth: 28, textAlign: 'right' },
  lastTrickWrap: { flex: 1 },
  lastTrickList: { padding: Spacing.sm, gap: 6 },
  lastTrickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: 6,
  },
  cardGlyph: { fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  lastTrickFooter: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: Spacing.sm,
  },
});

export default DesktopGameLayout;
