/**
 * One-shot contextual onboarding tip.
 *
 * Each tip appears once per user; once dismissed via "Got it", the
 * settingsStore.shownTips[name] flag is flipped and the tip never shows
 * again. Use `resetShownTips()` from settingsStore to re-trigger them
 * (handy for support / a future "Help" menu).
 *
 * Usage (in any screen):
 *   const shown = useSettingsStore((s) => s.shownTips.bidding);
 *   if (!shown && conditionsMet) <OnboardingTip name="bidding" titleKey="..." bodyKey="..." />
 */

import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { Spacing, Radius } from '../constants';
import { useSettingsStore, type OnboardingTipName } from '../store/settingsStore';

export interface OnboardingTipProps {
  name: OnboardingTipName;
  titleKey: string;
  bodyKey: string;
  /** Optional: extra delay before showing — lets the underlying screen settle. */
  delayMs?: number;
}

export const OnboardingTip: React.FC<OnboardingTipProps> = ({
  name,
  titleKey,
  bodyKey,
  delayMs = 400,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const alreadyShown = useSettingsStore((s) => s.shownTips[name]);
  const markTipShown = useSettingsStore((s) => s.markTipShown);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (alreadyShown) return;
    const t = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(t);
  }, [alreadyShown, delayMs]);

  const handleDismiss = () => {
    setVisible(false);
    markTipShown(name);
  };

  if (alreadyShown || !visible) return null;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={handleDismiss}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
          <Text style={[styles.title, { color: colors.accent }]}>
            {t(titleKey)}
          </Text>
          <Text style={[styles.body, { color: colors.textPrimary }]}>
            {t(bodyKey)}
          </Text>
          <Pressable
            onPress={handleDismiss}
            style={[styles.button, { backgroundColor: colors.accent }]}
            testID={`onboarding-tip-${name}-got-it`}
          >
            <Text style={styles.buttonText}>{t('onboarding.gotIt', 'Got it')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: Radius.lg,
    borderWidth: 2,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  button: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.full,
    alignSelf: 'center',
    minWidth: 140,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
