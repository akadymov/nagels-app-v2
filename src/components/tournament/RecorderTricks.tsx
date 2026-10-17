/**
 * Recorder tricks entry: steppers for every seat at once, saved in one go.
 * The server overwrites taken_tricks per seat, so a failed save can be retried.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';
import { gameClient } from '../../lib/gameClient';
import { canSubmitTricks, tricksSum } from '../../lib/tournament/recorder';
import type { RoomSnapshot } from '../../../supabase/functions/_shared/types.ts';

interface Props { state: RoomSnapshot }

export const RecorderTricks: React.FC<Props> = ({ state }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const room = state.room;
  const hand = state.current_hand;
  const players = [...state.players].sort((a, b) => a.seat_index - b.seat_index);
  const [draft, setDraft] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const handId = hand?.id;

  useEffect(() => {
    const d: Record<number, number> = {};
    for (const p of state.players) d[p.seat_index] = 0;
    setDraft(d);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handId]);

  if (!room || !hand) return null;
  const cards = hand.cards_per_player;
  const sum = tricksSum(draft);
  const ok = canSubmitTricks(draft, players.length, cards);
  const betOf = (sid: string) => state.hand_scores.find((s) => s.session_id === sid)?.bet;

  const step = (seat: number, delta: number) =>
    setDraft((d) => ({ ...d, [seat]: Math.min(cards, Math.max(0, (d[seat] ?? 0) + delta)) }));

  const submit = async () => {
    if (busy || !ok) return;
    setBusy(true);
    setErr(null);
    try {
      for (const p of players) {
        const r = await gameClient.recordTricksFor(room.id, hand.id, p.seat_index, draft[p.seat_index]);
        if (!r.ok) { setErr(r.error); break; }
      }
    } catch (e: any) {
      setErr(e?.message ?? 'generic');
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await gameClient.undoBet(room.id, hand.id);
      if (!r.ok) setErr(r.error);
    } catch (e: any) {
      setErr(e?.message ?? 'generic');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{t('tournament.tricksTitle')}</Text>
      {players.map((p) => (
        <View key={p.seat_index} style={styles.row}>
          <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>
            {p.display_name} ({betOf(p.session_id) ?? '—'})
          </Text>
          <TouchableOpacity
            testID={`recorder-tricks-dec-${p.seat_index}`}
            disabled={busy}
            onPress={() => step(p.seat_index, -1)}
            style={[styles.step, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}
          >
            <Text style={[styles.stepText, { color: colors.textPrimary }]}>−</Text>
          </TouchableOpacity>
          <Text testID={`recorder-tricks-value-${p.seat_index}`} style={[styles.value, { color: colors.textPrimary }]}>
            {draft[p.seat_index] ?? 0}
          </Text>
          <TouchableOpacity
            testID={`recorder-tricks-inc-${p.seat_index}`}
            disabled={busy}
            onPress={() => step(p.seat_index, 1)}
            style={[styles.step, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}
          >
            <Text style={[styles.stepText, { color: colors.textPrimary }]}>+</Text>
          </TouchableOpacity>
        </View>
      ))}
      <Text
        testID="recorder-tricks-sum"
        style={[styles.sum, { color: sum === cards ? colors.textPrimary : colors.error }]}
      >
        {t('tournament.tricksSum', { sum, cards })}
      </Text>
      {err && (
        <Text style={{ color: colors.error, marginBottom: Spacing.sm }}>
          {t(`tournament.errors.${err}`, { defaultValue: t('tournament.errors.generic') })}
        </Text>
      )}
      <TouchableOpacity
        testID="recorder-tricks-submit"
        disabled={!ok || busy}
        onPress={submit}
        style={[styles.submit, { backgroundColor: colors.accent, opacity: !ok || busy ? 0.4 : 1 }]}
      >
        <Text style={styles.submitText}>{t('tournament.submitTricks')}</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="recorder-tricks-undo" disabled={busy} onPress={undo} style={styles.undo}>
        <Text style={{ color: colors.accent, fontSize: 16 }}>{t('tournament.undo')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { padding: Spacing.md },
  title: { fontSize: 20, fontWeight: '700', marginBottom: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm },
  name: { flex: 1, fontSize: 18 },
  step: { width: 56, height: 56, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 28, fontWeight: '700' },
  value: { width: 44, textAlign: 'center', fontSize: 24, fontWeight: '700' },
  sum: { fontSize: 18, fontWeight: '600', marginVertical: Spacing.sm },
  submit: { minHeight: 56, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  undo: { marginTop: Spacing.md, minHeight: 48, justifyContent: 'center' },
});
