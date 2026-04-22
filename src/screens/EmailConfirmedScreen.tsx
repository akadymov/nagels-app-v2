/**
 * Nägels Online - Email Confirmed Screen
 * Shown after email confirmation, auto-redirects to Lobby.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../store/settingsStore';

export interface EmailConfirmedScreenProps {
  onContinue: () => void;
}

export const EmailConfirmedScreen: React.FC<EmailConfirmedScreenProps> = ({ onContinue }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const resetGamesPlayed = useSettingsStore((s) => s.resetGamesPlayed);

  useEffect(() => {
    // Reset the unconfirmed games counter
    resetGamesPlayed();
    // Auto-redirect after 3 seconds
    const timer = setTimeout(onContinue, 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <Text style={styles.emoji}>✅</Text>
        <Text style={[styles.title, { color: colors.accent }]}>
          {t('auth.emailConfirmed', 'Email confirmed!')}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t('auth.canPlay', 'Your account is ready. You can now play without limits.')}
        </Text>
        <Text style={[styles.redirect, { color: colors.textMuted }]}>
          {t('auth.redirecting', 'Redirecting to lobby...')}
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  emoji: {
    fontSize: 64,
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  redirect: {
    fontSize: 13,
    marginTop: Spacing.lg,
  },
});

export default EmailConfirmedScreen;
