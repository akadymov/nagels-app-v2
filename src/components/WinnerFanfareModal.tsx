/**
 * Standalone game-over celebration modal.
 *
 * Shown right after the last hand closes — before the scoreboard. The
 * point is a clear, big-text, single-purpose "X wins! Congratulations"
 * moment so the winner doesn't get lost in the table of standings.
 * After the user taps "View scoreboard" the parent renders the
 * regular ScoreboardModal.
 */

import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { Spacing, Radius } from '../constants';
import { avatarColorFor } from '../utils/avatarColor';

export interface WinnerFanfareModalProps {
  visible: boolean;
  winner: {
    id: string;
    name: string;
    totalScore: number;
    avatar?: string | null;
    avatarColor?: string | null;
  } | null;
  onDismiss: () => void;
}

export const WinnerFanfareModal: React.FC<WinnerFanfareModalProps> = ({
  visible,
  winner,
  onDismiss,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();

  if (!winner) return null;

  const avatarBg = winner.avatarColor || avatarColorFor(winner.id);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.success }]}>
          <Text style={styles.confetti}>🎉🏆🎉</Text>
          <View style={[styles.avatarBig, { backgroundColor: avatarBg }]}>
            <Text style={styles.avatarText}>
              {winner.avatar || (winner.name?.[0] ?? '?').toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.gameOverLine, { color: colors.textMuted }]} numberOfLines={1}>
            {t('scoreboard.gameOver')}
          </Text>
          <Text style={[styles.name, { color: colors.success }]} numberOfLines={1}>
            {winner.name}
          </Text>
          <Text style={[styles.subtitle, { color: colors.success }]}>
            {t('scoreboard.winsCongrats', 'wins! Congratulations 🎊')}
          </Text>
          <Text style={[styles.score, { color: colors.success }]}>
            {winner.totalScore} {t('scoreboard.points', 'pts')}
          </Text>
          <Pressable
            onPress={onDismiss}
            style={[styles.button, { backgroundColor: colors.accent }]}
            testID="winner-fanfare-continue"
          >
            <Text style={styles.buttonText}>
              {t('scoreboard.viewScoreboard', 'View scoreboard')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: Radius.lg,
    borderWidth: 2,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  confetti: {
    fontSize: 44,
    marginBottom: Spacing.xs,
  },
  avatarBig: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 44,
    fontWeight: '800',
  },
  gameOverLine: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  name: {
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
  },
  score: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: Spacing.sm,
  },
  button: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    minWidth: 200,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
