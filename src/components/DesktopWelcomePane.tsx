/**
 * DesktopWelcomePane — left half of the desktop Welcome + Auth layout.
 *
 * Order top → bottom (always):
 *   brand → hero/features → CTAs → language row → primer (when open)
 *
 * The primer is an inline onboarding carousel that mounts BELOW the
 * CTAs and language row when the user clicks "Learn to Play". Buttons
 * stay visible — the primer doesn't take over, it expands below.
 *
 * Primer body height is locked to the tallest of the 3 slides (per
 * locale) via a one-shot hidden measurement pass — no layout shift
 * when the user navigates between slides.
 *
 * The auth form lives in the right pane — no Sign In button here.
 */

import React, { useState, useRef, useEffect } from 'react';
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

  // Lock primer body to the tallest of the 3 slides so there's no
  // layout shift when navigating between them. One-shot measurement
  // via a hidden absolute layer; re-measures on language change.
  const [primerBodyMinHeight, setPrimerBodyMinHeight] = useState<number | null>(null);
  const slideHeightsRef = useRef<Record<string, number>>({});
  const recordSlideHeight = (slide: string, h: number) => {
    if (slideHeightsRef.current[slide] === h) return;
    slideHeightsRef.current[slide] = h;
    if (Object.keys(slideHeightsRef.current).length >= PRIMER_SLIDES.length) {
      const max = Math.max(...Object.values(slideHeightsRef.current));
      setPrimerBodyMinHeight(max);
    }
  };
  useEffect(() => {
    slideHeightsRef.current = {};
    setPrimerBodyMinHeight(null);
  }, [i18n.language]);

  return (
    <View style={[styles.root, { backgroundColor: colors.accent }]}>
      <View style={styles.inner}>
        {/* Brand cluster — coloured, larger than the auth-form copy */}
        <View style={styles.brandRow}>
          {SUITS.map((s) => (
            <Text key={s.glyph} style={[styles.suit, { color: s.color }]}>{s.glyph}</Text>
          ))}
          <Text style={styles.wordmark} numberOfLines={1}>NÄGELS</Text>
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

        <View style={styles.spacer} />

        {/* CTA group hugs the widest child (primary "▶ Learn to Play" /
            "▶ Научиться играть" / "▶ Aprender a Jugar") and stretches
            the secondary to match. Equal-width buttons across all
            languages without per-locale measurement. */}
        <View style={styles.ctaGroup}>
          <Pressable
            onPress={openPrimer}
            style={styles.primaryBtn}
            testID="desktop-welcome-learn"
          >
            <Text style={styles.primaryBtnText}>▶  {t('welcome.quickStart')}</Text>
          </Pressable>

          {/* "Continue to Lobby" / "Skip to Menu" CTA — only shown
              for guests. On desktop logged-in users see the Lobby
              mounted directly in the right pane (DesktopWelcomeAuth),
              so this button would be a no-op. */}
          {!isLoggedIn && (
            <Pressable
              onPress={onAlreadyPlay}
              style={styles.secondaryBtn}
              testID="desktop-welcome-continue"
            >
              <Text style={styles.secondaryBtnText}>
                {t('welcome.alreadyPlay')}
              </Text>
            </Pressable>
          )}
        </View>

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

            {/* Hidden measurement pass — renders all 3 slide bodies
                stacked, absolutely positioned + opacity 0. Each
                onLayout reports its natural height; once all are in,
                we lock the visible body to the max. Unmounts itself
                afterward. Re-runs on locale change. */}
            {primerBodyMinHeight === null && (
              <View pointerEvents="none" style={styles.primerMeasureLayer}>
                {PRIMER_SLIDES.map((slide) => (
                  <View
                    key={`measure-${slide}`}
                    style={styles.primerBody}
                    onLayout={(e) => recordSlideHeight(slide, e.nativeEvent.layout.height)}
                  >
                    <Text style={styles.primerTitle}>{t(`primer.${slide}.title`)}</Text>
                    <Text style={styles.primerVisual}>{t(`primer.${slide}.visual`)}</Text>
                    <Text style={styles.primerDesc}>{t(`primer.${slide}.description`)}</Text>
                  </View>
                ))}
              </View>
            )}

            <View
              style={[
                styles.primerBody,
                primerBodyMinHeight !== null && { minHeight: primerBodyMinHeight },
              ]}
            >
              <Text style={styles.primerTitle}>
                {t(`primer.${currentSlide}.title`)}
              </Text>
              <Text style={styles.primerVisual}>
                {t(`primer.${currentSlide}.visual`)}
              </Text>
              <Text style={styles.primerDesc}>
                {t(`primer.${currentSlide}.description`)}
              </Text>
            </View>

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
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  inner: { flex: 1, paddingHorizontal: 80, paddingTop: 80, paddingBottom: 56 },

  // Brand
  // flexWrap on the row so on narrow desktop windows (~1024px,
  // pane ≈ 500px) the wordmark moves to a second row instead of
  // splitting char-by-char. The wordmark itself stays on one line
  // (numberOfLines={1} + flexShrink: 0) so "NÄGELS" never breaks.
  brandRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginBottom: 36 },
  suit: { fontSize: 44, fontWeight: '800' },
  wordmark: {
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: 8,
    color: '#FFFFFF',
    marginLeft: 6,
    flexShrink: 0,
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

  // Primer container — appears below the CTAs/lang row when the
  // user clicks "Learn to Play".
  primerCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderColor: 'rgba(255, 255, 255, 0.35)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    maxWidth: 560,
    marginTop: 24,
  },
  primerBody: {
    // Natural content height; visible body has its minHeight set
    // dynamically once the hidden measurement pass completes.
  },
  primerMeasureLayer: {
    position: 'absolute',
    left: 24, // matches primerCard padding so wrap width is identical
    right: 24,
    top: 24,
    opacity: 0,
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

  // CTAs — wrapped in ctaGroup so primary and secondary share width.
  ctaGroup: {
    alignSelf: 'flex-start',
    alignItems: 'stretch',
  },
  primaryBtn: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
  },
  primaryBtnText: {
    color: '#13428f',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  secondaryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 9999,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  secondaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },

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
