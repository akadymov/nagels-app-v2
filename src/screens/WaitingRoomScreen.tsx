/**
 * Nägels Online - Waiting Room Screen
 *
 * Pre-game lobby where players gather before starting a game
 */

import React, { useEffect, useCallback } from 'react';
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
import { ConnectionStatus } from '../components/ConnectionStatus';
import { GameLogo } from '../components/GameLogo';
import { Colors, Spacing, Radius, TextStyles } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';
import { useMultiplayer } from '../hooks/useMultiplayer';
import { onGameStarted, clearGameStartedCallback } from '../lib/multiplayer/eventHandler';
import { buildInviteLink } from '../utils/inviteLink';

export interface WaitingRoomScreenProps {
  onGameStart: () => void;
  onLeave: () => void;
}

/**
 * WaitingRoomScreen - Pre-game lobby
 *
 * Shows:
 * - Room code (for sharing)
 * - List of players in room
 * - Ready status for each player
 * - Start Game button (host only)
 */
export const WaitingRoomScreen: React.FC<WaitingRoomScreenProps> = ({
  onGameStart,
  onLeave,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const {
    roomPlayers,
    currentRoom,
    myPlayerId,
    isHost,
    amIReady,
    playerCount,
    readyCount,
    canStartGame,
    syncStatus,
    isReconnecting,
    error,
    setReady,
    startGame,
    leaveRoom,
  } = useMultiplayer();

  // Register callback for when host starts the game
  // Note: GameTableScreen handles game initialization when it mounts
  useEffect(() => {
    // Register the callback
    onGameStarted(() => {
      console.log('[WaitingRoom] Game started callback triggered!');
      onGameStart();
    });

    // Cleanup on unmount
    return () => {
      clearGameStartedCallback();
    };
  }, [onGameStart]);

  // Poll for game start as fallback (in case Realtime has issues)
  useEffect(() => {
    // Only poll if not the host (host navigates immediately when they click start)
    if (isHost) return;

    const interval = setInterval(async () => {
      if (!currentRoom?.id) return;

      try {
        // Fetch fresh room status from database
        const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/rooms?id=eq.${currentRoom.id}&select=*`, {
          headers: {
            'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
            'Authorization': `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || ''}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          if (data && data[0] && data[0].status === 'playing') {
            console.log('[WaitingRoom] Polling detected game started!');
            clearInterval(interval);
            onGameStart();
          }
        }
      } catch (error) {
        console.error('[WaitingRoom] Polling error:', error);
      }
    }, 1000); // Check every second

    return () => clearInterval(interval);
  }, [isHost, currentRoom?.id, onGameStart]);

  const handleToggleReady = async () => {
    await setReady(!amIReady);
  };

  const handleStartGame = async () => {
    if (canStartGame) {
      await startGame();
      onGameStart();
    }
  };

  const handleLeave = async () => {
    await leaveRoom();
    onLeave();
  };

  const handleShare = useCallback(async () => {
    if (!currentRoom) return;
    const link = buildInviteLink(currentRoom.roomCode);
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
  }, [currentRoom, t]);

  const getReadyText = () => {
    return t(`multiplayer.${amIReady ? 'ready' : 'notReady'}`);
  };

  const getReadyButtonVariant = () => {
    return amIReady ? 'secondary' : 'primary';
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ConnectionStatus />
      <View style={styles.logoHeader}>
        <GameLogo size="sm" />
      </View>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Room Code Card */}
        {currentRoom && (
          <GlassCard style={styles.roomCodeCard}>
            <Text style={[styles.roomCodeLabel, { color: colors.textSecondary }]}>{t('multiplayer.roomCode')}</Text>
            <Text style={[styles.roomCode, { color: colors.accent }]} testID="room-code">{currentRoom.roomCode}</Text>
            <Pressable
              style={styles.shareButton}
              onPress={handleShare}
              hitSlop={8}
            >
              <Text style={styles.shareButtonText}>
                📤 {t('multiplayer.shareCode')}
              </Text>
            </Pressable>
          </GlassCard>
        )}

        {/* Players List */}
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          {t('multiplayer.playersInRoom', { count: playerCount, max: currentRoom?.maxPlayers ?? '?' })}
        </Text>

        <View style={styles.playersList}>
          {roomPlayers.map((player, index) => {
            const isDuplicate = roomPlayers.filter(p => p.playerName === player.playerName).length > 1;
            return (
            <GlassCard
              key={player.playerId}
              style={[
                styles.playerCard,
                player.playerId === myPlayerId && styles.myPlayerCard,
              ]}
            >
              <View style={styles.seatBadge}>
                <Text style={styles.seatNumber}>{index + 1}</Text>
              </View>
              <View style={styles.playerInfo}>
                <Text style={styles.playerName}>
                  {player.playerName}
                  {isDuplicate && (
                    <Text style={styles.seatSuffix}> #{index + 1}</Text>
                  )}
                  {player.playerId === myPlayerId && (
                    <Text style={styles.youBadge}> ({t('multiplayer.you')})</Text>
                  )}
                </Text>
                {player.isBot && (
                  <Text style={styles.botBadge}> {t('multiplayer.bot')}</Text>
                )}
                {player.playerId === currentRoom?.hostId && (
                  <Text style={styles.hostBadge}> {t('multiplayer.host')}</Text>
                )}
              </View>
              <View style={[
                styles.readyIndicator,
                player.isReady && styles.readyIndicatorReady,
              ]}>
                <Text style={[
                  styles.readyText,
                  player.isReady && styles.readyTextReady,
                ]}>
                  {player.isReady ? '✓' : '○'}
                </Text>
              </View>
            </GlassCard>
            );
          })}
        </View>

        {/* Sync Status */}
        {isReconnecting && (
          <View style={styles.statusBar}>
            <ActivityIndicator size="small" color={Colors.accent} />
            <Text style={styles.statusText}>{t('multiplayer.reconnecting')}</Text>
          </View>
        )}

        {error && (
          <View style={[styles.statusBar, styles.statusBarError]}>
            <Text style={styles.statusError}>{error}</Text>
          </View>
        )}

        {/* Action Buttons */}
        {!isHost ? (
          // Non-host: ready confirmation UI
          <>
            {amIReady ? (
              // Ready state: green confirmation banner
              <View style={styles.readyBanner}>
                <Text style={styles.readyBannerIcon}>✓</Text>
                <Text style={styles.readyBannerText}>{t('multiplayer.youAreReady')}</Text>
                <Pressable onPress={handleToggleReady} style={styles.cancelReadyLink}>
                  <Text style={styles.cancelReadyText}>{t('multiplayer.notReady')}</Text>
                </Pressable>
              </View>
            ) : (
              // Not ready state: prominent call-to-action
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
                total: roomPlayers.filter(p => !p.isBot).length,
              })}
            </Text>
          </>
        ) : (
          // Host: Start Game button (when all ready)
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
                  count: roomPlayers.filter(p => p.playerId !== myPlayerId && p.isReady).length,
                  total: roomPlayers.filter(p => p.playerId !== myPlayerId).length,
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
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.glassLight,
  },
  scrollContent: {
    padding: Spacing.xl,
    paddingTop: Spacing.lg,
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
    backgroundColor: `${Colors.accent}22`,
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
  botBadge: {
    ...TextStyles.caption,
    color: Colors.textMuted,
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
