/**
 * Nägels Online — Offline Hand Briefing
 *
 * Always-on card at the top of the betting screen in scorekeeper (offline)
 * mode. Shows, at a glance, the trump + dealer; then the seating / play
 * order, how many cards to deal, who bets and leads first, and a collapsible
 * quick-rules reminder. Self-gates: renders nothing unless
 * room.mode === 'scorekeeper'. All data comes from the live snapshot.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRoomStore } from '../../store/roomStore';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';
import { getTrumpColor } from '../../constants/colors';
import { OfflineQuickRules } from './OfflineQuickRules';
import {
  getDealerSeat,
  getPlayOrder,
  suitGlyph,
  suitLabelKey,
  TrumpSuit,
  BriefingPlayer,
} from '../../lib/offline/handBriefing';

export const OfflineHandBriefing: React.FC = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const snapshot = useRoomStore((s) => s.snapshot);

  const room = snapshot?.room ?? null;
  const hand = snapshot?.current_hand ?? null;
  const players = (snapshot?.players ?? []) as BriefingPlayer[];
  const handNumber = hand?.hand_number ?? 1;
  const isFirstHand = handNumber === 1;

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

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}
      testID="offline-briefing"
    >
      <Text style={[styles.title, { color: colors.textPrimary }]}>
        {t('offline.briefing.header', { n: handNumber })}
      </Text>
      <Text style={[styles.summary, { color: colors.textSecondary }]} numberOfLines={1}>
        {trump === 'notrump' ? (
          t('offline.briefing.noTrump')
        ) : (
          <>
            <Text style={{ color: getTrumpColor(trump), fontWeight: '700' }}>
              {suitGlyph(trump)}
            </Text>
            {' '}{t(suitLabelKey(trump))}
          </>
        )}
      </Text>

      <Text style={[styles.line, { color: colors.textSecondary }]}>
        {isFirstHand ? t('offline.briefing.seatIntro') : t('offline.briefing.seatLabel')}
      </Text>

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
        {t('offline.briefing.deal', { count: hand.cards_per_player, dealer: dealerName })}
      </Text>
      <Text style={[styles.line, { color: colors.textPrimary }]}>
        {t('offline.briefing.first', { first: firstName })}
      </Text>

      <OfflineQuickRules />
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
  },
  summary: {
    fontSize: 13,
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
});
