/**
 * Nägels Online - Scoreboard Modal
 * Table layout with score history per round.
 * Two modes: compact (mid-game) and full (end-of-round).
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  Dimensions,
  Animated,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing, Radius } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { avatarColorFor } from '../utils/avatarColor';
import { useTranslation } from 'react-i18next';
import { useRoomStore } from '../store/roomStore';
import { OnboardingTip } from '../components/OnboardingTip';
import { UserAvatar } from '../components/UserAvatar';
import { computeSettlement } from '../../supabase/functions/_shared/engine/stakes';

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
  /** Avatar emoji from auth metadata. Null/undefined → render initial. */
  avatar?: string | null;
  /** Profile picture URL (Google `avatar_url`). Wins over the emoji. */
  avatarUrl?: string | null;
  /** Avatar color hex; falls back to a deterministic seat-based color. */
  avatarColor?: string | null;
  /** Seat index at the table (0-based). The detailed table uses this to
   *  decide which column shows the ▶ "started this hand" badge — without
   *  it the comparison falls back to the player's index in the sorted
   *  list, which always lands the ▶ on the leftmost (highest-scoring)
   *  column regardless of who actually led. */
  seatIndex?: number;
}

export interface ScoreboardModalProps {
  visible: boolean;
  handNumber: number;
  totalHands: number;
  players: PlayerScore[];
  scoreHistory?: HandResult[];
  startingPlayerIndex?: number;
  isGameOver?: boolean;
  /** True if the local user is the room host. Only the host sees the
   *  "Play again" button on game-over; everyone else sees a quieter
   *  "Back to lobby". */
  isHost?: boolean;
  isMidGame?: boolean;
  onContinue: () => void;
  onPlayAgain?: () => void;
  onClose?: () => void;
  /** Game-over only: lets every player (host included) exit to lobby
   *  without waiting for the host's "Play Again" decision. Caller is
   *  expected to surface its own confirm and detach the room. */
  onLeaveRoom?: () => void;
  /** When true, render the scoreboard contents inline (no Modal /
   *  overlay / close button) so it can live inside the desktop
   *  left pane. The brief / detailed toggle remains visible so the
   *  user can switch between the two views (Akula: "давать
   *  возможность переключать между подробной и краткой записью"). */
  embedded?: boolean;
  /** When true, suppress the in-scoreboard "Play again" CTA so an
   *  upstream modal (e.g. RatingSettlementModal for opt-in stake
   *  players) can own the restart action. Non-host "Waiting for host…"
   *  placeholder is also suppressed since the upstream flow replaces
   *  the entire restart UX. Defaults to false — non-stake flows are
   *  unchanged. */
  suppressPlayAgain?: boolean;
}

