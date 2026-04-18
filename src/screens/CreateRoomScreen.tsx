/**
 * Nägels Online - Create Room Screen
 *
 * Create a private room and share the room code
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GlassCard } from '../components/glass';
import { GlassButton } from '../components/buttons';
import { Colors, Spacing, Radius, TextStyles } from '../constants';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { useMultiplayer } from '../hooks/useMultiplayer';
import type { GameConfig } from '../lib/supabase/types';
import { buildInviteLink } from '../utils/inviteLink';

export interface CreateRoomScreenProps {
  onRoomCreated: (roomCode: string) => void;
  onBack: () => void;
  initialPlayerCount?: number;
}

/**
 * CreateRoomScreen - Create a private game room
 */
export const CreateRoomScreen: React.FC<CreateRoomScreenProps> = ({
  onRoomCreated,
  onBack,
  initialPlayerCount = 4,
}) => {
  const { t } = useTranslation();
  const { playerName, setPlayerName, createRoom } = useMultiplayer();

  const [playerNameInput, setPlayerNameInput] = useState(playerName);
  const [isCreating, setIsCreating] = useState(false);
  const [createdRoomCode, setCreatedRoomCode] = useState<string | null>(null);

  const handleCreateRoom = useCallback(async () => {
    if (playerNameInput.trim()) {
      await setPlayerName(playerNameInput.trim());
    }

    setIsCreating(true);
    try {
      const config: Partial<GameConfig> = {
        playerCount: initialPlayerCount,
        maxCards: 10,
        autoStart: false,
      };

      const room = await createRoom(config);
      setCreatedRoomCode(room.roomCode);
      onRoomCreated(room.roomCode);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create room';
      Alert.alert(t('common.error'), message);
    } finally {
      setIsCreating(false);
    }
  }, [playerNameInput, initialPlayerCount, setPlayerName, createRoom, onRoomCreated, t]);

  const handleCopyCode = useCallback(async () => {
    if (createdRoomCode) {
      await Clipboard.setStringAsync(createdRoomCode);
      Alert.alert(t('multiplayer.codeCopied'), createdRoomCode);
    }
  }, [createdRoomCode, t]);

  const handleShareRoom = useCallback(async () => {
    if (!createdRoomCode) return;
    const link = buildInviteLink(createdRoomCode);
    const message = `${t('multiplayer.shareMessage')}\n${link}`;
    try {
      await Share.share(
        { message, title: 'Nägels Online' },
        { dialogTitle: t('multiplayer.shareRoom') }
      );
    } catch {
      // Fallback: copy link to clipboard
      await Clipboard.setStringAsync(link);
      Alert.alert(t('multiplayer.codeCopied'), link);
    }
  }, [createdRoomCode, t]);

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

        {/* Create Button */}
        {isCreating ? (
          <View style={styles.creatingContainer}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={styles.creatingText}>{t('multiplayer.creatingRoom')}</Text>
          </View>
        ) : createdRoomCode ? (
          <>
            {/* Room Code Display */}
            <GlassCard style={styles.roomCodeCard}>
              <Text style={styles.roomCodeLabel}>{t('multiplayer.roomCreated')}</Text>
              <Text style={styles.roomCode}>{createdRoomCode}</Text>
              <View style={styles.codeActions}>
                <GlassButton
                  title={t('multiplayer.copyCode')}
                  onPress={handleCopyCode}
                  size="small"
                  variant="secondary"
                  style={styles.codeButton}
                />
                <GlassButton
                  title={t('multiplayer.shareCode')}
                  onPress={handleShareRoom}
                  size="small"
                  variant="primary"
                  accentColor={Colors.accent}
                  style={styles.codeButton}
                />
              </View>
            </GlassCard>

            <Text style={styles.infoText}>
              {t('multiplayer.waitingForPlayers')}
            </Text>
          </>
        ) : (
          <GlassButton
            title={t('multiplayer.createRoom')}
            onPress={handleCreateRoom}
            size="large"
            variant="primary"
            accentColor={Colors.highlight}
            style={styles.createButton}
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
  creatingContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  creatingText: {
    ...TextStyles.body,
    color: Colors.textMuted,
    marginTop: Spacing.md,
  },
  roomCodeCard: {
    padding: Spacing.xl,
    alignItems: 'center',
    marginBottom: Spacing.lg,
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
    marginBottom: Spacing.lg,
  },
  codeActions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  codeButton: {
    flex: 1,
  },
  infoText: {
    ...TextStyles.caption,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  createButton: {
    width: '100%',
    marginBottom: Spacing.md,
  },
  backButton: {
    width: '100%',
  },
});

export default CreateRoomScreen;
