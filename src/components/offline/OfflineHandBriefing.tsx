/**
 * Nägels Online — Offline Hand Briefing
 *
 * Pinned, collapsible card shown at the top of the betting screen in
 * scorekeeper (offline) mode. Tells players how to physically run the hand:
 * seating (hand 1), who deals and how many cards, the trump, who bets/leads
 * first, plus a collapsible quick-rules reminder. Self-gates: renders nothing
 * unless room.mode === 'scorekeeper'. All data comes from the live snapshot.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRoomStore } from '../../store/roomStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';
import {
  getDealerSeat,
  getPlayOrder,
  suitGlyph,
  suitLabelKey,
  TrumpSuit,
  BriefingPlayer,
} from '../../lib/offline/handBriefing';

const RULE_KEYS = [
  'offline.rules.bets',
  'offline.rules.follow',
  'offline.rules.trumpBeats',
  'offline.rules.noDumpTrump',
  'offline.rules.jackException',
  'offline.rules.scoring',
];

export const OfflineHandBriefing: React.FC = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const snapshot = useRoomStore((s) => s.snapshot);
  const expanded = useSettingsStore((s) => s.offlineBriefingExpanded);
  const setExpanded = useSettingsStore((s) => s.setOfflineBriefingExpanded);
  const [rulesOpen, setRulesOpen] = useState(false);

  const room = snapshot?.room ?? null;
  const hand = snapshot?.current_hand ?? null;
  const players = (snapshot?.players ?? []) as BriefingPlayer[];
  const handNumber = hand?.hand_number ?? 1;

  // Hand 1 needs seating, so force the card open regardless of stored pref.
  const isFirstHand = handNumber === 1;
  const showExpanded = expanded || isFirstHand;

  const order = useMemo(
    () => (hand ? getPlayOrder(players, hand.starting_seat) : []),
    [players, hand],
  );

  if (!room || room.mode !== 'scorekeeper' || !hand || players.length === 0) return null;

  const trump = (hand.trump_suit ?? 'notrump') as TrumpSuit;
  const first = order[0];
  const dealerSeat = getDealerSeat(hand.starting_seat, players.length);
  const dealer = players.find((p) => p.seat_index === dealerSeat) ?? null;
  const firstName = first?.display_name ?? '';
  const dealerName = dealer?.display_name ?? '';
  const glyph = suitGlyph(trump);
  const suitName = t(suitLabelKey(trump));
  const trumpChip = trump === 'notrump' ? t('offline.briefing.noTrump') : `${glyph} ${suitName}`;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}
      testID="offline-briefing"
    >
      <Pressable
        onPress={() => { if (!isFirstHand) setExpanded(!showExpanded); }}
        style={styles.header}
        testID="offline-briefing-toggle"
      >
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
          {showExpanded ? '▼ ' : '▶ '}{t('offline.briefing.header', { n: handNumber })}
        </Text>
        <Text style={[styles.headerSummary, { color: colors.textSecondary }]} numberOfLines={1}>
          {trumpChip} · {dealerName} {t('offline.briefing.dealsBadge')} · ▶ {firstName}
        </Text>
      </Pressable>

      {showExpanded && (
        <View style={styles.body}>
          {isFirstHand && (
            <Text style={[styles.line, { color: colors.textSecondary }]}>
              {t('offline.briefing.seatIntro')}
            </Text>
          )}

          <View style={styles.strip} testID="offline-briefing-order">
            {order.map((p, i) => {
              const isFirst = i === 0;
              const isDealer = p.seat_index === dealerSeat;
              return (
                <View key={p.session_id} style={styles.stripItem}>
                  {i > 0 && <Text style={[styles.arrow, { color: colors.textMuted }]}>→</Text>}
                  <Text
                    style={[
                      styles.chip,
                      {
                        color: colors.textPrimary,
                        backgroundColor: isFirst ? colors.accent + '22' : 'transparent',
                      },
                    ]}
                  >
                    {isFirst ? '▶ ' : ''}{p.display_name}{isDealer ? ' 🃏' : ''}
                  </Text>
                </View>
              );
            })}
          </View>

          <Text style={[styles.line, { color: colors.textPrimary }]}>
            {t('offline.briefing.deal', {
              dealer: dealerName,
              count: hand.cards_per_player,
              first: firstName,
            })}
          </Text>
          <Text style={[styles.line, { color: colors.textPrimary }]}>
            {trump === 'notrump'
              ? t('offline.briefing.noTrump')
              : t('offline.briefing.trump', { glyph, suit: suitName })}
          </Text>
          <Text style={[styles.line, { color: colors.textPrimary }]}>
            {t('offline.briefing.first', { first: firstName })}
          </Text>

          <Pressable onPress={() => setRulesOpen((v) => !v)} testID="offline-briefing-rules-toggle">
            <Text style={[styles.rulesToggle, { color: colors.accent }]}>
              {rulesOpen ? '▾ ' : '▸ '}{t('offline.briefing.rulesToggle')}
            </Text>
          </Pressable>
          {rulesOpen && (
            <View style={styles.rules} testID="offline-briefing-rules">
              {RULE_KEYS.map((k) => (
                <Text key={k} style={[styles.ruleItem, { color: colors.textSecondary }]}>
                  •  {t(k)}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  header: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    gap: 2,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  headerSummary: {
    fontSize: 13,
  },
  body: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    gap: Spacing.xs,
  },
  line: {
    fontSize: 14,
    lineHeight: 19,
  },
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  stripItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  arrow: {
    marginHorizontal: 6,
    fontSize: 14,
  },
  chip: {
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  rulesToggle: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: Spacing.xs,
  },
  rules: {
    gap: 4,
    marginTop: 2,
  },
  ruleItem: {
    fontSize: 13,
    lineHeight: 18,
  },
});
