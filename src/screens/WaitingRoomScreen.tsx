/**
 * Nägels Online - Waiting Room Screen
 *
 * Pre-game lobby where players gather before starting a game.
 * Reads server-authoritative state from useRoomStore; mutations go through gameClient.
 */

import React, { useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Share,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GlassCard } from '../components/glass';
import { GlassButton } from '../components/buttons';
import { GameLogo } from '../components/GameLogo';
import { Colors, Spacing, Radius, TextStyles } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';
import { useRoomStore } from '../store/roomStore';
import { gameClient } from '../lib/gameClient';
import { subscribeRoom, unsubscribeRoom } from '../lib/realtimeBroadcast';
import { buildInviteLink } from '../utils/inviteLink';

export interface WaitingRoomScreenProps {
  onGameStart: () => void;
  onLeave: () => void;
  onSettings?: () => void;
}

/**
 * WaitingRoomScreen - Pre-game lobby
 */
export const WaitingRoomScreen: React.FC<WaitingRoomScreenProps> = ({
  onGameStart,
  onLeave,
  onSettings,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const snapshot = useRoomStore((s) => s.snapshot);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const connState = useRoomStore((s) => s.connState);

  const room = snapshot?.room ?? null;
  const players = snapshot?.players ?? [];
  const myPlayer = useMemo(
    () => players.find((p) => p.session_id === myPlayerId) ?? null,
    [players, myPlayerId]
  );
  const isHost = !!room && !!myPlayer && room.host_session_id === myPlayer.session_id;
  const amIReady = myPlayer?.is_ready ?? false;
  const playerCount = players.length;
  const readyCount = players.filter((p) => p.is_ready).length;
  // Host is implicitly ready: only count non-host ready players for "canStart"
  const nonHostPlayers = players.filter((p) => p.session_id !== room?.host_session_id);
  const canStartGame =
    isHost && playerCount >= 2 && nonHostPlayers.every((p) => p.is_ready);

  // Ensure subscription is active when this screen is mounted
  useEffect(() => {
    if (room?.id) {
      subscribeRoom(room.id);
    }
  }, [room?.id]);

  // Watch for the server transitioning to "playing" — navigate to GameTable.
  useEffect(() => {
    if (room?.phase === 'playing') {
      onGameStart();
    }
  }, [room?.phase, onGameStart]);

  const handleToggleReady = useCallback(async () => {
    if (!room?.id) return;
    await gameClient.setReady(room.id, !amIReady);
  }, [room?.id, amIReady]);

  const handleStartGame = useCallback(async () => {
    if (!room?.id) return;
    // No client-side guard — server validates "all ready" / "all seats filled".
    // Idempotent error responses include current snapshot, so wrong-state
    // clicks just refresh the UI rather than producing user-visible errors.
    await gameClient.startGame(room.id);
  }, [room?.id]);

  const handleLeave = useCallback(async () => {
    const roomId = room?.id;
    if (roomId) {
      try {
        await gameClient.leaveRoom(roomId);
      } catch (err) {
        console.error('[WaitingRoom] leaveRoom failed:', err);
      }
    }
    unsubscribeRoom();
    useRoomStore.getState().reset();
    onLeave();
  }, [room?.id, onLeave]);

  const handleShare = useCallback(async () => {
    if (!room) return;
    const link = buildInviteLink(room.code);
    const message = `${t('multiplayer.shareMessage')}\n${link}`;
    try {
      await Share.share(
        { message, title: 'Nägels Online' },
        { dialogTitle: t('multiplayer.shareRoom') }
      );
    } catch {
      await Clipboard.setStringAsync(link);
      Alert.alert(t('multiplayer.codeCopied'), link);
    }
  }, [room, t]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.logoHeader, { borderBottomColor: colors.glassLight }]}>
        <View style={{ width: 36 }} />
        <GameLogo size="sm" />
        {onSettings ? (
          <Pressable onPress={onSettings} hitSlop={8} style={styles.settingsBtn} testID="waiting-btn-settings">
            <Text style={{ fontSize: 18 }}>⚙️</Text>
          </Pressable>
        ) : (
          <View style={{ width: 36 }} />
        )}
      </View>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Room Code Card */}
        {room && (
          <GlassCard style={styles.roomCodeCard}>
            <Text style={[styles.roomCodeLabel, { color: colors.textSecondary }]}>{t('multiplayer.roomCode')}</Text>
            <Text style={[styles.roomCode, { color: colors.accent }]} testID="room-code">{room.code}</Text>
            <Pressable
              style={styles.shareButton}
              onPress={handleShare}
              hitSlop={8}
            >
              <Text style={[styles.shareButtonText, { color: colors.textPrimary }]}>
                📤 {t('multiplayer.shareCode')}
              </Text>
            </Pressable>
          </GlassCard>
        )}

        {/* Players List */}
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          {t('multiplayer.playersInRoom', { count: playerCount, max: room?.player_count ?? '?' })}
        </Text>

        <View style={styles.playersList}>
          {players.map((player, index) => {
            const isDuplicate = players.filter(p => p.display_name === player.display_name).length > 1;
            const isMe = player.session_id === myPlayerId;
            const isHostPlayer = player.session_id === room?.host_session_id;
            return (
              <GlassCard
                key={player.session_id}
                style={[
                  styles.playerCard,
                  { backgroundColor: colors.surface },
                  isMe && [styles.myPlayerCard, { backgroundColor: colors.accent + '18' }],
                ]}
              >
                <View style={[styles.seatBadge, { backgroundColor: colors.surfaceSecondary }]}>
                  <Text style={[styles.seatNumber, { color: colors.textMuted }]}>{index + 1}</Text>
                </View>
                <View style={styles.playerInfo}>
                  <Text style={[styles.playerName, { color: colors.textPrimary }]}>
                    {player.display_name}
                    {isDuplicate && (
                      <Text style={styles.seatSuffix}> #{index + 1}</Text>
                    )}
                    {isMe && (
                      <Text style={styles.youBadge}> ({t('multiplayer.you')})</Text>
                    )}
                  </Text>
                  {isHostPlayer && (
                    <Text style={styles.hostBadge}> {t('multiplayer.host')}</Text>
                  )}
                </View>
                <View style={[
                  styles.readyIndicator,
                  { backgroundColor: colors.surfaceSecondary },
                  player.is_ready && styles.readyIndicatorReady,
                ]}>
                  <Text style={[
                    styles.readyText,
                    { color: colors.textMuted },
                    player.is_ready && styles.readyTextReady,
                  ]}>
                    {player.is_ready ? '✓' : '○'}
                  </Text>
                </View>
              </GlassCard>
            );
          })}
        </View>

        {/* Sync Status */}
        {connState === 'reconnecting' && (
          <View style={styles.statusBar}>
            <ActivityIndicator size="small" color={Colors.accent} />
            <Text style={styles.statusText}>{t('multiplayer.reconnecting')}</Text>
          </View>
        )}

        {connState === 'error' && (
          <View style={[styles.statusBar, styles.statusBarError]}>
            <Text style={styles.statusError}>Connection error</Text>
          </View>
        )}

        {/* Action Buttons */}
        {!isHost ? (
          // Non-host: ready confirmation UI
          <>
            {amIReady ? (
              <View style={styles.readyBanner}>
                <Text style={styles.readyBannerIcon}>✓</Text>
                <Text style={styles.readyBannerText}>{t('multiplayer.youAreReady')}</Text>
                <Pressable onPress={handleToggleReady} style={styles.cancelReadyLink}>
                  <Text style={styles.cancelReadyText}>{t('multiplayer.notReady')}</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={styles.readyHintText}>
                  {t('multiplayer.readyToPlayHint')}
                </Text>
                <GlassButton
                  title={t('multiplayer.ready')}
                  onPress={handleToggleReady}
                  size="large"
                  variant="primary"
                  accentColor={Colors.success}
                  style={styles.actionButton}
                  testID="btn-ready"
                />
              </>
            )}
            <Text style={styles.waitingText}>
              {t('multiplayer.waitingForReady', {
                count: readyCount,
                total: players.length,
              })}
            </Text>
          </>
        ) : (
          // Host: Start Game
          <>
            <GlassButton
              title={t('multiplayer.startGame')}
              onPress={handleStartGame}
              size="large"
              variant="primary"
              accentColor={Colors.highlight}
              disabled={!canStartGame}
              style={styles.actionButton}
              testID="btn-start-game"
            />
            {!canStartGame && (
              <Text style={styles.waitingText}>
                {t('multiplayer.waitingForReady', {
                  count: nonHostPlayers.filter((p) => p.is_ready).length,
                  total: nonHostPlayers.length,
                })}
              </Text>
            )}
          </>
        )}

        {/* Leave Button */}
        <Pressable onPress={handleLeave} style={styles.leaveButton}>
          <Text style={styles.leaveButtonText}>{t('multiplayer.leaveRoom')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollView: {
    flex: 1,
  },
  logoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.glassLight,
  },
  settingsBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: 160,
  },
  roomCodeCard: {
    padding: Spacing.xl,
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  roomCodeLabel: {
    ...TextStyles.caption,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  roomCode: {
    ...TextStyles.h1,
    color: Colors.textPrimary,
    letterSpacing: 4,
    marginBottom: Spacing.sm,
  },
  shareButton: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: 'rgba(100, 200, 150, 0.15)',
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  shareButtonText: {
    ...TextStyles.body,
    color: Colors.accent,
    fontWeight: '600',
  },
  sectionTitle: {
    ...TextStyles.h3,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  playersList: {
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  playerCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.md,
    backgroundColor: Colors.glassDark,
    gap: Spacing.sm,
  },
  myPlayerCard: {
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  seatBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.glassLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatNumber: {
    ...TextStyles.small,
    color: Colors.textMuted,
    fontWeight: '700',
    fontSize: 11,
  },
  playerInfo: {
    flex: 1,
  },
  playerName: {
    ...TextStyles.body,
    color: Colors.textPrimary,
  },
  seatSuffix: {
    ...TextStyles.caption,
    color: Colors.textMuted,
  },
  youBadge: {
    ...TextStyles.caption,
    color: Colors.accent,
  },
  hostBadge: {
    ...TextStyles.caption,
    color: Colors.highlight,
  },
  readyIndicator: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.glassLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyIndicatorReady: {
    backgroundColor: Colors.success,
  },
  readyText: {
    ...TextStyles.body,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  readyTextReady: {
    color: Colors.textPrimary,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    backgroundColor: `${Colors.accent}22`,
    borderRadius: Radius.md,
    marginBottom: Spacing.lg,
  },
  statusBarError: {
    backgroundColor: `${Colors.error}22`,
  },
  statusText: {
    ...TextStyles.caption,
    color: Colors.accent,
  },
  statusError: {
    ...TextStyles.caption,
    color: Colors.error,
  },
  readyBanner: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    backgroundColor: `${Colors.success}22`,
    borderWidth: 2,
    borderColor: Colors.success,
    borderRadius: Radius.lg,
    marginBottom: Spacing.md,
  },
  readyBannerIcon: {
    fontSize: 32,
    color: Colors.success,
    fontWeight: 'bold',
    marginBottom: Spacing.xs,
  },
  readyBannerText: {
    ...TextStyles.h3,
    color: Colors.success,
    fontWeight: '700',
    marginBottom: Spacing.sm,
  },
  cancelReadyLink: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  cancelReadyText: {
    ...TextStyles.caption,
    color: Colors.textMuted,
    textDecorationLine: 'underline',
  },
  readyHintText: {
    ...TextStyles.caption,
    color: Colors.accent,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  waitingText: {
    ...TextStyles.caption,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  actionButton: {
    width: '100%',
    marginBottom: Spacing.md,
  },
  leaveButton: {
    padding: Spacing.md,
    alignItems: 'center',
  },
  leaveButtonText: {
    ...TextStyles.caption,
    color: Colors.textMuted,
  },
});

export default WaitingRoomScreen;
