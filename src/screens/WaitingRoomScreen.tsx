/**
 * Nägels Online - Waiting Room Screen
 *
 * Pre-game lobby where players gather before starting a game.
 * Reads server-authoritative state from useRoomStore; mutations go through gameClient.
 */

import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
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
import { BrandSwitch } from '../components/BrandSwitch';
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
import { leaveWithConfirm } from '../lib/leaveWithConfirm';
import { subscribeRoom, unsubscribeRoom } from '../lib/realtimeBroadcast';
import { useHeartbeat } from '../lib/heartbeat';
import { usePushSubscribe } from '../lib/push/usePushSubscribe';
import { useReconnectOnFocus } from '../lib/reconnectOnFocus';
import { buildInviteLink } from '../utils/inviteLink';
import { avatarColorFor } from '../utils/avatarColor';
import { UserAvatar } from '../components/UserAvatar';
import { useChatStore } from '../store/chatStore';
import { useSystemEventStore } from '../store/systemEventStore';
import { ChatPanel } from '../components/ChatPanel';
import { PlayerChatTooltip } from '../components/PlayerChatTooltip';
import { useChatTooltipListener } from '../hooks/useChatTooltipListener';
import { useChatTooltipStore } from '../store/chatTooltipStore';
import { StakeSelector } from '../components/stakes/StakeSelector';
import { canPlayForRating } from '../utils/ratingEligibility';
import { useAuthStore } from '../store/authStore';
import { useDesktopGameUI } from './desktop/DesktopGameContext';

// Stable empty-array reference — see note in GameTableScreen.
const EMPTY_ARRAY: any[] = Object.freeze([]) as any;

export interface WaitingRoomScreenProps {
  onGameStart: () => void;
  onLeave: () => void;
  onSettings?: () => void;
  /** Desktop wrappers hoist Chat into a side pane; suppress the modal mount. */
  hideChat?: boolean;
}

/**
 * WaitingRoomScreen - Pre-game lobby
 */
