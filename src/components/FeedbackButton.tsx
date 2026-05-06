/**
 * Nägels Online - Feedback Button + Modal
 *
 * Floating action button (bottom-right) available on every screen.
 * Opens a modal where any user — including non-logged-in guests —
 * can submit feedback (bug reports, ideas, UX issues).
 *
 * Submissions go to the public.feedback table with auto-captured
 * context (current screen, room, platform, app version).
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { GlassButton } from './buttons';
import { Colors, Spacing, Radius, TextStyles } from '../constants';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase/client';
import { useAuthStore } from '../store/authStore';
import { useRoomStore } from '../store/roomStore';
import { useTheme } from '../hooks/useTheme';
import { collectFeedbackContext } from '../utils/feedbackContext';

type Category = 'bug' | 'idea' | 'ux' | 'general';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const APP_VERSION: string = (() => {
  try {
    return require('../../package.json').version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export interface FeedbackButtonProps {
  /** Optional override of the current screen name (otherwise inferred from props/route) */
  screenName?: string;
}

export const FeedbackButton: React.FC<FeedbackButtonProps> = ({ screenName }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        /* ignore */
      }
    }
    setOpen(true);
  }, []);

  return (
    <>
      <Pressable
        accessibilityLabel={t('feedback.openLabel')}
        accessibilityRole="button"
        onPress={handleOpen}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        hitSlop={8}
        testID="feedback-fab"
      >
        <Text style={styles.fabIcon}>✉️</Text>
      </Pressable>
      <FeedbackModal
        visible={open}
        onClose={() => setOpen(false)}
        screenName={screenName}
      />
    </>
  );
};

// ============================================================
// MODAL
// ============================================================

interface FeedbackModalProps {
  visible: boolean;
  onClose: () => void;
  screenName?: string;
}

const CATEGORIES: { value: Category; labelKey: string }[] = [
  { value: 'bug', labelKey: 'feedback.categoryBug' },
  { value: 'idea', labelKey: 'feedback.categoryIdea' },
  { value: 'ux', labelKey: 'feedback.categoryUx' },
  { value: 'general', labelKey: 'feedback.categoryGeneral' },
];

