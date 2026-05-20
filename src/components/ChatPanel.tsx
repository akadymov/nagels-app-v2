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
import { useRoomStore } from '../store/roomStore';
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
  /** `modal` (default) wraps the body in a React Native Modal —
   *  used on mobile. `inline` renders the body directly so a desktop
   *  layout can mount the chat as a permanent side panel. */
  mode?: 'modal' | 'inline';
  /** Inline hosts without an external re-open path (e.g. DesktopWaitingRoom)
   *  can hide the ✕ button so the user doesn't dead-end the chat. */
  hideCloseButton?: boolean;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  visible, onClose, sender, testIdPrefix = 'chat', mode = 'modal', hideCloseButton = false,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const messages = useChatStore((s) => s.messages);
  const markRead = useChatStore((s) => s.markRead);
  const setChatOpen = useChatStore((s) => s.setChatOpen);
  const [input, setInput] = useState('');
  const listRef = useRef<FlatList | null>(null);
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    if (!visible) {
      setChatOpen(false);
      return;
    }
    // setChatOpen also zeroes `unread` so the badge clears the instant
    // the chat becomes visible — independent of the messages-length
    // dependency that previously did the reset.
    setChatOpen(true);
    markRead();
    const t = setTimeout(() => {
      try { listRef.current?.scrollToEnd({ animated: false }); } catch {}
    }, 50);
    return () => {
      clearTimeout(t);
      setChatOpen(false);
    };
  }, [visible, markRead, setChatOpen, messages.length]);

  // iOS Safari leaves the page scrolled when the on-screen keyboard
  // pushes a focused input into view inside a fixed-position Modal.
  // After we close the chat modal, the GameTable can render shifted
  // until a hard reload — restore window/document scroll explicitly.
  // No-op outside web; cheap on every close.
  const handleClose = () => {
    try { inputRef.current?.blur(); } catch {}
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // iOS Safari: closing the chat after the keyboard pushed the
      // viewport leaves the underlying GameTable rendered against stale
      // dimensions — "fixable only by reload" until we force a relayout.
      // Three passes — now, mid-keyboard-retract, post-retract — restore
      // scroll AND dispatch resize so Dimensions listeners recompute.
      const restore = () => {
        try {
          window.scrollTo(0, 0);
          if (typeof document !== 'undefined') {
            document.documentElement.scrollTop = 0;
            if (document.body) document.body.scrollTop = 0;
          }
          window.dispatchEvent(new Event('resize'));
        } catch {}
      };
      restore();
      setTimeout(restore, 250);
      setTimeout(restore, 500);
    }
    onClose();
  };

  const send = async () => {
    if (!sender) return;
    const body = input.trim();
    if (!body) return;
    setInput('');
    // Keep focus on the input so the user can keep typing without
    // re-tapping. blurOnSubmit={false} below should cover Enter-key
    // submit, but on RN-Web some versions still fire blur AFTER our
    // sync focus() call. A deferred second focus (next frame) wins that
    // race — without it, desktop users lose the caret after every Enter.
    inputRef.current?.focus();
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        try { inputRef.current?.focus(); } catch {}
      });
    }
    // iOS Safari: after each send the page picks up a stray horizontal
    // scroll (autocomplete/focus reflow), shifting the chat sheet right
    // and clipping bubbles + the Send button. Snap scrollLeft back now
    // and once more after the autocomplete bar settles.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const snapX = () => {
        try {
          window.scrollTo(window.scrollX > 0 ? 0 : window.scrollX, window.scrollY);
          if (typeof document !== 'undefined') {
            if (document.documentElement) document.documentElement.scrollLeft = 0;
            if (document.body) document.body.scrollLeft = 0;
          }
        } catch {}
      };
      snapX();
      setTimeout(snapX, 100);
    }
    await sendChatMessage({
      id: `${sender.sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sessionId: sender.sessionId,
      displayName: sender.displayName,
      body,
      ts: Date.now(),
      avatar: sender.avatar ?? null,
      avatarColor: sender.avatarColor ?? null,
      // Snapshot the spectator flag at send time, not render time, so
      // the message keeps its origin even if the user later takes a seat.
      fromSpectator: useRoomStore.getState().isSpectator,
    });
  };

  // In inline mode, visibility is controlled by the parent container —
  // we always render the body; the side-pane decides if it's on screen.
  if (mode === 'inline' && !visible) {
    // Still render so messages keep arriving / unread counter updates;
    // hosts simply don't mount this when they want it hidden.
  }
  const body = (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[
        mode === 'inline' ? styles.inlineSheet : styles.sheet,
        { backgroundColor: colors.surface, borderColor: colors.glassLight },
      ]}
    >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              {t('chat.title', 'Chat')}
            </Text>
            {!hideCloseButton && (
              <Pressable onPress={handleClose} hitSlop={12} testID={`${testIdPrefix}-close`}>
                <Text style={[styles.closeX, { color: colors.textMuted }]}>✕</Text>
              </Pressable>
            )}
          </View>
          <FlatList
            ref={(r) => { listRef.current = r; }}
            data={messages}
            keyExtractor={(m) => m.id}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            // Stick to the bottom whenever new content lands while the
            // panel is visible. Without this the mobile Modal animation
            // outruns the 50ms scrollToEnd in the visibility effect and
            // the chat opens pinned to the top.
            onContentSizeChange={() => {
              if (!visible) return;
              try { listRef.current?.scrollToEnd({ animated: false }); } catch {}
            }}
            onLayout={() => {
              if (!visible) return;
              try { listRef.current?.scrollToEnd({ animated: false }); } catch {}
            }}
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
                        {item.fromSpectator === true && (
                          <Text style={styles.spectatorEye}>{'\u{1F441} '}</Text>
                        )}
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
              ref={(r) => { inputRef.current = r; }}
              style={[styles.input, { color: colors.textPrimary, borderColor: colors.glassLight, backgroundColor: colors.background }]}
              value={input}
              onChangeText={setInput}
              placeholder={t('chat.placeholder', 'Message')}
              placeholderTextColor={colors.textMuted}
              maxLength={500}
              onSubmitEditing={send}
              blurOnSubmit={false}
              returnKeyType="send"
              testID={`${testIdPrefix}-input`}
            />
            <Pressable
              onPress={send}
              disabled={!input.trim() || !sender}
              // iOS Safari: tapping the button while the input is focused
              // fires mousedown first, which blurs the input and eats the
              // subsequent click — so the second message never sends until
              // you tap elsewhere. preventDefault on mousedown keeps focus
              // on the input and lets onPress fire on the first tap.
              {...(Platform.OS === 'web'
                ? { onMouseDown: (e: any) => e.preventDefault?.() }
                : {})}
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
  );

  if (mode === 'inline') {
    return body;
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={handleClose} />
        {body}
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
  inlineSheet: {
    flex: 1,
    borderRadius: Radius.lg,
    borderWidth: 1,
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
  spectatorEye: { fontSize: 12, opacity: 0.7 },
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
    // 16px minimum — iOS Safari auto-zooms the viewport on focus when
    // input font-size is <16px, which pushes the Send button off-screen.
    fontSize: 16,
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
