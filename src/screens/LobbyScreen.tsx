/**
 * Nägels Online - Lobby Screen
 * Tab-based: Create Room / Join Room / Play vs Bots
 * Matches Figma design system
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spacing, Radius } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { GameLogo } from '../components/GameLogo';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { useTranslation } from 'react-i18next';
import { BotDifficulties, type BotDifficulty } from '../lib/bot/botAI';
import { useGameStore } from '../store';
import { gameClient } from '../lib/gameClient';
import { useRoomStore } from '../store/roomStore';
import { subscribeRoom } from '../lib/realtimeBroadcast';
import { getCurrentUser, updateUserMetadata } from '../lib/supabase/authService';
import { setPlayerName as setPlayerNameInStorage, getPlayerName as getPlayerNameFromStorage } from '../lib/supabase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PwaInstallModal } from '../components/PwaInstallModal';
import { isMobileWeb, isStandalone } from '../lib/pwaInstall';
import { SaveProgressModal } from '../components/SaveProgressModal';
import { shouldShowBeforeCreateRoom } from '../lib/auth/promptGate';
import { useNavigation } from '@react-navigation/native';
import { UserAvatar } from '../components/UserAvatar';
import { BrandSwitch } from '../components/BrandSwitch';

const { width: SW } = Dimensions.get('window');

type LobbyTab = 'create' | 'join' | 'bots';

export interface LobbyScreenProps {
  onQuickMatch?: (difficulty: BotDifficulty, botCount: number, playerName: string) => void;
  onRoomCreated: () => void;
  onRoomJoined: () => void;
  onSettings?: () => void;
  /** Desktop split layouts surface "Save Progress" inside the Profile
   *  pane, so the Lobby's own Sign In CTA would just duplicate that. */
  hideAuthCta?: boolean;
  /** Desktop shells already show the brand cluster up top — the
   *  in-screen logo header (small NÄGELS above the nickname row)
   *  is duplicate clutter there. */
  hideLogoHeader?: boolean;
  /** When true, the outer SafeAreaView uses a transparent background
   *  so the surrounding desktop pane's surface color shows through.
   *  Mobile still wants the dark page-background color, so default
   *  stays false. */
  transparentBackground?: boolean;
  /** Slot rendered right after the nickname row. Desktop welcome uses
   *  this to surface the identity cluster (avatar / password / Google)
   *  inline next to the nickname. */
  afterNickname?: React.ReactNode;
  /** Slot rendered after all CTAs (tab content). Desktop welcome uses
   *  this for the preferences cluster (theme / deck / language /
   *  notifications / sign-out). */
  afterCtas?: React.ReactNode;
  /** When true, the inner ScrollView contentContainer gets
   *  flexGrow:1 + justifyContent:'center' so short content sits
   *  centered vertically in the pane. Used by the desktop welcome
   *  right pane; mobile keeps top-aligned content. */
  centerContent?: boolean;
}

