/**
 * Desktop Welcome + Auth — split layout.
 *
 * Left pane: marketing / onboarding hero (DesktopWelcomePane).
 * Right pane:
 *   - guest / signed-out users → AuthScreen (capped at ~380px so the
 *     form doesn't sprawl across half a 1920-wide window).
 *   - signed-in users → a profile card with display name, email, and
 *     a Sign Out button. Per feedback (2026-05-16, Akula): the auth
 *     form should not be shown when the user is already logged in.
 *
 * Below 1024px each screen keeps its own dedicated mobile layout via
 * the route-level branching in AppNavigator.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { AuthScreen, type AuthScreenProps } from '../AuthScreen';
import {
  DesktopWelcomePane,
  type DesktopWelcomePaneProps,
} from '../../components/DesktopWelcomePane';
import { useAuthStore } from '../../store/authStore';
import { signOut } from '../../lib/supabase/authService';

interface Props {
  welcome: DesktopWelcomePaneProps;
  auth: AuthScreenProps;
}

export const DesktopWelcomeAuth: React.FC<Props> = ({ welcome, auth }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { user, isGuest } = useAuthStore();
  const isLoggedIn = !!user && !isGuest && !!user.email;

  const onSignOut = async (): Promise<void> => {
    try {
      await signOut();
    } catch {
      /* surface errors via re-render */
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.welcomePane}>
        <DesktopWelcomePane {...welcome} />
      </View>
      <View style={[styles.authPane, { backgroundColor: colors.background, borderColor: colors.glassLight }]}>
        <View style={styles.authInner}>
          {isLoggedIn ? (
            <View
              style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.accent }]}
              testID="welcome-profile-desktop"
            >
              <Text style={[styles.profileAvatar, { color: colors.accent }]}>
                {(user?.user_metadata?.avatar as string | undefined) || '🦈'}
              </Text>
              <Text style={[styles.profileName, { color: colors.textPrimary }]} numberOfLines={1}>
                {(user?.user_metadata?.display_name as string | undefined) ||
                  user?.email?.split('@')[0] ||
                  'Player'}
              </Text>
              {!!user?.email && (
                <Text style={[styles.profileEmail, { color: colors.textMuted }]} numberOfLines={1}>
                  {user.email}
                </Text>
              )}
              <Pressable
                onPress={onSignOut}
                style={[styles.signOutBtn, { borderColor: colors.error }]}
                testID="btn-welcome-signout-desktop"
              >
                <Text style={[styles.signOutText, { color: colors.error }]}>{t('auth.signOut')}</Text>
              </Pressable>
            </View>
          ) : (
            <AuthScreen {...auth} hideBack />
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  welcomePane: { flex: 1, minWidth: 0 },
  authPane: {
    flex: 1,
    minWidth: 0,
    borderLeftWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Auth form constrained per Figma — the form itself never exceeds
  // ~380px even on a 1920-wide window.
  authInner: {
    width: '100%',
    maxWidth: 420,
    paddingHorizontal: 24,
  },
  profileCard: {
    width: '100%',
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 8,
  },
  profileAvatar: {
    fontSize: 56,
  },
  profileName: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  profileEmail: {
    fontSize: 14,
    textAlign: 'center',
  },
  signOutBtn: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
  },
  signOutText: {
    fontSize: 15,
    fontWeight: '600',
  },
});

export default DesktopWelcomeAuth;
