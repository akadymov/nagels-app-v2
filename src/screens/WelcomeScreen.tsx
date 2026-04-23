/**
 * Nägels Online - Welcome Screen
 * Logo, Learn to Play, Play as Guest, Sign In
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Pressable,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing, Radius } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { useAuthStore } from '../store/authStore';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n/config';

const { width: SW, height: SH } = Dimensions.get('window');

export interface WelcomeScreenProps {
  onQuickStart: () => void;
  onAlreadyPlay?: () => void;
  onSignIn?: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onQuickStart,
  onAlreadyPlay,
  onSignIn,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { user, isGuest } = useAuthStore();
  const isLoggedIn = user && !isGuest && user.email;

  // Show confirmation banner if user just confirmed email
  const [showConfirmBanner, setShowConfirmBanner] = useState(false);
  useEffect(() => {
    if (isLoggedIn && user?.email_confirmed_at) {
      const confirmedAt = new Date(user.email_confirmed_at).getTime();
      const isRecent = (Date.now() - confirmedAt) < 120000; // 2 minutes
      if (isRecent) {
        setShowConfirmBanner(true);
        const { useSettingsStore } = require('../store/settingsStore');
        useSettingsStore.getState().resetGamesPlayed();
        setTimeout(() => setShowConfirmBanner(false), 5000);
      }
    }
  }, [isLoggedIn, user]);

  const fadeIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 800, useNativeDriver: true }).start();
  }, []);

  const currentLang = i18n.language;
  const handleLang = (lang: string) => i18n.changeLanguage(lang);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <Animated.View style={[styles.content, { opacity: fadeIn }]}>

        {/* Email confirmed banner */}
        {showConfirmBanner && (
          <View style={[styles.confirmBanner, { backgroundColor: colors.success + '20', borderColor: colors.success }]}>
            <Text style={[styles.confirmBannerText, { color: colors.success }]}>
              ✅ {t('auth.emailConfirmed', 'Email confirmed! You can now play without limits.')}
            </Text>
          </View>
        )}

        {/* Akula logo */}
        <View style={[styles.logoCircle, { backgroundColor: colors.accent }]}>
          <Text style={styles.logoEmoji}>🦈</Text>
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: colors.accent }]}>Nägels Online</Text>
        <Text style={[styles.tagline, { color: colors.textMuted }]}>
          {t('welcome.tagline')}
        </Text>

        {/* Suit symbols — faded but colored */}
        <View style={styles.suitsRow}>
          <Text style={[styles.suitChar, { color: '#888888' }]}>♠</Text>
          <Text style={[styles.suitChar, { color: '#E8A0A0' }]}>♥</Text>
          <Text style={[styles.suitChar, { color: '#A0C8F0' }]}>♦</Text>
          <Text style={[styles.suitChar, { color: '#90C8A0' }]}>♣</Text>
        </View>

        <View style={{ height: Spacing.xl }} />

        {/* Learn to Play (primary) */}
        <Pressable
          style={[styles.btnPrimary, { backgroundColor: colors.accent }]}
          onPress={onQuickStart}
          testID="btn-learn-to-play"
        >
          <Text style={styles.btnPrimaryText}>{t('welcome.quickStart')}</Text>
        </Pressable>

        {/* Play as Guest / Continue */}
        <Pressable
          style={[styles.btnSecondary, { backgroundColor: colors.surface, borderColor: colors.accent }]}
          onPress={onAlreadyPlay}
          testID="btn-skip-to-lobby"
        >
          <Text style={[styles.btnSecondaryText, { color: colors.accent }]}>
            {isLoggedIn ? t('lobby.continueToLobby', 'Continue to Lobby') : t('welcome.alreadyPlay', 'Skip to Menu')}
          </Text>
        </Pressable>

        {/* Sign In / Register — hidden when logged in */}
        {!isLoggedIn && (
          <Pressable
            style={[styles.btnSecondary, { backgroundColor: colors.surface, borderColor: colors.accent }]}
            onPress={onSignIn || onAlreadyPlay}
          >
            <Text style={[styles.btnSecondaryText, { color: colors.accent }]}>
              {t('auth.signIn')} / {t('auth.signUp', 'Register')}
            </Text>
          </Pressable>
        )}

        {/* Language switcher */}
        <View style={[styles.langRow, { backgroundColor: colors.surface }]}>
          {['en', 'ru', 'es'].map((lang) => (
            <Pressable
              key={lang}
              style={[
                styles.langPill,
                { backgroundColor: currentLang === lang ? colors.accent : colors.surfaceSecondary },
              ]}
              onPress={() => handleLang(lang)}
            >
              <Text style={[
                styles.langText,
                { color: currentLang === lang ? '#ffffff' : colors.textMuted },
              ]}>
                {lang.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Credit */}
        <Text style={[styles.credit, { color: colors.textMuted }]}>Made by Akula 🦈</Text>
      </Animated.View>
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
    paddingHorizontal: Spacing.xl,
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  logoEmoji: {
    fontSize: 48,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: Spacing.xs,
  },
  tagline: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: Spacing.sm,
  },
  suitsRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
    marginBottom: Spacing.md,
  },
  suitChar: {
    fontSize: 22,
  },
  btnPrimary: {
    width: Math.min(SW - 64, 340),
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  btnPrimaryText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  btnSecondary: {
    width: Math.min(SW - 64, 340),
    height: 52,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  btnSecondaryText: {
    fontSize: 16,
    fontWeight: '600',
  },
  langRow: {
    flexDirection: 'row',
    borderRadius: 22,
    padding: 4,
    gap: Spacing.xs,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  langPill: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 18,
  },
  langText: {
    fontSize: 13,
    fontWeight: '600',
  },
  confirmBanner: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    width: Math.min(SW - 64, 340),
  },
  confirmBannerText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  credit: {
    fontSize: 11,
    marginBottom: Spacing.md,
  },
});

export default WelcomeScreen;