const FeedbackModal: React.FC<FeedbackModalProps> = ({
  visible,
  onClose,
  screenName,
}) => {
  const { t, i18n } = useTranslation();
  const { user, isGuest, displayName } = useAuthStore();
  const currentRoom = useRoomStore((s) => s.snapshot?.room ?? null);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const { theme: themeResolved, colors: themeColors } = useTheme();

  const isLoggedIn = !!user && !isGuest;
  const defaultName = isLoggedIn ? displayName : '';

  const [name, setName] = useState(defaultName);
  const [category, setCategory] = useState<Category>('general');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const reset = useCallback(() => {
    setName(defaultName);
    setCategory('general');
    setMessage('');
    setError(null);
    setSubmitting(false);
    setSubmitted(false);
  }, [defaultName]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleSubmit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      setError(t('feedback.errorEmpty'));
      return;
    }
    if (!isSupabaseConfigured()) {
      setError(t('feedback.errorOffline'));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const client = getSupabaseClient();
      const userAgent =
        Platform.OS === 'web' && typeof navigator !== 'undefined'
          ? navigator.userAgent
          : null;

      // Rich debug context — device/browser, locale, settings, viewport,
      // PWA/online state, timezone. Lives in `extra` JSONB so we don't
      // bloat the schema while keeping it queryable from the dashboard.
      const ctx = collectFeedbackContext();

      const payload = {
        player_id: user?.id ?? null,
        display_name: (name || displayName || '').trim() || null,
        email: user?.email ?? null,
        category,
        message: trimmed,
        screen: screenName ?? null,
        room_id: currentRoom?.id ?? null,
        app_version: APP_VERSION,
        platform: Platform.OS,
        user_agent: userAgent,
        language: i18n.language,
        extra: {
          ...ctx,
          themeResolved,
          myPlayerId: myPlayerId ?? null,
          isAnonymous: isGuest,
        },
      };

      const { error: insertError } = await client.from('feedback').insert(payload);
      if (insertError) throw insertError;

      setSubmitted(true);
      // Auto-close after a beat so the user sees the success state
      setTimeout(() => {
        handleClose();
      }, 1200);
    } catch (err: any) {
      console.warn('[Feedback] submit failed', err);
      setError(err?.message || t('feedback.errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  }, [
    message,
    name,
    displayName,
    category,
    user,
    isGuest,
    screenName,
    currentRoom,
    myPlayerId,
    i18n.language,
    t,
    handleClose,
  ]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.overlay} onPress={handleClose}>
          <Pressable
            style={[styles.sheet, { backgroundColor: themeColors.surface, borderColor: themeColors.glassLight }]}
            onPress={(e) => e.stopPropagation?.()}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.title, { color: themeColors.textPrimary }]}>{t('feedback.title')}</Text>
              <Text style={[styles.subtitle, { color: themeColors.textMuted }]}>{t('feedback.subtitle')}</Text>

              {submitted ? (
                <Text style={[styles.successText, { color: themeColors.success }]}>{t('feedback.successMessage')}</Text>
              ) : (
                <>
                  {/* Name (optional, only for non-logged-in users) */}
                  {!isLoggedIn && (
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: themeColors.surfaceSecondary,
                          borderColor: themeColors.glassLight,
                          color: themeColors.textPrimary,
                        },
                      ]}
                      value={name}
                      onChangeText={setName}
                      placeholder={t('feedback.namePlaceholder')}
                      placeholderTextColor={themeColors.textMuted}
                      autoCapitalize="words"
                      autoCorrect={false}
                      maxLength={60}
                      returnKeyType="next"
                    />
                  )}

                  {/* Category chips */}
                  <View style={styles.chips}>
                    {CATEGORIES.map((c) => {
                      const active = category === c.value;
                      return (
                        <Pressable
                          key={c.value}
                          onPress={() => setCategory(c.value)}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: themeColors.surfaceSecondary,
                              borderColor: themeColors.glassLight,
                            },
                            active && { backgroundColor: themeColors.accent, borderColor: themeColors.accent },
                          ]}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              { color: themeColors.textSecondary },
                              active && styles.chipTextActive,
                            ]}
                          >
                            {t(c.labelKey)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {/* Message */}
                  <TextInput
                    style={[
                      styles.input,
                      styles.textarea,
                      {
                        backgroundColor: themeColors.surfaceSecondary,
                        borderColor: themeColors.glassLight,
                        color: themeColors.textPrimary,
                      },
                    ]}
                    value={message}
                    onChangeText={setMessage}
                    placeholder={t('feedback.messagePlaceholder')}
                    placeholderTextColor={themeColors.textMuted}
                    multiline
                    textAlignVertical="top"
                    maxLength={4000}
                  />

                  {error && <Text style={[styles.errorText, { color: themeColors.error }]}>{error}</Text>}

                  {submitting ? (
                    <ActivityIndicator
                      color={themeColors.accent}
                      style={{ marginVertical: Spacing.md }}
                    />
                  ) : (
                    <GlassButton
                      title={t('feedback.send')}
                      onPress={handleSubmit}
                      variant="primary"
                      size="large"
                      accentColor={themeColors.accent}
                      style={styles.fullWidth}
                      disabled={!message.trim()}
                    />
                  )}

                  <Pressable onPress={handleClose} style={styles.cancelBtn}>
                    <Text style={[styles.cancelText, { color: themeColors.textMuted }]}>{t('common.cancel')}</Text>
                  </Pressable>
                </>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

// ============================================================
// STYLES
// ============================================================

const FAB_SIZE = 48;

const styles = StyleSheet.create({
  // Floating button
  fab: {
    position: 'absolute',
    right: Spacing.md,
    bottom: Spacing.xxl,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    opacity: 0.92,
  },
  fabPressed: {
    opacity: 1,
    transform: [{ scale: 0.95 }],
  },
  fabIcon: {
    fontSize: 22,
    color: '#ffffff',
    lineHeight: 24,
  },

  // Modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.glassLight,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  title: {
    ...TextStyles.h2,
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  subtitle: {
    ...TextStyles.body,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  input: {
    ...TextStyles.body,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.glassLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  textarea: {
    minHeight: 120,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full ?? 999,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.glassLight,
  },
  chipActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  chipText: {
    ...TextStyles.caption,
    color: Colors.textSecondary,
  },
  chipTextActive: {
    color: '#ffffff',
    fontWeight: '600' as const,
  },
  errorText: {
    ...TextStyles.caption,
    color: Colors.error,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  successText: {
    ...TextStyles.body,
    color: Colors.success,
    textAlign: 'center',
    marginVertical: Spacing.lg,
    fontWeight: '600' as const,
  },
  fullWidth: {
    width: '100%',
    marginTop: Spacing.xs,
  },
  cancelBtn: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  cancelText: {
    ...TextStyles.caption,
    color: Colors.textMuted,
  },
});

export default FeedbackButton;
