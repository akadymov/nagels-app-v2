/**
 * Desktop Welcome + Auth — split layout that shows the brand /
 * onboarding pane on the left and the auth form on the right
 * simultaneously. Both Welcome and Auth routes render this same
 * component on desktop so navigation between them is a no-op:
 * everything is already on screen.
 *
 * Below 1024px each screen keeps its own dedicated mobile layout
 * via the LobbyRoute-style branching in AppNavigator.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Radius, Spacing } from '../../constants';
import { WelcomeScreen, type WelcomeScreenProps } from '../WelcomeScreen';
import { AuthScreen, type AuthScreenProps } from '../AuthScreen';

interface Props {
  welcome: WelcomeScreenProps;
  auth: AuthScreenProps;
}

export const DesktopWelcomeAuth: React.FC<Props> = ({ welcome, auth }) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[styles.pane, styles.welcomePane, { backgroundColor: colors.accent }]}
      >
        <WelcomeScreen {...welcome} />
      </View>
      <View
        style={[
          styles.pane,
          styles.authPane,
          { backgroundColor: colors.surface, borderColor: colors.glassLight },
        ]}
      >
        <AuthScreen {...auth} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  pane: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    overflow: 'hidden',
  },
  welcomePane: {
    // No border — the accent fill IS the visual edge.
  },
  authPane: {
    borderLeftWidth: 1,
  },
});

export default DesktopWelcomeAuth;
