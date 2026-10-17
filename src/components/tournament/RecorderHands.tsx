/**
 * Recorder: list of this game's scored hands with an editor to correct a
 * hand's bets / tricks after the fact. Same rules as live play (tricks sum
 * to cards, bets don't); the server rescores and the balance follows.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';
import { gameClient } from '../../lib/gameClient';
import { suitGlyph, type TrumpSuit } from '../../lib/offline/handBriefing';
import {
  editableHands, handScore, validateHandEdit,
  type EditableHand, type HandEditEntry,
} from '../../lib/tournament/recorder';
import type { RoomSnapshot } from '../../../supabase/functions/_shared/types.ts';

interface Props { state: RoomSnapshot; onDone: () => void }

const Stepper: React.FC<{
  id: string; value: number; max: number; disabled: boolean;
  onChange: (v: number) => void; colors: any;
}> = ({ id, value, max, disabled, onChange, colors }) => (
  <View style={styles.stepper}>
    <TouchableOpacity
      testID={`${id}-dec`} disabled={disabled} onPress={() => onChange(Math.max(0, value - 1))}
      style={[styles.step, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}
    >
      <Text style={[styles.stepText, { color: colors.textPrimary }]}>−</Text>
    </TouchableOpacity>
    <Text testID={id} style={[styles.value, { color: colors.textPrimary }]}>{value}</Text>
    <TouchableOpacity
      testID={`${id}-inc`} disabled={disabled} onPress={() => onChange(Math.min(max, value + 1))}
      style={[styles.step, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}
    >
      <Text style={[styles.stepText, { color: colors.textPrimary }]}>+</Text>
    </TouchableOpacity>
  </View>
);

export const RecorderHands: React.FC<Props> = ({ state, onDone }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [editing, setEditing] = useState<EditableHand | null>(null);
  const [draft, setDraft] = useState<HandEditEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hands = editableHands(state);
  const room = state.room;

  const trumpLabel = (trump: string) =>
    trump === 'notrump' ? t('tournament.noTrump') : suitGlyph(trump as TrumpSuit);

  const open = (h: EditableHand) => {
    setEditing(h);
    setDraft(h.rows.map((r) => ({ seat: r.seat, bet: r.bet, taken: r.taken })));
    setErr(null);
  };

  if (!editing || !room) {
    return (
      <View testID="recorder-hands" style={styles.wrap}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t('tournament.handsTitle')}</Text>
        {hands.length === 0 && (
          <Text style={{ color: colors.textSecondary, marginBottom: Spacing.md }}>{t('tournament.noHandsYet')}</Text>
        )}
        {hands.map((h) => (
          <TouchableOpacity
            key={h.hand_id}
            testID={`recorder-hand-${h.hand_number}`}
            onPress={() => open(h)}
            style={[styles.handRow, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}
          >
            <Text style={[styles.handHead, { color: colors.textPrimary }]}>
              {t('tournament.handShort', { n: h.hand_number })} · {t('tournament.cards', { count: h.cards })} · {trumpLabel(h.trump)}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 15 }} numberOfLines={2}>
              {h.rows.map((r) => `${r.name} ${r.bet}/${r.taken}`).join(' · ')}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity testID="recorder-hands-close" onPress={onDone} style={[styles.primary, { backgroundColor: colors.accent }]}>
          <Text style={styles.primaryText}>✕</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const cards = editing.cards;
  const problem = validateHandEdit(draft, cards);
  const set = (seat: number, key: 'bet' | 'taken', v: number) =>
    setDraft((d) => d.map((e) => (e.seat === seat ? { ...e, [key]: v } : e)));
  const sumTaken = draft.reduce((s, e) => s + e.taken, 0);
  const sumBet = draft.reduce((s, e) => s + e.bet, 0);

  const save = async () => {
    if (busy || problem) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await gameClient.editHand(room.id, editing.hand_id, draft);
      if (r.ok) setEditing(null);
      else setErr(r.error ?? 'generic');
    } catch (e: any) {
      setErr(e?.message ?? 'generic');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View testID="recorder-hand-editor" style={styles.wrap}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>
        {t('tournament.editHand', { n: editing.hand_number })} · {t('tournament.cards', { count: cards })} · {trumpLabel(editing.trump)}
      </Text>
      <View style={styles.headRow}>
        <Text style={[styles.name, { color: colors.textSecondary }]} />
        <Text style={[styles.colHead, { color: colors.textSecondary }]}>{t('tournament.colBet')}</Text>
        <Text style={[styles.colHead, { color: colors.textSecondary }]}>{t('tournament.colTaken')}</Text>
        <Text style={[styles.scoreHead, { color: colors.textSecondary }]}>{t('tournament.colHand')}</Text>
      </View>
      {editing.rows.map((r) => {
        const e = draft.find((x) => x.seat === r.seat)!;
        return (
          <View key={r.seat} style={styles.editRow}>
            <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>{r.name}</Text>
            <Stepper id={`recorder-edit-bet-${r.seat}`} value={e.bet} max={cards} disabled={busy}
              onChange={(v) => set(r.seat, 'bet', v)} colors={colors} />
            <Stepper id={`recorder-edit-taken-${r.seat}`} value={e.taken} max={cards} disabled={busy}
              onChange={(v) => set(r.seat, 'taken', v)} colors={colors} />
            <Text style={[styles.score, { color: colors.textPrimary }]}>{handScore(e.bet, e.taken)}</Text>
          </View>
        );
      })}
      <Text style={[styles.sum, { color: sumTaken === cards ? colors.textPrimary : colors.error }]}>
        {t('tournament.tricksSum', { sum: sumTaken, cards })}
      </Text>
      {problem && (
        <Text testID="recorder-edit-problem" style={{ color: colors.error, marginBottom: Spacing.sm }}>
          {t(`tournament.editErrors.${problem}`, { sum: sumBet, cards })}
        </Text>
      )}
      {err && (
        <Text style={{ color: colors.error, marginBottom: Spacing.sm }}>
          {t(`tournament.errors.${err}`, { defaultValue: t('tournament.errors.generic') })}
        </Text>
      )}
      <TouchableOpacity
        testID="recorder-edit-save"
        disabled={!!problem || busy}
        onPress={save}
        style={[styles.primary, { backgroundColor: colors.accent, opacity: problem || busy ? 0.4 : 1 }]}
      >
        <Text style={styles.primaryText}>{t('tournament.save')}</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="recorder-edit-cancel" disabled={busy} onPress={() => setEditing(null)} style={styles.cancel}>
        <Text style={{ color: colors.accent, fontSize: 16 }}>{t('common.cancel')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { padding: Spacing.md },
  title: { fontSize: 20, fontWeight: '700', marginBottom: Spacing.md },
  handRow: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.sm, minHeight: 56 },
  handHead: { fontSize: 17, fontWeight: '600', marginBottom: 4 },
  headRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.xs },
  editRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm },
  name: { flex: 1, fontSize: 16 },
  colHead: { width: 120, textAlign: 'center', fontSize: 13 },
  scoreHead: { width: 36, textAlign: 'right', fontSize: 13 },
  stepper: { width: 120, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  step: { width: 44, height: 44, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 22, fontWeight: '700' },
  value: { width: 28, textAlign: 'center', fontSize: 20, fontWeight: '700' },
  score: { width: 36, textAlign: 'right', fontSize: 18, fontWeight: '700' },
  sum: { fontSize: 17, fontWeight: '600', marginVertical: Spacing.sm },
  primary: { minHeight: 56, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  cancel: { marginTop: Spacing.sm, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
