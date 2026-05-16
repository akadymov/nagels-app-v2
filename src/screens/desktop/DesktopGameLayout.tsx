/**
 * Desktop Game Table layout — toggleable-left | center game | chat.
 *
 * The left side pane is a tab strip that switches between three views:
 *   - Scoreboard (default): live snapshot scoreboard with per-hand
 *     totals.
 *   - Last trick: compact recap of the most recently closed trick.
 *   - Settings: the same SettingsBody used elsewhere on desktop.
 *
 * Mobile keeps the existing modal flow (trophy / corner-up-left / gear
 * buttons open dedicated overlays). On desktop those modals remain
 * available too, but the always-visible left pane is the primary surface
 * since real estate is plentiful.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Radius, Spacing } from '../../constants';
import { useRoomStore } from '../../store/roomStore';
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
  const lastClosedTrick = snapshot?.last_closed_trick ?? null;

  // Sender for inline chat.
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

  // Aggregate totals from history.
  const totals: Record<string, number> = {};
  for (const h of history) {
    for (const row of h.scores ?? []) {
      totals[row.session_id] = (totals[row.session_id] ?? 0) + (row.hand_score ?? 0);
    }
  }

  const [leftPanel, setLeftPanel] = useState<LeftPanel>('scoreboard');

  const isMultiplayer = props.isMultiplayer ?? false;
  const showSidePanes = isMultiplayer;

  const renderScoreboard = () => (
    <>
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
              <Text style={[styles.scoreName, { color: colors.textPrimary }]} numberOfLines={1}>
                {p.display_name}{isMe ? ' (you)' : ''}
              </Text>
              <Text style={[styles.scoreCell, { color: colors.textMuted }]}>
                Bet {score?.bet ?? '–'} · Won {score?.taken_tricks ?? 0}
              </Text>
              <Text style={[styles.scoreTotal, { color: colors.textPrimary }]}>{total}</Text>
            </View>
          );
        })}
      </ScrollView>
    </>
  );

  const renderLastTrick = () => {
    const winner = lastClosedTrick?.winner_seat != null
      ? players.find((p) => p.seat_index === lastClosedTrick.winner_seat) ?? null
      : null;
    return (
      <View style={styles.lastTrickWrap}>
        <Text style={[styles.scoreTitle, { color: colors.textPrimary, padding: Spacing.md }]}>
          Last trick
        </Text>
        {!lastClosedTrick ? (
          <Text style={[styles.scoreCell, { color: colors.textMuted, padding: Spacing.md }]}>
            No tricks closed yet.
          </Text>
        ) : (
          <>
            <ScrollView contentContainerStyle={styles.lastTrickList}>
              {(lastClosedTrick.cards ?? []).map((c, i) => {
                const player = players.find((p) => p.seat_index === c.seat) ?? null;
                const isWinner = lastClosedTrick.winner_seat === c.seat;
                return (
                  <View
                    key={i}
                    style={[
                      styles.lastTrickRow,
                      {
                        backgroundColor: isWinner ? colors.surfaceSecondary : 'transparent',
                        borderColor: isWinner ? colors.highlight : colors.glassLight,
                      },
                    ]}
                  >
                    <Text style={[styles.scoreName, { color: colors.textPrimary }]} numberOfLines={1}>
                      {player?.display_name ?? `Seat ${c.seat}`}
                      {isWinner ? ' 👑' : ''}
                    </Text>
                    <Text style={[styles.cardGlyph, { color: colors.textPrimary }]}>{c.card}</Text>
                  </View>
                );
              })}
            </ScrollView>
            {winner && (
              <Text style={[styles.lastTrickFooter, { color: colors.success }]}>
                {winner.display_name} won the trick
              </Text>
            )}
          </>
        )}
      </View>
    );
  };

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
      )}

      <View style={styles.centerWrap}>
        <View style={styles.center}>
          <GameTableScreen {...props} hideChat={showSidePanes} />
        </View>
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
