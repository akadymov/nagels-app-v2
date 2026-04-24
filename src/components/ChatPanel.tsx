/**
 * Nägels Online - In-Game Chat Panel
 *
 * Floating chat overlay for multiplayer games.
 * Messages are sent via game_events table and received in real-time.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Colors, Spacing, Radius, TextStyles } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { useMultiplayerStore } from '../store/multiplayerStore';
import { multiplayerSendChat } from '../lib/multiplayer/gameActions';
import type { ChatMessage } from '../store/multiplayerStore';

interface ChatPanelProps {
  visible: boolean;
  onClose: () => void;
  myPlayerId: string;
  myPlayerName: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  visible,
  onClose,
  myPlayerId,
  myPlayerName,
}) => {
  const { colors } = useTheme();
  const chatMessages = useMultiplayerStore((s) => s.chatMessages);
  const clearUnreadCount = useMultiplayerStore((s) => s.clearUnreadCount);

  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Clear unread count when chat opens
  useEffect(() => {
    if (visible) {
      clearUnreadCount();
    }
  }, [visible]);

  // Scroll to bottom on new messages when panel is open
  useEffect(() => {
    if (visible && chatMessages.length > 0) {
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  }, [chatMessages.length, visible]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isSending) return;

    setInputText('');
    setIsSending(true);

    const optimisticId = `local-${Date.now()}`;
    const optimisticTs = Date.now();

    try {
      // Optimistic local add so sender sees the message immediately
      const store = useMultiplayerStore.getState();
      store.addChatMessage({
        id: optimisticId,
        playerId: myPlayerId,
        playerName: myPlayerName,
        text,
        timestamp: optimisticTs,
      });
      store.clearUnreadCount();

      await multiplayerSendChat(myPlayerId, myPlayerName, text);
    } catch (err) {
      console.error('[ChatPanel] Failed to send:', err);
    } finally {
      setIsSending(false);
    }
  }, [inputText, isSending, myPlayerId, myPlayerName]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const renderMessage = (msg: ChatMessage, index: number) => {
    const isMe = msg.playerId === myPlayerId;
    // Deduplicate: if an optimistic 'local-' message was sent and server echoed it back,
    // the server version will have a different ID. For simplicity, just show all.
    return (
      <View
        key={msg.id}
        style={[styles.messageRow, isMe && styles.messageRowMe]}
      >
        {!isMe && (
          <View style={styles.avatarBubble}>
            <Text style={styles.avatarText}>{msg.playerName[0]?.toUpperCase()}</Text>
          </View>
        )}
        <View style={[styles.bubble, isMe && styles.bubbleMe]}>
          {!isMe && (
            <Text style={styles.senderName}>{msg.playerName}</Text>
          )}
          <Text style={[styles.messageText, isMe && styles.messageTextMe]}>
            {msg.text}
          </Text>
          <Text style={[styles.timestamp, isMe && styles.timestampMe]}>
            {formatTime(msg.timestamp)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[styles.panel, { backgroundColor: colors.surfaceSecondary, borderColor: colors.glassLight }]}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Chat</Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          {/* Messages */}
          <ScrollView
            ref={scrollRef}
            style={styles.messageList}
            contentContainerStyle={styles.messageListContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {chatMessages.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>
                  Напишите что-нибудь — сообщения видят все за столом
                </Text>
              </View>
            ) : (
              chatMessages.map(renderMessage)
            )}
          </ScrollView>

          {/* Input */}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Сообщение..."
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={handleSend}
              returnKeyType="send"
              maxLength={200}
              multiline={false}
              autoCorrect={false}
              testID="chat-input"
            />
            <Pressable
              style={[styles.sendButton, (!inputText.trim() || isSending) && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!inputText.trim() || isSending}
              testID="chat-send"
            >
              {isSending ? (
                <ActivityIndicator size="small" color={colors.textPrimary} />
              ) : (
                <Text style={styles.sendText}>↑</Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

// ============================================================
// CHAT BUTTON (floating badge with unread count)
// ============================================================

interface ChatButtonProps {
  onPress: () => void;
  unreadCount: number;
  style?: any;
}

export const ChatButton: React.FC<ChatButtonProps> = ({ onPress, unreadCount, style }) => {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={[styles.chatButtonWrapper, style]}>
      <Text style={styles.chatButtonLabel}>Chat</Text>
      {unreadCount > 0 && (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadCount}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </Text>
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  panel: {
    backgroundColor: '#1a1f2e',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: '70%',
    minHeight: 300,
    borderTopWidth: 1,
    borderColor: Colors.glassLight,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.glassLight,
  },
  headerTitle: {
    ...TextStyles.h3,
    color: Colors.textPrimary,
  },
  closeButton: {
    padding: Spacing.xs,
  },
  closeText: {
    ...TextStyles.body,
    color: Colors.textMuted,
    fontSize: 18,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  emptyState: {
    paddingVertical: Spacing.xxl,
    alignItems: 'center',
  },
  emptyText: {
    ...TextStyles.small,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  messageRowMe: {
    flexDirection: 'row-reverse',
  },
  avatarBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.glassDark,
    borderWidth: 1,
    borderColor: Colors.glassLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  bubble: {
    maxWidth: '75%',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: Radius.md,
    borderTopLeftRadius: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.glassLight,
  },
  bubbleMe: {
    backgroundColor: 'rgba(100, 200, 150, 0.18)',
    borderColor: Colors.accent,
    borderTopLeftRadius: Radius.md,
    borderTopRightRadius: 4,
  },
  senderName: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.accent,
    marginBottom: 2,
  },
  messageText: {
    ...TextStyles.body,
    color: Colors.textPrimary,
    lineHeight: 20,
  },
  messageTextMe: {
    color: Colors.textPrimary,
  },
  timestamp: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 2,
    alignSelf: 'flex-start',
  },
  timestampMe: {
    alignSelf: 'flex-end',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    gap: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.glassLight,
    // Extra bottom padding for mobile browser chrome (Android/iOS nav bar)
    paddingBottom: Platform.OS === 'web' ? 40 : Platform.OS === 'ios' ? Spacing.xl : Spacing.md,
  },
  input: {
    flex: 1,
    ...TextStyles.body,
    color: Colors.textPrimary,
    backgroundColor: Colors.glassDark,
    borderWidth: 1,
    borderColor: Colors.glassLight,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    maxHeight: 80,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: Colors.glassDark,
    borderWidth: 1,
    borderColor: Colors.glassLight,
  },
  sendText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  // Chat action button in game bar
  chatButtonWrapper: {
    alignItems: 'center',
    position: 'relative',
  },
  chatButtonLabel: {
    ...TextStyles.caption,
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  unreadBadge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  unreadCount: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
});
