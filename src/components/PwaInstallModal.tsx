import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { Spacing, Radius, TextStyles } from '../constants';
import {
  hasDeferredPrompt,
  triggerInstall,
  isStandalone,
  isIOS,
  isInAppBrowser,
} from '../lib/pwaInstall';

export interface PwaInstallModalProps {
  visible: boolean;
  onClose: () => void;
}

export const PwaInstallModal: React.FC<PwaInstallModalProps> = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [installing, setInstalling] = useState(false);

  const installed = isStandalone();
  const ios = isIOS();
  const canPrompt = hasDeferredPrompt();
  const inApp = isInAppBrowser();

  useEffect(() => {
    if (!visible) setInstalling(false);
  }, [visible]);

  const onInstallTap = async () => {
    setInstalling(true);
    const outcome = await triggerInstall();
    setInstalling(false);
    if (outcome === 'accepted' || outcome === 'unavailable') onClose();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{t('pwa.title')}</Text>
            <Pressable onPress={onClose} hitSlop={12} testID="pwa-close">
              <Text style={[styles.closeX, { color: colors.textMuted }]}>✕</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {installed ? (
              <Text style={[styles.subtitle, { color: colors.textPrimary }]}>{t('pwa.alreadyInstalled')}</Text>
            ) : (
              <>
                <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('pwa.subtitle')}</Text>
                {ios ? (
                  <Text style={[styles.bodyText, { color: colors.textPrimary }]}>{t('pwa.iosBody')}</Text>
                ) : (
                  <Text style={[styles.bodyText, { color: colors.textPrimary }]}>{t('pwa.androidBody')}</Text>
                )}
                {inApp && (
                  <Text style={[styles.hint, { color: colors.textMuted }]}>{t('pwa.inAppHint')}</Text>
                )}
              </>
            )}
          </ScrollView>
          <View style={styles.actions}>
            {installed ? (
              <Pressable
                onPress={onClose}
                style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                testID="pwa-done"
              >
                <Text style={styles.primaryBtnText}>{t('pwa.doneBtn')}</Text>
              </Pressable>
            ) : ios || !canPrompt ? (
              <Pressable
                onPress={onClose}
                style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                testID="pwa-done"
              >
                <Text style={styles.primaryBtnText}>{t('pwa.doneBtn')}</Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  onPress={onClose}
                  style={[styles.secondaryBtn, { borderColor: colors.glassLight }]}
                  testID="pwa-not-now"
                >
                  <Text style={[styles.secondaryBtnText, { color: colors.textMuted }]}>{t('pwa.notNowBtn')}</Text>
                </Pressable>
                <Pressable
                  onPress={onInstallTap}
                  disabled={installing}
                  style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: installing ? 0.5 : 1 }]}
                  testID="pwa-install"
                >
                  <Text style={styles.primaryBtnText}>{t('pwa.installBtn')}</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: Spacing.lg },
  backdropTap: { ...StyleSheet.absoluteFillObject },
  sheet: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    maxHeight: '80%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.md, gap: Spacing.md },
  title: { ...TextStyles.h3, flex: 1 },
  closeX: { fontSize: 22, fontWeight: '700' },
  body: { maxHeight: 320 },
  bodyContent: { gap: Spacing.sm },
  subtitle: { ...TextStyles.body, lineHeight: 22 },
  bodyText: { ...TextStyles.body, lineHeight: 24 },
  hint: { ...TextStyles.caption, marginTop: Spacing.sm, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.lg, justifyContent: 'flex-end' },
  primaryBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    minWidth: 96,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#ffffff', fontWeight: '700' },
  secondaryBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    minWidth: 96,
    alignItems: 'center',
  },
  secondaryBtnText: { fontWeight: '600' },
});
