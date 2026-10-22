/**
 * Tournament standings: rank, name and money balance. Points are per table,
 * so summing them across tables is meaningless and not shown.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';
import { fullLeaderboard, formatBalance } from '../../lib/tournament/view';
import type { TournamentState } from '../../lib/tournament/types';

export const Leaderboard: React.FC<{
  state: TournamentState;
  highlightIds?: string[];
  size?: 'tv' | 'phone';
}> = ({
  state,
  highlightIds = [],
  size = 'phone',
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const rows = fullLeaderboard(state);
  const tv = size === 'tv';
  const fs = tv ? { fontSize: 22 } : null;
  const fsTitle = tv ? { fontSize: 26 } : null;
  const fsSmall = tv ? 18 : 12;
  // TV board sits in a side panel — one column unless the field is very large.
  const colCount = tv && rows.length > 20 ? 2 : 1;
  const perCol = Math.ceil(rows.length / colCount);
  const columns = Array.from({ length: colCount }, (_, c) => rows.slice(c * perCol, (c + 1) * perCol));

  const renderRow = (r: (typeof rows)[number], i: number) => {
    const bal = Math.round(r.balance * 10) / 10;
    const balColor = bal > 0 ? colors.success : bal < 0 ? colors.error : colors.textSecondary;
    const hl = highlightIds.includes(r.participant_id);
    return (
      <View
        key={r.participant_id}
        testID={`tournament-leader-${r.participant_id}`}
        style={[styles.row, tv && styles.rowTv, hl && { backgroundColor: colors.accent + '22', borderRadius: Radius.sm }]}
      >
        <Text style={[styles.rank, tv && styles.rankTv, fs, { color: colors.textSecondary }]}>{i + 1}</Text>
        <Text style={[styles.name, fs, { color: colors.textPrimary }]} numberOfLines={1}>
          {r.name}
          {r.no_stakes ? (
            <Text style={{ fontSize: fsSmall, color: colors.textSecondary }}>{`  ${t('tournament.noStakes')}`}</Text>
          ) : null}
        </Text>
        <Text style={[styles.num, tv && styles.numTv, fs, { color: balColor, fontWeight: '700' }]}>{formatBalance(r.balance)}</Text>
      </View>
    );
  };

  const header = (
    <View style={styles.row}>
      <Text style={[styles.rank, fs, { color: colors.textSecondary }]} />
      <Text style={[styles.name, fs, { color: colors.textSecondary }]} />
      <Text style={[styles.num, tv && styles.numTv, fs, { color: colors.textSecondary }]}>{t('tournament.colBalance')}</Text>
    </View>
  );

  return (
    <View
      testID="tournament-leaderboard"
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}
    >
      <Text style={[styles.title, fsTitle, { color: colors.textPrimary }]}>{t('tournament.leaderboard')}</Text>
      {colCount > 1 ? (
        <View style={styles.cols}>
          {columns.map((col, c) => (
            <View key={c} style={styles.col}>
              {header}
              {col.map((r, i) => renderRow(r, c * perCol + i))}
            </View>
          ))}
        </View>
      ) : (
        <>
          {header}
          {rows.map((r, i) => renderRow(r, i))}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md },
  title: { fontSize: 20, fontWeight: '700', marginBottom: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 4 },
  cols: { flexDirection: 'row', gap: Spacing.lg },
  col: { flex: 1 },
  rowTv: { paddingVertical: 2 },
  rankTv: { width: 40 },
  numTv: { width: 96 },
  rank: { width: 28, fontSize: 16 },
  name: { flex: 1, fontSize: 16 },
  num: { width: 72, textAlign: 'right', fontSize: 16 },
});