export const LobbyScreen: React.FC<LobbyScreenProps> = ({
  onQuickMatch,
  onRoomCreated,
  onRoomJoined,
  onSettings,
  hideAuthCta = false,
  hideLogoHeader = false,
  transparentBackground = false,
  afterNickname,
  afterCtas,
  centerContent = false,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const setBotDifficulty = useGameStore(state => state.setBotDifficulty);
  const authDisplayName = useAuthStore((s) => s.displayName);
  const [playerName, setPlayerNameState] = useState<string>(authDisplayName || 'Guest');

  // Load player name from storage on mount
  useEffect(() => {
    getPlayerNameFromStorage().then((name) => {
      if (name && name !== 'Guest') setPlayerNameState(name);
    });
  }, []);

  // First-visit PWA install prompt — mobile-only, suppressed if already
  // installed or previously dismissed. Delayed so the lobby paints first.
  const [showPwaModal, setShowPwaModal] = useState(false);
  useEffect(() => {
    if (!isMobileWeb() || isStandalone()) return;
    let cancelled = false;
    (async () => {
      const seen = await AsyncStorage.getItem('pwa_install_prompt_seen_v1');
      if (seen) return;
      setTimeout(() => { if (!cancelled) setShowPwaModal(true); }, 600);
    })();
    return () => { cancelled = true; };
  }, []);
  const dismissPwaModal = useCallback(() => {
    setShowPwaModal(false);
    void AsyncStorage.setItem('pwa_install_prompt_seen_v1', '1');
  }, []);

  // Sync auth display name when it changes
  useEffect(() => {
    if (authDisplayName) setPlayerNameState(authDisplayName);
  }, [authDisplayName]);

  const setPlayerName = useCallback(async (name: string) => {
    // Sync writes go FIRST — by the time saveName resolves, any screen
    // that mounts (e.g. Settings opened from the gear button) will read
    // the fresh displayName from authStore. If we awaited AsyncStorage
    // first, Settings could mount mid-tick and read the stale value.
    setPlayerNameState(name);
    useAuthStore.getState().setDisplayName(name);
    // Async persistence — AsyncStorage cache + supabase user_metadata.
    await setPlayerNameInStorage(name);
    try {
      const updated = await updateUserMetadata({ display_name: name });
      useAuthStore.getState().setUser(updated, !!updated.is_anonymous);
    } catch {
      // Offline / supabase down — local state is still updated, will
      // re-sync on next online action.
    }
  }, []);

  const [activeTab, setActiveTab] = useState<LobbyTab>('bots');
  const [nameInput, setNameInput] = useState(playerName || playerName);
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<BotDifficulty | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [roomMode, setRoomMode] = useState<'standard' | 'scorekeeper'>('standard');
  const [announceTelegram, setAnnounceTelegram] = useState(false);
  const [canAnnounce, setCanAnnounce] = useState(false);
  const [showCreateSavePrompt, setShowCreateSavePrompt] = useState(false);
  const pendingCreateRef = useRef(false);
  const navigation = useNavigation<any>();
  const [isJoining, setIsJoining] = useState(false);
  const [showConfirmAlert, setShowConfirmAlert] = useState(false);

  // ── Paused room indicator ─────────────────────────────────────
  type PausedRoomInfo = { room_id: string; code: string; paused_at: string; back: number; total: number };
  const [pausedRoom, setPausedRoom] = useState<PausedRoomInfo | null>(null);
  const [ttlTick, setTtlTick] = useState(0); // bumped every 30s to refresh countdown

  const fetchPausedRoom = useCallback(async () => {
    try {
      const active = await gameClient.getMyActiveRoom();
      if (active?.phase === 'paused' && active.paused_at) {
        let back = 0, total = 0;
        try {
          const { getSupabaseClient } = await import('../lib/supabase/client');
          const { data: snap } = await getSupabaseClient().rpc('get_room_state', { p_room_id: active.room_id });
          const lineup: string[] = ((snap as any)?.room?.paused_lineup ?? []) as string[];
          const players: Array<{ session_id: string; last_seen_at: string }> = ((snap as any)?.players ?? []) as any[];
          const LIVE_MS = 30_000;
          total = lineup.length;
          back = lineup.filter((sid) => {
            const p = players.find((x) => x.session_id === sid);
            return !!p && (Date.now() - Date.parse(p.last_seen_at)) < LIVE_MS;
          }).length;
        } catch { /* counter is best-effort; 0/0 hides the line */ }
        setPausedRoom({ room_id: active.room_id, code: active.code, paused_at: active.paused_at, back, total });
      } else {
        setPausedRoom(null);
      }
    } catch {
      // Non-fatal: silently skip if network is unavailable
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    void fetchPausedRoom();
  }, [fetchPausedRoom]);

  // Re-fetch when the lobby comes back into focus (e.g. user navigated away and returned)
  useFocusEffect(
    useCallback(() => {
      void fetchPausedRoom();
    }, [fetchPausedRoom]),
  );

  // Countdown tick every 30s while mounted
  useEffect(() => {
    if (!pausedRoom) return;
    const id = setInterval(() => { setTtlTick((n) => n + 1); void fetchPausedRoom(); }, 30_000);
    return () => clearInterval(id);
  }, [pausedRoom, fetchPausedRoom]);

  const pausedRoomTimeStr = (() => {
    if (!pausedRoom) return '';
    const ttlMs = Date.parse(pausedRoom.paused_at) + 48 * 3600_000 - Date.now();
    const hh = Math.max(0, Math.floor(ttlMs / 3600_000));
    const mm = Math.max(0, Math.floor((ttlMs % 3600_000) / 60_000));
    return `${hh}h ${mm}m`;
  })();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void ttlTick; // consumed only to trigger re-render

  useEffect(() => {
    if (playerName && playerName !== 'Guest') {
      setNameInput(prev => (prev === 'Guest' || prev === '') ? playerName : prev);
    }
  }, [playerName]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [allow, adminRes] = await Promise.all([
        gameClient.canAnnounceTelegram().catch(() => false),
        gameClient.adminCheck().catch(() => ({ is_admin: false })),
      ]);
      if (!cancelled) setCanAnnounce(allow || !!adminRes.is_admin);
    })();
    return () => { cancelled = true; };
  }, []);

  const saveName = useCallback(async () => {
    const trimmed = nameInput.trim();
    if (trimmed) await setPlayerName(trimmed);
  }, [nameInput, setPlayerName]);

  const canStartMatch = playerCount !== null && selectedDifficulty !== null;
  const user = useAuthStore((s) => s.user);
  const isGuest = useAuthStore((s) => s.isGuest);
  const gamesPlayed = useSettingsStore((s) => s.gamesPlayedUnconfirmed);
  const pendingEmail = useSettingsStore((s) => s.pendingEmail);
  const incrementGamesPlayed = useSettingsStore((s) => s.incrementGamesPlayed);

  // On mount: refresh session to check if email was confirmed in another tab/browser
  useEffect(() => {
    const checkConfirmation = async () => {
      try {
        const { getCurrentUser } = require('../lib/supabase/authService');
        const freshUser = await getCurrentUser();
        if (freshUser && freshUser.email_confirmed_at && pendingEmail) {
          useSettingsStore.getState().resetGamesPlayed();
          useAuthStore.getState().setUser(freshUser, false);
        }
      } catch {}
    };
    if (pendingEmail) checkConfirmation();
  }, [pendingEmail]);

  // Check if user registered but hasn't confirmed email
  const hasUnconfirmedEmail = (user && user.email && !user.email_confirmed_at) || !!pendingEmail;
  const needsEmailConfirmation = hasUnconfirmedEmail && gamesPlayed >= 1;


  const handleQuickMatch = useCallback(async () => {
    if (!canStartMatch) return;
    // Read fresh state to avoid stale closure
    const currentGames = useSettingsStore.getState().gamesPlayedUnconfirmed;
    const currentPending = useSettingsStore.getState().pendingEmail;
    const currentUser = useAuthStore.getState().user;
    const emailUnconfirmed = (currentUser && currentUser.email && !currentUser.email_confirmed_at) || !!currentPending;
    if (emailUnconfirmed && currentGames >= 1) {
      setShowConfirmAlert(true);
      return;
    }
    await saveName();
    setBotDifficulty(selectedDifficulty!);
    incrementGamesPlayed();
    onQuickMatch?.(selectedDifficulty!, playerCount! - 1, nameInput.trim() || playerName);
  }, [saveName, setBotDifficulty, selectedDifficulty, playerCount, nameInput, onQuickMatch, canStartMatch]);

  const setMyPlayerIdInRoomStore = (sessionId: string, players: any[]) => {
    // Find my session_id in the snapshot players list
    const me = players.find((p) => p.session_id === sessionId);
    if (me) {
      useRoomStore.getState().setMyPlayerId(me.session_id);
    }
  };

  const performCreateRoom = useCallback(async () => {
    const currentPending = useSettingsStore.getState().pendingEmail;
    const currentUser = useAuthStore.getState().user;
    const unconfirmed = (currentUser && currentUser.email && !currentUser.email_confirmed_at) || !!currentPending;
    if (unconfirmed) {
      setShowConfirmAlert(true);
      return;
    }
    await saveName();
    setIsCreating(true);
    try {
      const displayName = (nameInput.trim() || playerName) ?? 'Guest';
      const result = await gameClient.createRoom(displayName, playerCount ?? 4, 10, roomMode, announceTelegram);
      if (!result.ok) {
        const code = result.error || 'Failed to create room';
        const friendly = code === 'too_many_rooms'
          ? t('multiplayer.tooManyRooms', 'You\'ve created too many rooms in the past hour. Try again later.')
          : code;
        throw new Error(friendly);
      }
      const user = await getCurrentUser();
      if (user && result.state.players) {
        setMyPlayerIdInRoomStore(user.id, result.state.players);
      }
      const roomId = result.state.room?.id;
      if (roomId) {
        const { setActiveRoom } = await import('../lib/activeRoom');
        await setActiveRoom(roomId, result.state.room?.code, 'player');
        subscribeRoom(roomId);
      }
      onRoomCreated();
    } catch (error: unknown) {
      console.error('[Lobby] create threw:', error);
      const message = error instanceof Error ? error.message : 'Failed to create room';
      if (typeof window !== 'undefined' && typeof (window as any).alert === 'function') {
        (window as any).alert(`Error\n\n${message}`);
      } else {
        Alert.alert(t('common.error'), message);
      }
    } finally {
      setIsCreating(false);
    }
  }, [saveName, playerCount, nameInput, playerName, onRoomCreated, t, roomMode, announceTelegram]);

  const handleCreateRoom = useCallback(async () => {
    // Soft prompt — only the first create per anonymous device sees it.
    // The modal's onResolved continues into performCreateRoom regardless
    // of which dismissal action the user picked.
    if (await shouldShowBeforeCreateRoom()) {
      pendingCreateRef.current = true;
      setShowCreateSavePrompt(true);
      return;
    }
    await performCreateRoom();
  }, [performCreateRoom]);

  const handleJoinRoom = useCallback(async () => {
    const showMsg = (title: string, body: string) => {
      if (typeof window !== 'undefined' && typeof (window as any).alert === 'function') {
        (window as any).alert(`${title}\n\n${body}`);
      } else {
        Alert.alert(title, body);
      }
    };

    console.log('[Lobby] join pressed', { code: joinCode });
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) {
      showMsg(t('common.error'), t('multiplayer.invalidCode'));
      return;
    }
    await saveName();
    setIsJoining(true);
    try {
      const displayName = (nameInput.trim() || playerName) ?? 'Guest';
      const result = await gameClient.joinRoom(displayName, code);
      console.log('[Lobby] joinRoom response', result);
      if (!result.ok) {
        const err = (result as any).error || 'Failed to join room';
        const errMap: Record<string, string> = {
          unknown_room: t('multiplayer.roomNotFound'),
          room_full: t('multiplayer.roomFull'),
          room_in_progress: 'Game already in progress.',
          seat_taken: 'Seat already taken — try again.',
        };
        showMsg(t('common.error'), errMap[err] ?? err);
        return;
      }
      const user = await getCurrentUser();
      if (user && result.state.players) {
        setMyPlayerIdInRoomStore(user.id, result.state.players);
      }
      const roomId = result.state.room?.id;
      if (roomId) {
        const { setActiveRoom } = await import('../lib/activeRoom');
        await setActiveRoom(roomId, result.state.room?.code, 'player');
        subscribeRoom(roomId);
      }
      onRoomJoined();
    } catch (error: unknown) {
      console.error('[Lobby] join threw:', error);
      const message = error instanceof Error ? error.message : 'Failed to join room';
      showMsg(t('common.error'), message);
    } finally {
      setIsJoining(false);
    }
  }, [joinCode, saveName, nameInput, playerName, onRoomJoined, t]);

  const TabButton: React.FC<{ tab: LobbyTab; label: string; disabled?: boolean }> = ({ tab, label, disabled }) => {
    const isActive = activeTab === tab;
    return (
      <Pressable
        style={[
          styles.tabBtn,
          { backgroundColor: isActive ? colors.accent : colors.surface, borderColor: colors.accent },
          disabled && { opacity: 0.35 },
        ]}
        onPress={() => !disabled && setActiveTab(tab)}
        disabled={disabled}
        testID={`tab-${tab}`}
      >
        <Text style={[styles.tabBtnText, { color: isActive ? '#ffffff' : colors.accent }]}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: transparentBackground ? 'transparent' : colors.background },
      ]}
      edges={['top', 'bottom']}
    >
      {/* Logo — hidden in desktop shells that already show the brand
          cluster up top. The gear stays available because mobile and
          some desktop variants still need it. */}
      {!hideLogoHeader && (
        <View style={[styles.logoHeader, { borderBottomColor: colors.glassLight }]}>
          <GameLogo size="sm" />
          {onSettings && (
            <Pressable onPress={onSettings} hitSlop={12} style={styles.settingsBtn} testID="btn-open-settings">
              <Text style={{ fontSize: 20, color: colors.textPrimary }}>⚙</Text>
            </Pressable>
          )}
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          centerContent && { flexGrow: 1, justifyContent: 'center' },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Nickname */}
        <View style={[styles.nicknameRow, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <View style={{ marginRight: Spacing.sm }}>
            <UserAvatar
              avatarUrl={(user?.user_metadata?.avatar_url as string | undefined) ?? null}
              emoji={(user?.user_metadata?.avatar as string | undefined) ?? '🦈'}
              fallback={(nameInput || playerName || 'P')[0].toUpperCase()}
              backgroundColor={colors.surfaceSecondary}
              size={28}
              textSize={18}
            />
          </View>
          <TextInput
            style={[styles.nicknameInput, { color: colors.textPrimary }]}
            value={nameInput}
            onChangeText={setNameInput}
            onBlur={saveName}
            onSubmitEditing={saveName}
            placeholder="Guest"
            placeholderTextColor={colors.textMuted}
            maxLength={20}
            autoCapitalize="words"
            testID="input-player-name"
          />
        </View>

        {afterNickname}

        {/* Paused room indicator — shown when the user has a frozen game */}
        {pausedRoom && (
          <Pressable
            testID="lobby-paused-card"
            onPress={async () => {
              const { setActiveRoom } = await import('../lib/activeRoom');
              const { subscribeRoom } = await import('../lib/realtimeBroadcast');
              const { getSupabaseClient } = await import('../lib/supabase/client');
              const { useRoomStore: roomStore } = await import('../store/roomStore');
              try {
                const supabase = getSupabaseClient();
                const { data } = await supabase.rpc('get_room_state', { p_room_id: pausedRoom.room_id });
                if (data) {
                  const snap = data as any;
                  roomStore.getState().applySnapshot(snap, Number(snap?.room?.version ?? 0));
                }
                await setActiveRoom(pausedRoom.room_id, pausedRoom.code, 'player');
                subscribeRoom(pausedRoom.room_id);
              } catch {
                // Non-fatal: navigate anyway; GameTableScreen will resync
              }
              navigation.navigate('GameTable', { isMultiplayer: true });
            }}
            style={({ pressed }) => [
              styles.pausedCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.accent,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text style={[styles.pausedCardTitle, { color: colors.textPrimary }]}>
              ⏸ {t('freeze.lobbyCard', { code: pausedRoom.code })}
            </Text>
            <Text style={[styles.pausedCardSub, { color: colors.textMuted }]}>
              {t('freeze.autoCloseIn', { time: pausedRoomTimeStr })}
            </Text>
            {pausedRoom.total > 0 && (
              <Text style={[styles.pausedCardSub, { color: colors.textMuted }]}>
                {t('freeze.returnedCount', { n: pausedRoom.back, total: pausedRoom.total })}
              </Text>
            )}
          </Pressable>
        )}

        {/* Sign In / Create Account — visible to anonymous guests only.
            Desktop wrappers set hideAuthCta to suppress this CTA since the
            Profile pane already carries a Save Progress button. */}
        {isGuest && !hideAuthCta && (
          <Pressable
            onPress={() => navigation.navigate('Auth')}
            style={[styles.signInBtn, { borderColor: colors.accent }]}
            testID="lobby-sign-in"
          >
            <Text style={[styles.signInBtnText, { color: colors.accent }]}>
              {t('auth.signIn')} / {t('auth.signUp')}
            </Text>
          </Pressable>
        )}

        {/* Email confirmation warning */}
        {hasUnconfirmedEmail && (
          <View style={[styles.confirmBanner, { backgroundColor: colors.warning + '20', borderColor: colors.warning }]}>
            <Text style={[styles.confirmBannerText, { color: colors.warning }]}>
              ⚠ {t('auth.emailNotConfirmed', 'Email not confirmed')}
            </Text>
            <Text style={[styles.confirmBannerSub, { color: colors.textMuted }]}>
              {needsEmailConfirmation
                ? t('auth.confirmToPlay', 'Please confirm your email to continue playing.')
                : t('auth.oneGameLeft', 'You can play 1 game. Confirm email for unlimited access.')}
            </Text>
          </View>
        )}

        {/* Tab buttons */}
        <View style={styles.tabRow}>
          <TabButton tab="create" label={t('lobby.createRoom')} disabled={hasUnconfirmedEmail} />
          <TabButton tab="join" label={t('multiplayer.joinRoom')} />
          <TabButton tab="bots" label={t('lobby.playVsBots', 'Play vs Bots')} />
        </View>

        {/* Tab content */}
        {activeTab === 'bots' && (
          <View style={styles.tabContent}>
            {/* Player count */}
            <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>
              {t('lobby.playerCount', { count: playerCount ?? 0 })}
            </Text>
            <View style={styles.chipRow}>
              {[2, 3, 4, 5, 6].map((n) => (
                <Pressable
                  key={n}
                  onPress={() => setPlayerCount(n)}
                  testID={`player-count-${n}`}
                  style={[
                    styles.chip,
                    { backgroundColor: colors.surface, borderColor: colors.glassLight },
                    playerCount === n && { backgroundColor: colors.accent, borderColor: colors.accent },
                  ]}
                >
                  <Text style={[
                    styles.chipText,
                    { color: colors.textSecondary },
                    playerCount === n && { color: '#ffffff' },
                  ]}>
                    {n}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Difficulty */}
            <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>
              {t('lobby.selectDifficulty')}
            </Text>
            <View style={styles.chipRow}>
              {(Object.keys(BotDifficulties) as BotDifficulty[]).map((d) => (
                <Pressable
                  key={d}
                  onPress={() => setSelectedDifficulty(d)}
                  testID={`difficulty-${d}`}
                  style={[
                    styles.diffChip,
                    { backgroundColor: colors.surface, borderColor: colors.glassLight },
                    selectedDifficulty === d && { backgroundColor: colors.accent, borderColor: colors.accent },
                  ]}
                >
                  <Text style={[
                    styles.chipText,
                    { color: colors.textSecondary },
                    selectedDifficulty === d && { color: '#ffffff' },
                  ]}>
                    {t(`lobby.difficulty.${d}`)}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Start */}
            <Pressable
              style={[styles.actionBtn, { backgroundColor: canStartMatch ? colors.accent : colors.accentMuted, opacity: canStartMatch ? 1 : 0.5 }]}
              onPress={handleQuickMatch}
              disabled={!canStartMatch}
              testID="btn-quick-match"
            >
              <Text style={styles.actionBtnText}>
                {t('lobby.quickMatch', 'Start Quick Match')}
              </Text>
            </Pressable>
          </View>
        )}

        {activeTab === 'join' && (
          <View style={styles.tabContent}>
            <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>
              {t('multiplayer.enterRoomCode')}
            </Text>
            <TextInput
              style={[styles.codeInput, { backgroundColor: colors.surface, color: colors.textPrimary, borderColor: colors.glassLight }]}
              value={joinCode}
              onChangeText={(v) => setJoinCode(v.toUpperCase().substring(0, 6))}
              placeholder="ABC123"
              placeholderTextColor={colors.textMuted}
              maxLength={6}
              autoCapitalize="characters"
              textAlign="center"
              testID="input-join-code"
            />
            <Pressable
              style={[styles.actionBtn, { backgroundColor: joinCode.trim().length === 6 ? colors.accent : colors.accentMuted, opacity: joinCode.trim().length === 6 ? 1 : 0.5 }]}
              onPress={handleJoinRoom}
              disabled={joinCode.trim().length !== 6}
              testID="btn-join-room"
            >
              {isJoining ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.actionBtnText}>{t('multiplayer.joinRoom')}</Text>
              )}
            </Pressable>
          </View>
        )}

        {activeTab === 'create' && (
          <View style={styles.tabContent}>
            <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>
              {t('scorekeeper.gameMode')}
            </Text>
            <View style={styles.chipRow}>
              {(['standard', 'scorekeeper'] as const).map((m) => {
                const active = roomMode === m;
                return (
                  <Pressable
                    key={m}
                    onPress={() => setRoomMode(m)}
                    testID={`room-mode-${m}`}
                    style={[
                      styles.diffChip,
                      { backgroundColor: colors.surface, borderColor: colors.glassLight },
                      active && { backgroundColor: colors.accent, borderColor: colors.accent },
                    ]}
                  >
                    <Text style={[
                      styles.chipText,
                      { color: colors.textSecondary },
                      active && { color: '#ffffff' },
                    ]}>
                      {t(`scorekeeper.mode${m === 'standard' ? 'Standard' : 'Scorekeeper'}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.modeHint, { color: colors.textMuted }]}>
              {t(`scorekeeper.mode${roomMode === 'standard' ? 'Standard' : 'Scorekeeper'}Desc`)}
            </Text>
            {canAnnounce && (
              <View
                style={[
                  styles.announceRow,
                  { backgroundColor: colors.surface, borderColor: colors.glassLight },
                ]}
                testID="row-announce-telegram"
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.announceLabel, { color: colors.textPrimary }]}>
                    {t('lobby.announceTelegram', 'Announce in Telegram')}
                  </Text>
                  <Text style={[styles.announceHint, { color: colors.textMuted }]}>
                    {t('lobby.announceTelegramHint', 'Post a "new room" message to the public channel.')}
                  </Text>
                </View>
                <BrandSwitch
                  value={announceTelegram}
                  onValueChange={setAnnounceTelegram}
                  testID="switch-announce-telegram"
                />
              </View>
            )}
            <Pressable
              style={[styles.actionBtn, { backgroundColor: colors.accent }]}
              onPress={handleCreateRoom}
              testID="btn-create-room"
            >
              {isCreating ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.actionBtnText}>{t('lobby.createRoom')}</Text>
              )}
            </Pressable>
          </View>
        )}

        {afterCtas}
      </ScrollView>

      {/* Email confirmation alert (replaces Alert.alert which doesn't work on web) */}
      {showConfirmAlert && (
        <View style={styles.alertOverlay}>
          <View style={[styles.alertBox, { backgroundColor: colors.surface }]}>
            <Text style={[styles.alertTitle, { color: colors.warning }]}>
              ⚠ {t('auth.emailNotConfirmed', 'Email not confirmed')}
            </Text>
            <Text style={[styles.alertMessage, { color: colors.textSecondary }]}>
              {t('auth.confirmToPlay', 'Please confirm your email to continue playing. Check your inbox.')}
            </Text>
            <Pressable
              style={[styles.alertBtn, { backgroundColor: colors.accent }]}
              onPress={() => setShowConfirmAlert(false)}
            >
              <Text style={styles.alertBtnText}>OK</Text>
            </Pressable>
          </View>
        </View>
      )}
      <PwaInstallModal visible={showPwaModal} onClose={dismissPwaModal} />
      <SaveProgressModal
        visible={showCreateSavePrompt}
        trigger="beforeCreate"
        onResolved={async () => {
          setShowCreateSavePrompt(false);
          if (pendingCreateRef.current) {
            pendingCreateRef.current = false;
            await performCreateRoom();
          }
        }}
        onUseEmail={() => {
          pendingCreateRef.current = false;
          setShowCreateSavePrompt(false);
          navigation.navigate('Auth');
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  logoHeader: {
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    position: 'relative',
  },
  settingsBtn: {
    position: 'absolute',
    right: Spacing.lg,
    top: Spacing.sm,
    padding: Spacing.xs,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
    paddingBottom: 160,
  },
  // Nickname
  nicknameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    height: 52,
  },
  nicknameIcon: {
    fontSize: 18,
    marginRight: Spacing.sm,
  },
  nicknameInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  // Paused room card
  pausedCard: {
    borderWidth: 1.5,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: 4,
  },
  pausedCardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  pausedCardSub: {
    fontSize: 13,
  },
  // Confirm banner
  confirmBanner: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
    gap: 4,
  },
  confirmBannerText: {
    fontSize: 14,
    fontWeight: '700',
  },
  confirmBannerSub: {
    fontSize: 12,
    textAlign: 'center',
  },
  // Alert overlay
  alertOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  alertBox: {
    width: '85%',
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  alertTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  alertMessage: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  alertBtn: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  alertBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  // Tabs
  tabRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  tabBtn: {
    flex: 1,
    height: 52,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  // Tab content
  tabContent: {
    gap: Spacing.md,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  chip: {
    flex: 1,
    height: 52,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diffChip: {
    flex: 1,
    height: 52,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 15,
    fontWeight: '600',
  },
  modeHint: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: -Spacing.sm,
  },
  announceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginTop: Spacing.md,
  },
  announceLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  announceHint: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  // Code input
  codeInput: {
    height: 56,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 8,
    paddingHorizontal: Spacing.lg,
    textAlign: 'center',
  },
  // Action button
  actionBtn: {
    height: 56,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  actionBtnText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  signInBtn: {
    height: 44,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

export default LobbyScreen;