export const WaitingRoomScreen: React.FC<WaitingRoomScreenProps> = ({
  onGameStart,
  onLeave,
  onSettings,
  hideChat = false,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const [startFeedback, setStartFeedback] = useState<string>('');

  const snapshot = useRoomStore((s) => s.snapshot);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const connState = useRoomStore((s) => s.connState);
  const isSpectator = useRoomStore((s) => s.isSpectator);
  const spectators = snapshot?.spectators ?? EMPTY_ARRAY;

  // Desktop wraps this screen in DesktopWaitingRoom which provides the
  // left-pane toggle context. Null on mobile / SP — we fall back to the
  // bottom-sheet SettingsModal there.
  const desktopUI = useDesktopGameUI();
  const room = snapshot?.room ?? null;
  const players = snapshot?.players ?? [];
  const myPlayer = useMemo(
    () => players.find((p) => p.session_id === myPlayerId) ?? null,
    [players, myPlayerId]
  );
  const isHost = !!room && !!myPlayer && room.host_session_id === myPlayer.session_id;
  const amIReady = myPlayer?.is_ready ?? false;
  const authUser = useAuthStore((s) => s.user);
  const authIsGuest = useAuthStore((s) => s.isGuest);
  const selfEligible = canPlayForRating(authUser, authIsGuest);
  // Non-host: host-eligibility is irrelevant to the selector's chip state.
  const hostEligible = isHost ? selfEligible : true;
  const [showChat, setShowChat] = useState(false);
  useChatTooltipListener({
    selfSessionId: myPlayerId,
    isChatOpen: !!hideChat || showChat,
  });
  const chatUnread = useChatStore((s) => s.unread);
  const lastLeft = useSystemEventStore((s) => s.lastLeftMidGame);
  const clearLastLeft = useSystemEventStore((s) => s.clearLeftMidGame);
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

  // Mark this player online every 10s so the host (and others) can see
  // who actually has the tab open vs who closed/locked the device.
  useHeartbeat();

  // Force a fresh snapshot when the tab returns to foreground / online.
  useReconnectOnFocus();

  // Polling fallback while waiting for players. Realtime Broadcast is
  // best-effort: if a peer joins before our channel finishes its SUBSCRIBE
  // handshake, we miss the state_changed event and the host is stuck looking
  // at "1/4" until they mash the sync button. A 2s refetch while in
  // 'waiting' phase fixes that without depending on broadcast delivery.
  useEffect(() => {
    if (!room?.id || room?.phase !== 'waiting') return;
    const id = setInterval(() => {
      void gameClient.refreshSnapshot(room.id);
    }, 2000);
    return () => clearInterval(id);
  }, [room?.id, room?.phase]);

  // Watch for the server transitioning to "playing" — navigate to GameTable.
  useEffect(() => {
    if (room?.phase === 'playing') {
      onGameStart();
    }
  }, [room?.phase, onGameStart]);

  // Auto-prompt for push permission on the first start_game observed by this
  // mount. Piggybacks on phase flipping to 'playing'. If state isn't 'default'
  // (already subscribed / denied / unsupported), skip — Settings is the
  // recovery path. askedRef caps to one ask per WaitingRoom mount.
  const push = usePushSubscribe();
  const askedRef = useRef(false);
  useEffect(() => {
    if (askedRef.current) return;
    if (room?.phase !== 'playing') return;
    if (push.state !== 'default') return;
    askedRef.current = true;
    void push.enable();
  }, [room?.phase, push]);

  // We no longer auto-leave on phase='finished'. The GameTable holds
  // the scoreboard / winner fanfare; from there the host can restart
  // (phase='waiting' again) or any player can leave manually. Bouncing
  // out of WaitingRoom on 'finished' would yank the host out before
  // they could click "Play again" and disorient guests who landed here
  // through a natural goBack.
  //
  // EXCEPTION: pre-game host abandonment. If we're still in WaitingRoom
  // and the room flipped to 'finished' AND the host is no longer in the
  // player list, the host left before the game started — there is no
  // scoreboard to wait for, no "Play again" possible. Eject everyone
  // remaining (players + spectators) to the lobby with a notice.
  const ejectedRef = useRef(false);
  useEffect(() => {
    if (ejectedRef.current) return;
    if (!room || !myPlayerId) return;
    if (room.phase !== 'finished') return;
    if (room.host_session_id === myPlayerId) return;
    const hostStillIn = players.some((p) => p.session_id === room.host_session_id);
    if (hostStillIn) return;
    ejectedRef.current = true;
    const title = t('multiplayer.roomClosedTitle', 'Room closed');
    const body = t('multiplayer.hostLeftBody', 'The host left the room before the game started.');
    if (typeof window !== 'undefined' && typeof (window as any).alert === 'function') {
      (window as any).alert(`${title}\n\n${body}`);
    } else {
      Alert.alert(title, body);
    }
    unsubscribeRoom();
    useRoomStore.getState().reset();
    onLeave();
  }, [room?.phase, room?.host_session_id, myPlayerId, players, onLeave, t]);

  const handleForceReady = useCallback(async (sessionId: string, value: boolean) => {
    if (!room?.id) return;
    await gameClient.setReady(room.id, value, sessionId);
  }, [room?.id]);

  const handleToggleReady = useCallback(async () => {
    if (!room?.id) return;
    await gameClient.setReady(room.id, !amIReady);
  }, [room?.id, amIReady]);

  const handleSwitchRole = useCallback(async (
    targetSessionId: string,
    toRole: 'player' | 'spectator',
  ) => {
    if (!room?.id) return;
    const r = await gameClient.switchRole(room.id, targetSessionId, toRole);
    if (!r.ok) {
      const raw = String(r.error ?? '');
      const map: Record<string, string> = {
        cannot_switch_during_game: 'spectator.cannotSwitchDuringGame',
        room_full: 'spectator.roomFull',
        host_cannot_spectate: 'spectator.hostCannotSpectate',
        not_host: 'spectator.hostCannotSpectate',
      };
      const key = Object.keys(map).find((k) => raw.includes(k));
      const msg = key ? t(map[key]) : t('spectator.switchFailed', { error: raw });
      showMessage(t('common.error'), msg);
    }
    // Success: rooms.version bump → realtime broadcast → snapshot refresh.
    // For the demoted-self case the store still has us as a player; flip
    // isSpectator locally so the badge swaps immediately.
    if (r.ok && targetSessionId === myPlayerId) {
      useRoomStore.getState().setIsSpectator(toRole === 'spectator');
    }
  }, [room?.id, myPlayerId, t]);

  const showMessage = (title: string, body: string) => {
    // Alert.alert is unreliable on react-native-web. Use window.alert directly.
    if (typeof window !== 'undefined' && typeof (window as any).alert === 'function') {
      (window as any).alert(`${title}\n\n${body}`);
    } else {
      Alert.alert(title, body);
    }
  };

  const handleToggleSkipOnes = useCallback(async (next: boolean) => {
    if (!room?.id) return;
    const r = await gameClient.setMinCardsPerHand(room.id, next ? 2 : 1);
    if (!r.ok) {
      console.warn('[WaitingRoom] setMinCardsPerHand failed', r.error);
      showMessage('Error', `Couldn't update mode: ${r.error}`);
      return;
    }
    // Refresh snapshot so the toggle reflects the new server state.
    void gameClient.refreshSnapshot(room.id);
  }, [room?.id]);

  const handleStartGame = useCallback(async () => {
    console.log('[WaitingRoom] start game pressed', { roomId: room?.id });
    setStartFeedback('Starting…');
    if (!room?.id) {
      setStartFeedback('No room');
      showMessage('Error', 'Room not loaded yet — try refresh.');
      return;
    }
    try {
      const r = await gameClient.startGame(room.id);
      console.log('[WaitingRoom] startGame response', r);
      if (!r.ok) {
        const msgMap: Record<string, string> = {
          not_all_seats_filled: 'Wait for all players to join.',
          not_all_ready: 'Wait for all players to mark ready.',
          host_only: 'Only the host can start the game.',
          unknown_room: 'Room not found.',
        };
        const msg = msgMap[r.error] ?? `Server error: ${r.error}`;
        setStartFeedback(msg);
        showMessage('Cannot start', msg);
      } else {
        setStartFeedback('Started!');
      }
    } catch (err) {
      console.error('[WaitingRoom] startGame threw:', err);
      const msg = String((err as Error)?.message ?? err);
      setStartFeedback(`Error: ${msg}`);
      showMessage('Error', msg);
    }
  }, [room?.id]);

  const handleLeave = useCallback(async () => {
    const roomId = room?.id;
    if (roomId) {
      try {
        if (useRoomStore.getState().isSpectator) {
          await gameClient.leaveRoomAsSpectator(roomId);
        } else {
          await gameClient.leaveRoom(roomId);
        }
      } catch (err) {
        console.error('[WaitingRoom] leaveRoom failed:', err);
      }
    }
    unsubscribeRoom();
    useRoomStore.getState().reset();
    onLeave();
  }, [room?.id, onLeave]);

  // Logo-tap leave: confirm for participants (player or host), no
  // confirm for spectators. On a successful exit we always navigate
  // back to the lobby via onLeave.
  const handleLogoLeave = useCallback(async () => {
    const roomId = room?.id;
    if (!roomId) {
      onLeave();
      return;
    }
    const isSpectator = useRoomStore.getState().isSpectator;
    if (isSpectator) {
      try {
        await gameClient.leaveRoomAsSpectator(roomId);
      } catch (err) {
        console.error('[WaitingRoom] leaveRoomAsSpectator failed:', err);
      }
    } else {
      const ok = await leaveWithConfirm(roomId, t, { isHost, context: 'room' });
      if (!ok) return;
    }
    unsubscribeRoom();
    useRoomStore.getState().reset();
    onLeave();
  }, [room?.id, t, isHost, onLeave]);

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

  const handleShareSpectator = useCallback(async () => {
    if (!room) return;
    const link = `${buildInviteLink(room.code)}?as=spectator`;
    const message = `${t('spectator.shareMessage')}\n${link}`;
    try {
      await Share.share(
        { message, title: 'Nägels Online' },
        { dialogTitle: t('spectator.shareLink') }
      );
    } catch {
      await Clipboard.setStringAsync(link);
      Alert.alert(t('multiplayer.codeCopied'), link);
    }
  }, [room, t]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.logoHeader, { borderBottomColor: colors.glassLight }]}>
        <Pressable
          onPress={async () => {
            if (!room?.id) return;
            const { gameClient } = await import('../lib/gameClient');
            await gameClient.refreshSnapshot(room.id);
          }}
          hitSlop={8}
          style={styles.settingsBtn}
          testID="waiting-btn-sync"
        >
          <Text style={{ fontSize: 18 }}>🔄</Text>
        </Pressable>
        <GameLogo
          size="sm"
          onPress={handleLogoLeave}
          testID="app-logo-button"
          accessibilityLabel={t('multiplayer.leaveRoomConfirmTitle')}
        />
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pressable
            onPress={() => {
              setShowChat(true);
              useChatTooltipStore.getState().dismissAll();
            }}
            hitSlop={8}
            style={styles.settingsBtn}
            testID="waiting-btn-chat"
          >
            <Text style={{ fontSize: 18 }}>💬</Text>
            {chatUnread > 0 && (
              <View style={{
                position: 'absolute', top: -4, right: -4,
                minWidth: 16, height: 16, paddingHorizontal: 4,
                borderRadius: 8, backgroundColor: colors.error,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                  {chatUnread > 9 ? '9+' : chatUnread}
                </Text>
              </View>
            )}
          </Pressable>
          {onSettings ? (
            <Pressable
              onPress={() => {
                // Desktop already mounts SettingsBody in the left pane —
                // toggle that pane instead of stacking a bottom-sheet on top.
                if (desktopUI) desktopUI.toggleLeftPanel('settings');
                else onSettings();
              }}
              hitSlop={8}
              style={[
                styles.settingsBtn,
                desktopUI?.leftPanel === 'settings' && {
                  backgroundColor: colors.accent,
                  borderColor: colors.accent,
                },
              ]}
              testID="waiting-btn-settings"
            >
              <Text style={{ fontSize: 18 }}>⚙️</Text>
            </Pressable>
          ) : (
            <View style={{ width: 36 }} />
          )}
        </View>
      </View>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {lastLeft && (
          <Pressable
            onPress={clearLastLeft}
            style={[styles.leftBanner, { backgroundColor: colors.surfaceSecondary, borderColor: colors.glassLight }]}
            testID="left-mid-game-banner"
          >
            <Text style={[styles.leftBannerText, { color: colors.textPrimary }]}>
              {t('multiplayer.leftMidGame', { name: lastLeft.display_name })}
            </Text>
            <Text style={[styles.leftBannerDismiss, { color: colors.textMuted }]}>×</Text>
          </Pressable>
        )}
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
            {!isSpectator && (
              <Pressable
                testID="btn-share-spectator"
                onPress={handleShareSpectator}
                style={styles.shareButton}
                hitSlop={8}
              >
                <Text style={[styles.shareButtonText, { color: colors.textPrimary }]}>
                  👁 {t('spectator.shareLink')}
                </Text>
              </Pressable>
            )}
          </GlassCard>
        )}

        {room && (
          <StakeSelector
            stake={room.stake ?? 0}
            isHost={isHost}
            isHostEligible={hostEligible}
            optedIn={!!myPlayer?.opt_in_stake}
            selfEligible={selfEligible}
            locked={!!room.stake_locked}
            onStakeChange={(s) => gameClient.setStake(room.id, s)}
            onToggleOptIn={(next) => gameClient.toggleStakeOptin(room.id, next)}
          />
        )}

        {/* Players List — hide the count until the snapshot has loaded so
            we don't flash "Players in Room (0/?)" during the brief gap
            between leaving a finished room and navigating away. */}
        {room && (
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            {t('multiplayer.playersInRoom', { count: playerCount, max: room.player_count })}
            {spectators.length > 0 && (
              <Text
                style={[styles.spectatorCount, { color: colors.textSecondary }]}
                testID="spectator-count"
              >
                {`  ·  👁 ${spectators.length}`}
              </Text>
            )}
          </Text>
        )}

        <View style={styles.playersList}>
          {players.map((player, index) => {
            const isDuplicate = players.filter(p => p.display_name === player.display_name).length > 1;
            const isMe = player.session_id === myPlayerId;
            const isHostPlayer = player.session_id === room?.host_session_id;
            // No heartbeat for >30s = treat as offline. Don't gray out
            // myself — my own card always renders before my first ping lands.
            const seenTs = player.last_seen_at ? Date.parse(player.last_seen_at) : NaN;
            const msSince = Number.isNaN(seenTs) ? Infinity : Date.now() - seenTs;
            const isOffline = !isMe && msSince > 30_000;
            // Avatar: prefer user-chosen emoji + color (from auth metadata),
            // fall back to a session-id-hashed color (random-looking, stable).
            const avatarBg = (player as any).avatar_color || avatarColorFor(player.session_id);
            const avatarEmoji = (player as any).avatar as string | null | undefined;
            const avatarUrl = (player as any).avatar_url as string | null | undefined;
            return (
              <View key={player.session_id} style={styles.playerCardWrap}>
                <GlassCard
                  style={[
                    styles.playerCard,
                    { backgroundColor: colors.surface },
                    isMe && [styles.myPlayerCard, { backgroundColor: colors.accent + '18' }],
                    isOffline && { opacity: 0.5 },
                  ]}
                >
                  <UserAvatar
                    avatarUrl={avatarUrl}
                    emoji={avatarEmoji}
                    fallback={(player.display_name?.[0] ?? '?').toUpperCase()}
                    backgroundColor={avatarBg}
                    size={24}
                    textSize={12}
                  />
                  <View style={styles.playerInfo}>
                    <Text style={[styles.playerName, { color: colors.textPrimary }]}>
                      {player.display_name}
                      {isDuplicate && (
                        <Text style={styles.seatSuffix}> #{index + 1}</Text>
                      )}
                      {isMe && (
                        <Text style={styles.youBadge}> ({t('multiplayer.you')})</Text>
                      )}
                      {isOffline && (
                        <Text style={styles.seatSuffix}> · 📡</Text>
                      )}
                      {(player as any).opt_in_stake && (room?.stake ?? 0) > 0 && (
                        <Text
                          testID={`stake-badge-${player.seat_index}`}
                          style={[styles.stakeBadgeText, { color: colors.accent, borderColor: colors.accent }]}
                        >
                          {' ±'}{room?.stake ?? 0}
                        </Text>
                      )}
                    </Text>
                    {isHostPlayer && (
                      <Text style={styles.hostBadge}> {t('multiplayer.host')}</Text>
                    )}
                  </View>
                  <Pressable
                    onPress={() => {
                      if (isHost || isMe) {
                        handleForceReady(player.session_id, !player.is_ready);
                      }
                    }}
                    style={[
                      styles.readyIndicator,
                      { backgroundColor: colors.surfaceSecondary },
                      player.is_ready && styles.readyIndicatorReady,
                    ]}
                    hitSlop={8}
                    testID={`btn-ready-${player.seat_index}`}
                  >
                    <Text style={[
                      styles.readyText,
                      { color: colors.textMuted },
                      player.is_ready && styles.readyTextReady,
                    ]}>
                      {player.is_ready ? '✓' : '○'}
                    </Text>
                  </Pressable>
                  {/* Convert-to-spectator button. Self or host (never the
                      host themselves). Only between games / before start. */}
                  {!isHostPlayer && room?.id && (isMe || isHost) &&
                   (room.phase === 'waiting' || room.phase === 'finished') && (
                    <Pressable
                      onPress={() => handleSwitchRole(player.session_id, 'spectator')}
                      hitSlop={8}
                      style={{ marginLeft: 4, padding: 8 }}
                      testID={`btn-to-spectator-${player.seat_index}`}
                      accessibilityLabel={t('spectator.becomeSpectator')}
                    >
                      <Text style={{ fontSize: 16 }}>👁</Text>
                    </Pressable>
                  )}
                  {isHost && !isMe && !isHostPlayer && room?.id && (
                    <Pressable
                      onPress={async () => {
                        if (typeof window !== 'undefined' &&
                            !(window as any).confirm(`Kick ${player.display_name}?`)) {
                          return;
                        }
                        await gameClient.leaveRoom(room.id, player.session_id);
                      }}
                      hitSlop={8}
                      style={{ marginLeft: 8, padding: 8 }}
                      testID={`btn-kick-${player.seat_index}`}
                    >
                      <Text style={{ color: '#e74c3c', fontSize: 18, fontWeight: '700' }}>✕</Text>
                    </Pressable>
                  )}
                </GlassCard>
                {!isMe && (
                  <PlayerChatTooltip
                    sessionId={player.session_id}
                    onPress={() => {
                      setShowChat(true);
                      useChatTooltipStore.getState().dismissAll();
                    }}
                  />
                )}
              </View>
            );
          })}
        </View>

        {/* Spectators — show only to the host so they can promote into
            empty seats. Self-toggle for the spectator themselves lives
            on the spectator badge further down. */}
        {isHost && spectators.length > 0 && room?.id &&
         (room.phase === 'waiting' || room.phase === 'finished') && (
          <View style={styles.playersList} testID="spectators-list">
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              👁 {t('spectator.spectatorsTitle')}
            </Text>
            {spectators.map((sp: any) => {
              const canPromote = players.length < (room.player_count ?? 6);
              return (
                <GlassCard
                  key={sp.session_id}
                  style={[styles.playerCard, { backgroundColor: colors.surface }]}
                >
                  <UserAvatar
                    avatarUrl={sp.avatar_url ?? null}
                    emoji={sp.avatar ?? null}
                    fallback={(sp.display_name?.[0] ?? '?').toUpperCase()}
                    backgroundColor={sp.avatar_color || avatarColorFor(sp.session_id)}
                    size={24}
                    textSize={12}
                  />
                  <View style={styles.playerInfo}>
                    <Text style={[styles.playerName, { color: colors.textPrimary }]}>
                      {sp.display_name}
                    </Text>
                  </View>
                  {canPromote && (
                    <Pressable
                      onPress={() => handleSwitchRole(sp.session_id, 'player')}
                      hitSlop={8}
                      style={{ marginLeft: 4, padding: 8 }}
                      testID={`btn-to-player-${sp.session_id}`}
                      accessibilityLabel={t('spectator.becomePlayer')}
                    >
                      <Text style={{ fontSize: 16 }}>🃏</Text>
                    </Pressable>
                  )}
                </GlassCard>
              );
            })}
          </View>
        )}

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

        {/* Read-only mode chip for non-hosts so everyone knows the rules. */}
        {!isHost && (room?.min_cards_per_hand ?? 1) >= 2 && (
          <View style={[styles.modeChip, { backgroundColor: colors.accent + '22', borderColor: colors.accent }]}>
            <Text style={[styles.modeChipText, { color: colors.accent }]}>
              {t('gameMode.skipOnes', 'Skip 1-card rounds')}
            </Text>
          </View>
        )}

        {/* Action Buttons */}
        {isSpectator ? (
          <View testID="spectator-badge" style={styles.spectatorBadge}>
            <Text style={[styles.spectatorBadgeText, { color: colors.textPrimary }]}>
              👁 {t('spectator.watching')}
            </Text>
            {room?.id && myPlayerId &&
             (room.phase === 'waiting' || room.phase === 'finished') &&
             players.length < (room.player_count ?? 6) && (
              <Pressable
                onPress={() => handleSwitchRole(myPlayerId, 'player')}
                hitSlop={8}
                style={{
                  marginTop: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: Radius.md,
                  backgroundColor: colors.accent,
                }}
                testID="btn-self-to-player"
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>
                  🃏 {t('spectator.becomePlayer')}
                </Text>
              </Pressable>
            )}
          </View>
        ) : !isHost ? (
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
            {/* Game-mode toggle: replace the two 1-card hands with 2-card
                ones. Host-editable in waiting phase only. */}
            <View style={[styles.modeRow, { backgroundColor: colors.surface, borderColor: colors.glassLight }]} testID="mode-skip-ones-row">
              <View style={{ flex: 1 }}>
                <Text style={[styles.modeLabel, { color: colors.textPrimary }]}>
                  {t('gameMode.skipOnes', 'Skip 1-card rounds')}
                </Text>
                <Text style={[styles.modeHint, { color: colors.textMuted }]}>
                  {t('gameMode.skipOnesHint', 'Middle of the ladder stays at 2 cards')}
                </Text>
              </View>
              <BrandSwitch
                value={(room?.min_cards_per_hand ?? 1) >= 2}
                onValueChange={handleToggleSkipOnes}
                testID="switch-skip-ones"
              />
            </View>
            <GlassButton
              title={t('multiplayer.startGame')}
              onPress={handleStartGame}
              size="large"
              variant="primary"
              accentColor={Colors.highlight}
              disabled={playerCount < 2}
              style={styles.actionButton}
              testID="btn-start-game"
            />
            {!!startFeedback && (
              <Text style={[styles.waitingText, { color: Colors.highlight, fontWeight: '600' }]}>
                {startFeedback}
              </Text>
            )}
            {!canStartGame && !startFeedback && (
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
      {!hideChat && <ChatPanel
        visible={showChat}
        onClose={() => setShowChat(false)}
        sender={(() => {
          if (myPlayer) return {
            sessionId: myPlayer.session_id,
            displayName: myPlayer.display_name,
            avatar: (myPlayer as any).avatar ?? null,
            avatarUrl: (myPlayer as any).avatar_url ?? null,
            avatarColor: (myPlayer as any).avatar_color ?? null,
          };
          if (isSpectator && myPlayerId) {
            const sp = spectators.find((s: any) => s.session_id === myPlayerId);
            if (sp) return {
              sessionId: sp.session_id,
              displayName: sp.display_name,
              avatar: (sp as any).avatar ?? null,
              avatarUrl: (sp as any).avatar_url ?? null,
              avatarColor: (sp as any).avatar_color ?? null,
            };
          }
          return null;
        })()}
      />}
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
  playerCardWrap: {
    position: 'relative',
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
  // "Playing for ±N rating" badge next to opted-in player names.
  // ±N reads instantly as "this player wagers N points either way";
  // a plain ★ was opaque per Akula's feedback.
  stakeBadgeText: {
    ...TextStyles.caption,
    fontWeight: '700',
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
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  modeLabel: { fontSize: 15, fontWeight: '600' },
  modeHint:  { fontSize: 12, marginTop: 2 },
  modeChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  modeChipText: { fontSize: 12, fontWeight: '600' },
  leaveButton: {
    padding: Spacing.md,
    alignItems: 'center',
  },
  leaveButtonText: {
    ...TextStyles.caption,
    color: Colors.textMuted,
  },
  leftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  leftBannerText: {
    ...TextStyles.caption,
    flex: 1,
  },
  leftBannerDismiss: {
    ...TextStyles.h3,
    marginLeft: Spacing.md,
  },
  spectatorBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    alignSelf: 'center',
  },
  spectatorBadgeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  spectatorCount: {
    fontSize: 13,
  },
});

export default WaitingRoomScreen;
