/**
 * Nägels Online - Profile Screen
 * View/edit nickname, avatar, logout.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing, Radius } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import { signOut, updateUserMetadata, resendConfirmationEmail } from '../lib/supabase/authService';
import { linkGoogle, unlinkGoogle, hasGoogleIdentity } from '../lib/auth/google';

export interface ProfileScreenProps {
  onBack: () => void;
}

const AVATAR_PRESETS = ['🦈', '🐺', '🦊', '🐻', '🐱', '🎯', '🎲', '🃏', '👑', '💎', '🔥', '⭐', '🏆'];
const AVATAR_COLORS = ['#3380CC', '#CC4D80', '#66B366', '#9966CC', '#CC9933', '#33AAAA', '#CC6633', '#6666CC'];

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ onBack }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { user, isGuest, displayName } = useAuthStore();

  const [nickname, setNickname] = useState(displayName || '');
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);
  const [avatarColor] = useState(() => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]);

  const handleSave = async () => {
    if (!nickname.trim()) return;
    try {
      await updateUserMetadata({
        display_name: nickname.trim(),
        avatar: selectedAvatar,
        avatar_color: avatarColor,
      });
      useAuthStore.getState().setDisplayName(nickname.trim());
      Alert.alert(String(t('common.done')), String(t('profile.saved', 'Profile saved')));
    } catch (err: any) {
      Alert.alert(String(t('common.error')), String(err.message));
    }
  };

  const handleResendConfirmation = async () => {
    if (!user?.email) return;
    try {
      await resendConfirmationEmail(user.email);
      Alert.alert(String(t('common.done')), String(t('auth.resetSent', 'Confirmation email sent!')));
    } catch (err: any) {
      Alert.alert(String(t('common.error')), String(err.message));
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
      onBack();
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const isGoogleLinked = hasGoogleIdentity(user);

  const handleToggleGoogle = async () => {
    try {
      if (isGoogleLinked) await unlinkGoogle();
      else await linkGoogle();
    } catch (err: any) {
      Alert.alert(String(t('common.error')), String(err?.message ?? err));
    }
  };

  const initial = (nickname || displayName || 'S')[0].toUpperCase();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.glassLight }]}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={[styles.backBtn, { color: colors.accent }]}>←</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
          {t('profile.title', 'Profile')}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={[styles.avatarCircle, { backgroundColor: avatarColor }]}>
            {selectedAvatar ? (
              <Text style={styles.avatarEmoji}>{selectedAvatar}</Text>
            ) : (
              <Text style={styles.avatarInitial}>{initial}</Text>
            )}
          </View>
          {!isGuest && user?.email && (
            <>
              <Text style={[styles.emailText, { color: colors.textMuted }]}>
                {user.email}
              </Text>
              {!user.email_confirmed_at && (
                <Pressable onPress={handleResendConfirmation} style={[styles.confirmBanner, { backgroundColor: colors.warning + '20', borderColor: colors.warning }]}>
                  <Text style={[styles.confirmText, { color: colors.warning }]}>
                    ⚠ {t('auth.emailNotConfirmed', 'Email not confirmed')}
                  </Text>
                  <Text style={[styles.resendLink, { color: colors.accent }]}>
                    {t('auth.resendConfirmation', 'Resend confirmation')}
                  </Text>
                </Pressable>
              )}
            </>
          )}
          {isGuest && (
            <Text style={[styles.guestBadge, { color: colors.textMuted }]}>
              {t('auth.guest', 'Guest')}
            </Text>
          )}
        </View>

        {/* Nickname */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            {t('profile.editNickname', 'Nickname')}
          </Text>
          <View style={styles.nicknameRow}>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surfaceSecondary, color: colors.textPrimary, borderColor: colors.glassLight }]}
              value={nickname}
              onChangeText={setNickname}
              maxLength={20}
              autoCapitalize="words"
            />
            <Pressable
              style={[styles.saveBtn, { backgroundColor: colors.accent }]}
              onPress={handleSave}
            >
              <Text style={styles.saveBtnText}>{t('common.done', 'Save')}</Text>
            </Pressable>
          </View>
        </View>

        {/* Avatar picker */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            {t('profile.chooseAvatar', 'Choose Avatar')}
          </Text>
          <Text style={[styles.sectionDesc, { color: colors.textMuted }]}>
            {t('profile.avatarOptional', 'Optional — default shows your initial')}
          </Text>
          <View style={styles.avatarGrid}>
            {/* Default (initial) option */}
            <Pressable
              style={[
                styles.avatarOption,
                { backgroundColor: avatarColor },
                !selectedAvatar && styles.avatarOptionSelected,
              ]}
              onPress={() => setSelectedAvatar(null)}
            >
              <Text style={styles.avatarOptionInitial}>{initial}</Text>
            </Pressable>
            {AVATAR_PRESETS.map((emoji) => (
              <Pressable
                key={emoji}
                style={[
                  styles.avatarOption,
                  { backgroundColor: colors.surfaceSecondary },
                  selectedAvatar === emoji && styles.avatarOptionSelected,
                ]}
                onPress={() => setSelectedAvatar(emoji)}
              >
                <Text style={styles.avatarOptionEmoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Link Google */}
        <Pressable
          testID="btn-link-google"
          style={[styles.linkBtn, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}
          onPress={handleToggleGoogle}
        >
          <Text style={[styles.linkBtnText, { color: colors.textPrimary }]}>
            {isGoogleLinked
              ? t('auth.unlinkGoogle', 'Unlink Google')
              : t('auth.linkGoogle', 'Sign in with Google')}
          </Text>
        </Pressable>

        {/* Logout */}
        <Pressable
          style={[styles.logoutBtn, { borderColor: colors.error }]}
          onPress={handleLogout}
        >
          <Text style={[styles.logoutText, { color: colors.error }]}>
            {t('auth.signOut')}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  backBtn: {
    fontSize: 22,
    fontWeight: '700',
    width: 36,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  scroll: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  avatarSection: {
    alignItems: 'center',
    gap: Spacing.sm,
    marginVertical: Spacing.md,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 36,
    fontWeight: '700',
    color: '#ffffff',
  },
  avatarEmoji: {
    fontSize: 40,
  },
  emailText: {
    fontSize: 14,
  },
  confirmBanner: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.xs,
  },
  confirmText: {
    fontSize: 13,
    fontWeight: '600',
  },
  resendLink: {
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  guestBadge: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  section: {
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  sectionDesc: {
    fontSize: 13,
    marginBottom: Spacing.md,
  },
  nicknameRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  input: {
    flex: 1,
    height: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    fontSize: 15,
  },
  saveBtn: {
    height: 44,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  avatarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    justifyContent: 'center',
  },
  avatarOption: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOptionSelected: {
    borderWidth: 3,
    borderColor: '#E6BF33',
  },
  avatarOptionInitial: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
  },
  avatarOptionEmoji: {
    fontSize: 24,
  },
  linkBtn: {
    height: 48,
    borderRadius: Radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.md,
  },
  linkBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  logoutBtn: {
    height: 48,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.md,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '600',
  },
});

export default ProfileScreen;
