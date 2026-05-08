import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { Spacing, Radius, TextStyles } from '../constants';
import {
  useHasDeferredPrompt,
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
  const [linkCopied, setLinkCopied] = useState(false);

  const installed = isStandalone();
  const ios = isIOS();
  const canPrompt = useHasDeferredPrompt();
  const inApp = isInAppBrowser();

  useEffect(() => {
    if (!visible) {
      setInstalling(false);
      setLinkCopied(false);
    }
  }, [visible]);

  const onInstallTap = async () => {
    setInstalling(true);
    const outcome = await triggerInstall();
    setInstalling(false);
    if (outcome === 'accepted' || outcome === 'unavailable') onClose();
  };

  const onCopyLinkTap = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Some in-app browsers block clipboard. Best effort — silently fail.
    }
  };

  // Decide which body copy + which CTA to show. Three install paths exist:
  //   - Native install dialog via Chromium's beforeinstallprompt (canPrompt)
  //   - iOS Safari manual flow (Share → Add to Home Screen)
  //   - Browser-menu manual flow on Android when prompt didn't fire
  // Plus an in-app browser case where install is impossible — we offer
  // "copy link" so the user can paste in Safari/Chrome.
  const hasNativePrompt = !installed && canPrompt && !ios;
  const showCopyLink = !installed && inApp;

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
                ) : hasNativePrompt ? (
                  <Text style={[styles.bodyText, { color: colors.textPrimary }]}>{t('pwa.androidBody')}</Text>
                ) : (
                  <Text style={[styles.bodyText, { color: colors.textPrimary }]}>{t('pwa.androidNoPromptBody')}</Text>
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
            ) : hasNativePrompt ? (
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
            ) : (
              <>
                {showCopyLink && (
                  <Pressable
                    onPress={onCopyLinkTap}
                    style={[styles.secondaryBtn, { borderColor: colors.glassLight }]}
                    testID="pwa-copy-link"
                  >
                    <Text style={[styles.secondaryBtnText, { color: colors.textPrimary }]}>
                      {linkCopied ? t('pwa.linkCopied') : t('pwa.copyLink')}
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={onClose}
                  style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                  testID="pwa-done"
                >
                  <Text style={styles.primaryBtnText}>{t('pwa.doneBtn')}</Text>
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
