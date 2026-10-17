/**
 * Recorder bet pad: one big-button grid, the bettor is whoever's turn it is.
 * Buttons are 56px+ squares for one-thumb use. Single in-flight guard.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';
import { gameClient } from '../../lib/gameClient';
import { forbiddenBet } from '../../lib/tournament/recorder';
import type { RoomSnapshot } from '../../../supabase/functions/_shared/types.ts';

interface Props { state: RoomSnapshot }

export const RecorderBetPad: React.FC<Props> = ({ state }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const room = state.room;
  const hand = state.current_hand;
  if (!room || !hand) return null;

  const bidder = state.players.find((p) => p.seat_index === hand.current_seat);
  const forbidden = forbiddenBet(state);
  const nums = Array.from({ length: hand.cards_per_player + 1 }, (_, i) => i);

  const run = async (fn: () => Promise<any>, quiet: string[] = []) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fn();
      if (!r.ok && !quiet.includes(r.error)) setErr(r.error);
    } catch (e: any) {
      setErr(e?.message ?? 'generic');
    } finally {
      setBusy(false);
    }
  };

  const onBet = (n: number) =>
    run(() => gameClient.placeBetFor(room.id, hand.id, hand.current_seat, n), ['not_your_turn', 'already_bet']);
  const onUndo = () => run(() => gameClient.undoBet(room.id, hand.id), ['nothing_to_undo']);

  return (
    <View style={styles.wrap}>
      <Text testID="recorder-bidder" style={[styles.title, { color: colors.textPrimary }]}>
        {t('tournament.betsTurn', { name: bidder?.display_name ?? '' })}
      </Text>
      <View style={styles.grid}>
        {nums.map((n) => {
          const off = busy || n === forbidden;
          return (
            <TouchableOpacity
              key={n}
              testID={`recorder-bet-${n}`}
              disabled={off}
              onPress={() => onBet(n)}
              style={[
                styles.btn,
                { backgroundColor: colors.accent, opacity: off ? 0.3 : 1 },
              ]}
            >
              <Text style={styles.btnText}>{n}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {forbidden !== null && (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          {t('tournament.forbidden', { n: forbidden })}
        </Text>
      )}
      {err && (
        <Text style={[styles.hint, { color: colors.error }]}>
          {t(`tournament.errors.${err}`, { defaultValue: t('tournament.errors.generic') })}
        </Text>
      )}
      {state.hand_scores.length > 0 && (
        <TouchableOpacity testID="recorder-undo" disabled={busy} onPress={onUndo} style={[styles.undo, { opacity: busy ? 0.4 : 1 }]}>
          <Text style={{ color: colors.accent, fontSize: 16 }}>{t('tournament.undo')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { padding: Spacing.md },
  title: { fontSize: 20, fontWeight: '700', marginBottom: Spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  btn: { width: 64, height: 64, minWidth: 56, minHeight: 56, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontSize: 24, fontWeight: '700' },
  hint: { marginTop: Spacing.sm, fontSize: 14 },
  undo: { marginTop: Spacing.md, minHeight: 48, justifyContent: 'center' },
});
