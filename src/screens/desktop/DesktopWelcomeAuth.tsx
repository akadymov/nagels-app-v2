/**
 * Desktop Welcome + Auth — split layout.
 *
 * Left pane: marketing / onboarding hero (DesktopWelcomePane).
 * Right pane: the existing AuthScreen, capped at ~380px so the form
 *  doesn't sprawl across half a 1920-wide window.
 *
 * Below 1024px each screen keeps its own dedicated mobile layout via
 * the route-level branching in AppNavigator.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { AuthScreen, type AuthScreenProps } from '../AuthScreen';
import {
  DesktopWelcomePane,
  type DesktopWelcomePaneProps,
} from '../../components/DesktopWelcomePane';

interface Props {
  welcome: DesktopWelcomePaneProps;
  auth: AuthScreenProps;
}

export const DesktopWelcomeAuth: React.FC<Props> = ({ welcome, auth }) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.welcomePane}>
        <DesktopWelcomePane {...welcome} />
      </View>
      <View style={[styles.authPane, { backgroundColor: colors.background, borderColor: colors.glassLight }]}>
        <View style={styles.authInner}>
          <AuthScreen {...auth} />
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
});

export default DesktopWelcomeAuth;
