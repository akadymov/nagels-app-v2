/** Tournament standings: rank, name, money balance and total points. */
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
  const twoCols = tv && rows.length > 8;
  const half = Math.ceil(rows.length / 2);

  const renderRow = (r: (typeof rows)[number], i: number) => {
    const bal = Math.round(r.balance * 10) / 10;
    const balColor = bal > 0 ? colors.success : bal < 0 ? colors.error : colors.textSecondary;
    const hl = highlightIds.includes(r.participant_id);
    return (
      <View
        key={r.participant_id}
        testID={`tournament-leader-${r.participant_id}`}
        style={[styles.row, hl && { backgroundColor: colors.accent + '22', borderRadius: Radius.sm }]}
      >
        <Text style={[styles.rank, fs, { color: colors.textSecondary }]}>{i + 1}</Text>
        <Text style={[styles.name, fs, { color: colors.textPrimary }]} numberOfLines={1}>
          {r.name}
          {r.no_stakes ? (
            <Text style={{ fontSize: fsSmall, color: colors.textSecondary }}>{`  ${t('tournament.noStakes')}`}</Text>
          ) : null}
        </Text>
        <Text style={[styles.num, fs, { color: balColor, fontWeight: '700' }]}>{formatBalance(r.balance)}</Text>
        <Text style={[styles.num, fs, { color: colors.textPrimary }]}>{r.total_points}</Text>
      </View>
    );
  };

  const header = (
    <View style={styles.row}>
      <Text style={[styles.rank, fs, { color: colors.textSecondary }]} />
      <Text style={[styles.name, fs, { color: colors.textSecondary }]} />
      <Text style={[styles.num, fs, { color: colors.textSecondary }]}>{t('tournament.colBalance')}</Text>
      <Text style={[styles.num, fs, { color: colors.textSecondary }]}>{t('tournament.colPoints')}</Text>
    </View>
  );

  return (
    <View
      testID="tournament-leaderboard"
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}
    >
      <Text style={[styles.title, fsTitle, { color: colors.textPrimary }]}>{t('tournament.leaderboard')}</Text>
      {twoCols ? (
        <View style={styles.cols}>
          <View style={styles.col}>
            {header}
            {rows.slice(0, half).map((r, i) => renderRow(r, i))}
          </View>
          <View style={styles.col}>
            {header}
            {rows.slice(half).map((r, i) => renderRow(r, half + i))}
          </View>
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
  rank: { width: 28, fontSize: 16 },
  name: { flex: 1, fontSize: 16 },
  num: { width: 72, textAlign: 'right', fontSize: 16 },
});
