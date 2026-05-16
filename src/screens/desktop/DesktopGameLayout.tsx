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

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Radius, Spacing } from '../../constants';
import { useRoomStore } from '../../store/roomStore';
import { useGameStore, type GameStore } from '../../store/gameStore';
import { GameTableScreen, type GameTableScreenProps } from '../GameTableScreen';
import { ChatPanel } from '../../components/ChatPanel';
import { SettingsBody } from '../../components/SettingsBody';
import { Icon, type IconName } from '../../components/Icon';

type Props = GameTableScreenProps;
type LeftPanel = 'scoreboard' | 'lastTrick' | 'settings';

const TABS: Array<{ key: LeftPanel; icon: IconName; label: string }> = [
  { key: 'scoreboard', icon: 'trophy',          label: 'Scores' },
  { key: 'lastTrick',  icon: 'corner-up-left',  label: 'Last trick' },
  { key: 'settings',   icon: 'settings',        label: 'Settings' },
];

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
  cardLabel: string;
  isWinner: boolean;
}
interface LeftLastTrick {
  cards: LeftLastTrickCard[];
  winnerName: string | null;
}

export const DesktopGameLayout: React.FC<Props> = (props) => {
  const { colors } = useTheme();
  const isMultiplayer = props.isMultiplayer ?? false;

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
    avatarColor: senderSrc.avatar_color ?? null,
  } : null;

  const [leftPanel, setLeftPanel] = useState<LeftPanel>('scoreboard');

  const renderScoreboard = () => (
    <>
      <View style={styles.scoreHeader}>
        <Text style={[styles.scoreTitle, { color: colors.textPrimary }]}>Scoreboard</Text>
        {handInfo && (
          <Text style={[styles.scoreMeta, { color: colors.textMuted }]}>
            Hand {handInfo.handNumber} / {handInfo.totalHands}
          </Text>
        )}
      </View>
      {handInfo && (
        <Text style={[styles.scoreSub, { color: colors.textMuted }]}>
          {handInfo.cardsPerPlayer} card{handInfo.cardsPerPlayer === 1 ? '' : 's'} · {handInfo.trump} trump
        </Text>
      )}
      <ScrollView style={styles.scoreList} showsVerticalScrollIndicator={false}>
        {rows.map((r) => (
          <View
            key={r.id}
            style={[
              styles.scoreRow,
              {
                backgroundColor: r.isMe ? colors.surfaceSecondary : 'transparent',
                borderColor: colors.glassLight,
              },
            ]}
          >
            <Text style={[styles.scoreName, { color: colors.textPrimary }]} numberOfLines={1}>
              {r.name}{r.isMe ? ' (you)' : ''}
            </Text>
            <Text style={[styles.scoreCell, { color: colors.textMuted }]}>
              Bet {r.bet ?? '–'} · Won {r.won}
            </Text>
            <Text style={[styles.scoreTotal, { color: colors.textPrimary }]}>{r.total}</Text>
          </View>
        ))}
      </ScrollView>
    </>
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
                <Text style={[styles.cardGlyph, { color: colors.textPrimary }]}>{c.cardLabel}</Text>
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
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.sidePane,
          styles.leftPane,
          { backgroundColor: colors.surface, borderColor: colors.glassLight },
        ]}
      >
        <View style={[styles.tabsRow, { borderBottomColor: colors.glassLight }]}>
          {TABS.map((t) => {
            const active = t.key === leftPanel;
            return (
              <Pressable
                key={t.key}
                onPress={() => setLeftPanel(t.key)}
                style={[
                  styles.tab,
                  active && { backgroundColor: colors.accent + '14' },
                  active && { borderBottomColor: colors.accent },
                ]}
                testID={`desktop-left-tab-${t.key}`}
              >
                <Icon
                  name={t.icon}
                  color={active ? colors.accent : colors.iconButtonText}
                  size={18}
                />
                <Text
                  style={[
                    styles.tabLabel,
                    { color: active ? colors.accent : colors.textMuted },
                  ]}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.leftBody}>
          {leftPanel === 'scoreboard' && renderScoreboard()}
          {leftPanel === 'lastTrick' && renderLastTrick()}
          {leftPanel === 'settings' && <SettingsBody onClose={() => {}} />}
        </View>
      </View>

      <View style={styles.centerWrap}>
        <View style={styles.center}>
          <GameTableScreen {...props} hideChat={isMultiplayer} />
        </View>
      </View>

      {isMultiplayer && (
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
            onClose={() => {}}
            sender={sender}
            testIdPrefix="chat"
          />
        </View>
      )}
    </View>
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
          return {
            playerName: player?.display_name ?? `Seat ${c.seat}`,
            cardLabel: c.card,
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
        const rank = typeof c.card.rank === 'number' ? String(c.card.rank) : c.card.rank;
        const suitGlyph = ({ spades: '♠', hearts: '♥', clubs: '♣', diamonds: '♦' } as any)[c.card.suit] ?? c.card.suit;
        return {
          playerName: player?.name ?? '?',
          cardLabel: `${rank}${suitGlyph}`,
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
  center: { flex: 1, width: '100%', maxWidth: 1200 },
  sidePane: {
    width: 320,
    margin: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  leftPane: { marginRight: 0 },
  rightPane: { marginLeft: 0 },
  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: { fontSize: 12, fontWeight: '600' },
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
