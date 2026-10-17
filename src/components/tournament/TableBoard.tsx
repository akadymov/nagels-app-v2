/**
 * Read-only board for one tournament table: header (table, stake, hand,
 * cards, trump), status line and a per-player bet/taken/score grid.
 * Shared by the TV screen and the phone recorder.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';
import { getTrumpColor } from '../../constants/colors';
import { suitGlyph, TrumpSuit } from '../../lib/offline/handBriefing';
import { getTotalHands } from '../../game/rules';
import { tableRows } from '../../lib/tournament/view';
import type { TournamentTable } from '../../lib/tournament/types';

interface Props { table: TournamentTable; size?: 'tv' | 'phone' }

const dash = (v: number | null) => (v === null || v === undefined ? '—' : String(v));

export const TableBoard: React.FC<Props> = ({ table, size = 'phone' }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const tv = size === 'tv';
  const fs = tv ? 24 : 16;
  const fsSmall = tv ? 18 : 12;
  const n = table.table_number;
  const state = table.state;
  const room = state.room;
  const hand = state.current_hand;
  const rows = tableRows(state);
  const nameAt = (seat: number | undefined) =>
    rows.find((r) => r.seat === seat)?.name ?? '';

  let status: string | null = null;
  if (room?.phase === 'finished') status = t('tournament.finished');
  else if (hand?.phase === 'betting') status = t('tournament.betsTurn', { name: nameAt(hand.current_seat) });
  else if (hand?.phase === 'tricks_recording') status = t('tournament.playing', { name: nameAt(hand.starting_seat) });
  else if (hand?.phase === 'scoring' || hand?.phase === 'closed') status = t('tournament.scored');

  const trump = (hand?.trump_suit ?? 'notrump') as TrumpSuit;
  const cell = { fontSize: fs, color: colors.textPrimary };

  return (
    <View
      testID={`tournament-table-${n}`}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}
    >
      <View style={styles.header}>
        <Text style={[styles.bold, { fontSize: fs, color: colors.textPrimary }]}>
          {t('tournament.table', { n })}
        </Text>
        <Text style={[styles.badge, { fontSize: fsSmall, color: colors.textSecondary, borderColor: colors.glassLight }]}>
          {table.stake > 0 ? t('tournament.stakeUnits', { stake: table.stake }) : t('tournament.stakeNone')}
        </Text>
        {hand && (
          <>
            <Text style={{ fontSize: fsSmall, color: colors.textSecondary }}>
              {t('tournament.hand', { n: hand.hand_number, total: getTotalHands(room?.max_cards ?? 10) })}
            </Text>
            <Text style={{ fontSize: fsSmall, color: colors.textSecondary }}>
              {t('tournament.cards', { count: hand.cards_per_player })}
            </Text>
            {trump === 'notrump' ? (
              <Text style={{ fontSize: fsSmall, color: colors.textSecondary }}>{t('tournament.noTrump')}</Text>
            ) : (
              <Text style={{ fontSize: fs, fontWeight: '700', color: getTrumpColor(trump) }}>
                {suitGlyph(trump)}
              </Text>
            )}
          </>
        )}
      </View>

      {status !== null && (
        <Text
          testID={`tournament-status-${n}`}
          style={[styles.status, { fontSize: fs, color: colors.accent }]}
        >
          {status}
        </Text>
      )}

      <View style={styles.row}>
        <Text style={[styles.name, { fontSize: fsSmall, color: colors.textSecondary }]} />
        {(['colBet', 'colTaken', 'colHand', 'colTotal'] as const).map((k) => (
          <Text key={k} style={[styles.num, { fontSize: fsSmall, color: colors.textSecondary }]}>
            {t(`tournament.${k}`)}
          </Text>
        ))}
      </View>
      {rows.map((r) => (
        <View
          key={r.seat}
          testID={`tournament-row-${n}-${r.seat}`}
          style={[
            styles.row,
            r.isTurn && { backgroundColor: colors.accent + '22', borderRadius: Radius.sm },
          ]}
        >
          <Text
            style={[styles.name, { fontSize: fs, color: colors.textPrimary, fontWeight: r.isTurn ? '700' : '400' }]}
            numberOfLines={1}
          >
            {r.name}
            {r.isDealer ? `  🂠 ${t('tournament.dealer')}` : ''}
          </Text>
          <Text style={[styles.num, cell]}>{dash(r.bet)}</Text>
          <Text style={[styles.num, cell]}>{dash(r.taken)}</Text>
          <Text style={[styles.num, cell]}>{dash(r.hand_score)}</Text>
          <Text style={[styles.num, cell, styles.bold]}>{r.total}</Text>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  bold: { fontWeight: '700' },
  badge: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  status: { fontWeight: '600', marginBottom: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 4 },
  name: { flex: 1 },
  num: { width: 64, textAlign: 'right' },
});
