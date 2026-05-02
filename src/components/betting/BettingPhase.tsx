/**
 * Nägels Online - Betting Phase Component
 *
 * Modal for players to place their bets during the betting phase.
 * All state is read from useRoomStore.snapshot; bet actions go through gameClient.
 */

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Dimensions,
  Modal,
  RefreshControl,
} from 'react-native';
import { CardHand } from '../cards';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { Colors, Spacing, Radius, TextStyles } from '../../constants';
import { useTheme } from '../../hooks/useTheme';
import { GameLogo } from '../GameLogo';
import { useRoomStore } from '../../store/roomStore';
import { gameClient } from '../../lib/gameClient';
import { useSettingsStore, type ThemePreference } from '../../store/settingsStore';
import { useAuthStore } from '../../store/authStore';
import { useTranslation } from 'react-i18next';
import { SuitSymbols } from '../../constants/colors';
import { betPlacedHaptic } from '../../utils/haptics';
import { getAllowedBets } from '../../../supabase/functions/_shared/engine/rules';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const ACTION_BAR_HEIGHT = SCREEN_HEIGHT * 0.05;

export interface BettingPhaseProps {
  visible: boolean;
  onClose?: () => void;
  isMultiplayer?: boolean;
  onShowScore?: () => void;
}

// Convert "spades-9" → { id, suit, rank }
function parseCard(s: string): { id: string; suit: string; rank: string | number } {
  const [suit, rankStr] = s.split('-');
  const rank: string | number = /^\d+$/.test(rankStr) ? parseInt(rankStr, 10) : rankStr;
  return { id: s, suit, rank };
}

/**
 * BettingPhase - Modal for placing bets
 */
