/**
 * Nägels Online - Betting Phase Component
 *
 * Modal for players to place their bets during the betting phase.
 * Enforces all Nägels betting rules:
 * - Bet cannot exceed cards on hand
 * - Last player cannot make total equal to cards dealt
 */

import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Dimensions,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { GlassCard } from '../glass';
import { GlassButton } from '../buttons/GlassButton';
import { PlayingCard, CardHand } from '../cards';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { Colors, Spacing, Radius, TextStyles } from '../../constants';
import { useTheme } from '../../hooks/useTheme';
import { GameLogo } from '../GameLogo';
import { useGameStore } from '../../store';
import { useMultiplayerStore } from '../../store/multiplayerStore';
import { useSettingsStore, type ThemePreference } from '../../store/settingsStore';
import { useAuthStore } from '../../store/authStore';
import { multiplayerSendChat } from '../../lib/multiplayer/gameActions';
import { useTranslation } from 'react-i18next';
import { SuitSymbols } from '../../constants/colors';
import { betPlacedHaptic } from '../../utils/haptics';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const ACTION_BAR_HEIGHT = SCREEN_HEIGHT * 0.05;

export interface BettingPhaseProps {
  visible: boolean;
  onClose?: () => void;
  isMultiplayer?: boolean;
  onShowScore?: () => void;
}

/**
 * BettingPhase - Modal for placing bets
 *
 * Shows:
 * - Current trump
 * - Cards in hand
 * - Other players' bets
 * - Available bet options (enforcing rules)
 */
