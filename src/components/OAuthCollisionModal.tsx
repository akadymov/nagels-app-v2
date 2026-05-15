/**
 * OAuth collision modal.
 *
 * When linkIdentity to Google returns identity_already_exists (the Google
 * account is attached to a different Nägels profile), the URL hash contains
 * error_code=identity_already_exists. This component detects that on mount,
 * shows a modal, and — on confirm — switches to the existing profile.
 *
 * Why a custom modal instead of window.confirm: in standalone PWA mode,
 * Chrome's redirect-blocker rejects cross-origin navigation that isn't
 * tied to a fresh user gesture. window.confirm + await + window.location
 * .assign loses the gesture; an actual Pressable's onPress preserves it
 * and the redirect to Google goes through.
 */

import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { Spacing, Radius } from '../constants';
import { GoogleButton } from './GoogleButton';

export const OAuthCollisionModal: React.FC = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash || !hash.includes('error')) return;
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const errCode = params.get('error_code') || params.get('error');
    if (errCode !== 'identity_already_exists') return;

    // Strip the hash so a refresh doesn't replay this prompt.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);

    const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches
      || (window.navigator as any)?.standalone === true;
    console.log('[OAuth] collision detected; standalone PWA?', isStandalone);
    setVisible(true);
  }, []);

  const handleSwitch = async () => {
    // CRITICAL: this onPress is the user gesture that authorises the
    // upcoming cross-origin redirect inside signInWithGoogle. Do not
    // wrap in setTimeout / window.confirm — that loses the gesture
    // and Chrome PWA standalone will silently block the navigation.
    setSwitching(true);
    try {
      const { signOut, signInWithGoogle, clearLocalGuestState } =
        await import('../lib/supabase/authService');
      await signOut();
      await clearLocalGuestState();
      console.log('[OAuth] local state cleared, redirecting to Google…');
      await signInWithGoogle();
      // signInWithOAuth navigates the page; if we're still here after
      // a moment the redirect was blocked.
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
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            {t('auth.collisionTitle', 'Switch profile?')}
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {t(
              'auth.collisionBody',
              'This Google account is already linked to a different Nägels profile. Switching will replace this device\'s guest data with the existing profile.',
            )}
          </Text>
          <View style={styles.actions}>
            <Pressable
              style={[styles.secondaryBtn, { borderColor: colors.glassLight }]}
              onPress={() => setVisible(false)}
              testID="collision-cancel"
            >
              <Text style={[styles.secondaryBtnText, { color: colors.textMuted }]}>
                {t('common.cancel', 'Cancel')}
              </Text>
            </Pressable>
            <GoogleButton
              onPress={handleSwitch}
              loading={switching}
              label={t('auth.collisionSwitch', 'Switch to existing profile')}
              testID="collision-switch"
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  sheet: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  title: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'column', gap: Spacing.sm, marginTop: Spacing.sm },
  secondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '500' },
});

export default OAuthCollisionModal;
