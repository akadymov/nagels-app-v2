import React, { useEffect, useState } from 'react';
import { View, Text, Modal, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { Spacing, Radius } from '../constants';
import { gameClient } from '../lib/gameClient';

type SettlementRow = { user_id: string; display_name: string; score: number; delta: number };

export interface RatingSettlementModalProps {
  visible: boolean;
  roomId: string | null;
  onClose: () => void;
  onPlayAgain?: () => void;
  showPlayAgain?: boolean;
}

export const RatingSettlementModal: React.FC<RatingSettlementModalProps> = ({
  visible, roomId, onClose, onPlayAgain, showPlayAgain,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [data, setData] = useState<{
    old_balance: number;
    new_balance: number;
    rows: SettlementRow[];
  } | null>(null);

  useEffect(() => {
    if (!visible || !roomId) return;
    let cancelled = false;
    (async () => {
      const result = await gameClient.getRatingSettlement(roomId).catch(() => null);
      if (!cancelled) setData(result);
    })();
    return () => { cancelled = true; };
  }, [visible, roomId]);

  if (!visible || !data) return null;
  const delta = data.new_balance - data.old_balance;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.title, { color: colors.accent }]} testID="settlement-title">
            {t('stakes.settlementTitle')}
          </Text>
          <View style={styles.balanceRow}>
            <Text style={[styles.balanceLabel, { color: colors.textMuted }]}>{data.old_balance}</Text>
            <Text style={[styles.balanceDelta, { color: delta > 0 ? colors.success : delta < 0 ? colors.error : colors.textMuted }]}>
              {delta > 0 ? `+${delta}` : String(delta)}
            </Text>
            <Text style={[styles.balanceNew, { color: colors.textPrimary }]}>
              {t('stakes.newBalance', { n: data.new_balance })}
            </Text>
          </View>
          <ScrollView style={styles.list}>
            {data.rows.map((r) => (
              <View key={r.user_id} style={[styles.row, { borderColor: colors.glassLight }]}>
                <Text style={[styles.rowName, { color: colors.textPrimary }]} numberOfLines={1}>{r.display_name}</Text>
                <Text style={[styles.rowScore, { color: colors.textMuted }]}>{r.score}</Text>
                <Text style={[styles.rowDelta, { color: r.delta > 0 ? colors.success : r.delta < 0 ? colors.error : colors.textMuted }]}>
                  {r.delta > 0 ? `+${r.delta}` : String(r.delta)}
                </Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.actions}>
            {showPlayAgain && onPlayAgain && (
              <Pressable
                onPress={onPlayAgain}
                style={[styles.btn, { backgroundColor: colors.accent }]}
                testID="settlement-play-again"
              >
                <Text style={[styles.btnText, { color: '#ffffff' }]}>
                  {t('scoreboard.playAgain')}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={onClose}
              style={[styles.btn, { backgroundColor: 'transparent', borderColor: colors.glassLight, borderWidth: 1 }]}
              testID="settlement-close"
            >
              <Text style={[styles.btnText, { color: colors.textPrimary }]}>{t('common.close', 'Close')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: Spacing.lg },
  sheet: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.lg, maxHeight: '80%' },
  title: { fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: Spacing.md },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginBottom: Spacing.md },
  balanceLabel: { fontSize: 16 },
  balanceDelta: { fontSize: 22, fontWeight: '800' },
  balanceNew: { fontSize: 16, fontWeight: '700' },
  list: { maxHeight: 240, marginBottom: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 8, borderBottomWidth: 1 },
  rowName: { flex: 1, fontSize: 14, fontWeight: '600' },
  rowScore: { fontSize: 13, width: 50, textAlign: 'right', marginRight: Spacing.sm },
  rowDelta: { fontSize: 14, fontWeight: '700', width: 60, textAlign: 'right' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
  btn: { paddingHorizontal: Spacing.lg, paddingVertical: 10, borderRadius: Radius.md, alignItems: 'center' },
  btnText: { fontWeight: '700' },
});
