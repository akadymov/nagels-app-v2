/**
 * Waiting room, scorekeeper host only: seat a player who has no phone.
 * The host records that seat's bets and tricks during the game.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';
import { gameClient } from '../../lib/gameClient';

export const AddOfflinePlayer: React.FC<{ roomId: string }> = ({ roomId }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (busy) return;
    if (!trimmed) { setErr('invalid_name'); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await gameClient.addOfflinePlayer(roomId, trimmed);
      if (r.ok) setName('');
      else setErr(r.error ?? 'generic');
    } catch {
      setErr('generic');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassLight }]} testID="add-offline-player">
      <Text style={[styles.title, { color: colors.textPrimary }]}>{t('scorekeeper.addOfflineTitle')}</Text>
      <Text style={[styles.hint, { color: colors.textMuted }]}>{t('scorekeeper.addOfflineHint')}</Text>
      <View style={styles.row}>
        <TextInput
          value={name}
          onChangeText={setName}
          onSubmitEditing={submit}
          placeholder={t('scorekeeper.addOfflinePlaceholder')}
          placeholderTextColor={colors.textMuted}
          maxLength={24}
          returnKeyType="done"
          style={[styles.input, { color: colors.textPrimary, borderColor: colors.glassLight }]}
          testID="input-offline-player"
        />
        <Pressable
          onPress={submit}
          disabled={busy}
          style={[styles.btn, { backgroundColor: colors.accent, opacity: busy ? 0.5 : 1 }]}
          testID="btn-add-offline-player"
        >
          <Text style={styles.btnText}>{t('scorekeeper.addOfflineBtn')}</Text>
        </Pressable>
      </View>
      {err && (
        <Text style={[styles.hint, { color: colors.error }]}>
          {t(`scorekeeper.addErrors.${err}`, { defaultValue: t('scorekeeper.addErrors.generic') })}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm, marginTop: Spacing.sm },
  title: { fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 12 },
  row: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.md, fontSize: 16 },
  btn: { minHeight: 44, paddingHorizontal: Spacing.md, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
