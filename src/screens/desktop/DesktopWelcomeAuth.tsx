/**
 * Desktop Welcome + Auth — split layout.
 *
 * Left pane: marketing / onboarding hero (DesktopWelcomePane). For
 * logged-in users the "Continue to Lobby" CTA is hidden — the
 * lobby is already mounted in the right pane.
 *
 * Right pane:
 *   - guest / signed-out users → AuthScreen (capped at ~420px so the
 *     form doesn't sprawl across half a 1920-wide window).
 *   - signed-in users → the full LobbyScreen mounted directly, so
 *     a logged-in user lands one click away from a match without
 *     navigating off the welcome route.
 *
 * Below 1024px each screen keeps its own dedicated mobile layout
 * via the route-level branching in AppNavigator. The mobile
 * WelcomeScreen still shows a compact profile card + Sign-Out for
 * logged-in users, which is intentional (small screen ergonomics
 * make a single column the right choice there).
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { AuthScreen, type AuthScreenProps } from '../AuthScreen';
import { LobbyScreen, type LobbyScreenProps } from '../LobbyScreen';
import { SettingsBody } from '../../components/SettingsBody';
import {
  DesktopWelcomePane,
  type DesktopWelcomePaneProps,
} from '../../components/DesktopWelcomePane';
import { useAuthStore } from '../../store/authStore';

interface Props {
  welcome: DesktopWelcomePaneProps;
  auth: AuthScreenProps;
  lobby: LobbyScreenProps;
}

export const DesktopWelcomeAuth: React.FC<Props> = ({ welcome, auth, lobby }) => {
  const { colors } = useTheme();
  const { user, isGuest } = useAuthStore();
  const isLoggedIn = !!user && !isGuest && !!user.email;

  // Right-pane content for logged-in users: Lobby with profile
  // sections spliced in. Identity (avatar / password / Google) sits
  // right after the nickname; preferences (theme / deck / language /
  // notifications / sign-out) live below the lobby CTAs.
  const identitySlot = isLoggedIn ? (
    <SettingsBody onClose={() => {}} only="identity" hideNickname />
  ) : null;
  const preferencesSlot = isLoggedIn ? (
    <SettingsBody onClose={() => {}} only="preferences" />
  ) : null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.welcomePane}>
        <DesktopWelcomePane {...welcome} />
      </View>
      <View
        style={[
          styles.rightPane,
          { backgroundColor: colors.background, borderColor: colors.glassLight },
          isLoggedIn ? styles.rightPaneLobby : styles.rightPaneAuth,
        ]}
      >
        {isLoggedIn ? (
          <View style={styles.lobbyContainer}>
            <LobbyScreen
              {...lobby}
              hideAuthCta
              hideLogoHeader
              transparentBackground
              centerContent
              afterNickname={identitySlot}
              afterCtas={preferencesSlot}
            />
          </View>
        ) : (
          <View style={styles.authInner}>
            <AuthScreen {...auth} hideBack />
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  welcomePane: { flex: 1, minWidth: 0 },
  rightPane: {
    flex: 1,
    minWidth: 0,
    borderLeftWidth: 1,
  },
  rightPaneAuth: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightPaneLobby: {
    // Lobby controls its own scroll + safe area, but on ultra-wide
    // desktops we still center it in a ≤600px column so the form
    // doesn't stretch across half a 1920+ window.
    alignItems: 'center',
  },
  // Auth form constrained per Figma — the form itself never exceeds
  // ~420px even on a 1920-wide window.
  authInner: {
    width: '100%',
    maxWidth: 420,
    paddingHorizontal: 24,
  },
  lobbyContainer: {
    flex: 1,
    width: '100%',
    maxWidth: 600,
  },
});

export default DesktopWelcomeAuth;
