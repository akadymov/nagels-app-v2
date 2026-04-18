/**
 * Nägels Online - Join Room Screen
 *
 * Join a private room by entering the room code
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GlassCard } from '../components/glass';
import { GlassButton } from '../components/buttons';
import { Colors, Spacing, Radius, TextStyles } from '../constants';
import { useTranslation } from 'react-i18next';
import { useMultiplayer } from '../hooks/useMultiplayer';

export interface JoinRoomScreenProps {
  onRoomJoined: () => void;
  onBack: () => void;
  initialCode?: string; // Pre-filled from deep link
}

/**
 * JoinRoomScreen - Join a private game room by code
 */
export const JoinRoomScreen: React.FC<JoinRoomScreenProps> = ({
  onRoomJoined,
  onBack,
  initialCode,
}) => {
  const { t } = useTranslation();
  const { playerName, setPlayerName, joinRoom } = useMultiplayer();

  const [playerNameInput, setPlayerNameInput] = useState(playerName);
  const [roomCode, setRoomCode] = useState(initialCode?.toUpperCase() ?? '');
  const [isJoining, setIsJoining] = useState(false);

  const formatRoomCode = useCallback((text: string) => {
    // Uppercase and limit to 6 characters
    return text.toUpperCase().substring(0, 6);
  }, []);

  const handleRoomCodeChange = useCallback((text: string) => {
    setRoomCode(formatRoomCode(text));
  }, [formatRoomCode]);

  const handleJoinRoom = useCallback(async () => {
    const trimmedCode = roomCode.trim().toUpperCase();

    if (trimmedCode.length !== 6) {
      Alert.alert(t('common.error'), t('multiplayer.invalidCode'));
      return;
    }

    if (playerNameInput.trim()) {
      await setPlayerName(playerNameInput.trim());
    }

    setIsJoining(true);
    try {
      await joinRoom(trimmedCode);
      onRoomJoined();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to join room';
      if (message.includes('not found')) {
        Alert.alert(t('common.error'), t('multiplayer.roomNotFound'));
      } else if (message.includes('full')) {
        Alert.alert(t('common.error'), t('multiplayer.roomFull'));
      } else if (message.includes('not accepting')) {
        Alert.alert(t('common.error'), t('multiplayer.roomNotAccepting'));
      } else {
        Alert.alert(t('common.error'), message);
      }
    } finally {
      setIsJoining(false);
    }
  }, [roomCode, playerNameInput, setPlayerName, joinRoom, onRoomJoined, t]);

  // Auto-join when opened from a deep link (code pre-filled)
  useEffect(() => {
    if (initialCode?.length === 6) {
      const timer = setTimeout(() => handleJoinRoom(), 400);
      return () => clearTimeout(timer);
    }
  }, [initialCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const canJoin = roomCode.length === 6 && !isJoining;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.content}>
        {/* Player Name Input */}
        <Text style={styles.label}>{t('multiplayer.yourName')}</Text>
        <TextInput
          style={styles.input}
          value={playerNameInput}
          onChangeText={setPlayerNameInput}
          placeholder={t('multiplayer.namePlaceholder')}
          placeholderTextColor={Colors.textMuted}
          maxLength={20}
          autoCapitalize="words"
        />

        {/* Room Code Input */}
        <Text style={styles.label}>{t('multiplayer.enterRoomCode')}</Text>
        <GlassCard style={styles.codeInputCard}>
          <TextInput
            style={styles.codeInput}
            value={roomCode}
            onChangeText={handleRoomCodeChange}
            placeholder="ABC123"
            placeholderTextColor={Colors.textMuted}
            maxLength={6}
            autoCapitalize="characters"
            autoFocus
            textAlign="center"
          />
        </GlassCard>

        {/* Info */}
        <GlassCard style={styles.infoCard}>
          <Text style={styles.infoTitle}>{t('multiplayer.howToJoin')}</Text>
          <Text style={styles.infoText}>
            {t('multiplayer.enterCodeFromHost')}
          </Text>
          <Text style={styles.infoText}>
            {t('multiplayer.codeIsCaseInsensitive')}
          </Text>
        </GlassCard>

        {/* Join Button */}
        {isJoining ? (
          <View style={styles.joiningContainer}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={styles.joiningText}>{t('multiplayer.joiningRoom')}</Text>
          </View>
        ) : (
          <GlassButton
            title={t('multiplayer.joinRoom')}
            onPress={handleJoinRoom}
            size="large"
            variant="primary"
            accentColor={Colors.accent}
            disabled={!canJoin}
            style={styles.joinButton}
          />
        )}

        {/* Back Button */}
        <GlassButton
          title={t('common.back')}
          onPress={onBack}
          size="medium"
          variant="outline"
          style={styles.backButton}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
    padding: Spacing.xl,
    paddingTop: Spacing.xxl,
  },
  label: {
    ...TextStyles.body,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },
  input: {
    ...TextStyles.body,
    backgroundColor: Colors.glassDark,
    borderWidth: 1,
    borderColor: Colors.glassLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    color: Colors.textPrimary,
    marginBottom: Spacing.xl,
  },
  codeInputCard: {
    padding: Spacing.lg,
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  codeInput: {
    ...TextStyles.h1,
    color: Colors.textPrimary,
    letterSpacing: 8,
    textAlign: 'center',
    minWidth: 200,
  },
  infoCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  infoTitle: {
    ...TextStyles.h3,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  infoText: {
    ...TextStyles.body,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  joiningContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  joiningText: {
    ...TextStyles.body,
    color: Colors.textMuted,
    marginTop: Spacing.md,
  },
  joinButton: {
    width: '100%',
    marginBottom: Spacing.md,
  },
  backButton: {
    width: '100%',
  },
});

export default JoinRoomScreen;
