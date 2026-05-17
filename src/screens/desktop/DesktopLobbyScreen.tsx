/**
 * Desktop Lobby — Lobby + Profile side-by-side.
 *
 * Mounts the existing LobbyScreen on the left and the SettingsBody
 * (which renders the Profile section among others) on the right.
 * Both panes are real mounted components, not shells — actions like
 * Quick Match, Link Google, Save Nickname all work the same way
 * they do on mobile.
 *
 * Active only at viewport >= 1024px (gated by useIsDesktop in
 * AppNavigator); mobile keeps the plain LobbyScreen.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Radius, Spacing } from '../../constants';
import { LobbyScreen, type LobbyScreenProps } from '../LobbyScreen';
import { SettingsBody } from '../../components/SettingsBody';
import { DesktopShell } from '../../components/DesktopShell';

type Props = LobbyScreenProps;

export const DesktopLobbyScreen: React.FC<Props> = (props) => {
  const { colors } = useTheme();
  // The desktop layout already shows SettingsBody in the right pane,
  // so the gear-button entry-point inside LobbyScreen would just open
  // a modal duplicating those settings. Drop the onSettings prop to
  // hide the gear.
  const { onSettings: _drop, ...lobbyProps } = props;
  void _drop;

  return (
    <DesktopShell>
      <View style={styles.row}>
        <View
          style={[
            styles.pane,
            styles.lobbyPane,
            { backgroundColor: colors.surface, borderColor: colors.glassLight },
          ]}
        >
          {/* Cap the lobby form at 600px on ultra-wide desktops —
              same pattern as the embedded lobby in DesktopWelcomeAuth.
              The outer pane still flexes to its ~65% column; only the
              inner column is capped. */}
          <View style={styles.lobbyInner}>
            <LobbyScreen {...lobbyProps} hideAuthCta />
          </View>
        </View>
        <View
          style={[
            styles.pane,
            styles.profilePane,
            { backgroundColor: colors.surface, borderColor: colors.glassLight },
          ]}
        >
          <SettingsBody onClose={() => {}} />
        </View>
      </View>
    </DesktopShell>
  );
};

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.lg,
    minHeight: 720,
  },
  pane: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  lobbyPane: {
    flexGrow: 13,
    flexShrink: 1,
    flexBasis: 0, // ~65%
    alignItems: 'center', // center the capped inner column
  },
  lobbyInner: {
    flex: 1,
    width: '100%',
    maxWidth: 600,
  },
  profilePane: { flexGrow: 7, flexShrink: 1, flexBasis: 0 }, // ~35%
});

export default DesktopLobbyScreen;
