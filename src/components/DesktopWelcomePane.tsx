/**
 * DesktopWelcomePane — left half of the desktop Welcome + Auth layout.
 *
 * Two modes:
 *  - default: marketing hero (suits + NÄGELS wordmark, headline,
 *    subtitle, feature checklist, Learn to Play + Continue/Skip,
 *    inline language switcher pinned bottom-left)
 *  - primer: an inline onboarding carousel that takes over the
 *    centre region. Brand cluster stays at top, CTAs stay at bottom.
 *    Tapping "Got it"/"Let's Play!" on the last slide closes back
 *    to the marketing hero — the user is still on the same desktop
 *    welcome page with the auth form on the right.
 *
 * The auth form lives in the right pane — no Sign In button here.
 */

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { useAuthStore } from '../store/authStore';
import { languages, type LanguageCode } from '../i18n';

// Suit glyphs coloured the same as the AuthScreen brand cluster, but
// with diamond shifted to accent-2 (light blue) so it reads against
// the accent-blue background. Spade stays near-black for contrast.
const SUITS: Array<{ glyph: string; color: string }> = [
  { glyph: '♠', color: '#1a1a1a' },
  { glyph: '♥', color: '#BE1931' },
  { glyph: '♣', color: '#308552' },
  { glyph: '♦', color: '#5dc2fc' },
];

const PRIMER_SLIDES = ['screen1', 'screen2', 'screen3'] as const;

export interface DesktopWelcomePaneProps {
  onQuickStart?: () => void;
  onAlreadyPlay?: () => void;
}

export const DesktopWelcomePane: React.FC<DesktopWelcomePaneProps> = ({
  onAlreadyPlay,
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

  const [showPrimer, setShowPrimer] = useState(false);
  const [primerIndex, setPrimerIndex] = useState(0);
  const openPrimer = () => { setPrimerIndex(0); setShowPrimer(true); };
  const closePrimer = () => setShowPrimer(false);
  const primerNext = () => {
    if (primerIndex < PRIMER_SLIDES.length - 1) setPrimerIndex(primerIndex + 1);
    else closePrimer();
  };
  const primerPrev = () => { if (primerIndex > 0) setPrimerIndex(primerIndex - 1); };
  const currentSlide = PRIMER_SLIDES[primerIndex];

  return (
    <View style={[styles.root, { backgroundColor: colors.accent }]}>
      <View style={styles.inner}>
        {/* Brand cluster — coloured, larger than the auth-form copy */}
        <View style={styles.brandRow}>
          {SUITS.map((s) => (
            <Text key={s.glyph} style={[styles.suit, { color: s.color }]}>{s.glyph}</Text>
          ))}
          <Text style={styles.wordmark}>NÄGELS</Text>
        </View>

        {/* Hero stays mounted at all times; primer card stacks below it
            so the user can keep the game pitch visible while reading
            the onboarding slides. */}
        <Text style={styles.heroTitle}>{t('welcome.heroTitle')}</Text>
        <Text style={styles.heroSubtitle}>{t('welcome.heroSubtitle')}</Text>
        <View style={styles.features}>
          {([1, 2, 3] as const).map((n) => (
            <View key={n} style={styles.featureRow}>
              <Text style={styles.check}>✓</Text>
              <Text style={styles.featureText}>{t(`welcome.feature${n}`)}</Text>
            </View>
          ))}
        </View>

        {showPrimer && (
          <View style={styles.primerCard}>
            <View style={styles.primerHeader}>
              <Pressable onPress={closePrimer} hitSlop={8} testID="desktop-primer-skip">
                <Text style={styles.primerSkip}>{t('common.skip', 'Skip')}</Text>
              </Pressable>
              <Text style={styles.primerProgress}>
                {primerIndex + 1} / {PRIMER_SLIDES.length}
              </Text>
            </View>

            <Text style={styles.primerTitle}>
              {t(`primer.${currentSlide}.title`)}
            </Text>
            <Text style={styles.primerVisual}>
              {t(`primer.${currentSlide}.visual`)}
            </Text>
            <Text style={styles.primerDesc}>
              {t(`primer.${currentSlide}.description`)}
            </Text>

            <View style={styles.primerDots}>
              {PRIMER_SLIDES.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.primerDot,
                    i === primerIndex && styles.primerDotActive,
                  ]}
                />
              ))}
            </View>

            <View style={styles.primerNav}>
              <Pressable
                onPress={primerPrev}
                disabled={primerIndex === 0}
                style={[styles.primerNavBtn, primerIndex === 0 && styles.primerNavBtnDisabled]}
              >
                <Text style={styles.primerNavText}>← Prev</Text>
              </Pressable>
              <Pressable onPress={primerNext} style={styles.primerNavBtnPrimary}>
                <Text style={styles.primerNavTextPrimary}>
                  {t(`primer.${currentSlide}.button`)}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={styles.spacer} />

        <Pressable
          onPress={openPrimer}
          style={[styles.primaryBtn, showPrimer && styles.primaryBtnHidden]}
          testID="desktop-welcome-learn"
          disabled={showPrimer}
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
  inner: { flex: 1, paddingHorizontal: 80, paddingTop: 80, paddingBottom: 56 },

  // Brand
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 36 },
  suit: { fontSize: 44, fontWeight: '800' },
  wordmark: {
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: 8,
    color: '#FFFFFF',
    marginLeft: 6,
  },

  // Hero. RN Web's height calc for Text with explicit lineHeight has
  // been flaky when the text wraps to >1 line — the container often
  // sizes to the first line and subsequent content overlaps. Leaving
  // lineHeight default and pushing the next block with marginBottom
  // instead.
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 40,
    fontWeight: '800',
    marginBottom: 18,
  },
  heroSubtitle: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 16,
    marginBottom: 24,
    maxWidth: 520,
  },
  features: { gap: 10 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  check: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  featureText: { color: '#FFFFFF', fontSize: 15, fontWeight: '500' },

  // Primer container — appears in place of the hero/features block
  primerCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderColor: 'rgba(255, 255, 255, 0.35)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    maxWidth: 560,
    marginTop: 24,
  },
  primerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  primerSkip: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
  primerProgress: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
  primerTitle: { color: '#FFFFFF', fontSize: 28, fontWeight: '800', marginBottom: 6 },
  primerVisual: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    fontStyle: 'italic',
    marginBottom: 12,
  },
  primerDesc: { color: '#FFFFFF', fontSize: 15, lineHeight: 22 },
  primerDots: { flexDirection: 'row', gap: 8, marginTop: 20 },
  primerDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  primerDotActive: { width: 24, backgroundColor: '#FFFFFF' },
  primerNav: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
    alignItems: 'center',
  },
  primerNavBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 9999,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  primerNavBtnDisabled: { opacity: 0.4 },
  primerNavText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  primerNavBtnPrimary: {
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
  },
  primerNavTextPrimary: { color: '#13428f', fontSize: 14, fontWeight: '700' },

  spacer: { flex: 1, minHeight: 24 },

  // CTAs
  primaryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
  },
  primaryBtnHidden: { opacity: 0 },
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

  // Language switcher
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
  },
  langDot: { color: 'rgba(255, 255, 255, 0.4)', fontSize: 14 },
});

export default DesktopWelcomePane;
