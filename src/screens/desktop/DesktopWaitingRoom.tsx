/**
 * Desktop Waiting Room — three-column layout:
 *   Settings/Profile (left, ~360) | WaitingRoomScreen (center, ~720) | Chat (right, ~360)
 *
 * The left pane surfaces the same SettingsBody used in DesktopLobbyScreen,
 * so the user can manage their nickname / avatar / Google linking /
 * theme / language while waiting for everyone to ready up. Hidden on
 * mobile via the route-level branching in AppNavigator.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Radius, Spacing } from '../../constants';
import { useRoomStore } from '../../store/roomStore';
import { WaitingRoomScreen, type WaitingRoomScreenProps } from '../WaitingRoomScreen';
import { ChatPanel } from '../../components/ChatPanel';
import { SettingsBody } from '../../components/SettingsBody';

type Props = WaitingRoomScreenProps;

export const DesktopWaitingRoom: React.FC<Props> = (props) => {
  const { colors } = useTheme();
  const snapshot = useRoomStore((s) => s.snapshot);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const isSpectator = useRoomStore((s) => s.isSpectator);
  const players = snapshot?.players ?? [];
  const me = players.find((p) => p.session_id === myPlayerId) ?? null;
  const spectatorMe = !me && isSpectator && myPlayerId
    ? (snapshot?.spectators ?? []).find((s: any) => s.session_id === myPlayerId) ?? null
    : null;
  const senderSrc: any = me ?? spectatorMe;
  const sender = senderSrc ? {
    sessionId: senderSrc.session_id,
    displayName: senderSrc.display_name,
    avatar: senderSrc.avatar ?? null,
    avatarColor: senderSrc.avatar_color ?? null,
  } : null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.sidePane,
          styles.left,
          { backgroundColor: colors.surface, borderColor: colors.glassLight },
        ]}
      >
        <View style={styles.settingsInner}>
          <SettingsBody onClose={() => {}} />
        </View>
      </View>

      <View style={styles.centerWrap}>
        <View style={styles.center}>
          <WaitingRoomScreen {...props} hideChat />
        </View>
      </View>

      <View
        style={[
          styles.sidePane,
          styles.right,
          { backgroundColor: colors.surface, borderColor: colors.glassLight },
        ]}
      >
        <ChatPanel
          mode="inline"
          visible
          onClose={() => {}}
          sender={sender}
          testIdPrefix="chat"
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  sidePane: {
    width: 400,
    margin: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  left: { marginRight: 0 },
  right: { marginLeft: 0 },
  // Inner cap so SettingsBody banners don't span the full 360 either —
  // matches the DesktopLobbyScreen feel.
  settingsInner: { flex: 1, width: '100%', maxWidth: 360 },
  centerWrap: { flex: 1, minWidth: 0, alignItems: 'center' },
  center: { flex: 1, width: '100%', maxWidth: 720 },
});

export default DesktopWaitingRoom;
