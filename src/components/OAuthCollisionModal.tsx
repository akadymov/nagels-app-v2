/**
 * OAuth collision auto-switcher.
 *
 * When linkIdentity to Google returns identity_already_exists (the Google
 * account is attached to a different Nägels profile), the URL hash contains
 * error_code=identity_already_exists. Auto-switch to the existing profile
 * silently — no prompt — since both alternatives lead the user to the same
 * place. Shows a brief "Switching…" overlay so the screen isn't blank
 * during the redirect.
 *
 * Caveat: Chrome PWA standalone may block cross-origin navigation triggered
 * outside a user-gesture window. We still try, but if the redirect doesn't
 * fire within 5 s we surface an actionable alert.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { Spacing, Radius } from '../constants';

export const OAuthCollisionModal: React.FC = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash || !hash.includes('error')) return;
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const errCode = params.get('error_code') || params.get('error');
    if (errCode !== 'identity_already_exists') return;

    // Strip the hash so a refresh doesn't replay this branch.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);

    const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches
      || (window.navigator as any)?.standalone === true;
    console.log('[OAuth] collision → auto-switching to existing profile; standalone PWA?', isStandalone);
    setSwitching(true);

    void (async () => {
      try {
        const { signOut, signInWithGoogle, clearLocalGuestState } =
          await import('../lib/supabase/authService');
        // Local-scope signOut → no server revoke → auth lock free immediately.
        await signOut('local');
        await clearLocalGuestState();
        // Yield a tick so any in-flight onAuthStateChange listeners (display-name
        // backfill etc.) finish on their own auth-lock turn.
        await new Promise((r) => setTimeout(r, 50));
        console.log('[OAuth] local state cleared, redirecting to Google…');
        await signInWithGoogle();
        // signInWithOAuth navigates the page away. If we're still here after
        // 5 s the redirect was blocked (Chrome PWA standalone is the most
        // likely culprit) — surface an actionable alert.
        setTimeout(() => {
          if (typeof window !== 'undefined') {
            setSwitching(false);
            console.warn('[OAuth] redirect did not navigate within 5s');
            window.alert(
              'Switch stalled. Try opening the site in your browser (not the installed app).',
            );
          }
        }, 5000);
      } catch (err) {
        setSwitching(false);
        console.error('[OAuth] switch failed:', err);
        window.alert('Switch failed: ' + (err instanceof Error ? err.message : String(err)));
      }
    })();
  }, []);

  if (!switching) return null;

  return (
    <View style={[styles.overlay, { backgroundColor: colors.background + 'EE' }]} pointerEvents="auto">
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t('auth.switchingProfile', 'Switching profile…')}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  card: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    gap: Spacing.md,
  },
  title: { fontSize: 15, fontWeight: '600' },
});

export default OAuthCollisionModal;
