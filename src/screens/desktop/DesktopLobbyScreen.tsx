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
import { Radius } from '../../constants';
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
        {/* Lobby pane is fixed at 600px so the form has a stable
            width across all desktop sizes. The Profile pane flexes
            to fill the rest, so together the two forms span the
            full active page width without an awkward gap. */}
        <View
          style={[
            styles.pane,
            styles.lobbyPane,
            { backgroundColor: colors.surface, borderColor: colors.glassLight },
          ]}
        >
          <LobbyScreen {...lobbyProps} hideAuthCta hideLogoHeader />
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
    minHeight: 720,
  },
  pane: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  lobbyPane: {
    width: 600,
    flexShrink: 0,
  },
  profilePane: {
    flex: 1,
  },
});

export default DesktopLobbyScreen;
