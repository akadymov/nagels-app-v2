/**
 * Nägels Online - Scoreboard Modal
 * Table layout with score history per round.
 * Two modes: compact (mid-game) and full (end-of-round).
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing, Radius } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';
import { useRoomStore } from '../store/roomStore';

// Compact result row for one player in a closed hand.
export interface HandResultRow {
  playerId: string;
  bet: number;
  tricksWon: number;
  points: number;
  bonus: number;
}

export interface HandResult {
  handNumber: number;
  startingPlayerIndex: number;
  results: HandResultRow[];
}

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
  scoreHistory?: HandResult[];
  startingPlayerIndex?: number;
  isGameOver?: boolean;
  isMidGame?: boolean;
  onContinue: () => void;
  onPlayAgain?: () => void;
  onClose?: () => void;
}

export const ScoreboardModal: React.FC<ScoreboardModalProps> = ({
  visible,
  handNumber,
  totalHands,
  players,
  scoreHistory,
  startingPlayerIndex,
  isGameOver = false,
  isMidGame = false,
  onContinue,
  onPlayAgain,
  onClose,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [showFull, setShowFull] = useState(!isMidGame);

  // Derive history from server snapshot if no explicit history passed in.
  const snapshot = useRoomStore((s) => s.snapshot);
  const derivedHistory: HandResult[] = React.useMemo(() => {
    if (scoreHistory && scoreHistory.length > 0) return scoreHistory;
    const sh = snapshot?.score_history ?? [];
    if (!sh.length) return [];
    return sh.map((h) => ({
      handNumber: h.hand_number,
      startingPlayerIndex: 0,
      results: (h.scores ?? []).map((row) => ({
        playerId: row.session_id,
        bet: row.bet,
        tricksWon: row.taken_tricks,
        points: row.hand_score,
        bonus: row.bet === row.taken_tricks ? 10 : 0,
      })),
    }));
  }, [scoreHistory, snapshot]);
  const effectiveHistory: HandResult[] =
    scoreHistory && scoreHistory.length > 0 ? scoreHistory : derivedHistory;

  // Sort players by score
  const sortedPlayers = [...players].sort((a, b) => b.totalScore - a.totalScore);
  const leader = sortedPlayers[0];

  if (!visible) return null;

  const renderCompact = () => (
    <View style={styles.compactContainer}>
      {/* Header */}
      <Text style={[styles.title, { color: colors.accent }]}>
        {isGameOver ? t('scoreboard.gameOver') : t('scoreboard.hand') + ' ' + handNumber + '/' + totalHands}
      </Text>

      {/* Rankings */}
      {sortedPlayers.map((p, i) => (
        <View key={p.id} style={[styles.compactRow, { backgroundColor: colors.surface, borderColor: i === 0 ? colors.accent : colors.glassLight }]}>
          <Text style={[styles.compactRank, { color: colors.textMuted }]}>{i + 1}</Text>
          <Text style={[styles.compactName, { color: colors.textPrimary }]} numberOfLines={1}>{p.name}</Text>
          <Text style={[styles.compactScore, { color: colors.accent }]}>{p.totalScore}</Text>
          <View style={[styles.compactLastHand, { backgroundColor: p.madeBet ? 'rgba(48,133,82,0.15)' : 'rgba(177,0,0,0.1)' }]}>
            <Text style={{ color: p.madeBet ? colors.success : colors.error, fontWeight: '700', fontSize: 12 }}>
              {p.lastPoints > 0 ? '+' : ''}{p.lastPoints}
            </Text>
          </View>
        </View>
      ))}

      {/* Show History toggle */}
      {effectiveHistory.length > 0 && (
        <Pressable onPress={() => setShowFull(true)} style={[styles.toggleBtn, { borderColor: colors.accent }]}>
          <Text style={[styles.toggleText, { color: colors.accent }]}>{t('scoreboard.showHistory', 'Show History')}</Text>
        </Pressable>
      )}
    </View>
  );

  const renderFullTable = () => {
    // Column width calculation
    const playerCount = players.length;
    const roundColW = 32;
    const playerColW = Math.max(52, Math.floor((Dimensions.get('window').width - 48 - roundColW) / playerCount));

    return (
      <View style={styles.fullContainer}>
        {/* Header */}
        <Text style={[styles.title, { color: colors.accent }]}>
          {isGameOver ? t('scoreboard.gameOver') : t('scoreboard.hand') + ' ' + handNumber + '/' + totalHands}
        </Text>

        {isMidGame && (
          <Pressable onPress={() => setShowFull(false)} style={[styles.toggleBtn, { borderColor: colors.accent, marginBottom: Spacing.sm }]}>
            <Text style={[styles.toggleText, { color: colors.accent }]}>{t('scoreboard.hideHistory', 'Hide History')}</Text>
          </Pressable>
        )}

        {/* Table */}
        <ScrollView style={styles.tableScroll} showsVerticalScrollIndicator={false}>
          {/* Column headers */}
          <View style={styles.tableRow}>
            <View style={[styles.tableCell, { width: roundColW }]}>
              <Text style={[styles.headerText, { color: colors.textMuted }]}>#</Text>
            </View>
            {sortedPlayers.map((p) => (
              <View key={p.id} style={[styles.tableCell, { width: playerColW }]}>
                <Text style={[styles.headerText, { color: colors.textPrimary }]} numberOfLines={1}>{p.name}</Text>
              </View>
            ))}
          </View>

          {/* Divider */}
          <View style={[styles.divider, { backgroundColor: colors.glassLight }]} />

          {/* Round rows */}
          {effectiveHistory.map((hand) => (
            <View key={hand.handNumber} style={styles.tableRow}>
              <View style={[styles.tableCell, { width: roundColW }]}>
                <Text style={[styles.roundNum, { color: colors.textMuted }]}>{hand.handNumber}</Text>
              </View>
              {sortedPlayers.map((player) => {
                const result = hand.results.find(r => r.playerId === player.id);
                if (!result) return <View key={player.id} style={[styles.tableCell, { width: playerColW }]} />;
                const isBonus = result.bonus > 0;
                const isFirst = hand.startingPlayerIndex === players.findIndex(p => p.id === player.id);
                return (
                  <View key={player.id} style={[styles.tableCell, { width: playerColW }]}>
                    {isFirst && <Text style={styles.firstBadge}>▶</Text>}
                    {isBonus ? (
                      <View style={[styles.bonusCircle, { borderColor: colors.success }]}>
                        <Text style={[styles.scoreText, { color: colors.success }]}>{result.points}</Text>
                      </View>
                    ) : (
                      <Text style={[styles.scoreText, { color: colors.error }]}>{result.points}</Text>
                    )}
                  </View>
                );
              })}
            </View>
          ))}

          {/* Total row */}
          <View style={[styles.divider, { backgroundColor: colors.accent, height: 2 }]} />
          <View style={styles.tableRow}>
            <View style={[styles.tableCell, { width: roundColW }]}>
              <Text style={[styles.totalLabel, { color: colors.textPrimary }]}>Σ</Text>
            </View>
            {sortedPlayers.map((p) => (
              <View key={p.id} style={[styles.tableCell, { width: playerColW }]}>
                <Text style={[styles.totalScore, { color: p.id === leader?.id ? colors.accent : colors.textPrimary }]}>
                  {p.totalScore}
                </Text>
              </View>
            ))}
          </View>

          {/* Leader */}
          {leader && (
            <Text style={[styles.leaderText, { color: colors.success }]}>
              🏆 {leader.name} {isGameOver ? t('scoreboard.winner', 'wins!') : t('scoreboard.leading', 'leading')}
            </Text>
          )}
        </ScrollView>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
            {/* Close button */}
            <Pressable onPress={onClose || onContinue} style={styles.closeBtn} hitSlop={12} testID="scoreboard-close-x">
              <Text style={[styles.closeText, { color: colors.textMuted }]}>✕</Text>
            </Pressable>

            {/* Content */}
            {showFull && effectiveHistory.length > 0 ? renderFullTable() : renderCompact()}

            {/* Continue / Play Again button */}
            <View style={styles.footer}>
              <Pressable
                style={[styles.continueBtn, { backgroundColor: colors.accent }]}
                onPress={isGameOver && onPlayAgain ? onPlayAgain : onContinue}
                testID="btn-continue-scoreboard"
              >
                <Text style={styles.continueBtnText}>
                  {isGameOver ? t('scoreboard.playAgain') : t('scoreboard.continue')}
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modal: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: SCREEN_HEIGHT * 0.85,
    minHeight: 300,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.md,
  },
  closeBtn: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.md,
    zIndex: 10,
  },
  closeText: {
    fontSize: 22,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  // Compact mode
  compactContainer: {
    gap: Spacing.xs,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  compactRank: {
    fontSize: 14,
    fontWeight: '700',
    width: 20,
    textAlign: 'center',
  },
  compactName: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  compactScore: {
    fontSize: 16,
    fontWeight: '700',
  },
  compactLastHand: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  // Full table mode
  fullContainer: {
    flex: 1,
  },
  tableScroll: {
    flex: 1,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  tableCell: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  headerText: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  divider: {
    height: 1,
    marginVertical: 4,
  },
  roundNum: {
    fontSize: 11,
    fontWeight: '500',
  },
  scoreText: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  bonusCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  firstBadge: {
    position: 'absolute',
    top: -2,
    left: 0,
    fontSize: 6,
    color: '#308552',
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  totalScore: {
    fontSize: 14,
    fontWeight: '700',
  },
  leaderText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  // Toggle button
  toggleBtn: {
    alignSelf: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1,
    marginTop: Spacing.md,
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Footer
  footer: {
    paddingVertical: Spacing.md,
  },
  continueBtn: {
    height: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default ScoreboardModal;
