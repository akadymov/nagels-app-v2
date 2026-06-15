/**
 * Desktop Waiting Room — three-column layout:
 *   Settings/Profile (left, ~360) | WaitingRoomScreen (center, ~720) | Chat (right, ~360)
 *
 * The left pane surfaces the same SettingsBody used in DesktopLobbyScreen.
 * Settings starts visible; tapping the in-room gear icon toggles it via
 * `DesktopGameUIContext` — same pattern that the in-game DesktopGameLayout
 * uses for its scoreboard/lastTrick/settings panes.
 */

import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Radius, Spacing } from '../../constants';
import { useRoomStore } from '../../store/roomStore';
import { useIsDiscordActivity } from '../../hooks/useIsDiscordActivity';
import { WaitingRoomScreen, type WaitingRoomScreenProps } from '../WaitingRoomScreen';
import { ChatPanel } from '../../components/ChatPanel';
import { SettingsBody } from '../../components/SettingsBody';
import { DesktopGameUIContext, type LeftPanel } from './DesktopGameContext';

type Props = WaitingRoomScreenProps;

export const DesktopWaitingRoom: React.FC<Props> = (props) => {
  const { colors } = useTheme();
  const isDiscord = useIsDiscordActivity();
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
    avatarUrl: senderSrc.avatar_url ?? null,
    avatarColor: senderSrc.avatar_color ?? null,
  } : null;

  // Settings starts visible — the room is pre-game, this is the time to
  // tweak nickname/avatar/language. The gear in WaitingRoomScreen toggles it.
  const [leftPanel, setLeftPanel] = useState<LeftPanel | null>('settings');
  const ui = useMemo(() => ({
    leftPanel,
    toggleLeftPanel: (next: LeftPanel) =>
      setLeftPanel((curr) => (curr === next ? null : next)),
    // The other context fields aren't used in the pre-game room; keep them
    // as inert no-ops so the same context type works.
    showScoreboard: () => {},
    chatVisible: !isDiscord,
    toggleChat: () => {},
  }), [leftPanel, isDiscord]);

  return (
    <DesktopGameUIContext.Provider value={ui}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        {leftPanel === 'settings' && (
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
        )}

        <View style={styles.centerWrap}>
          <View style={styles.center}>
            <WaitingRoomScreen {...props} hideChat />
          </View>
        </View>

        {!isDiscord && (
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
              // WaitingRoom desktop has no toggle to re-open the chat,
              // so hide the ✕ instead of wiring a one-way close.
              hideCloseButton
              onClose={() => {}}
              sender={sender}
              testIdPrefix="chat"
            />
          </View>
        )}
      </View>
    </DesktopGameUIContext.Provider>
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