export const BettingPhase: React.FC<BettingPhaseProps> = ({
  visible,
  onClose,
  isMultiplayer = false,
  onShowScore,
}) => {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const {
    players,
    trumpSuit,
    cardsPerPlayer,
    handNumber,
    totalHands,
    bettingPlayerIndex,
    hasAllBets,
    myPlayerId,
    placeBet,
    getAllowedBets,
    getBettingPlayer,
  } = useGameStore();

  const bettingPlayer = getBettingPlayer();
  const isMyTurn = bettingPlayer?.id === myPlayerId;
  const myPlayer = players.find(p => p.id === myPlayerId);

  // Action bar modals / toggles
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showChat, setShowChat] = useState(true);

  // Settings & auth for in-game settings panel
  const themePreference = useSettingsStore((s) => s.themePreference);
  const setThemePreference = useSettingsStore((s) => s.setThemePreference);
  const fourColorDeck = useSettingsStore((s) => s.fourColorDeck);
  const setFourColorDeck = useSettingsStore((s) => s.setFourColorDeck);
  const isGuest = useAuthStore((s) => s.isGuest);
  const authDisplayName = useAuthStore((s) => s.displayName);
  const unreadChatCount = useMultiplayerStore((s) => s.unreadChatCount);

  // Chat state (multiplayer only)
  const chatMessages = useMultiplayerStore((s) => s.chatMessages);
  const clearUnreadCount = useMultiplayerStore((s) => s.clearUnreadCount);
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const chatScrollRef = useRef<ScrollView>(null);

  // Clear unread and scroll to bottom when chat visible
  useEffect(() => {
    if (visible && isMultiplayer) {
      clearUnreadCount();
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [visible, isMultiplayer]);

  // Scroll on new messages
  useEffect(() => {
    if (visible && isMultiplayer && chatMessages.length > 0) {
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [chatMessages.length]);

  const handleChatSend = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || isSendingChat || !myPlayerId || !myPlayer) return;
    setChatInput('');
    setIsSendingChat(true);
    try {
      const store = useMultiplayerStore.getState();
      store.addChatMessage({
        id: `local-${Date.now()}`,
        playerId: myPlayerId,
        playerName: myPlayer.name,
        text,
        timestamp: Date.now(),
      });
      store.clearUnreadCount();
      await multiplayerSendChat(myPlayerId, myPlayer.name, text);
    } catch (e) {
      console.error('[BettingChat] send failed', e);
    } finally {
      setIsSendingChat(false);
    }
  }, [chatInput, isSendingChat, myPlayerId, myPlayer]);

  // Get allowed bets for the current betting player
  const allowedBets = useMemo(() => {
    if (!bettingPlayer) return [];
    return getAllowedBets(bettingPlayer.id);
  }, [bettingPlayer, getAllowedBets]);

  // Get trump symbol
  const getTrumpSymbol = (trump: string): string => {
    if (trump === 'notrump') return 'NT';
    return SuitSymbols[trump as keyof typeof SuitSymbols] || trump;
  };

  // Get trump color
  const getTrumpColor = (trump: string): string => {
    if (trump === 'notrump') return Colors.textMuted;
    return (Colors[trump as keyof typeof Colors] as string) || Colors.textSecondary;
  };

  // All possible bets 0..cardsPerPlayer
  const allBets = useMemo(() => {
    return Array.from({ length: cardsPerPlayer + 1 }, (_, i) => i);
  }, [cardsPerPlayer]);

  // Blocked bets (for explanation)
  const blockedBets = useMemo(() => {
    return allBets.filter(b => !allowedBets.includes(b) && b <= cardsPerPlayer);
  }, [allBets, allowedBets, cardsPerPlayer]);

  // Smart hint: count trumps and aces in hand
  const smartHint = useMemo(() => {
    if (!myPlayer) return null;
    const hand = myPlayer.hand;
    const trumpCount = trumpSuit === 'notrump' ? 0 : hand.filter(c => c.suit === trumpSuit).length;
    const aceCount = hand.filter(c => c.rank === 'A').length;
    const bidsSoFar = players.reduce((sum, p) => sum + (p.bet ?? 0), 0);
    return { trumpCount, aceCount, bidsSoFar };
  }, [myPlayer, trumpSuit, players]);

  const renderBetChip = (bet: number) => {
    const isAllowed = allowedBets.includes(bet);
    const isSelected = myPlayer?.bet === bet;
    const isDisabled = !isSelected && (!isMyTurn || !isAllowed);

    const handleBetPress = () => {
      if (myPlayerId && isAllowed) {
        betPlacedHaptic();
        placeBet(myPlayerId, bet);
      }
    };

    const chipBg = isSelected
      ? colors.success
      : isDisabled
        ? colors.bidChipDisabled
        : colors.accent;

    const chipBorder = isSelected
      ? '#2AA555'
      : isDisabled
        ? 'transparent'
        : colors.accentSecondary;

    const chipTextColor = isSelected ? '#ffffff' : isDisabled ? colors.bidChipDisabledText : '#ffffff';

    return (
      <Pressable
        key={bet}
        onPress={handleBetPress}
        disabled={isDisabled}
        testID={`bet-btn-${bet}`}
      >
        <View style={[
          styles.betChip,
          {
            backgroundColor: chipBg,
            borderColor: chipBorder,
            opacity: isDisabled ? 0.5 : 1,
          },
        ]}>
          <Text style={[styles.betChipText, { color: chipTextColor }]}>
            {bet}
          </Text>
        </View>
      </Pressable>
    );
  };

  if (!visible) return null;

  return (
    <View style={[styles.overlay, { backgroundColor: isDark ? 'rgba(20, 23, 32, 0.97)' : 'rgba(232, 232, 232, 0.97)' }]}>
      <View style={styles.gradient} />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header — matches Figma: Hand info left, Trump badge center, icons right */}
        <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.glassLight }]}>
          <View style={{ alignItems: 'center', paddingVertical: 2 }}>
            <GameLogo size="xs" />
          </View>
          <View style={styles.topBarRow1}>
            <Text style={[styles.handInfo, { color: colors.textPrimary }]}>
              {t('game.hand')} {handNumber}/{totalHands}
            </Text>
            <View style={[styles.trumpBadge, { backgroundColor: isDark ? 'rgba(19,66,143,0.2)' : 'rgba(19,66,143,0.08)', borderColor: colors.accent }]}>
              <Text style={[styles.trumpBadgeText, { color: getTrumpColor(trumpSuit) }]}>
                {getTrumpSymbol(trumpSuit)} {t('game.trump')}
              </Text>
            </View>
          </View>
          <View style={styles.topBarRow2}>
            <Pressable onPress={onClose} style={[styles.iconBtn, { backgroundColor: colors.iconButtonBg, borderWidth: 1, borderColor: colors.glassLight }]} hitSlop={8}>
              <Text style={[styles.iconBtnText, { color: colors.iconButtonText }]}>←</Text>
            </Pressable>
            <Pressable onPress={() => setShowSettingsModal(true)} style={[styles.iconBtn, { backgroundColor: colors.iconButtonBg, borderWidth: 1, borderColor: colors.glassLight }]} hitSlop={8}>
              <Text style={styles.iconBtnEmoji}>⚙️</Text>
            </Pressable>
            <Pressable onPress={onShowScore} style={[styles.iconBtn, { backgroundColor: colors.iconButtonBg, borderWidth: 1, borderColor: colors.glassLight }]} hitSlop={8}>
              <Text style={styles.iconBtnEmoji}>🏆</Text>
            </Pressable>
            <Pressable onPress={() => setShowChat(v => !v)} style={[styles.iconBtn, { backgroundColor: colors.accent, borderWidth: 1, borderColor: colors.accent }]} hitSlop={8}>
              <Text style={styles.iconBtnEmoji}>💬</Text>
              {isMultiplayer && unreadChatCount > 0 && !showChat && (
                <View style={styles.chatBadge}>
                  <Text style={styles.chatBadgeText}>{unreadChatCount > 9 ? '9+' : unreadChatCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>

        {/* Title */}
        <Text style={[styles.bettingTitle, { color: colors.accent }]}>{t('game.placeBets')}</Text>

        {/* Players grid — adaptive layout */}
        <View style={styles.playersGrid}>
          {players.map((player, index) => {
            const isBetting = index === bettingPlayerIndex;
            const hasBet = player.bet !== null && player.bet !== undefined;
            const isMe = player.id === myPlayerId;
            const displayName = isMe
              ? t('game.you')
              : players.filter(other => other.name === player.name).length > 1
                ? `${player.name} #${index + 1}`
                : player.name;

            return (
              <View
                key={player.id}
                style={[
                  styles.playerCard,
                  { backgroundColor: colors.surface, borderColor: colors.glassLight },
                  isBetting && { borderColor: colors.activePlayerBorder, borderWidth: 2 },
                  isMe && { borderColor: colors.accent, borderWidth: 2 },
                ]}
              >
                <Text style={[styles.playerCardName, { color: isMe ? colors.accent : colors.textPrimary }]} numberOfLines={1}>
                  {displayName}
                </Text>
                <Text style={[
                  styles.playerCardBet,
                  { color: hasBet ? colors.success : colors.textMuted },
                ]}>
                  {hasBet ? `Bet: ${player.bet}` : isBetting ? t('game.betting') + '...' : '...'}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Bids summary */}
        <View style={[styles.betsSummary, { backgroundColor: colors.surfaceSecondary, borderColor: colors.glassLight }]}>
          <Text style={[styles.betsSummaryValue, { color: colors.textPrimary }]}>
            {t('game.totalBets')}: {players.reduce((sum, p) => sum + (p.bet ?? 0), 0)} / {cardsPerPlayer}
          </Text>
        </View>

        {/* Your Cards */}
        {myPlayer && myPlayer.hand.length > 0 && (
          <View style={[styles.handPreview, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
            <Text style={[styles.handLabel, { color: colors.textSecondary }]}>
              {t('game.yourCards', 'Your cards this round')}:
            </Text>
            <CardHand
              cards={myPlayer.hand.map(c => ({
                id: c.id,
                suit: c.suit,
                rank: c.rank,
              }))}
              size="tiny"
              horizontal
              cardOverlap={myPlayer.hand.length}
            />
          </View>
        )}

        {/* Smart hint */}
        {isMyTurn && smartHint && !myPlayer?.bet && (
          <View style={[styles.smartHint, { backgroundColor: isDark ? 'rgba(93,194,252,0.1)' : 'rgba(19,66,143,0.07)' }]}>
            <Text style={[styles.smartHintText, { color: isDark ? colors.textPrimary : colors.accent }]}>
              💡 {t('game.trumpsCount', { count: smartHint.trumpCount })} ({getTrumpSymbol(trumpSuit)}), {t('game.acesCount', { count: smartHint.aceCount })}. {t('game.bidsSoFar')}: {smartHint.bidsSoFar}/{cardsPerPlayer}
            </Text>
          </View>
        )}

        {/* Bet chips — poker style (show all, disabled = gray) */}
        {isMyTurn && !myPlayer?.bet && (
          <View style={[styles.betButtonsContainer, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
            <Text style={[styles.betPrompt, { color: colors.textPrimary }]}>
              {t('game.bet')}:
            </Text>

            <View style={styles.betButtons}>
              {allBets.map(renderBetChip)}
            </View>

            {allowedBets.length === 0 && (
              <Text style={[styles.noBetsText, { color: colors.error }]}>
                No valid bets available
              </Text>
            )}

            {/* Blocked bets explanation */}
            {blockedBets.length > 0 && blockedBets.length < allBets.length && (
              <Text style={[styles.blockedText, { color: colors.error }]}>
                {blockedBets.map(b => t('game.bidBlocked', { bid: b, total: cardsPerPlayer })).join('\n')}
              </Text>
            )}
          </View>
        )}

        {/* All bets placed - show status */}
        {hasAllBets && (
          <View style={styles.readyContainer}>
            <Text style={styles.readyText}>
              ✓ All bets placed!
            </Text>
          </View>
        )}

        {/* Waiting for other players */}
        {!isMyTurn && !hasAllBets && (
          <View style={[styles.waitingContainer, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={styles.waitingPlayerText}>
              {(() => {
                if (!bettingPlayer) return t('game.waiting');
                const bpIdx = players.findIndex(p => p.id === bettingPlayer.id);
                const isDup = players.filter(p => p.name === bettingPlayer.name).length > 1;
                const displayName = isDup ? `${bettingPlayer.name} #${bpIdx + 1}` : bettingPlayer.name;
                return `${t('game.waiting').replace('...', '')} ${displayName}...`;
              })()}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Inline Chat - multiplayer only, toggled by action bar */}
      {isMultiplayer && myPlayer && showChat && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.chatSection}
        >
          <View style={styles.chatHeader}>
            <Text style={styles.chatHeaderText}>Chat</Text>
          </View>

          <ScrollView
            ref={chatScrollRef}
            style={styles.chatMessages}
            contentContainerStyle={styles.chatMessagesContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {chatMessages.length === 0 ? (
              <Text style={styles.chatEmpty}>{t('game.chatEmpty')}</Text>
            ) : (
              chatMessages.map((msg) => {
                const isMe = msg.playerId === myPlayerId;
                return (
                  <View key={msg.id} style={[styles.chatMsgRow, isMe && styles.chatMsgRowMe]}>
                    {!isMe && (
                      <View style={styles.chatAvatar}>
                        <Text style={styles.chatAvatarText}>{msg.playerName[0]?.toUpperCase()}</Text>
                      </View>
                    )}
                    <View style={[styles.chatBubble, isMe && styles.chatBubbleMe]}>
                      {!isMe && <Text style={styles.chatSender}>{msg.playerName}</Text>}
                      <Text style={[styles.chatMsgText, isMe && styles.chatMsgTextMe]}>{msg.text}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          <View style={styles.chatInputRow}>
            <TextInput
              style={styles.chatInput}
              value={chatInput}
              onChangeText={setChatInput}
              placeholder={t('game.chatPlaceholder')}
              placeholderTextColor={Colors.textMuted}
              onSubmitEditing={handleChatSend}
              returnKeyType="send"
              maxLength={200}
              multiline={false}
              autoCorrect={false}
            />
            <Pressable
              style={[styles.chatSendBtn, (!chatInput.trim() || isSendingChat) && styles.chatSendBtnDisabled]}
              onPress={handleChatSend}
              disabled={!chatInput.trim() || isSendingChat}
            >
              {isSendingChat
                ? <ActivityIndicator size="small" color="#ffffff" />
                : <Text style={styles.chatSendText}>↑</Text>
              }
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Bottom action bar removed — all buttons are in top bar icons */}

      {/* Settings modal */}
      <Modal
        visible={showSettingsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSettingsModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowSettingsModal(false)}>
          <Pressable onPress={() => {}} style={[styles.settingsPanel, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
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
                  const labels: Record<string, string> = { system: t('settings.system'), light: t('settings.light'), dark: t('settings.dark') };
                  const isActive = themePreference === opt;
                  return (
                    <Pressable key={opt} style={[styles.settingsPill, isActive && { backgroundColor: colors.accent }]} onPress={() => setThemePreference(opt)}>
                      <Text style={[styles.settingsPillText, { color: colors.textSecondary }, isActive && { color: '#fff', fontWeight: '700' }]}>{labels[opt]}</Text>
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
                    <Pressable key={String(fc)} style={[styles.settingsPill, isActive && { backgroundColor: colors.accent }]} onPress={() => setFourColorDeck(fc)}>
                      <Text style={[styles.settingsPillText, { color: colors.textSecondary }, isActive && { color: '#fff', fontWeight: '700' }]}>{fc ? t('settings.fourColor') : t('settings.classic')}</Text>
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
  gradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.sm,
    paddingBottom: 160,
  },
  // Top bar — 2 rows matching Figma
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
  spacer: {
    height: Spacing.sm,
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
  // Players grid — 3 per row for 5-6, 2 per row for 2-4
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
  // Smart hint
  smartHint: {
    borderRadius: Radius.md,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  smartHintText: {
    fontSize: 12,
    fontWeight: '500',
  },
  // Blocked bets
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
  screenSubtitle: {
    ...TextStyles.caption,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
    fontWeight: '600' as const,
  },
  playersContainer: {
    marginTop: 0,
    backgroundColor: '#ffffff',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.glassLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.glassLight,
  },
  playerRowActive: {
    backgroundColor: 'rgba(19, 66, 143, 0.04)',
    borderRadius: Radius.sm,
    borderBottomColor: 'transparent',
    marginBottom: 1,
  },
  playerRowMe: {
    // subtle distinction for "You" row
  },
  playerRowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginRight: Spacing.sm,
  },
  bettingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent,
    flexShrink: 0,
  },
  playerRowName: {
    ...TextStyles.body,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
    flexShrink: 1,
  },
  playerRowNameActive: {
    color: Colors.accent,
    fontWeight: '700' as const,
  },
  playerRowNameMe: {
    color: Colors.textPrimary,
  },
  bettingIndicator: {
    ...TextStyles.small,
    color: Colors.accent,
    fontStyle: 'italic' as const,
    flexShrink: 0,
  },
  playerRowBetBadge: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: Radius.sm,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.glassLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playerRowBetBadgeConfirmed: {
    backgroundColor: 'rgba(82, 183, 136, 0.12)',
    borderColor: Colors.success,
  },
  playerRowBetText: {
    ...TextStyles.h3,
    color: Colors.textMuted,
    fontWeight: '700' as const,
  },
  playerRowBetTextConfirmed: {
    color: Colors.success,
  },
  betsSummary: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  betsSummaryLabel: {
    ...TextStyles.small,
    color: Colors.textSecondary,
  },
  betsSummaryValue: {
    fontSize: 14,
    fontWeight: '700',
  },

  // ── Inline Chat ──────────────────────────────────────────────
  chatSection: {
    borderTopWidth: 1,
    borderTopColor: Colors.glassLight,
    backgroundColor: '#ffffff',
    maxHeight: 220,
  },
  chatHeader: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.glassLight,
    backgroundColor: Colors.background,
  },
  chatHeaderText: {
    ...TextStyles.caption,
    color: Colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chatMessages: {
    flex: 1,
    maxHeight: 130,
  },
  chatMessagesContent: {
    padding: Spacing.sm,
    gap: Spacing.xs,
  },
  chatEmpty: {
    ...TextStyles.caption,
    color: Colors.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
    paddingVertical: Spacing.sm,
  },
  chatMsgRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.xs,
    marginBottom: 2,
  },
  chatMsgRowMe: {
    justifyContent: 'flex-end',
  },
  chatAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.accentMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatAvatarText: {
    fontSize: 11,
    color: '#ffffff',
    fontWeight: '700',
  },
  chatBubble: {
    maxWidth: '75%',
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.glassLight,
  },
  chatBubbleMe: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  chatSender: {
    ...TextStyles.small,
    color: Colors.textMuted,
    fontSize: 9,
    marginBottom: 1,
  },
  chatMsgText: {
    ...TextStyles.caption,
    color: Colors.textPrimary,
    fontSize: 13,
  },
  chatMsgTextMe: {
    color: '#ffffff',
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    paddingBottom: Platform.OS === 'web' ? 40 : Spacing.xs,
    gap: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.glassLight,
  },
  chatInput: {
    flex: 1,
    ...TextStyles.body,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.glassLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    fontSize: 14,
  },
  chatSendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatSendBtnDisabled: {
    opacity: 0.4,
  },
  chatSendText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },

  // Action bar — identical to GameTableScreen
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: Colors.glassLight,
    height: ACTION_BAR_HEIGHT,
  },
  actionButton: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    borderRadius: Radius.sm,
  },
  actionLabel: {
    ...TextStyles.caption,
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  actionLabelDisabled: {
    color: Colors.textMuted,
    opacity: 0.5,
  },
  actionLabelActive: {
    color: Colors.accent,
    fontWeight: '700' as const,
    textDecorationLine: 'underline' as const,
  },
  chatBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  chatBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
});

export default BettingPhase;