export const BettingPhase: React.FC<BettingPhaseProps> = ({
  visible,
  onClose,
  isMultiplayer = false,
  onShowScore,
}) => {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();

  const snapshot = useRoomStore((s) => s.snapshot);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);

  const room = snapshot?.room ?? null;
  const players = snapshot?.players ?? [];
  const hand = snapshot?.current_hand ?? null;
  const handScores = snapshot?.hand_scores ?? [];
  const myHandCards = snapshot?.my_hand ?? [];

  const myPlayer = players.find((p) => p.session_id === myPlayerId) ?? null;
  const trumpSuit = hand?.trump_suit ?? 'diamonds';
  const cardsPerPlayer = hand?.cards_per_player ?? 0;
  const handNumber = hand?.hand_number ?? 1;
  const totalHands = useMemo(() => {
    const max = room?.max_cards ?? 10;
    // Pattern: max → 1 → max with the 1 played twice
    return max * 2;
  }, [room?.max_cards]);

  // Whose turn to bet
  const bettingPlayer = useMemo(() => {
    if (!hand || hand.phase !== 'betting') return null;
    return players.find((p) => p.seat_index === hand.current_seat) ?? null;
  }, [hand, players]);

  const isMyTurn = !!bettingPlayer && !!myPlayer && bettingPlayer.session_id === myPlayer.session_id;

  // My current bet (from hand_scores)
  const myBet = useMemo(() => {
    if (!myPlayer) return null;
    const row = handScores.find((s) => s.session_id === myPlayer.session_id);
    return row ? row.bet : null;
  }, [handScores, myPlayer]);

  // Bets placed so far, by seat order
  const playerBets = useMemo(() => {
    return players.map((p) => {
      const row = handScores.find((s) => s.session_id === p.session_id);
      return { ...p, bet: row?.bet ?? null };
    });
  }, [players, handScores]);

  const hasAllBets = playerBets.every((p) => p.bet !== null) && playerBets.length > 0;

  // Action bar modals / toggles
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Settings & auth for in-game settings panel
  const themePreference = useSettingsStore((s) => s.themePreference);
  const setThemePreference = useSettingsStore((s) => s.setThemePreference);
  const fourColorDeck = useSettingsStore((s) => s.fourColorDeck);
  const setFourColorDeck = useSettingsStore((s) => s.setFourColorDeck);
  const isGuest = useAuthStore((s) => s.isGuest);
  const authDisplayName = useAuthStore((s) => s.displayName);

  const handleRefresh = useCallback(async () => {
    if (!room?.id) return;
    setIsRefreshing(true);
    try {
      await gameClient.refreshSnapshot(room.id);
    } finally {
      setIsRefreshing(false);
    }
  }, [room?.id]);

  // Allowed bets for the current betting player.
  // Computed locally so the UI gives instant feedback; the server still validates.
  const allowedBets = useMemo(() => {
    if (!bettingPlayer || !hand || hand.phase !== 'betting') return [];
    const currentBets = handScores
      .filter((s) => s.session_id !== bettingPlayer.session_id)
      .map((s) => ({ playerId: s.session_id, amount: s.bet }));
    const placedCount = handScores.length;
    const isLastPlayer = placedCount === players.length - 1;
    return getAllowedBets({
      playerCount: players.length,
      cardsPerPlayer,
      currentBets,
      isLastPlayer,
    });
  }, [bettingPlayer, hand, handScores, players.length, cardsPerPlayer]);

  const allBets = useMemo(
    () => Array.from({ length: cardsPerPlayer + 1 }, (_, i) => i),
    [cardsPerPlayer]
  );
  const blockedBets = useMemo(
    () => allBets.filter((b) => !allowedBets.includes(b)),
    [allBets, allowedBets]
  );

  // Smart hint: count trumps and aces in hand
  const smartHint = useMemo(() => {
    if (!myHandCards.length) return null;
    const cards = myHandCards.map(parseCard);
    const trumpCount = trumpSuit === 'notrump' ? 0 : cards.filter((c) => c.suit === trumpSuit).length;
    const aceCount = cards.filter((c) => c.rank === 'A').length;
    const bidsSoFar = handScores.reduce((sum, s) => sum + s.bet, 0);
    return { trumpCount, aceCount, bidsSoFar };
  }, [myHandCards, trumpSuit, handScores]);

  // Hand sorted with trump first, then S/H/C/D, descending rank within suit.
  // Mirrors the sort used on GameTableScreen so the order stays consistent
  // when the betting modal hands off to the table.
  const sortedHandCards = useMemo(() => {
    const RANK_ORDER: Record<string, number> = { '2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8, J: 9, Q: 10, K: 11, A: 12 };
    const SUIT_ORDER: Record<string, number> = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
    const tw = (s: string) => (s === trumpSuit ? -1 : SUIT_ORDER[s] ?? 9);
    const cards = myHandCards.map(parseCard);
    return cards.sort((a, b) => {
      const ds = tw(String(a.suit)) - tw(String(b.suit));
      if (ds !== 0) return ds;
      return (RANK_ORDER[String(b.rank)] ?? 0) - (RANK_ORDER[String(a.rank)] ?? 0);
    });
  }, [myHandCards, trumpSuit]);

  // Get trump symbol / color
  const getTrumpSymbol = (trump: string): string => {
    if (trump === 'notrump') return 'NT';
    return SuitSymbols[trump as keyof typeof SuitSymbols] || trump;
  };
  const getTrumpColor = (trump: string): string => {
    if (trump === 'notrump') return Colors.textMuted;
    return (Colors[trump as keyof typeof Colors] as string) || Colors.textSecondary;
  };

  const handleBet = useCallback(
    async (bet: number) => {
      if (!room?.id || !hand?.id) return;
      if (!allowedBets.includes(bet)) return;
      betPlacedHaptic();
      try {
        await gameClient.placeBet(room.id, hand.id, bet);
      } catch (err) {
        console.error('[BettingPhase] placeBet failed:', err);
      }
    },
    [room?.id, hand?.id, allowedBets]
  );

  const renderBetChip = (bet: number) => {
    const isAllowed = allowedBets.includes(bet);
    const isSelected = myBet === bet;
    const isDisabled = !isSelected && (!isMyTurn || !isAllowed);

    const chipBg = isSelected
      ? colors.success
      : isDisabled
      ? colors.bidChipDisabled
      : colors.accent;

    const chipBorder = isSelected ? '#2AA555' : isDisabled ? 'transparent' : colors.accentSecondary;
    const chipTextColor = isSelected ? '#ffffff' : isDisabled ? colors.bidChipDisabledText : '#ffffff';

    return (
      <Pressable
        key={bet}
        onPress={() => handleBet(bet)}
        disabled={isDisabled}
        testID={`bet-btn-${bet}`}
      >
        <View
          style={[
            styles.betChip,
            {
              backgroundColor: chipBg,
              borderColor: chipBorder,
              opacity: isDisabled ? 0.5 : 1,
            },
          ]}
        >
          <Text style={[styles.betChipText, { color: chipTextColor }]}>{bet}</Text>
        </View>
      </Pressable>
    );
  };

  if (!visible) return null;

  return (
    <View
      style={[
        styles.overlay,
        { backgroundColor: isDark ? 'rgba(20, 23, 32, 0.97)' : 'rgba(232, 232, 232, 0.97)' },
      ]}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
        refreshControl={
          isMultiplayer ? <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} /> : undefined
        }
      >
        {/* Header */}
        <View
          style={[
            styles.topBar,
            { backgroundColor: colors.surface, borderBottomColor: colors.glassLight },
          ]}
        >
          <View style={{ alignItems: 'center', paddingVertical: 2 }}>
            <GameLogo size="xs" />
          </View>
          <View style={styles.topBarRow1}>
            <Text style={[styles.handInfo, { color: colors.textPrimary }]}>
              {t('game.hand')} {handNumber}/{totalHands}
            </Text>
            <View
              style={[
                styles.trumpBadge,
                {
                  backgroundColor: isDark ? 'rgba(19,66,143,0.2)' : 'rgba(19,66,143,0.08)',
                  borderColor: colors.accent,
                },
              ]}
            >
              <Text style={[styles.trumpBadgeText, { color: getTrumpColor(trumpSuit) }]}>
                {getTrumpSymbol(trumpSuit)} {t('game.trump')}
              </Text>
            </View>
          </View>
          <View style={styles.topBarRow2}>
            <Pressable
              onPress={onClose}
              style={[
                styles.iconBtn,
                { backgroundColor: colors.iconButtonBg, borderWidth: 1, borderColor: colors.glassLight },
              ]}
              hitSlop={8}
            >
              <Text style={[styles.iconBtnText, { color: colors.iconButtonText }]}>←</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowSettingsModal(true)}
              style={[
                styles.iconBtn,
                { backgroundColor: colors.iconButtonBg, borderWidth: 1, borderColor: colors.glassLight },
              ]}
              hitSlop={8}
            >
              <Text style={styles.iconBtnEmoji}>⚙️</Text>
            </Pressable>
            {isMultiplayer && (
              <Pressable
                onPress={handleRefresh}
                disabled={isRefreshing}
                style={[
                  styles.iconBtn,
                  {
                    backgroundColor: colors.iconButtonBg,
                    borderWidth: 1,
                    borderColor: colors.glassLight,
                    opacity: isRefreshing ? 0.5 : 1,
                  },
                ]}
                hitSlop={8}
                testID="betting-btn-sync"
              >
                <Text style={styles.iconBtnEmoji}>{isRefreshing ? '⏳' : '🔄'}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={onShowScore}
              style={[
                styles.iconBtn,
                { backgroundColor: colors.iconButtonBg, borderWidth: 1, borderColor: colors.glassLight },
              ]}
              hitSlop={8}
            >
              <Text style={styles.iconBtnEmoji}>🏆</Text>
            </Pressable>
          </View>
        </View>

        <Text style={[styles.bettingTitle, { color: colors.accent }]}>{t('game.placeBets')}</Text>

        {/* Players grid */}
        <View style={styles.playersGrid}>
          {playerBets.map((player, index) => {
            const isBetting = bettingPlayer?.session_id === player.session_id;
            const hasBet = player.bet !== null && player.bet !== undefined;
            const isMe = player.session_id === myPlayerId;
            const displayName = isMe
              ? t('game.you')
              : playerBets.filter((other) => other.display_name === player.display_name).length > 1
              ? `${player.display_name} #${index + 1}`
              : player.display_name;

            return (
              <View
                key={player.session_id}
                style={[
                  styles.playerCard,
                  { backgroundColor: colors.surface, borderColor: colors.glassLight },
                  isBetting && { borderColor: colors.activePlayerBorder, borderWidth: 2 },
                  isMe && { borderColor: colors.accent, borderWidth: 2 },
                ]}
              >
                <Text
                  style={[styles.playerCardName, { color: isMe ? colors.accent : colors.textPrimary }]}
                  numberOfLines={1}
                >
                  {displayName}
                </Text>
                <Text
                  style={[
                    styles.playerCardBet,
                    { color: hasBet ? colors.success : colors.textMuted },
                  ]}
                >
                  {hasBet ? `Bet: ${player.bet}` : isBetting ? t('game.betting') + '...' : '...'}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Bids summary */}
        <View
          style={[
            styles.betsSummary,
            { backgroundColor: colors.surfaceSecondary, borderColor: colors.glassLight },
          ]}
        >
          <Text style={[styles.betsSummaryValue, { color: colors.textPrimary }]}>
            {t('game.totalBets')}: {handScores.reduce((sum, s) => sum + s.bet, 0)} / {cardsPerPlayer}
          </Text>
        </View>

        {/* Your Cards */}
        {myHandCards.length > 0 && (
          <View
            style={[
              styles.handPreview,
              { backgroundColor: colors.surface, borderColor: colors.glassLight },
            ]}
          >
            <Text style={[styles.handLabel, { color: colors.textSecondary }]}>
              {t('game.yourCards', 'Your cards this round')}:
            </Text>
            <CardHand
              cards={sortedHandCards as any}
              size="tiny"
              horizontal
              cardOverlap={myHandCards.length}
            />
          </View>
        )}

        {/* Smart hint */}
        {isMyTurn && smartHint && myBet === null && (
          <View
            style={[
              styles.smartHint,
              { backgroundColor: isDark ? 'rgba(93,194,252,0.1)' : 'rgba(19,66,143,0.07)' },
            ]}
          >
            <Text style={[styles.smartHintText, { color: isDark ? colors.textPrimary : colors.accent }]}>
              💡 {t('game.trumpsCount', { count: smartHint.trumpCount })} ({getTrumpSymbol(trumpSuit)}),{' '}
              {t('game.acesCount', { count: smartHint.aceCount })}. {t('game.bidsSoFar')}: {smartHint.bidsSoFar}/
              {cardsPerPlayer}
            </Text>
          </View>
        )}

        {/* Bet chips */}
        {isMyTurn && myBet === null && (
          <View
            style={[
              styles.betButtonsContainer,
              { backgroundColor: colors.surface, borderColor: colors.glassLight },
            ]}
          >
            <Text style={[styles.betPrompt, { color: colors.textPrimary }]}>{t('game.bet')}:</Text>

            <View style={styles.betButtons}>{allBets.map(renderBetChip)}</View>

            {allowedBets.length === 0 && (
              <Text style={[styles.noBetsText, { color: colors.error }]}>No valid bets available</Text>
            )}

            {blockedBets.length > 0 && blockedBets.length < allBets.length && (
              <Text style={[styles.blockedText, { color: colors.error }]}>
                {blockedBets.map((b) => t('game.bidBlocked', { bid: b, total: cardsPerPlayer })).join('\n')}
              </Text>
            )}
          </View>
        )}

        {/* All bets placed */}
        {hasAllBets && (
          <View style={styles.readyContainer}>
            <Text style={styles.readyText}>✓ All bets placed!</Text>
          </View>
        )}

        {/* Waiting for other players */}
        {!isMyTurn && !hasAllBets && (
          <View style={[styles.waitingContainer, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={styles.waitingPlayerText}>
              {(() => {
                if (!bettingPlayer) return t('game.waiting');
                const bpIdx = players.findIndex((p) => p.session_id === bettingPlayer.session_id);
                const isDup =
                  players.filter((p) => p.display_name === bettingPlayer.display_name).length > 1;
                const displayName = isDup ? `${bettingPlayer.display_name} #${bpIdx + 1}` : bettingPlayer.display_name;
                return `${t('game.waiting').replace('...', '')} ${displayName}...`;
              })()}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Settings modal */}
      <Modal
        visible={showSettingsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSettingsModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowSettingsModal(false)}>
          <Pressable
            onPress={() => {}}
            style={[styles.settingsPanel, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}
          >
            <Text style={[styles.settingsPanelTitle, { color: colors.textPrimary }]}>{t('settings.title')}</Text>

            {!isGuest && (
              <View style={styles.settingsSection}>
                <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>{t('profile.title')}</Text>
                <Text style={[styles.settingsValue, { color: colors.textPrimary }]}>{authDisplayName}</Text>
              </View>
            )}

            <View style={styles.settingsSection}>
              <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>{t('settings.language')}</Text>
              <LanguageSwitcher />
            </View>

            <View style={styles.settingsSection}>
              <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>{t('settings.theme')}</Text>
              <View style={[styles.settingsPills, { borderColor: colors.glassLight }]}>
                {(['system', 'light', 'dark'] as ThemePreference[]).map((opt) => {
                  const labels: Record<string, string> = {
                    system: t('settings.system'),
                    light: t('settings.light'),
                    dark: t('settings.dark'),
                  };
                  const isActive = themePreference === opt;
                  return (
                    <Pressable
                      key={opt}
                      style={[styles.settingsPill, isActive && { backgroundColor: colors.accent }]}
                      onPress={() => setThemePreference(opt)}
                    >
                      <Text
                        style={[
                          styles.settingsPillText,
                          { color: colors.textSecondary },
                          isActive && { color: '#fff', fontWeight: '700' },
                        ]}
                      >
                        {labels[opt]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.settingsSection}>
              <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>{t('settings.deckStyle')}</Text>
              <View style={[styles.settingsPills, { borderColor: colors.glassLight }]}>
                {[false, true].map((fc) => {
                  const isActive = fourColorDeck === fc;
                  return (
                    <Pressable
                      key={String(fc)}
                      style={[styles.settingsPill, isActive && { backgroundColor: colors.accent }]}
                      onPress={() => setFourColorDeck(fc)}
                    >
                      <Text
                        style={[
                          styles.settingsPillText,
                          { color: colors.textSecondary },
                          isActive && { color: '#fff', fontWeight: '700' },
                        ]}
                      >
                        {fc ? t('settings.fourColor') : t('settings.classic')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Pressable style={styles.settingsCloseBtn} onPress={() => setShowSettingsModal(false)}>
              <Text style={styles.settingsCloseBtnText}>{t('common.close')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(232, 232, 232, 0.97)',
    zIndex: 100,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.sm,
    paddingBottom: 160,
  },
  topBar: {
    borderBottomWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  topBarRow1: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
    marginBottom: Spacing.xs,
  },
  handInfo: {
    fontSize: 14,
    fontWeight: '600',
  },
  trumpBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  trumpBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  topBarRow2: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: {
    fontSize: 18,
    fontWeight: '700',
  },
  iconBtnEmoji: {
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
  },
  bettingTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  handPreview: {
    marginBottom: Spacing.sm,
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: Radius.lg,
    padding: Spacing.sm,
    borderWidth: 2,
    borderColor: Colors.accent,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  handLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: Spacing.xs,
  },
  betButtonsContainer: {
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    backgroundColor: '#ffffff',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.glassLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  betPrompt: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  betButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  betChip: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  betChipText: {
    fontSize: 24,
    fontWeight: '700',
  },
  playersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  playerCard: {
    width: 110,
    height: 56,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerCardName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 3,
  },
  playerCardBet: {
    fontSize: 12,
    fontWeight: '500',
  },
  smartHint: {
    borderRadius: Radius.md,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  smartHintText: {
    fontSize: 12,
    fontWeight: '500',
  },
  blockedText: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  noBetsText: {
    ...TextStyles.caption,
    color: Colors.error,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  readyContainer: {
    padding: Spacing.lg,
    backgroundColor: 'rgba(82, 183, 136, 0.2)',
    borderRadius: Radius.lg,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.success,
  },
  readyText: {
    ...TextStyles.h3,
    color: Colors.success,
    fontWeight: '700',
  },
  waitingContainer: {
    padding: Spacing.lg,
    backgroundColor: '#ffffff',
    borderRadius: Radius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.glassLight,
  },
  waitingPlayerText: {
    ...TextStyles.body,
    color: Colors.textSecondary,
    fontStyle: 'italic',
  },
  betsSummary: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  betsSummaryValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  settingsPanel: {
    width: '100%',
    maxWidth: 340,
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.lg,
  },
  settingsPanelTitle: {
    ...TextStyles.h3,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  settingsSection: {
    marginBottom: Spacing.md,
  },
  settingsSectionTitle: {
    ...TextStyles.caption,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  settingsValue: {
    ...TextStyles.body,
    fontWeight: '600',
  },
  settingsPills: {
    flexDirection: 'row',
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: 3,
  },
  settingsPill: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: Radius.lg,
    alignItems: 'center',
  },
  settingsPillText: {
    ...TextStyles.small,
    fontWeight: '500',
  },
  settingsCloseBtn: {
    backgroundColor: Colors.accent,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.md,
    alignSelf: 'center',
    marginTop: Spacing.sm,
  },
  settingsCloseBtnText: {
    ...TextStyles.body,
    color: '#ffffff',
    fontWeight: '600',
  },
});

export default BettingPhase;
