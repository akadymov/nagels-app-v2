import React, { useCallback } from 'react';
import { Pressable, Text, Alert, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { useIsDiscordActivity } from '../hooks/useIsDiscordActivity';
import { invokeDiscordInvite } from '../lib/discord/invite';
import { Spacing } from '../constants';

/**
 * Renders only inside a Discord Activity. Opens Discord's native invite dialog
 * so any participant can bring friends into the shared Activity (and, via
 * auto-join, this room). No-op surface outside Discord.
 */
export const DiscordInviteButton: React.FC = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const isDiscord = useIsDiscordActivity();

  const onPress = useCallback(async () => {
    const res = await invokeDiscordInvite();
    if (!res.ok) {
      Alert.alert(
        String(t('room.inviteDiscord', 'Invite friends')),
        String(t('room.inviteDiscordFailed', "Couldn't open the Discord invite.")),
      );
    }
  }, [t]);

  if (!isDiscord) return null;

  return (
    <Pressable testID="btn-invite-discord" onPress={onPress} hitSlop={8} style={styles.btn}>
      <Text style={[styles.btnText, { color: colors.textPrimary }]}>
        🎮 {t('room.inviteDiscord', 'Invite friends')}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  btn: { paddingVertical: Spacing.sm, alignItems: 'center' },
  btnText: { fontSize: 14, fontWeight: '600' },
});
