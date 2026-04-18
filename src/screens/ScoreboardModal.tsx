/**
 * Nägels Online - Scoreboard Modal
 * End-of-hand results display with swipe-to-close
 */

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  Dimensions,
  Platform,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import { GlassCard, GlassButton } from '../components';
import { Colors, Spacing, Radius, TextStyles } from '../constants';
import { useTranslation } from 'react-i18next';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface PlayerScore {
  id: string;
  name: string;
  rank: number;
  totalScore: number;
  lastBet: number;
  lastTricks: number;
  lastBonus: number;
  lastPoints: number;
  madeBet: boolean;
}

export interface ScoreboardModalProps {
  visible: boolean;
  handNumber: number;
  totalHands: number;
  players: PlayerScore[];
  isGameOver?: boolean;
  onContinue: () => void;
  onPlayAgain?: () => void;
  onClose?: () => void;
}

/**
 * ScoreboardModal - End of hand results
 *
 * Shows:
 * - Hand number (e.g., "Hand 3/20")
 * - Player rankings with scores
 * - Last hand breakdown (bet + tricks + bonus)
 * - "Continue Playing" button
 * - Swipe down from handle/header to close
 */
export const ScoreboardModal: React.FC<ScoreboardModalProps> = ({
  visible,
  handNumber,
  totalHands,
  players,
  isGameOver = false,
  onContinue,
  onPlayAgain,
  onClose,
}) => {
  const { t } = useTranslation();

  // State to control closing animation
  const [isClosing, setIsClosing] = useState(false);

  // Animated value for swipe gesture
  const translateY = useRef(new Animated.Value(0)).current;

  // Sort players by score (highest first)
  const sortedPlayers = [...players].sort((a, b) => b.totalScore - a.totalScore);

  // Close modal with animation
  const closeModal = () => {
    if (isClosing) return;
    setIsClosing(true);

    Animated.timing(translateY, {
      toValue: SCREEN_HEIGHT,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      translateY.setValue(0);
      setIsClosing(false);
      onClose?.();
    });
  };

  // Handle gesture for swipe-to-close
  const gestureHandler = useRef(
    Animated.event(
      [{ nativeEvent: { translationY: translateY } }],
      { useNativeDriver: true }
    )
  ).current;

  const handleGestureStateChange = (_event: any) => {
    const event = _event.nativeEvent;

    if (event.state === State.END) {
      const { translationY } = event;

      // If swiped down far enough, close the modal
      if (translationY > 80) {
        closeModal();
      } else {
        // Snap back to position
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 0,
        }).start();
      }
    }
  };

  const renderPlayerRow = (player: PlayerScore) => (
    <GlassCard
      key={player.id}
      style={[
        styles.playerRow,
        player.rank === 1 && styles.winnerRow,
      ]}
      dark
    >
      {/* Rank and Name */}
      <View style={styles.playerInfo}>
        {/* Simple white rank number instead of medals */}
        <View style={styles.rankBadge}>
          <Text style={styles.rankNumber}>{player.rank}</Text>
        </View>
        <View style={styles.nameContainer}>
          <Text style={styles.playerName}>{player.name}</Text>
        </View>
      </View>

      {/* Total Score */}
      <View style={styles.scoreContainer}>
        <Text style={styles.totalScore}>{player.totalScore}</Text>
        <Text style={styles.pointsLabel}>{t('game.score')}</Text>
      </View>

      {/* Bonus - Show prominently if player made their bet */}
      {player.madeBet && player.lastBonus > 0 && (
        <View style={styles.bonusContainer}>
          <Text style={styles.bonusEmoji}>⭐</Text>
          <View style={styles.bonusContent}>
            <Text style={styles.bonusTitle}>{t('scoreboard.bonusAchieved')}</Text>
            <Text style={styles.bonusAmount}>+{player.lastBonus}</Text>
          </View>
        </View>
      )}

      {/* Last Hand Breakdown */}
      <View style={styles.breakdownContainer}>
        <Text style={styles.breakdownLabel}>{t('scoreboard.lastHand')}:</Text>
        <Text style={[
          styles.breakdownValue,
          { color: player.madeBet ? Colors.success : Colors.error }
        ]}>
          {player.lastPoints > 0 ? '+' : ''}{player.lastPoints}
          {' '}({player.lastTricks}/{player.lastBet})
        </Text>
      </View>
    </GlassCard>
  );

  if (isClosing && !visible) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      animationType={Platform.OS === 'web' ? 'slide' : 'none'}
      transparent
      statusBarTranslucent
      onRequestClose={closeModal}
    >
      {/* Background overlay - tap outside closes modal */}
      <View style={styles.overlay}>
        <View style={styles.modalWrapper}>
          <Animated.View
            style={[
              styles.modalContainer,
              {
                transform: [{ translateY }],
              },
            ]}
          >
            {/* Swipe-to-close gesture handler - covers handle + header */}
            <PanGestureHandler
              onGestureEvent={gestureHandler}
              onHandlerStateChange={handleGestureStateChange}
              activeOffsetY={[-10, 10]}
            >
              <View style={styles.swipeArea}>
                {/* Swipe indicator - draggable handle */}
                <View style={styles.swipeIndicator}>
                  <View style={styles.swipeHandle} />
                </View>

                {/* Header - also swipeable */}
                <View style={styles.header}>
                  <GlassCard style={styles.headerCard} blurAmount={25}>
                    <Text style={styles.headerTitle}>
                      {isGameOver ? t('scoreboard.gameOver') : `${t('scoreboard.hand')} ${handNumber} ${t('scoreboard.of')} ${totalHands}`}
                    </Text>
                    {isGameOver && (
                      <Text style={styles.gameOverSubtitle}>
                        🏆 {sortedPlayers[0]?.name} wins!
                      </Text>
                    )}
                  </GlassCard>
                </View>
              </View>
            </PanGestureHandler>

            {/* Gradient background */}
            {Platform.OS === 'web' ? (
              <View style={[styles.gradient, { backgroundColor: Colors.background }]} />
            ) : (
              <LinearGradient
                colors={Colors.deepRich}
                style={styles.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 0.3, y: 1 }}
              />
            )}

            {/* Scores List - NOT pressable, scrolling works inside */}
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {sortedPlayers.map(renderPlayerRow)}
            </ScrollView>

            {/* Continue Button */}
            <View style={styles.footer}>
              <GlassButton
                title={t('scoreboard.continue')}
                onPress={isGameOver && onPlayAgain ? onPlayAgain : onContinue}
                size="large"
                variant="primary"
                accentColor={Colors.highlight}
                style={styles.continueButton}
              />
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalWrapper: {
    width: '100%',
    maxHeight: '85%',
  },
  modalContainer: {
    width: '100%',
    height: '85%',
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    overflow: 'hidden',
  },
  swipeArea: {
    // This area (handle + header) is swipeable
    backgroundColor: 'transparent',
  },
  swipeIndicator: {
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingTop: Spacing.md,
  },
  swipeHandle: {
    width: 48,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.textMuted,
    opacity: 0.4,
  },
  header: {
    paddingTop: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  headerCard: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.glassLight,
  },
  headerTitle: {
    ...TextStyles.h2,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  gameOverSubtitle: {
    ...TextStyles.body,
    color: Colors.highlight,
    textAlign: 'center',
    marginTop: Spacing.sm,
    fontWeight: '600',
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: -1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  playerRow: {
    padding: Spacing.sm,
    borderWidth: 2,
    borderColor: Colors.glassLight,
  },
  winnerRow: {
    borderColor: Colors.accent,
    borderWidth: 2,
  },
  playerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    backgroundColor: Colors.background,
    borderWidth: 2,
    borderColor: Colors.glassLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  rankNumber: {
    ...TextStyles.h3,
    color: Colors.textPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
  nameContainer: {
    flex: 1,
  },
  playerName: {
    ...TextStyles.h3,
    color: Colors.textPrimary,
  },
  winnerLabel: {
    ...TextStyles.caption,
    color: Colors.highlight,
    marginTop: 2,
  },
  scoreContainer: {
    alignItems: 'flex-end',
    marginBottom: Spacing.sm,
  },
  totalScore: {
    ...TextStyles.h2,
    color: Colors.highlight,
    fontWeight: '700',
  },
  pointsLabel: {
    ...TextStyles.small,
    color: Colors.textMuted,
  },
  breakdownContainer: {
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.glassMedium,
  },
  breakdownLabel: {
    ...TextStyles.small,
    color: Colors.textMuted,
    marginBottom: 2,
  },
  breakdownValue: {
    ...TextStyles.body,
    fontWeight: '600',
  },
  bonusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(19, 66, 143, 0.07)',
    borderWidth: 2,
    borderColor: Colors.accent,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  bonusEmoji: {
    fontSize: 32,
    marginRight: Spacing.sm,
  },
  bonusContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bonusTitle: {
    ...TextStyles.body,
    color: Colors.accent,
    fontWeight: '600',
  },
  bonusAmount: {
    ...TextStyles.h3,
    color: Colors.accent,
    fontWeight: '700',
  },
  footer: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xl,
    paddingTop: Spacing.sm,
  },
  continueButton: {
    width: '100%',
  },
});

export default ScoreboardModal;
