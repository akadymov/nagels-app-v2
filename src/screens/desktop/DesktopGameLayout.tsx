/**
 * Desktop Game Table layout — Scoreboard | Center game | Chat.
 *
 * The center column mounts the existing GameTableScreen with hideChat=true
 * so its modal-mode ChatPanel doesn't double up against the inline-mode
 * one in the right side pane.
 *
 * The left side pane reads the room snapshot directly and renders a
 * compact live scoreboard (player, bet/won, total). Mobile keeps the
 * existing ScoreboardModal flow unchanged.
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Radius, Spacing } from '../../constants';
import { useRoomStore } from '../../store/roomStore';
import { useChatStore } from '../../store/chatStore';
import { GameTableScreen, type GameTableScreenProps } from '../GameTableScreen';
import { ChatPanel } from '../../components/ChatPanel';

type Props = GameTableScreenProps;

export const DesktopGameLayout: React.FC<Props> = (props) => {
  const { colors } = useTheme();
  const snapshot = useRoomStore((s) => s.snapshot);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const isSpectator = useRoomStore((s) => s.isSpectator);

  const players = snapshot?.players ?? [];
  const handScores = snapshot?.hand_scores ?? [];
  const history = snapshot?.score_history ?? [];
  const room = snapshot?.room ?? null;
  const hand = snapshot?.current_hand ?? null;

  // Sender for inline chat — mirror GameTable's own resolution
  // (player slot, or spectator entry, whichever applies).
  const me = players.find((p) => p.session_id === myPlayerId) ?? null;
  const spectatorMe = !me && isSpectator && myPlayerId
    ? (snapshot?.spectators ?? []).find((s: any) => s.session_id === myPlayerId) ?? null
    : null;
  const senderSrc: any = me ?? spectatorMe;
  const sender = senderSrc ? {
    sessionId: senderSrc.session_id,
    displayName: senderSrc.display_name,
    avatar: senderSrc.avatar ?? null,
    avatarColor: senderSrc.avatar_color ?? null,
  } : null;

  // Aggregate totals from history
  const totals: Record<string, number> = {};
  for (const h of history) {
    for (const row of h.scores ?? []) {
      totals[row.session_id] = (totals[row.session_id] ?? 0) + (row.hand_score ?? 0);
    }
  }

  const isMultiplayer = props.isMultiplayer ?? false;
  const showSidePanes = isMultiplayer; // SP has no chat/scoreboard side panel value yet

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {showSidePanes && (
        <View
          style={[
            styles.sidePane,
            styles.leftPane,
            { backgroundColor: colors.surface, borderColor: colors.glassLight },
          ]}
        >
          <View style={styles.scoreHeader}>
            <Text style={[styles.scoreTitle, { color: colors.textPrimary }]}>Scoreboard</Text>
            {hand?.hand_number != null && room?.max_cards != null && (
              <Text style={[styles.scoreMeta, { color: colors.textMuted }]}>
                Hand {hand.hand_number} / {room.max_cards * 2}
              </Text>
            )}
          </View>
          {hand?.cards_per_player != null && (
            <Text style={[styles.scoreSub, { color: colors.textMuted }]}>
              {hand.cards_per_player} card{hand.cards_per_player === 1 ? '' : 's'} · {hand.trump_suit} trump
            </Text>
          )}
          <ScrollView style={styles.scoreList} showsVerticalScrollIndicator={false}>
            {players.map((p) => {
              const score = handScores.find((s) => s.session_id === p.session_id);
              const total = totals[p.session_id] ?? 0;
              const isMe = p.session_id === myPlayerId;
              return (
                <View
                  key={p.session_id}
                  style={[
                    styles.scoreRow,
                    {
                      backgroundColor: isMe ? colors.surfaceSecondary : 'transparent',
                      borderColor: colors.glassLight,
                    },
                  ]}
                >
                  <Text
                    style={[styles.scoreName, { color: colors.textPrimary }]}
                    numberOfLines={1}
                  >
                    {p.display_name}
                    {isMe ? ' (you)' : ''}
                  </Text>
                  <Text style={[styles.scoreCell, { color: colors.textMuted }]}>
                    Bet {score?.bet ?? '–'} · Won {score?.taken_tricks ?? 0}
                  </Text>
                  <Text style={[styles.scoreTotal, { color: colors.textPrimary }]}>{total}</Text>
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      <View style={styles.center}>
        <GameTableScreen {...props} hideChat={showSidePanes} />
      </View>

      {showSidePanes && (
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

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  center: { flex: 1, minWidth: 0 },
  sidePane: {
    width: 320,
    margin: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  leftPane: { marginRight: 0 },
  rightPane: { marginLeft: 0 },
  scoreHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: 4,
  },
  scoreTitle: { fontSize: 18, fontWeight: '700' },
  scoreMeta: { fontSize: 12, fontWeight: '500' },
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
  scoreTotal: {
    fontSize: 14,
    fontWeight: '700',
    minWidth: 28,
    textAlign: 'right',
  },
});

export default DesktopGameLayout;
