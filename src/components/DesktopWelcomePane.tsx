/**
 * DesktopWelcomePane — the left half of the desktop Welcome + Auth layout.
 *
 * Marketing / onboarding content per the Figma spec:
 *  - brand cluster (suits + NÄGELS wordmark)
 *  - large headline + subtitle
 *  - feature checklist
 *  - "Learn to Play" primary CTA
 *  - "Continue to Lobby" / "Skip to Menu" secondary
 *  - language switcher pinned bottom-left
 *
 * The auth form lives on the right pane — no Sign In button here.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { Spacing, Radius } from '../constants';
import { useAuthStore } from '../store/authStore';
import { languages, type LanguageCode } from '../i18n';

const SUITS: Array<{ glyph: string; color: string }> = [
  { glyph: '♠', color: '#FFFFFF' },
  { glyph: '♥', color: '#FFFFFF' },
  { glyph: '♣', color: '#FFFFFF' },
  { glyph: '♦', color: '#FFFFFF' },
];

export interface DesktopWelcomePaneProps {
  onQuickStart: () => void;
  onAlreadyPlay?: () => void;
}

export const DesktopWelcomePane: React.FC<DesktopWelcomePaneProps> = ({
  onQuickStart, onAlreadyPlay,
}) => {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { user, isGuest } = useAuthStore();
  const isLoggedIn = !!user && !isGuest && !!user.email;
  const currentLang = i18n.language as LanguageCode;
  const changeLanguage = (code: LanguageCode) => {
    void i18n.changeLanguage(code);
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('@nagels_language', code); } catch {}
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.accent }]}>
      <View style={styles.inner}>
        {/* Brand */}
        <View style={styles.brandRow}>
          {SUITS.map((s) => (
            <Text key={s.glyph} style={[styles.suit, { color: s.color }]}>{s.glyph}</Text>
          ))}
          <Text style={styles.wordmark}>NÄGELS</Text>
        </View>

        {/* Headline */}
        <Text style={styles.heroTitle}>{t('welcome.heroTitle')}</Text>
        <Text style={styles.heroSubtitle}>{t('welcome.heroSubtitle')}</Text>

        {/* Features */}
        <View style={styles.features}>
          {([1, 2, 3] as const).map((n) => (
            <View key={n} style={styles.featureRow}>
              <Text style={styles.check}>✓</Text>
              <Text style={styles.featureText}>{t(`welcome.feature${n}`)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.spacer} />

        {/* CTAs */}
        <Pressable
          onPress={onQuickStart}
          style={styles.primaryBtn}
          testID="desktop-welcome-learn"
        >
          <Text style={styles.primaryBtnText}>▶  {t('welcome.quickStart')}</Text>
        </Pressable>

        <Pressable
          onPress={onAlreadyPlay}
          style={styles.secondaryBtn}
          testID="desktop-welcome-continue"
        >
          <Text style={styles.secondaryBtnText}>
            {isLoggedIn ? t('lobby.continueToLobby') : t('welcome.alreadyPlay')}
          </Text>
        </Pressable>

        {/* Language switcher — subtle inline text links on the accent
            panel; deliberately understated so it doesn't compete with
            the brand and CTAs. */}
        <View style={styles.langRow}>
          {(Object.keys(languages) as LanguageCode[]).map((code, i) => {
            const isActive = code === currentLang;
            return (
              <React.Fragment key={code}>
                {i > 0 && <Text style={styles.langDot}>·</Text>}
                <Pressable
                  onPress={() => changeLanguage(code)}
                  hitSlop={8}
                  testID={`desktop-lang-${code}`}
                >
                  <Text style={[styles.langLink, isActive && styles.langLinkActive]}>
                    {code.toUpperCase()}
                  </Text>
                </Pressable>
              </React.Fragment>
            );
          })}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  inner: {
    flex: 1,
    paddingHorizontal: 80,
    paddingTop: 96,
    paddingBottom: 64,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 32,
  },
  suit: { fontSize: 30, fontWeight: '700' },
  wordmark: {
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 6,
    color: '#FFFFFF',
    marginLeft: 4,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 48,
    lineHeight: 56,
    fontWeight: '800',
    marginBottom: 16,
  },
  heroSubtitle: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 17,
    lineHeight: 26,
    marginBottom: 28,
    maxWidth: 520,
  },
  features: { gap: 10 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  check: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  featureText: { color: '#FFFFFF', fontSize: 15, fontWeight: '500' },
  spacer: { flex: 1 },
  primaryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
  },
  primaryBtnText: { color: '#13428f', fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 9999,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  secondaryBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  langRow: {
    marginTop: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'flex-start',
  },
  langLink: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1,
  },
  langLinkActive: {
    color: '#FFFFFF',
    textDecorationLine: 'underline',
    textDecorationStyle: 'solid',
  },
  langDot: { color: 'rgba(255, 255, 255, 0.4)', fontSize: 14 },
});

export default DesktopWelcomePane;
