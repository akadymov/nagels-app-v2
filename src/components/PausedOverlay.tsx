/**
 * Nägels Online - PausedOverlay
 *
 * Full-screen overlay shown when a multiplayer room is in 'paused' phase.
 * Host sees Resume / Kill controls; all players see a To Lobby button.
 * Resume is disabled until all paused-lineup members are live again.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { Spacing, Radius, TextStyles } from '../constants';

export interface PausedOverlayProps {
  isHost: boolean;
  missingNames: string[];          // lineup members not currently live
  onResume: () => void;
  onKill: () => void;
  onToLobby: () => void;
}

export const PausedOverlay: React.FC<PausedOverlayProps> = ({
  isHost, missingNames, onResume, onKill, onToLobby,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const canResume = missingNames.length === 0;

  return (
    <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.78)' }]} testID="paused-overlay">
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
        <Text style={[styles.title, { color: colors.accent }]}>
          {t(isHost ? 'freeze.pausedTitleHost' : 'freeze.pausedTitle')}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {t(isHost ? 'freeze.pausedBodyHost' : 'freeze.pausedBody')}
        </Text>
        {!canResume && (
          <Text style={[styles.waiting, { color: colors.textMuted }]}>
            {t('freeze.waitingFor', { names: missingNames.join(', ') })}
          </Text>
        )}
        {isHost && (
          <>
            <Pressable
              testID="btn-resume-game"
              disabled={!canResume}
              onPress={onResume}
              style={[styles.btnPrimary, { backgroundColor: canResume ? colors.accent : colors.surfaceSecondary }]}
            >
              <Text style={[styles.btnPrimaryText, { color: canResume ? '#fff' : colors.textMuted }]}>
                {canResume ? t('freeze.resume') : t('freeze.resumeDisabled')}
              </Text>
            </Pressable>
            <Pressable testID="btn-kill-game" onPress={onKill} style={styles.btnGhost}>
              <Text style={[styles.btnGhostText, { color: colors.error }]}>{t('freeze.kill')}</Text>
            </Pressable>
          </>
        )}
        <Pressable testID="btn-paused-to-lobby" onPress={onToLobby} style={styles.btnGhost}>
          <Text style={[styles.btnGhostText, { color: colors.textSecondary }]}>{t('freeze.toLobby')}</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: Spacing.lg },
  card: { width: '100%', maxWidth: 420, borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm },
  title: { ...TextStyles.h2, textAlign: 'center' },
  body: { ...TextStyles.body, textAlign: 'center' },
  waiting: { ...TextStyles.caption, textAlign: 'center', marginTop: Spacing.xs },
  btnPrimary: { paddingVertical: Spacing.sm, borderRadius: Radius.md, alignItems: 'center', marginTop: Spacing.sm },
  btnPrimaryText: { ...TextStyles.button },
  btnGhost: { paddingVertical: Spacing.sm, alignItems: 'center' },
  btnGhostText: { ...TextStyles.button },
});

export default PausedOverlay;
