/**
 * TV dashboard for an offline tournament: one board per table, a claim QR
 * on every table (large while unclaimed, small once claimed so anyone can
 * take over) and the standings strip along the bottom. Web only.
 */
import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';
import { useTournamentState } from '../../lib/tournament/useTournamentState';
import { TableBoard, Leaderboard, TableQr } from '../../components/tournament';

interface Props { code?: string; secret?: string }

const origin = (): string =>
  typeof window !== 'undefined' && window.location ? window.location.origin : '';

export const TournamentTvScreen: React.FC<Props> = ({ code, secret }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { data, error } = useTournamentState(code);

  if (!data) {
    return (
      <View testID="tournament-tv" style={[styles.root, styles.center, { backgroundColor: colors.background }]}>
        {error ? (
          <Text style={{ color: colors.textSecondary, fontSize: 28 }}>
            {t(error === 'not_found' ? 'tournament.errors.unknown_tournament' : 'tournament.reconnecting')}
          </Text>
        ) : (
          <ActivityIndicator color={colors.accent} size="large" />
        )}
      </View>
    );
  }

  const started = data.tournament.current_tour > 0 && data.tables.length > 0;
  const bigText = { color: colors.textPrimary, fontSize: 28 };

  return (
    <View testID="tournament-tv" style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          {data.tournament.name}
          {started ? ` · ${t('tournament.tour', { n: data.tournament.current_tour })}` : ''}
        </Text>
        {error ? (
          <Text style={[styles.badge, { color: colors.error, borderColor: colors.error }]}>
            {t('tournament.reconnecting')}
          </Text>
        ) : null}
      </View>

      {started ? (
        <>
          <View style={styles.tables}>
            {data.tables.map((table) => {
              const n = table.table_number;
              const url = `${origin()}/tournament/${code}/table/${n}?k=${secret}`;
              return (
                <View key={table.room_id} style={styles.column}>
                  <TableBoard table={table} size="tv" />
                  {secret ? (
                    table.claimed ? (
                      <View style={styles.qrSmall} pointerEvents="none">
                        <TableQr url={url} size={96} />
                      </View>
                    ) : (
                      <View
                        style={[styles.qrBig, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}
                      >
                        <TableQr url={url} size={220} />
                        <Text style={[styles.qrLabel, { color: colors.textPrimary }]}>
                          {t('tournament.scanToRecord')}
                        </Text>
                      </View>
                    )
                  ) : null}
                </View>
              );
            })}
          </View>
          <View style={styles.bottom}>
            <Leaderboard state={data} size="tv" />
          </View>
        </>
      ) : (
        <View style={styles.waiting}>
          <Text style={[bigText, { fontWeight: '700', marginBottom: Spacing.md }]}>
            {t('tournament.waitingTour', { n: 1 })}
          </Text>
          <View style={styles.names}>
            {data.participants.map((p) => (
              <Text key={p.id} style={[bigText, styles.nameChip, { borderColor: colors.glassLight }]}>
                {p.display_name}
              </Text>
            ))}
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, padding: Spacing.md, overflow: 'hidden' as any },
  center: { alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.sm },
  title: { fontSize: 32, fontWeight: '800', flexShrink: 1 },
  badge: { fontSize: 18, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 8, paddingVertical: 2 },
  tables: { flex: 7, flexDirection: 'row', gap: Spacing.md },
  column: { flex: 1, minWidth: 0, justifyContent: 'center' },
  qrSmall: { position: 'absolute', top: 0, right: 0 },
  qrBig: {
    position: 'absolute',
    alignSelf: 'center',
    alignItems: 'center',
    top: '20%' as any,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  qrLabel: { fontSize: 22, fontWeight: '600', marginTop: Spacing.sm },
  bottom: { flex: 3, marginTop: Spacing.md },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  names: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, justifyContent: 'center' },
  nameChip: { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 6 },
});
