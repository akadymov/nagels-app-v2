// src/screens/TransferRatingModal.tsx
import React, { useState, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { useRatingStore } from '../store/ratingStore';
import { gameClient } from '../lib/gameClient';
import type { LookupRecipientResult } from '../lib/gameClient';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Step = 'form' | 'preview' | 'success';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function TransferRatingModal({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const balance = useRatingStore((s) => s.balance) ?? 0;
  const transfer = useRatingStore((s) => s.transfer);

  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState('');
  const [amountText, setAmountText] = useState('');
  const [recipient, setRecipient] = useState<
    Extract<LookupRecipientResult, { found: true; is_self: false }>['recipient'] | null
  >(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [sentAmount, setSentAmount] = useState(0);
  const [sentRecipientName, setSentRecipientName] = useState<string>('—');

  const amount = useMemo(() => {
    const n = parseInt(amountText, 10);
    return Number.isFinite(n) ? n : 0;
  }, [amountText]);

  const emailValid = EMAIL_RE.test(email.trim());
  const amountValid = amount >= 1 && amount <= balance;
  const canLookup = emailValid && amountValid && !busy;

  const reset = () => {
    setStep('form');
    setEmail('');
    setAmountText('');
    setRecipient(null);
    setLookupError(null);
    setConfirmError(null);
    setBusy(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const handleLookup = async () => {
    setLookupError(null);
    setBusy(true);
    try {
      const res = await gameClient.lookupRatingRecipient(email.trim());
      if (!res.found) {
        setLookupError(t('profile.transferRating.error.recipientNotFound'));
        return;
      }
      if ('is_self' in res && res.is_self) {
        setLookupError(t('profile.transferRating.error.selfTransfer'));
        return;
      }
      setRecipient(res.recipient);
      setStep('preview');
    } catch {
      setLookupError(t('profile.transferRating.error.unknown'));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    setConfirmError(null);
    setBusy(true);
    try {
      const res = await transfer(email.trim(), amount);
      if (res.ok) {
        setSentAmount(amount);
        setSentRecipientName(res.recipient.display_name ?? res.recipient.masked_email);
        setStep('success');
        return;
      }
      if (res.error === 'insufficient_balance' || res.error === 'recipient_not_found') {
        setConfirmError(
          t(
            res.error === 'insufficient_balance'
              ? 'profile.transferRating.error.insufficientBalance'
              : 'profile.transferRating.error.recipientNotFound',
          ),
        );
        setStep('form');
        return;
      }
      setConfirmError(t('profile.transferRating.error.unknown'));
    } catch {
      setConfirmError(t('profile.transferRating.error.unknown'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          {step === 'form' && (
            <>
              <Text style={[styles.title, { color: colors.textPrimary }]}>
                {t('profile.transferRating.modal.title')}
              </Text>
              <Text style={[styles.balance, { color: colors.textSecondary }]}>
                {t('profile.transferRating.modal.balance', { n: balance })}
              </Text>

              <Text style={[styles.label, { color: colors.textSecondary }]}>
                {t('profile.transferRating.modal.emailLabel')}
              </Text>
              <TextInput
                testID="input-recipient-email"
                value={email}
                onChangeText={(v) => { setEmail(v); setLookupError(null); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { color: colors.textPrimary, borderColor: colors.glassLight, backgroundColor: colors.surfaceSecondary }]}
                placeholder="player@example.com"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={[styles.label, { color: colors.textSecondary }]}>
                {t('profile.transferRating.modal.amountLabel')}
              </Text>
              <TextInput
                testID="input-transfer-amount"
                value={amountText}
                onChangeText={(v) => setAmountText(v.replace(/[^0-9]/g, ''))}
                keyboardType="numeric"
                style={[styles.input, { color: colors.textPrimary, borderColor: colors.glassLight, backgroundColor: colors.surfaceSecondary }]}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
              />
              {amount > balance && (
                <Text style={[styles.errorText, { color: colors.error }]}>
                  {t('profile.transferRating.modal.amountTooHigh', { max: balance })}
                </Text>
              )}
              {lookupError && (
                <Text style={[styles.errorText, { color: colors.error }]}>{lookupError}</Text>
              )}
              {confirmError && (
                <Text style={[styles.errorText, { color: colors.error }]}>{confirmError}</Text>
              )}

              <View style={styles.row}>
                <Pressable
                  onPress={close}
                  style={[styles.btnSecondary, { borderColor: colors.glassLight }]}
                >
                  <Text style={{ color: colors.textPrimary }}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable
                  testID="btn-lookup-recipient"
                  onPress={handleLookup}
                  disabled={!canLookup}
                  style={[styles.btnPrimary, { backgroundColor: canLookup ? colors.accent : colors.surfaceSecondary }]}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.textPrimary} />
                  ) : (
                    <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
                      {t('profile.transferRating.modal.lookup')}
                    </Text>
                  )}
                </Pressable>
              </View>
            </>
          )}

          {step === 'preview' && recipient && (
            <>
              <Text style={[styles.title, { color: colors.textPrimary }]}>
                {t('profile.transferRating.preview.title')}
              </Text>

              <View style={styles.recipientRow}>
                <View style={[styles.avatar, { backgroundColor: recipient.avatar_color ?? colors.surfaceSecondary }]}>
                  <Text style={{ color: colors.textPrimary, fontSize: 18 }}>
                    {recipient.avatar ?? (recipient.display_name?.[0] ?? '?').toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.recipientName, { color: colors.textPrimary }]}>
                    {recipient.display_name ?? recipient.masked_email}
                  </Text>
                  {recipient.display_name && (
                    <Text style={[styles.recipientEmail, { color: colors.textSecondary }]}>
                      {recipient.masked_email}
                    </Text>
                  )}
                </View>
              </View>

              <Text style={[styles.previewLine, { color: colors.textPrimary }]}>
                {t('profile.transferRating.preview.youSend', { amount })}
              </Text>
              <Text style={[styles.previewLine, { color: colors.textSecondary }]}>
                {t('profile.transferRating.preview.willRemain', { balance: balance - amount })}
              </Text>

              <View style={styles.row}>
                <Pressable
                  testID="btn-transfer-back"
                  onPress={() => setStep('form')}
                  style={[styles.btnSecondary, { borderColor: colors.glassLight }]}
                >
                  <Text style={{ color: colors.textPrimary }}>
                    {t('profile.transferRating.preview.back')}
                  </Text>
                </Pressable>
                <Pressable
                  testID="btn-transfer-confirm"
                  onPress={handleConfirm}
                  disabled={busy}
                  style={[styles.btnPrimary, { backgroundColor: colors.accent }]}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.textPrimary} />
                  ) : (
                    <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
                      {t('profile.transferRating.preview.confirm', { amount })}
                    </Text>
                  )}
                </Pressable>
              </View>
            </>
          )}

          {step === 'success' && (
            <>
              <Text style={[styles.title, { color: colors.textPrimary }]}>
                {t('profile.transferRating.success.title')}
              </Text>
              <Text style={[styles.successMessage, { color: colors.textPrimary }]}>
                {t('profile.transferRating.success.message', { amount: sentAmount, recipient: sentRecipientName })}
              </Text>
              <Text style={[styles.balance, { color: colors.textSecondary }]}>
                {t('profile.transferRating.modal.balance', { n: balance })}
              </Text>
              <Pressable
                testID="btn-transfer-done"
                onPress={close}
                style={[styles.btnPrimaryFull, { backgroundColor: colors.accent }]}
              >
                <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
                  {t('profile.transferRating.success.close')}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 20 },
  card:        { borderRadius: 16, borderWidth: 1, padding: 20, gap: 12 },
  title:       { fontSize: 18, fontWeight: '700' },
  balance:     { fontSize: 14 },
  label:       { fontSize: 13, marginTop: 4 },
  input:       { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  errorText:   { fontSize: 13, marginTop: -4 },
  row:         { flexDirection: 'row', gap: 12, marginTop: 8 },
  btnPrimary:  { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  btnPrimaryFull: { paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  btnSecondary:{ flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1 },
  recipientRow:{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 8 },
  avatar:      { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  recipientName: { fontSize: 16, fontWeight: '600' },
  recipientEmail: { fontSize: 13 },
  previewLine: { fontSize: 15 },
  successMessage: { fontSize: 15, marginVertical: 4 },
});
