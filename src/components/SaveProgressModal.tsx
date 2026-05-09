import React, { useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { Spacing, Radius, TextStyles } from '../constants';
import { connectGoogle } from '../lib/supabase/authService';
import { markDismissed } from '../lib/auth/promptGate';

export type SaveProgressTrigger = 'afterGame' | 'beforeCreate';

export interface SaveProgressModalProps {
  visible: boolean;
  trigger: SaveProgressTrigger;
  onResolved: () => void;
  onUseEmail: () => void;
}

export const SaveProgressModal: React.FC<SaveProgressModalProps> = ({
  visible, trigger, onResolved, onUseEmail,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);

  const titleKey = trigger === 'afterGame'
    ? 'auth.savePromptAfterGameTitle'
    : 'auth.savePromptBeforeCreateTitle';
  const bodyKey = trigger === 'afterGame'
    ? 'auth.savePromptAfterGameBody'
    : 'auth.savePromptBeforeCreateBody';
  const dismissKey = trigger === 'afterGame' ? 'auth.maybeLater' : 'auth.continueAsGuest';

  const handleGoogle = async () => {
    setBusy(true);
    try {
      await markDismissed(trigger);
      await connectGoogle();
      onResolved();
    } catch {
      onResolved();
    } finally {
      setBusy(false);
    }
  };
  const handleEmail = async () => {
    await markDismissed(trigger);
    onUseEmail();
    onResolved();
  };
  const handleDismiss = async () => {
    await markDismissed(trigger);
    onResolved();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={handleDismiss}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={handleDismiss} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t(titleKey)}</Text>
          <ScrollView style={styles.body}>
            <Text style={[styles.bodyText, { color: colors.textSecondary }]}>{t(bodyKey)}</Text>
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              onPress={handleDismiss}
              style={[styles.secondaryBtn, { borderColor: colors.glassLight }]}
              testID="save-progress-dismiss"
            >
              <Text style={[styles.secondaryBtnText, { color: colors.textMuted }]}>{t(dismissKey)}</Text>
            </Pressable>
            <Pressable
              onPress={handleEmail}
              disabled={busy}
              style={[styles.secondaryBtn, { borderColor: colors.glassLight }]}
              testID="save-progress-email"
            >
              <Text style={[styles.secondaryBtnText, { color: colors.textPrimary }]}>{t('auth.useEmail')}</Text>
            </Pressable>
            <Pressable
              onPress={handleGoogle}
              disabled={busy}
              style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: busy ? 0.5 : 1 }]}
              testID="save-progress-google"
            >
              <Text style={styles.primaryBtnText}>{t('auth.continueWithGoogle')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: Spacing.lg },
  backdropTap: { ...StyleSheet.absoluteFillObject },
  sheet: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.lg, maxHeight: '85%' },
  title: { ...TextStyles.h3, marginBottom: Spacing.sm },
  body: { maxHeight: 220 },
  bodyText: { ...TextStyles.body, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg, justifyContent: 'flex-end', flexWrap: 'wrap' },
  primaryBtn: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderRadius: Radius.md, alignItems: 'center' },
  primaryBtnText: { color: '#ffffff', fontWeight: '700' },
  secondaryBtn: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center' },
  secondaryBtnText: { fontWeight: '600' },
});
