/**
 * Scorekeeper host recorder: in a scorekeeper room the host enters bets and
 * tricks for every seat (offline players and anyone without the app open),
 * like a tournament table recorder. Replaces BettingPhase / TricksRecorder
 * for the host during 'betting' and 'tricks_recording'; scoring keeps the
 * regular scoreboard flow.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRoomStore } from '../../store/roomStore';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';
import { Icon } from '../Icon';
import { leaveWithConfirm } from '../../lib/leaveWithConfirm';
import { useSettingsUIStore } from '../../store/settingsUIStore';
import { useDesktopGameUI } from '../../screens/desktop/DesktopGameContext';
import { OfflineHandBriefing } from '../offline/OfflineHandBriefing';
import { RecorderBetPad } from '../tournament/RecorderBetPad';
import { RecorderTricks } from '../tournament/RecorderTricks';
import { RecorderHands } from '../tournament/RecorderHands';
import { TableBoard } from '../tournament/TableBoard';

export interface ScorekeeperHostPanelProps {
  visible: boolean;
  onShowScore?: () => void;
  onShowChat?: () => void;
}

export const ScorekeeperHostPanel: React.FC<ScorekeeperHostPanelProps> = ({ visible, onShowScore, onShowChat }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const desktopUI = useDesktopGameUI();
  const snapshot = useRoomStore((s) => s.snapshot);
  const [showHands, setShowHands] = useState(false);

  const room = snapshot?.room ?? null;
  const hand = snapshot?.current_hand ?? null;

  const openSettings = useCallback(() => {
    if (desktopUI) desktopUI.toggleLeftPanel('settings');
    else useSettingsUIStore.getState().open();
  }, [desktopUI]);
  const openScore = useCallback(() => {
    if (desktopUI) desktopUI.toggleLeftPanel('scoreboard');
    else onShowScore?.();
  }, [desktopUI, onShowScore]);
  const openChat = useCallback(() => {
    if (desktopUI) desktopUI.toggleChat();
    else onShowChat?.();
  }, [desktopUI, onShowChat]);
  const handleLeave = useCallback(async () => {
    if (!room?.id) return;
    await leaveWithConfirm(room.id, t, { isHost: true });
  }, [room?.id, t]);

  if (!visible || !snapshot || !room || !hand) return null;

  const ctrl = [styles.ctrlBtn, { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight }];
  const board = { table_number: 0, room_id: room.id, stake: 0, claimed: true, state: snapshot };

  return (
    <View style={[styles.overlay, { backgroundColor: colors.background }]} testID="scorekeeper-host-panel">
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.controlBar}>
          <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
            {t('scorekeeper.hostRecording')}
          </Text>
          <Pressable onPress={openSettings} hitSlop={8} testID="sk-host-btn-settings"
            accessibilityLabel={t('settings.title')} style={ctrl}>
            <Icon name="settings" color={colors.iconButtonText} size={20} />
          </Pressable>
          <Pressable onPress={openScore} hitSlop={8} testID="sk-host-btn-scores"
            accessibilityLabel={t('game.score')} style={ctrl}>
            <Icon name="trophy" color={colors.iconButtonText} size={20} />
          </Pressable>
          <Pressable onPress={openChat} hitSlop={8} testID="sk-host-btn-chat"
            accessibilityLabel={t('game.chat')} style={ctrl}>
            <Icon name="chat" color={colors.iconButtonText} size={20} />
          </Pressable>
          <Pressable onPress={handleLeave} hitSlop={8} testID="sk-host-leave"
            accessibilityLabel={t('game.exit')} style={ctrl}>
            <Icon name="door" color={colors.iconButtonText} size={20} />
          </Pressable>
        </View>
        <Pressable onPress={() => setShowHands(true)} testID="sk-host-hands-toggle" style={styles.handsLink}>
          <Text style={{ color: colors.accent, fontSize: 16 }}>{t('tournament.hands')}</Text>
        </Pressable>
        <OfflineHandBriefing />
        {hand.phase === 'betting' && <RecorderBetPad state={snapshot} />}
        {hand.phase === 'tricks_recording' && <RecorderTricks state={snapshot} />}
        <TableBoard table={board} size="phone" />
      </ScrollView>
      <Modal visible={showHands} animationType="slide" onRequestClose={() => setShowHands(false)}>
        <ScrollView style={{ flex: 1, backgroundColor: colors.background }} keyboardShouldPersistTaps="handled">
          <RecorderHands state={snapshot} onDone={() => setShowHands(false)} />
        </ScrollView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 },
  scroll: { padding: Spacing.md, gap: Spacing.md },
  controlBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { flex: 1, fontSize: 18, fontWeight: '700' },
  ctrlBtn: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  handsLink: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
});
