/**
 * Desktop Waiting Room — players list / room code / ready-start
 * on the left, inline chat panel on the right.
 *
 * Same pattern as DesktopGameLayout: the existing WaitingRoomScreen
 * runs in the left column with hideChat=true so its modal-mode
 * ChatPanel doesn't double up against the side-pane inline one.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Radius, Spacing } from '../../constants';
import { useRoomStore } from '../../store/roomStore';
import { WaitingRoomScreen, type WaitingRoomScreenProps } from '../WaitingRoomScreen';
import { ChatPanel } from '../../components/ChatPanel';

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
      <View style={styles.leftWrap}>
        <View style={styles.left}>
          <WaitingRoomScreen {...props} hideChat />
        </View>
      </View>
      <View
        style={[
          styles.chat,
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
  // Wrap that fills the space, then a centered inner column capped
  // at ~720. The waiting room is a vertical list (code, players,
  // toggle, start) — wider than that just adds whitespace on the
  // sides without helping legibility.
  leftWrap: { flex: 1, minWidth: 0, alignItems: 'center' },
  left: { flex: 1, width: '100%', maxWidth: 720 },
  chat: {
    width: 360,
    margin: Spacing.md,
    marginLeft: 0,
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
});

export default DesktopWaitingRoom;
