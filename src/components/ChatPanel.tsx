/**
 * In-room chat panel.
 *
 * Reads messages from useChatStore (session-scoped, in-memory — wiped
 * when the room channel changes). Send goes over the realtime broadcast
 * 'chat' event on the same room:${id} channel that drives state sync,
 * so no extra DB writes and no separate auth flow.
 *
 * Styled as a bottom-anchored sheet for compact display on phones; the
 * caller decides when it's visible (Modal wrapper for GameTable, inline
 * View for BettingPhase).
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, Pressable, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { Spacing, Radius } from '../constants';
import { useChatStore } from '../store/chatStore';
import { sendChatMessage } from '../lib/realtimeBroadcast';
import { avatarColorFor } from '../utils/avatarColor';

export interface ChatPanelProps {
  visible: boolean;
  onClose: () => void;
  /** Identity for outgoing messages. Provided by the host screen since
   *  GameTable / BettingPhase resolve sender slightly differently
   *  (snapshot vs. local store). */
  sender: {
    sessionId: string;
    displayName: string;
    avatar?: string | null;
    avatarColor?: string | null;
  } | null;
  /** Field testID prefix — lets the demo find betting-chat-input vs.
   *  chat-input depending on where the panel is mounted. */
  testIdPrefix?: 'chat' | 'betting-chat';
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  visible, onClose, sender, testIdPrefix = 'chat',
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const messages = useChatStore((s) => s.messages);
  const markRead = useChatStore((s) => s.markRead);
  const [input, setInput] = useState('');
  const listRef = useRef<FlatList | null>(null);

  useEffect(() => {
    if (!visible) return;
    markRead();
    const t = setTimeout(() => {
      try { listRef.current?.scrollToEnd({ animated: false }); } catch {}
    }, 50);
    return () => clearTimeout(t);
  }, [visible, markRead, messages.length]);

  const send = async () => {
    if (!sender) return;
    const body = input.trim();
    if (!body) return;
    setInput('');
    await sendChatMessage({
      id: `${sender.sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sessionId: sender.sessionId,
      displayName: sender.displayName,
      body,
      ts: Date.now(),
      avatar: sender.avatar ?? null,
      avatarColor: sender.avatarColor ?? null,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              {t('chat.title', 'Chat')}
            </Text>
            <Pressable onPress={onClose} hitSlop={12} testID={`${testIdPrefix}-close`}>
              <Text style={[styles.closeX, { color: colors.textMuted }]}>✕</Text>
            </Pressable>
          </View>
          <FlatList
            ref={(r) => { listRef.current = r; }}
            data={messages}
            keyExtractor={(m) => m.id}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const bg = item.avatarColor || avatarColorFor(item.sessionId);
              const isMe = sender?.sessionId === item.sessionId;
              return (
                <View style={[styles.row, isMe ? styles.rowMe : styles.rowOther]}>
                  {!isMe && (
                    <View style={[styles.avatar, { backgroundColor: bg }]}>
                      <Text style={styles.avatarText}>
                        {item.avatar || (item.displayName?.[0] ?? '?').toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View
                    style={[
                      styles.bubble,
                      isMe
                        ? { backgroundColor: colors.accent, borderBottomRightRadius: 2 }
                        : { backgroundColor: colors.background, borderBottomLeftRadius: 2, borderColor: colors.glassLight, borderWidth: 1 },
                    ]}
                  >
                    {!isMe && (
                      <Text style={[styles.author, { color: colors.textMuted }]} numberOfLines={1}>
                        {item.displayName}
                      </Text>
                    )}
                    <Text
                      style={[
                        styles.body,
                        { color: isMe ? '#ffffff' : colors.textPrimary },
                      ]}
                    >
                      {item.body}
                    </Text>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: colors.textMuted }]}>
                {t('chat.empty', 'No messages yet — say hi!')}
              </Text>
            }
          />
          <View style={[styles.inputRow, { borderTopColor: colors.glassLight }]}>
            <TextInput
              style={[styles.input, { color: colors.textPrimary, borderColor: colors.glassLight, backgroundColor: colors.background }]}
              value={input}
              onChangeText={setInput}
              placeholder={t('chat.placeholder', 'Message')}
              placeholderTextColor={colors.textMuted}
              maxLength={500}
              onSubmitEditing={send}
              returnKeyType="send"
              testID={`${testIdPrefix}-input`}
            />
            <Pressable
              onPress={send}
              disabled={!input.trim() || !sender}
              style={[
                styles.sendBtn,
                { backgroundColor: colors.accent, opacity: (input.trim() && sender) ? 1 : 0.4 },
              ]}
              testID={`${testIdPrefix}-send`}
            >
              <Text style={styles.sendBtnText}>{t('chat.send', 'Send')}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  backdropTap: { flex: 1 },
  sheet: {
    height: '70%',
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  title: { fontSize: 16, fontWeight: '700' },
  closeX: { fontSize: 18, paddingHorizontal: 4 },
  list: { flex: 1 },
  listContent: { padding: Spacing.md, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, maxWidth: '85%' },
  rowMe: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  rowOther: { alignSelf: 'flex-start' },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  bubble: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.md,
    maxWidth: 280,
  },
  author: { fontSize: 11, fontWeight: '700', marginBottom: 1 },
  body: { fontSize: 14, lineHeight: 18 },
  empty: { textAlign: 'center', paddingVertical: Spacing.lg, fontSize: 13 },
  inputRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderTopWidth: 1,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    fontSize: 14,
  },
  sendBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    borderRadius: Radius.full,
  },
  sendBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
});
