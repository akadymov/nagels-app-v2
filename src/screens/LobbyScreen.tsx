/**
 * Nägels Online - Lobby Screen
 * Tab-based: Create Room / Join Room / Play vs Bots
 * Matches Figma design system
 */

import React, { useState, useCallback, useEffect } from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spacing, Radius } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { GameLogo } from '../components/GameLogo';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { useTranslation } from 'react-i18next';
import { BotDifficulties, type BotDifficulty } from '../lib/bot/botAI';
import { useGameStore } from '../store';
import { useMultiplayer } from '../hooks/useMultiplayer';
import type { GameConfig } from '../lib/supabase/types';

const { width: SW } = Dimensions.get('window');

type LobbyTab = 'create' | 'join' | 'bots';

export interface LobbyScreenProps {
  onQuickMatch?: (difficulty: BotDifficulty, botCount: number, playerName: string) => void;
  onRoomCreated: () => void;
  onRoomJoined: () => void;
  onSettings?: () => void;
}

export const LobbyScreen: React.FC<LobbyScreenProps> = ({
  onQuickMatch,
  onRoomCreated,
  onRoomJoined,
  onSettings,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const setBotDifficulty = useGameStore(state => state.setBotDifficulty);
  const { playerName, setPlayerName, createRoom, joinRoom } = useMultiplayer();

  const [activeTab, setActiveTab] = useState<LobbyTab>('bots');
  const [nameInput, setNameInput] = useState(playerName || playerName);
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<BotDifficulty | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [showConfirmAlert, setShowConfirmAlert] = useState(false);

  useEffect(() => {
    if (playerName && playerName !== 'Guest') {
      setNameInput(prev => (prev === 'Guest' || prev === '') ? playerName : prev);
    }
  }, [playerName]);

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

  const handleCreateRoom = useCallback(async () => {
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
      const config: Partial<GameConfig> = { playerCount: playerCount ?? 4, maxCards: 10, autoStart: false };
      await createRoom(config);
      onRoomCreated();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create room';
      Alert.alert(t('common.error'), message);
    } finally {
      setIsCreating(false);
    }
  }, [saveName, playerCount, createRoom, onRoomCreated, t]);

  const handleJoinRoom = useCallback(async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) {
      Alert.alert(t('common.error'), t('multiplayer.invalidCode'));
      return;
    }
    await saveName();
    setIsJoining(true);
    try {
      await joinRoom(code);
      onRoomJoined();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to join room';
      if (message.includes('not found')) {
        Alert.alert(t('common.error'), t('multiplayer.roomNotFound'));
      } else if (message.includes('full')) {
        Alert.alert(t('common.error'), t('multiplayer.roomFull'));
      } else {
        Alert.alert(t('common.error'), message);
      }
    } finally {
      setIsJoining(false);
    }
  }, [joinCode, saveName, joinRoom, onRoomJoined, t]);

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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      {/* Logo */}
      <View style={[styles.logoHeader, { borderBottomColor: colors.glassLight }]}>
        <GameLogo size="sm" />
        {onSettings && (
          <Pressable onPress={onSettings} hitSlop={12} style={styles.settingsBtn}>
            <Text style={{ fontSize: 20, color: colors.textPrimary }}>⚙</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Nickname */}
        <View style={[styles.nicknameRow, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.nicknameIcon, { color: colors.textMuted }]}>🦈</Text>
          <TextInput
            style={[styles.nicknameInput, { color: colors.textPrimary }]}
            value={nameInput}
            onChangeText={setNameInput}
            placeholder="Guest"
            placeholderTextColor={colors.textMuted}
            maxLength={20}
            autoCapitalize="words"
            testID="input-player-name"
          />
        </View>

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
});

export default LobbyScreen;
