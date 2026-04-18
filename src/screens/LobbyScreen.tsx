/**
 * Nägels Online - Lobby Screen
 * Single unified screen: nickname + player count + all game entry points
 * Light theme matching legacy app aesthetic
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
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassButton } from '../components/buttons';
import { GameLogo } from '../components/GameLogo';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { Colors, Spacing, Radius, TextStyles } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';
import { BotDifficulties, type BotDifficulty } from '../lib/bot/botAI';
import { useGameStore, useAuthStore } from '../store';
import { useMultiplayer } from '../hooks/useMultiplayer';
import { AuthModal } from '../components/AuthModal';
import type { GameConfig } from '../lib/supabase/types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface LobbyScreenProps {
  onQuickMatch?: (difficulty: BotDifficulty, botCount: number, playerName: string) => void;
  onRoomCreated: () => void;
  onRoomJoined: () => void;
  onSettings?: () => void;
}

const ACTION_BAR_HEIGHT = 44;

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

  const [nameInput, setNameInput] = useState(playerName || 'Guest');
  const [playerCount, setPlayerCount] = useState(4);

  useEffect(() => {
    if (playerName && playerName !== 'Guest') {
      setNameInput(prev => (prev === 'Guest' || prev === '') ? playerName : prev);
    }
  }, [playerName]);
  const [selectedDifficulty, setSelectedDifficulty] = useState<BotDifficulty>('medium');
  const [joinCode, setJoinCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const { isGuest, displayName: authDisplayName, user } = useAuthStore();

  const saveName = useCallback(async () => {
    const trimmed = nameInput.trim();
    if (trimmed) await setPlayerName(trimmed);
  }, [nameInput, setPlayerName]);

  const handleQuickMatch = useCallback(async () => {
    await saveName();
    setBotDifficulty(selectedDifficulty);
    onQuickMatch?.(selectedDifficulty, playerCount - 1, nameInput.trim() || 'Guest');
  }, [saveName, setBotDifficulty, selectedDifficulty, playerCount, nameInput, onQuickMatch]);

  const handleCreateRoom = useCallback(async () => {
    await saveName();
    setIsCreating(true);
    try {
      const config: Partial<GameConfig> = {
        playerCount,
        maxCards: 10,
        autoStart: false,
      };
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

  // Total bottom clearance = action bar + device safe area
  const bottomClearance = ACTION_BAR_HEIGHT + insets.bottom;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Logo — always centered at the top */}
      <View style={styles.logoHeader}>
        <GameLogo />
      </View>

      {/* Scrollable content — paddingBottom keeps content above the pinned bar */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomClearance + Spacing.md }]}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Nickname */}
        <Text style={styles.label}>{t('multiplayer.yourName')}</Text>
        <TextInput
          style={styles.input}
          value={nameInput}
          onChangeText={setNameInput}
          placeholder="Guest"
          placeholderTextColor={Colors.textMuted}
          maxLength={20}
          autoCapitalize="words"
          testID="input-player-name"
        />

        {/* Player Count */}
        <Text style={styles.label}>
          {t('lobby.playerCount', { count: playerCount })}
        </Text>
        <View style={styles.playerCountRow}>
          {[2, 3, 4, 5, 6].map((n) => (
            <Pressable
              key={n}
              onPress={() => setPlayerCount(n)}
              testID={`player-count-${n}`}
              style={[
                styles.countOption,
                playerCount === n && styles.countOptionSelected,
              ]}
            >
              <Text style={[
                styles.countOptionText,
                playerCount === n && styles.countOptionTextSelected,
              ]}>
                {n}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Difficulty */}
        <Text style={styles.label}>{t('lobby.selectDifficulty')}</Text>
        <View style={styles.difficultyRow}>
          {(Object.keys(BotDifficulties) as BotDifficulty[]).map((d) => (
            <Pressable
              key={d}
              onPress={() => setSelectedDifficulty(d)}
              style={[
                styles.difficultyPill,
                selectedDifficulty === d && styles.difficultyPillSelected,
              ]}
            >
              <Text style={[
                styles.difficultyPillText,
                selectedDifficulty === d && styles.difficultyPillTextSelected,
              ]}>
                {t(`lobby.difficulty.${d}`)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Quick Match */}
        <GlassButton
          title={t('lobby.quickMatch')}
          onPress={handleQuickMatch}
          size="large"
          variant="primary"
          accentColor={Colors.accent}
          style={styles.actionButton}
          testID="btn-quick-match"
        />

        <Divider label={t('lobby.or')} />

        {/* Create Room */}
        {isCreating ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={Colors.accent} />
            <Text style={styles.loadingText}>{t('multiplayer.creatingRoom')}</Text>
          </View>
        ) : (
          <GlassButton
            title={t('lobby.createRoom')}
            onPress={handleCreateRoom}
            size="large"
            variant="secondary"
            accentColor={Colors.accent}
            style={styles.actionButton}
            testID="btn-create-room"
          />
        )}

        <Divider label={t('lobby.or')} />

        {/* Join Room */}
        <View style={styles.joinCard}>
          <Text style={styles.joinLabel}>{t('multiplayer.enterRoomCode')}</Text>
          <TextInput
            style={styles.joinInput}
            value={joinCode}
            onChangeText={(t) => setJoinCode(t.toUpperCase().substring(0, 6))}
            placeholder="ABC123"
            placeholderTextColor={Colors.textMuted}
            maxLength={6}
            autoCapitalize="characters"
            textAlign="center"
            testID="input-join-code"
          />
          {isJoining ? (
            <View style={styles.joinSpinnerRow}>
              <ActivityIndicator size="small" color={Colors.accent} />
            </View>
          ) : (
            <GlassButton
              title={t('multiplayer.joinRoom')}
              onPress={handleJoinRoom}
              size="large"
              variant="primary"
              accentColor={Colors.accent}
              disabled={joinCode.trim().length !== 6}
              style={styles.joinButton}
              testID="btn-join-room"
            />
          )}
        </View>
      </ScrollView>

      {/* Bottom action bar — absolutely pinned, same style as in-game bar */}
      <View style={[styles.actionBar, { bottom: insets.bottom, backgroundColor: colors.surface, borderTopColor: colors.glassLight }]}>
        <Pressable
          style={styles.barButton}
          hitSlop={12}
          onPress={() => setShowLanguageModal(true)}
        >
          <Text style={styles.barLabel}>{t('game.language')}</Text>
        </Pressable>

        <Pressable
          style={styles.barButton}
          hitSlop={12}
          onPress={onSettings}
        >
          <Text style={styles.barLabel}>⚙ {t('settings.title', 'Settings')}</Text>
        </Pressable>

        <Pressable
          style={styles.barButton}
          hitSlop={12}
          onPress={() => setShowAuthModal(true)}
          testID="btn-auth"
        >
          <Text style={styles.barLabel} numberOfLines={1}>
            {isGuest
              ? t('auth.signIn')
              : (user?.email?.split('@')[0] ?? authDisplayName).substring(0, 14)}
          </Text>
        </Pressable>
      </View>

      {/* Language modal */}
      <Modal
        visible={showLanguageModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLanguageModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowLanguageModal(false)}>
          <Pressable onPress={() => {}}>
            <LanguageSwitcher />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Auth modal */}
      <AuthModal visible={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </SafeAreaView>
  );
};

const Divider: React.FC<{ label: string }> = ({ label }) => (
  <View style={styles.dividerContainer}>
    <View style={styles.dividerLine} />
    <Text style={styles.dividerText}>{label}</Text>
    <View style={styles.dividerLine} />
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: undefined, // set via inline style from useTheme
    ...(Platform.OS === 'web' ? { height: SCREEN_HEIGHT } : {}),
  },

  // Centered logo header — not part of scroll
  logoHeader: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    backgroundColor: undefined, // set via inline style from useTheme
  },

  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Platform.OS === 'web' ? 100 : Spacing.xl,
  },

  label: {
    ...TextStyles.body,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
    marginBottom: Spacing.sm,
  },
  input: {
    ...TextStyles.body,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: Colors.glassLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    color: Colors.textPrimary,
    marginBottom: Spacing.lg,
  },
  playerCountRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  countOption: {
    flex: 1,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: Colors.glassLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countOptionSelected: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
    borderWidth: 2,
  },
  countOptionText: {
    ...TextStyles.h3,
    color: Colors.textPrimary,
    fontWeight: '700' as const,
  },
  countOptionTextSelected: {
    color: '#ffffff',
  },
  difficultyRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  difficultyPill: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: Colors.glassLight,
    alignItems: 'center',
  },
  difficultyPillSelected: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
    borderWidth: 2,
  },
  difficultyPillText: {
    ...TextStyles.body,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
  },
  difficultyPillTextSelected: {
    color: '#ffffff',
  },
  actionButton: {
    width: '100%',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  loadingText: {
    ...TextStyles.body,
    color: Colors.textMuted,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.glassLight,
  },
  dividerText: {
    ...TextStyles.caption,
    color: Colors.textMuted,
    marginHorizontal: Spacing.md,
  },
  joinCard: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
    backgroundColor: '#ffffff',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.glassLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    gap: Spacing.sm,
  },
  joinLabel: {
    ...TextStyles.caption,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  joinInput: {
    ...TextStyles.h3,
    color: Colors.textPrimary,
    letterSpacing: 4,
    backgroundColor: undefined, // set via inline style from useTheme
    borderWidth: 1,
    borderColor: Colors.glassLight,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    textAlign: 'center',
  },
  joinButton: {
    width: '100%',
  },
  joinSpinnerRow: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Bottom action bar — absolutely pinned; style identical to GameTableScreen actionBar
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    // bottom is set inline with insets.bottom
    height: ACTION_BAR_HEIGHT,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: Colors.glassLight,
  },
  barButton: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    borderRadius: Radius.sm,
  },
  barLabel: {
    ...TextStyles.caption,
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '600' as const,
  },

  // Language modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
});

export default LobbyScreen;