export const ScoreboardModal: React.FC<ScoreboardModalProps> = ({
  visible,
  handNumber,
  totalHands,
  players,
  scoreHistory,
  startingPlayerIndex,
  isGameOver = false,
  isHost = false,
  isMidGame = false,
  onContinue,
  onPlayAgain,
  onClose,
  onLeaveRoom,
  embedded = false,
  suppressPlayAgain = false,
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
    // The room snapshot only carries the CURRENT hand's starting_seat;
    // older hands aren't stored. Rotate +1 per hand (see continueHand.ts):
    // hand H's start = (current.starting_seat - (currentHandNumber - H)) mod N.
    const playerCount = snapshot?.room?.player_count ?? snapshot?.players?.length ?? 0;
    const currentStart = snapshot?.current_hand?.starting_seat;
    const currentHandNumber = snapshot?.current_hand?.hand_number;
    const canDeriveStart =
      playerCount > 0 &&
      typeof currentStart === 'number' &&
      typeof currentHandNumber === 'number';
    return sh.map((h) => {
      const startingPlayerIndex = canDeriveStart
        ? (((currentStart as number) - ((currentHandNumber as number) - h.hand_number)) % playerCount + playerCount) % playerCount
        : 0;
      return {
        handNumber: h.hand_number,
        startingPlayerIndex,
        results: (h.scores ?? []).map((row) => ({
          playerId: row.session_id,
          bet: row.bet,
          tricksWon: row.taken_tricks,
          points: row.hand_score,
          bonus: row.bet === row.taken_tricks ? 10 : 0,
        })),
      };
    });
  }, [scoreHistory, snapshot]);
  const effectiveHistory: HandResult[] =
    scoreHistory && scoreHistory.length > 0 ? scoreHistory : derivedHistory;

  // Sort players by score
  const sortedPlayers = [...players].sort((a, b) => b.totalScore - a.totalScore);
  const leader = sortedPlayers[0];

  // Base stake visibility: only players who opted into rating see the
  // stake-per-game badge in the scoreboard. The host's chosen value
  // (room.stake) doesn't change once the game starts.
  const meSessionId = useRoomStore.getState().myPlayerId;
  const meOptedIn = !!(snapshot?.players ?? []).find(
    (p: any) => p.session_id === meSessionId && p.opt_in_stake,
  );
  const roomStake = snapshot?.room?.stake ?? 0;
  const showStakeBadge = roomStake > 0 && meOptedIn;

  // Winner-banner animation. Bounces in on game-over so the celebration
  // moment lands with weight; the confetti pops a beat later for layered
  // motion. Reset when the banner unmounts so a re-open re-animates.
  const bannerScale = useRef(new Animated.Value(0.6)).current;
  const bannerOpacity = useRef(new Animated.Value(0)).current;
  const confettiScale = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible && isGameOver) {
      bannerScale.setValue(0.6);
      bannerOpacity.setValue(0);
      confettiScale.setValue(0);
      Animated.parallel([
        Animated.spring(bannerScale, { toValue: 1, friction: 5, tension: 40, useNativeDriver: true }),
        Animated.timing(bannerOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
      Animated.sequence([
        Animated.delay(220),
        Animated.spring(confettiScale, { toValue: 1, friction: 4, tension: 50, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, isGameOver]);

  // Hooks for the full-table view live up here — never below the
  // `if (!visible) return null` guard. Putting useRef/useEffect after
  // a conditional early return changes the hook count between
  // renders and trips React's "Rendered more hooks than during the
  // previous render" (#310), breaking every player's table at once.
  const tableScrollRef = useRef<ScrollView | null>(null);
  useEffect(() => {
    if (!visible || !showFull) return;
    const t = setTimeout(() => {
      try { tableScrollRef.current?.scrollToEnd({ animated: false }); } catch {}
    }, 50);
    return () => clearTimeout(t);
  }, [visible, showFull, effectiveHistory.length]);

  if (!visible) return null;

  const renderWinnerBanner = (compact = false) => {
    const winner = sortedPlayers[0];
    if (!winner) return null;
    const avatarBg = winner.avatarColor || avatarColorFor(winner.id);
    // Compact horizontal banner for the detailed/history view, where the
    // tall celebration card would otherwise push the hand list off-screen.
    if (compact) {
      return (
        <Animated.View
          testID="scoreboard-winner-banner"
          style={[
            styles.winnerBannerCompact,
            { backgroundColor: 'rgba(48,133,82,0.12)', borderColor: colors.success,
              opacity: bannerOpacity, transform: [{ scale: bannerScale }] },
          ]}
        >
          <UserAvatar
            avatarUrl={winner.avatarUrl}
            emoji={winner.avatar}
            fallback={(winner.name?.[0] ?? '?').toUpperCase()}
            backgroundColor={avatarBg}
            size={36}
            textSize={18}
          />
          <View style={styles.winnerCompactText}>
            <Text style={[styles.winnerCompactName, { color: colors.success }]} numberOfLines={1}>
              🏆 {winner.name}
            </Text>
            <Text style={[styles.winnerCompactLabel, { color: colors.textMuted }]} numberOfLines={1}>
              {t('scoreboard.gameOver')}
            </Text>
          </View>
          <Text style={[styles.winnerCompactScore, { color: colors.success }]} numberOfLines={1}>
            {winner.totalScore} {t('scoreboard.points', 'pts')}
          </Text>
        </Animated.View>
      );
    }
    return (
      <Animated.View
        testID="scoreboard-winner-banner"
        style={[
          styles.winnerBanner,
          { backgroundColor: 'rgba(48,133,82,0.12)', borderColor: colors.success,
            opacity: bannerOpacity, transform: [{ scale: bannerScale }] },
        ]}
      >
        <Animated.Text style={[styles.winnerConfetti, { transform: [{ scale: confettiScale }] }]}>
          🎉🏆🎉
        </Animated.Text>
        <UserAvatar
          avatarUrl={winner.avatarUrl}
          emoji={winner.avatar}
          fallback={(winner.name?.[0] ?? '?').toUpperCase()}
          backgroundColor={avatarBg}
          size={64}
          textSize={30}
          style={{ marginVertical: 4 }}
        />
        <Text style={[styles.winnerGameOverLabel, { color: colors.textMuted }]} numberOfLines={1}>
          {t('scoreboard.gameOver')}
        </Text>
        <Text style={[styles.winnerName, { color: colors.success }]} numberOfLines={1}>
          {winner.name}
        </Text>
        <Text style={[styles.winnerSubtitle, { color: colors.success }]} numberOfLines={1}>
          {t('scoreboard.winsCongrats', 'wins! Congratulations 🎊')}
        </Text>
        <Text style={[styles.winnerScore, { color: colors.success }]}>
          {winner.totalScore} {t('scoreboard.points', 'pts')}
        </Text>
      </Animated.View>
    );
  };

  const renderStakeBadge = () =>
    showStakeBadge ? (
      <View
        style={[styles.stakeBadge, { borderColor: colors.accent, backgroundColor: colors.accent + '18' }]}
        testID="scoreboard-stake-badge"
      >
        <Text style={[styles.stakeBadgeText, { color: colors.accent }]}>
          ★ {t('stakes.baseStakeBadge', { n: roomStake })}
        </Text>
      </View>
    ) : null;

  const renderCompact = () => (
    <View style={styles.compactContainer} testID={isGameOver ? 'game-over' : undefined}>
      {/* Hand counter — suppressed on game-over because the winner banner
          above already announces the end of the game. */}
      {!isGameOver && (
        <Text
          style={[styles.title, { color: colors.accent }]}
          testID="scoreboard-title-hand"
        >
          {t('scoreboard.hand') + ' ' + handNumber + '/' + totalHands}
        </Text>
      )}
      {renderStakeBadge()}

      {/* Rankings */}
      {sortedPlayers.map((p, i) => {
        const isWinner = isGameOver && i === 0;
        const avatarBg = p.avatarColor || avatarColorFor(p.id);
        return (
          <View
            key={p.id}
            style={[
              styles.compactRow,
              {
                backgroundColor: isWinner ? 'rgba(48,133,82,0.10)' : colors.surface,
                borderColor: isWinner ? colors.success : (i === 0 ? colors.accent : colors.glassLight),
                borderWidth: isWinner ? 2 : 1,
              },
            ]}
          >
            <Text style={[styles.compactRank, { color: isWinner ? colors.success : colors.textMuted, fontWeight: isWinner ? '800' : '600' }]}>
              {isWinner ? '🏆' : i + 1}
            </Text>
            <UserAvatar
              avatarUrl={p.avatarUrl}
              emoji={p.avatar}
              fallback={(p.name?.[0] ?? '?').toUpperCase()}
              backgroundColor={avatarBg}
              size={26}
              textSize={12}
              style={{ marginHorizontal: 6 }}
            />
            <Text style={[styles.compactName, { color: colors.textPrimary, fontWeight: isWinner ? '700' : '500' }]} numberOfLines={1}>{p.name}</Text>
            <Text style={[styles.compactScore, { color: isWinner ? colors.success : colors.accent, fontWeight: isWinner ? '800' : '700' }]}>{p.totalScore}</Text>
            <View style={[styles.compactLastHand, { backgroundColor: p.madeBet ? 'rgba(48,133,82,0.15)' : 'rgba(177,0,0,0.1)' }]}>
              <Text style={{ color: p.madeBet ? colors.success : colors.error, fontWeight: '700', fontSize: 12 }}>
                {p.lastPoints > 0 ? '+' : ''}{p.lastPoints}
              </Text>
            </View>
          </View>
        );
      })}

      {/* Show History toggle */}
      {effectiveHistory.length > 0 && (
        <Pressable onPress={() => setShowFull(true)} style={[styles.toggleBtn, { borderColor: colors.accent }]}>
          <Text style={[styles.toggleText, { color: colors.accent }]}>{t('scoreboard.showHistory', 'Show History')}</Text>
        </Pressable>
      )}
    </View>
  );

  const renderFullTable = () => {
    // Column width calculation. Embedded (desktop left pane) uses a
    // narrow column with rotated name headers so 4-6 columns fit in
    // a ~300px-wide pane; the modal variant uses the wider headers
    // that wrap onto two lines.
    const playerCount = players.length;
    const roundColW = embedded ? 28 : 32;
    const playerColW = embedded
      ? 44
      : Math.max(52, Math.floor((Dimensions.get('window').width - 48 - roundColW) / playerCount));
    const headerMinHeight = embedded ? 96 : 38;

    // Δ-rating preview row — only opt-in stake players see their own
    // running settlement. Uses the same pure engine the server runs on
    // game-end, so this row matches the final RatingSettlementModal.
    const optedInIds = new Set(
      (snapshot?.players ?? [])
        .filter((p: any) => p.opt_in_stake)
        .map((p: any) => p.session_id as string),
    );
    const showDelta = roomStake > 0 && !!meSessionId && optedInIds.has(meSessionId);

    let deltaByUser: Map<string, number> | null = null;
    if (showDelta) {
      const inputs = (snapshot?.players ?? [])
        .filter((p: any) => optedInIds.has(p.session_id))
        .map((p: any) => ({
          user_id: p.session_id as string,
          score: sortedPlayers.find((sp) => sp.id === p.session_id)?.totalScore ?? 0,
        }));
      const deltas = computeSettlement(inputs, roomStake);
      deltaByUser = new Map(deltas.map((d) => [d.user_id, d.delta]));
    }

    return (
      <View style={styles.fullContainer} testID={isGameOver ? 'game-over' : undefined}>
        {/* Hand counter — suppressed on game-over (winner banner above
            already announces the end of the game). */}
        {!isGameOver && (
          <Text
            style={[styles.title, { color: colors.accent }]}
            testID="scoreboard-title-hand"
          >
            {t('scoreboard.hand') + ' ' + handNumber + '/' + totalHands}
          </Text>
        )}
        {renderStakeBadge()}

        {/* The brief↔detailed pill toggle at the top of embedded
            mode replaces this old "Hide History" button. */}
        {isMidGame && !embedded && (
          <Pressable onPress={() => setShowFull(false)} style={[styles.toggleBtn, { borderColor: colors.accent, marginBottom: Spacing.sm }]}>
            <Text style={[styles.toggleText, { color: colors.accent }]}>{t('scoreboard.hideHistory', 'Hide History')}</Text>
          </Pressable>
        )}

        {/* Column headers. Modal: two-line wrap. Embedded: nickname
            rotated -90° (reads bottom-to-top) so the column can be
            narrow enough to fit several players in a desktop pane. */}
        <View style={[styles.tableRow, { minHeight: headerMinHeight, alignItems: 'flex-end' }]}>
          <View style={[styles.tableCell, { width: roundColW }]}>
            <Text style={[styles.headerText, { color: colors.textMuted }]}>#</Text>
          </View>
          {sortedPlayers.map((p) => {
            const avatarBg = p.avatarColor || avatarColorFor(p.id);
            const initial = (p.avatar || (p.name?.[0] ?? '?').toUpperCase());
            return (
              <View key={p.id} style={[styles.tableCell, { width: playerColW, height: embedded ? headerMinHeight : undefined }]}>
                {embedded ? (
                  // Avatar circle instead of a rotated nickname — rotated text
                  // was hard to read on desktop. Initial / emoji fallback keeps
                  // it readable even without a per-user avatar. The native
                  // browser tooltip (`title`) is set imperatively via ref —
                  // RN-Web's View doesn't forward unknown DOM attrs through
                  // JSX props, but the ref hands us the underlying div.
                  <View
                    ref={(node: any) => {
                      if (node && Platform.OS === 'web') {
                        try { (node as HTMLElement).title = p.name; } catch {}
                      }
                    }}
                    accessibilityLabel={p.name}
                  >
                    <UserAvatar
                      avatarUrl={p.avatarUrl}
                      emoji={p.avatar}
                      fallback={initial}
                      backgroundColor={avatarBg}
                      size={32}
                      textSize={14}
                    />
                  </View>
                ) : (
                  <Text style={[styles.headerText, { color: colors.textPrimary }]} numberOfLines={2}>
                    {p.name}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
        <View style={[styles.divider, { backgroundColor: colors.glassLight }]} />

        {/* Scrollable rounds — ascending order so the chronology reads
            top-to-bottom; the parent effect auto-scrolls to bottom on
            mount so the user opens to the latest round. */}
        <ScrollView
          ref={(r) => { tableScrollRef.current = r; }}
          style={styles.tableScroll}
          showsVerticalScrollIndicator={false}
        >
          {effectiveHistory.map((hand) => (
            <View key={hand.handNumber} style={styles.tableRow}>
              <View style={[styles.tableCell, { width: roundColW }]}>
                <Text style={[styles.roundNum, { color: colors.textMuted }]}>{hand.handNumber}</Text>
              </View>
              {sortedPlayers.map((player) => {
                const result = hand.results.find(r => r.playerId === player.id);
                if (!result) return <View key={player.id} style={[styles.tableCell, { width: playerColW }]} />;
                const isBonus = result.bonus > 0;
                // Prefer the explicit seat index — `players.findIndex` would
                // return the position in the score-sorted list, so the ▶
                // badge would always land on the current leader's column.
                const playerSeat = player.seatIndex
                  ?? players.findIndex(p => p.id === player.id);
                const isFirst = hand.startingPlayerIndex === playerSeat;
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

          {/* Total row at the bottom — also scrolls into view so it's
              what the user sees first when the modal opens. */}
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

          {showDelta && (
            <View style={styles.tableRow} testID="scoreboard-delta-row">
              <View style={[styles.tableCell, { width: roundColW }]}>
                <Text style={[styles.totalLabel, { color: colors.textPrimary }]}>Δ</Text>
              </View>
              {sortedPlayers.map((p) => {
                const d = deltaByUser?.get(p.id) ?? 0;
                const color = d > 0 ? colors.success : d < 0 ? colors.error : colors.textMuted;
                return (
                  <View key={p.id} style={[styles.tableCell, { width: playerColW }]}>
                    <Text style={[styles.totalScore, { color }]}>
                      {d > 0 ? `+${d}` : String(d)}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          {leader && (
            <Text style={[styles.leaderText, { color: colors.success }]}>
              🏆 {leader.name} {isGameOver ? t('scoreboard.winner', 'wins!') : t('scoreboard.leading', 'leading')}
            </Text>
          )}
        </ScrollView>
      </View>
    );
  };

  // Brief / detailed toggle row — used in embedded mode where the
  // scoreboard lives in the desktop left pane and can flip between
  // a compact and a hand-by-hand view at will.
  const renderViewToggle = () => (
    <View style={[styles.viewToggleRow, { borderBottomColor: colors.glassLight }]}>
      <Pressable
        onPress={() => setShowFull(false)}
        style={[
          styles.viewTogglePill,
          { borderColor: colors.glassLight },
          !showFull && { backgroundColor: colors.accent, borderColor: colors.accent },
        ]}
      >
        <Text style={[styles.viewToggleText, { color: !showFull ? '#ffffff' : colors.textSecondary }]}>
          {t('scoreboard.brief', 'Brief')}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => setShowFull(true)}
        style={[
          styles.viewTogglePill,
          { borderColor: colors.glassLight },
          showFull && { backgroundColor: colors.accent, borderColor: colors.accent },
        ]}
      >
        <Text style={[styles.viewToggleText, { color: showFull ? '#ffffff' : colors.textSecondary }]}>
          {t('scoreboard.detailed', 'Detailed')}
        </Text>
      </Pressable>
    </View>
  );

  if (embedded) {
    return (
      <View style={[styles.embeddedRoot, { backgroundColor: colors.background }]}>
        {renderViewToggle()}
        {isGameOver && renderWinnerBanner(showFull && effectiveHistory.length > 0)}
        {showFull && effectiveHistory.length > 0 ? renderFullTable() : renderCompact()}
        {/* Game-over Play Again button stays even when embedded —
            the host needs an explicit action to restart the room.
            Mid-game embedded view doesn't need a Continue button:
            the next hand auto-loads when the server advances. */}
        {isGameOver && (
          <View style={styles.footer}>
            {!suppressPlayAgain && (isHost && onPlayAgain ? (
              <Pressable
                style={[styles.continueBtn, { backgroundColor: colors.accent }]}
                onPress={onPlayAgain}
                testID="btn-play-again-scoreboard"
              >
                <Text style={styles.continueBtnText}>{t('scoreboard.playAgain')}</Text>
              </Pressable>
            ) : (
              <View style={[styles.continueBtn, { backgroundColor: colors.surface, borderColor: colors.glassLight, borderWidth: 1 }]}>
                <Text style={[styles.continueBtnText, { color: colors.textMuted }]}>
                  {t('scoreboard.waitingForHost', 'Waiting for host…')}
                </Text>
              </View>
            ))}
            {onLeaveRoom && (
              <Pressable
                style={[styles.continueBtn, { marginTop: Spacing.sm, backgroundColor: 'transparent', borderColor: colors.glassLight, borderWidth: 1 }]}
                onPress={onLeaveRoom}
                testID="btn-leave-scoreboard"
              >
                <Text style={[styles.continueBtnText, { color: colors.textMuted }]}>
                  {t('multiplayer.leaveRoom')}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      {/* First-time scoring explainer. Renders above the scoreboard the
          first time a user opens it and self-dismisses afterwards. */}
      <OnboardingTip
        name="scoring"
        titleKey="onboarding.scoringTitle"
        bodyKey="onboarding.scoringBody"
        delayMs={600}
      />
      <View style={styles.overlay}>
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
            {/* Close button */}
            <Pressable onPress={onClose || onContinue} style={styles.closeBtn} hitSlop={12} testID="scoreboard-close-x">
              <Text style={[styles.closeText, { color: colors.textMuted }]}>✕</Text>
            </Pressable>

            {/* Game-over winner banner — animated celebration card that
                lands at the top of the scoreboard so the winner shot and
                the rankings are visible together in a single modal. */}
            {isGameOver && renderWinnerBanner(showFull && effectiveHistory.length > 0)}

            {/* Content */}
            {showFull && effectiveHistory.length > 0 ? renderFullTable() : renderCompact()}

            {/* Continue / Play Again button.
                  Mid-game (between hands): everyone sees "Continue" → next hand.
                  Game over + host: "Play Again" → restart_game RPC.
                  Game over + non-host: "Waiting for host..." informative
                    label, button calls onContinue (which navigates the
                    user out if they want to leave, see GameTable wiring).
            */}
            <View style={styles.footer}>
              {isGameOver ? (
                suppressPlayAgain ? null : (
                  isHost && onPlayAgain ? (
                    <Pressable
                      style={[styles.continueBtn, { backgroundColor: colors.accent }]}
                      onPress={onPlayAgain}
                      testID="btn-play-again-scoreboard"
                    >
                      <Text style={styles.continueBtnText}>
                        {t('scoreboard.playAgain')}
                      </Text>
                    </Pressable>
                  ) : (
                    <View style={[styles.continueBtn, { backgroundColor: colors.surface, borderColor: colors.glassLight, borderWidth: 1 }]}>
                      <Text style={[styles.continueBtnText, { color: colors.textMuted }]}>
                        {t('scoreboard.waitingForHost', 'Waiting for host…')}
                      </Text>
                    </View>
                  )
                )
              ) : (
                <Pressable
                  style={[styles.continueBtn, { backgroundColor: colors.accent }]}
                  onPress={onContinue}
                  testID="btn-continue-scoreboard"
                >
                  <Text style={styles.continueBtnText}>
                    {t('scoreboard.continue')}
                  </Text>
                </Pressable>
              )}
              {isGameOver && onLeaveRoom && (
                <Pressable
                  style={[styles.continueBtn, { marginTop: Spacing.sm, backgroundColor: 'transparent', borderColor: colors.glassLight, borderWidth: 1 }]}
                  onPress={onLeaveRoom}
                  testID="btn-leave-scoreboard"
                >
                  <Text style={[styles.continueBtnText, { color: colors.textMuted }]}>
                    {t('multiplayer.leaveRoom')}
                  </Text>
                </Pressable>
              )}
            </View>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  embeddedRoot: {
    flex: 1,
  },
  viewToggleRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  viewTogglePill: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: Radius.lg,
    borderWidth: 1,
    alignItems: 'center',
  },
  viewToggleText: {
    fontSize: 13,
    fontWeight: '600',
  },
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
    // Cap the winner / scoreboard panel width on desktop so it
    // doesn't sprawl across an ultrawide window — Akula: "сделай
    // её тоже 600 пикселей".
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },
  closeBtn: {
    // Top: 0 inside SafeAreaView lines the ✕ up with the title row's
    // top edge — modal paddingTop:Spacing.lg already pushes both down
    // by the same amount, so they share a baseline. The previous
    // top:Spacing.md sat the ✕ a Spacing.md below the title text.
    position: 'absolute',
    top: 0,
    right: Spacing.md,
    zIndex: 10,
  },
  closeText: {
    fontSize: 22,
    lineHeight: 28,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  // Game-over winner banner
  winnerBanner: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: 2,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    marginBottom: Spacing.md,
    gap: 2,
  },
  winnerConfetti: {
    fontSize: 32,
  },
  winnerAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  winnerAvatarText: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '800',
  },
  winnerGameOverLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  winnerName: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 2,
  },
  winnerSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  winnerScore: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 4,
  },
  winnerBannerCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.lg,
    borderWidth: 2,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.md,
  },
  winnerCompactText: {
    flex: 1,
    minWidth: 0,
  },
  winnerCompactName: {
    fontSize: 16,
    fontWeight: '800',
  },
  winnerCompactLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  winnerCompactScore: {
    fontSize: 18,
    fontWeight: '800',
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
  scoreboardAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 6,
  },
  scoreboardAvatarText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
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
  // Rotated header for the embedded (desktop pane) variant — the
  // text reads bottom-to-top so a long nickname fits in a narrow
  // column. Wrap is an explicit-size square so the rotated child
  // is positioned predictably.
  rotatedHeaderWrap: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotatedHeaderText: {
    width: 80,
    textAlign: 'center',
    transform: [{ rotate: '-90deg' }],
  },
  // Replaces the rotated nickname in embedded mode — round chip with
  // avatar emoji or initial. Keeps the column narrow without forcing
  // the user to read text sideways.
  headerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
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
  stakeBadge: {
    alignSelf: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radius.full,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  stakeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
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
