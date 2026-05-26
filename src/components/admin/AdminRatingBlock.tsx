import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';
import { gameClient } from '../../lib/gameClient';
import { BrandSwitch } from '../BrandSwitch';

interface FoundUser { id: string; email: string | null; display_name: string | null; balance: number; can_announce: boolean }

export const AdminRatingBlock: React.FC = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [isAdmin, setIsAdmin] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<FoundUser[]>([]);
  const [confirmText, setConfirmText] = useState('');
  const [pendingTelegram, setPendingTelegram] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await gameClient.adminCheck().catch(() => ({ is_admin: false }));
      if (!cancelled) setIsAdmin(!!r.is_admin);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isAdmin || q.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    (async () => {
      const r = await gameClient.adminSearchUsers(q).catch(() => ({ rows: [] as FoundUser[] }));
      if (!cancelled) setResults((r as any).rows ?? []);
    })();
    return () => { cancelled = true; };
  }, [q, isAdmin]);

  if (!isAdmin) return null;

  const resetOne = async (u: FoundUser) => {
    if (u.balance === 0) return;
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`Reset ${u.email}'s rating ${u.balance} → 0?`)
      : true;
    if (!ok) return;
    await gameClient.adminResetRating(u.id);
    setResults((prev) => prev.map((x) => x.id === u.id ? { ...x, balance: 0 } : x));
  };

  const toggleTelegram = async (u: FoundUser, next: boolean) => {
    if (pendingTelegram.has(u.id)) return;
    setPendingTelegram((prev) => new Set(prev).add(u.id));
    setResults((prev) => prev.map((x) => x.id === u.id ? { ...x, can_announce: next } : x));
    try {
      const r = next
        ? await gameClient.adminGrantTelegram(u.id)
        : await gameClient.adminRevokeTelegram(u.id);
      if (!r.ok) throw new Error(r.error || 'unknown');
    } catch {
      setResults((prev) => prev.map((x) => x.id === u.id ? { ...x, can_announce: !next } : x));
      Alert.alert('Error', String(t('admin.toggleTelegramError', 'Could not update Telegram permission')));
    } finally {
      setPendingTelegram((prev) => {
        const next = new Set(prev);
        next.delete(u.id);
        return next;
      });
    }
  };

  const resetAll = async () => {
    if (confirmText !== 'RESET ALL') {
      Alert.alert('Confirm', 'Type RESET ALL to confirm');
      return;
    }
    const r = await gameClient.adminResetAllRatings();
    Alert.alert('Done', `Affected: ${(r as any).affected ?? 0}`);
    setConfirmText('');
  };

  return (
    <View style={[styles.block, { borderColor: colors.error, backgroundColor: colors.surface }]} testID="admin-rating-block">
      <Text style={[styles.title, { color: colors.error }]}>Admin · Reset ratings</Text>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search by email…"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, { color: colors.textPrimary, borderColor: colors.glassLight }]}
        testID="admin-search-input"
      />
      {results.map((u) => (
        <View key={u.id} style={[styles.row, { borderColor: colors.glassLight }]}>
          <Text style={[styles.rowText, { color: colors.textPrimary }]} numberOfLines={1}>{u.email}</Text>
          <Text style={[styles.rowText, { color: colors.textMuted }]}>{u.balance}</Text>
          <BrandSwitch
            value={u.can_announce}
            onValueChange={(v) => toggleTelegram(u, v)}
            disabled={pendingTelegram.has(u.id)}
            testID={`admin-allow-telegram-${u.id}`}
          />
          <Pressable
            onPress={() => resetOne(u)}
            disabled={u.balance === 0}
            style={[styles.btnSmall, { borderColor: colors.error, opacity: u.balance === 0 ? 0.4 : 1 }]}
            testID={`admin-reset-${u.id}`}
          >
            <Text style={{ color: colors.error, fontWeight: '700', fontSize: 13 }}>Reset</Text>
          </Pressable>
        </View>
      ))}
      <View style={{ height: Spacing.md }} />
      <Text style={{ color: colors.error, fontWeight: '600', marginBottom: 4 }}>
        Reset every user's rating (type RESET ALL to confirm):
      </Text>
      <TextInput
        value={confirmText}
        onChangeText={setConfirmText}
        placeholder="RESET ALL"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, { color: colors.textPrimary, borderColor: colors.error }]}
        testID="admin-reset-all-input"
      />
      <Pressable
        onPress={resetAll}
        disabled={confirmText !== 'RESET ALL'}
        style={[styles.btn, { backgroundColor: colors.error, opacity: confirmText === 'RESET ALL' ? 1 : 0.4 }]}
        testID="admin-reset-all-btn"
      >
        <Text style={{ color: '#ffffff', fontWeight: '700' }}>Reset all ratings</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  block: { borderWidth: 2, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.lg },
  title: { fontSize: 14, fontWeight: '800', marginBottom: Spacing.sm, textTransform: 'uppercase' },
  input: {
    borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, marginBottom: Spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1 },
  rowText: { fontSize: 13, flex: 1 },
  btnSmall: { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 10, paddingVertical: 4 },
  btn: { padding: 10, borderRadius: Radius.md, alignItems: 'center', marginTop: Spacing.sm },
});
