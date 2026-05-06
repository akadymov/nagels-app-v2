/**
 * Nägels Online - Settings Screen
 * Combined Profile + Settings: nickname, avatar, theme, deck, language, password, logout.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing, Radius, TextStyles } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { useSettingsStore, type ThemePreference } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';
import { signOut, updateUserMetadata, resetPasswordForEmail, resendConfirmationEmail } from '../lib/supabase/authService';
import { setPlayerName as setPlayerNameInStorage } from '../lib/supabase/auth';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n/config';
import { usePushSubscribe } from '../lib/push/usePushSubscribe';

export interface SettingsScreenProps {
  onBack: () => void;
  onProfile?: () => void; // kept for compat but unused now
}

const AVATAR_PRESETS = ['🦈', '🐺', '🦊', '🐻', '🐱', '🎯', '🎲', '🃏', '👑', '💎', '🔥', '⭐', '🏆'];
const AVATAR_COLORS = ['#3380CC', '#CC4D80', '#66B366', '#9966CC', '#CC9933', '#33AAAA', '#CC6633', '#6666CC'];

/** Pill selector */
const OptionPills: React.FC<{
  options: { key: string; label: string }[];
  selected: string;
  onSelect: (key: string) => void;
  accentColor: string;
  textColor: string;
  bgColor: string;
  testIDPrefix?: string;
}> = ({ options, selected, onSelect, accentColor, textColor, bgColor, testIDPrefix }) => {
  const { colors } = useTheme();
  return (
    <View style={[pillStyles.container, { backgroundColor: bgColor, borderColor: colors.glassLight }]}>
      {options.map((opt) => {
        const isActive = opt.key === selected;
        return (
          <Pressable key={opt.key} style={[pillStyles.pill, isActive && { backgroundColor: accentColor }]} onPress={() => onSelect(opt.key)} testID={testIDPrefix ? `${testIDPrefix}-${opt.key}` : undefined}>
            <Text style={[pillStyles.pillText, { color: textColor }, isActive && { color: '#ffffff', fontWeight: '700' }]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const pillStyles = StyleSheet.create({
  container: { flexDirection: 'row', borderRadius: Radius.xl, borderWidth: 1, padding: 3 },
  pill: { flex: 1, paddingVertical: 8, borderRadius: Radius.lg, alignItems: 'center' },
  pillText: { fontSize: 14, fontWeight: '500' },
});

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onBack }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { themePreference, fourColorDeck, hapticsEnabled, setThemePreference, setFourColorDeck, setHapticsEnabled } = useSettingsStore();
  const { user, isGuest, displayName } = useAuthStore();
  const push = usePushSubscribe();

  const [nickname, setNickname] = useState(displayName || '');
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(user?.user_metadata?.avatar || null);
  const [avatarColor] = useState(() => user?.user_metadata?.avatar_color || AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [showConfirmAlert, setShowConfirmAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');

  const currentLang = i18n.language;
  const isLoggedIn = user && !isGuest && user.email;
  const initial = (nickname || displayName || 'S')[0].toUpperCase();

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
    useSettingsStore.getState().setLanguage(lang);
  };

  const handleSaveProfile = async () => {
    if (!nickname.trim()) return;
    try {
      const updated = await updateUserMetadata({
        display_name: nickname.trim(),
        avatar: selectedAvatar,
        avatar_color: avatarColor,
      });
      // Push the fresh user into authStore so any screen reading user_metadata
      // (e.g. Lobby avatar) updates immediately — supabase USER_UPDATED events
      // don't always fire reliably for anonymous sessions.
      useAuthStore.getState().setUser(updated, !!updated.is_anonymous);
      useAuthStore.getState().setDisplayName(nickname.trim());
      // Mirror the new name into the legacy guest-name AsyncStorage cache so
      // Lobby's getPlayerNameFromStorage on next mount agrees with authStore.
      await setPlayerNameInStorage(nickname.trim()).catch(() => {});
      setAlertMessage(String(t('profile.saved', 'Profile saved')));
      setShowConfirmAlert(true);
      setTimeout(() => setShowConfirmAlert(false), 3000);
    } catch (err: any) {
      setAlertMessage(String(err.message));
      setShowConfirmAlert(true);
    }
  };

  const handleResetPassword = async () => {
    if (!user?.email) return;
    try {
      await resetPasswordForEmail(user.email);
      setAlertMessage(String(t('auth.resetSent', 'Reset link sent! Check your email.')));
      setShowConfirmAlert(true);
      setShowPasswordReset(false);
    } catch (err: any) {
      setAlertMessage(String(err.message));
      setShowConfirmAlert(true);
    }
  };

  const handleResendConfirmation = async () => {
    if (!user?.email) return;
    try {
      await resendConfirmationEmail(user.email);
      setAlertMessage(String(t('auth.resetSent', 'Confirmation email sent!')));
      setShowConfirmAlert(true);
    } catch (err: any) {
      setAlertMessage(String(err.message));
      setShowConfirmAlert(true);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
      onBack();
    } catch {}
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: colors.glassLight }]}>
        <Pressable onPress={onBack} hitSlop={12} testID="settings-back">
          <Text style={[styles.backButton, { color: colors.accent }]}>←</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
          {t('settings.title', 'Settings')}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* === PROFILE === */}
        {/* Render for any user (guest or registered). Email + password sub-
            blocks are gated on isLoggedIn separately so guests can still
            pick a nickname and an avatar — those persist via user metadata
            on the anonymous Supabase session. */}
        {user && (
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              {t('profile.title', 'Profile')}
            </Text>

            {/* Avatar */}
            <View style={styles.avatarRow}>
              <View style={[styles.avatarCircle, { backgroundColor: avatarColor }]}>
                {selectedAvatar ? (
                  <Text style={styles.avatarEmoji}>{selectedAvatar}</Text>
                ) : (
                  <Text style={styles.avatarInitial}>{initial}</Text>
                )}
              </View>
              {isLoggedIn && (
                <View style={{ flex: 1 }}>
                  <Text style={[styles.emailText, { color: colors.textMuted }]}>{user?.email}</Text>
                  {!user?.email_confirmed_at && (
                    <Pressable onPress={handleResendConfirmation}>
                      <Text style={[styles.resendLink, { color: colors.warning }]}>
                        ⚠ {t('auth.resendConfirmation', 'Resend confirmation')}
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>

            {/* Nickname */}
            <View style={styles.nicknameRow}>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surfaceSecondary, color: colors.textPrimary, borderColor: colors.glassLight, flex: 1 }]}
                value={nickname}
                onChangeText={setNickname}
                maxLength={20}
                autoCapitalize="words"
                placeholder={String(t('profile.editNickname', 'Nickname'))}
                placeholderTextColor={colors.textMuted}
                testID="settings-nickname"
              />
              <Pressable style={[styles.saveBtn, { backgroundColor: colors.accent }]} onPress={handleSaveProfile} testID="settings-save">
                <Text style={styles.saveBtnText}>{t('common.done', 'Save')}</Text>
              </Pressable>
            </View>

            {/* Avatar picker */}
            <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
              {t('profile.chooseAvatar', 'Choose Avatar')}
            </Text>
            <View style={styles.avatarGrid}>
              <Pressable
                style={[styles.avatarOption, { backgroundColor: avatarColor }, !selectedAvatar && styles.avatarOptionSelected]}
                onPress={() => setSelectedAvatar(null)}
              >
                <Text style={styles.avatarOptionInitial}>{initial}</Text>
              </Pressable>
              {AVATAR_PRESETS.map((emoji) => (
                <Pressable
                  key={emoji}
                  style={[styles.avatarOption, { backgroundColor: colors.surfaceSecondary }, selectedAvatar === emoji && styles.avatarOptionSelected]}
                  onPress={() => setSelectedAvatar(emoji)}
                  testID={`avatar-${emoji}`}
                >
                  <Text style={styles.avatarOptionEmoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>

            {/* Change password — registered users only */}
            {isLoggedIn && (
              <>
                <Pressable onPress={() => setShowPasswordReset(!showPasswordReset)}>
                  <Text style={[styles.linkText, { color: colors.accent }]}>
                    {t('auth.changePassword', 'Change Password')}
                  </Text>
                </Pressable>
                {showPasswordReset && (
                  <Pressable style={[styles.secondaryBtn, { borderColor: colors.accent }]} onPress={handleResetPassword}>
                    <Text style={[styles.secondaryBtnText, { color: colors.accent }]}>
                      {t('auth.sendResetLink', 'Send Reset Link')}
                    </Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        )}

        {/* === THEME === */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t('settings.theme', 'Theme')}</Text>
          <Text style={[styles.sectionDesc, { color: colors.textMuted }]}>{t('settings.themeDesc')}</Text>
          <OptionPills
            options={[
              { key: 'system', label: t('settings.system', 'System') },
              { key: 'light', label: t('settings.light', 'Light') },
              { key: 'dark', label: t('settings.dark', 'Dark') },
            ]}
            selected={themePreference}
            onSelect={(key) => setThemePreference(key as ThemePreference)}
            accentColor={colors.accent} textColor={colors.textSecondary} bgColor={colors.surfaceSecondary}
            testIDPrefix="theme"
          />
        </View>

        {/* === DECK === */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t('settings.deckStyle', 'Deck Colors')}</Text>
          <Text style={[styles.sectionDesc, { color: colors.textMuted }]}>{t('settings.deckDesc')}</Text>
          <OptionPills
            options={[
              { key: 'classic', label: t('settings.classic', 'Classic') },
              { key: 'fourColor', label: t('settings.fourColor', '4-Color') },
            ]}
            selected={fourColorDeck ? 'fourColor' : 'classic'}
            onSelect={(key) => setFourColorDeck(key === 'fourColor')}
            accentColor={colors.accent} textColor={colors.textSecondary} bgColor={colors.surfaceSecondary}
            testIDPrefix="deck"
          />
          <View style={styles.deckPreview}>
            <Text style={[styles.previewSuit, { color: '#1a1a1a' }]}>♠</Text>
            <Text style={[styles.previewSuit, { color: '#BE1931' }]}>♥</Text>
            <Text style={[styles.previewSuit, { color: fourColorDeck ? '#0094FF' : '#BE1931' }]}>♦</Text>
            <Text style={[styles.previewSuit, { color: fourColorDeck ? '#308552' : '#1a1a1a' }]}>♣</Text>
          </View>
        </View>

        {/* === LANGUAGE === */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t('settings.language', 'Language')}</Text>
          <View style={{ height: Spacing.md }} />
          <OptionPills
            options={[
              { key: 'en', label: 'English' },
              { key: 'ru', label: 'Русский' },
              { key: 'es', label: 'Español' },
            ]}
            selected={currentLang}
            onSelect={handleLanguageChange}
            accentColor={colors.accent} textColor={colors.textSecondary} bgColor={colors.surfaceSecondary}
            testIDPrefix="lang"
          />
        </View>

        {/* === HAPTICS === */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            {t('settings.haptics', 'Vibration')}
          </Text>
          <View style={{ height: Spacing.md }} />
          <OptionPills
            options={[
              { key: 'on', label: t('settings.on', 'On') },
              { key: 'off', label: t('settings.off', 'Off') },
            ]}
            selected={hapticsEnabled ? 'on' : 'off'}
            onSelect={(key) => setHapticsEnabled(key === 'on')}
            accentColor={colors.accent} textColor={colors.textSecondary} bgColor={colors.surfaceSecondary}
            testIDPrefix="haptics"
          />
        </View>

        {/* === NOTIFICATIONS === */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            {t('settings.notifications', 'Notifications')}
          </Text>
          <Text style={[styles.sectionDesc, { color: colors.textMuted }]}>
            {t('settings.notificationsDesc', 'Wake me when it is my turn or the game starts.')}
          </Text>
          <OptionPills
            options={[
              { key: 'on',  label: t('settings.on',  'On') },
              { key: 'off', label: t('settings.off', 'Off') },
            ]}
            selected={push.state === 'subscribed' ? 'on' : 'off'}
            onSelect={(key) => { void (key === 'on' ? push.enable() : push.disable()); }}
            accentColor={colors.accent} textColor={colors.textSecondary} bgColor={colors.surfaceSecondary}
            testIDPrefix="notifications"
          />
          {push.state === 'denied' && (
            <Text style={[styles.sectionDesc, { color: colors.textMuted, marginTop: Spacing.sm }]}>
              {t('settings.notificationsDenied', 'Enable notifications in your browser site settings, then come back.')}
            </Text>
          )}
          {push.state === 'ios-needs-pwa' && (
            <Text style={[styles.sectionDesc, { color: colors.textMuted, marginTop: Spacing.sm }]}>
              {t('settings.notificationsPwa', 'Add this site to your home screen first (Share → Add to Home Screen).')}
            </Text>
          )}
          {push.state === 'unsupported' && (
            <Text style={[styles.sectionDesc, { color: colors.textMuted, marginTop: Spacing.sm }]}>
              {t('settings.notificationsUnsupported', 'Your browser does not support push notifications.')}
            </Text>
          )}
        </View>

        {/* === LOGOUT === */}
        {isLoggedIn && (
          <Pressable style={[styles.logoutBtn, { borderColor: colors.error }]} onPress={handleLogout}>
            <Text style={[styles.logoutText, { color: colors.error }]}>{t('auth.signOut')}</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Toast */}
      {showConfirmAlert && (
        <View style={[styles.toast, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.toastText, { color: colors.textPrimary }]}>{alertMessage}</Text>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1 },
  backButton: { fontSize: 22, fontWeight: '700', width: 36 },
  headerTitle: { ...TextStyles.h3, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.md, gap: Spacing.md, paddingBottom: 160 },
  section: { borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1 },
  sectionTitle: { ...TextStyles.h3, marginBottom: Spacing.sm },
  sectionSubtitle: { fontSize: 13, marginTop: Spacing.md, marginBottom: Spacing.sm },
  sectionDesc: { ...TextStyles.caption, marginBottom: Spacing.md, lineHeight: 20 },
  // Profile
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  avatarCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 24, fontWeight: '700', color: '#ffffff' },
  avatarEmoji: { fontSize: 28 },
  emailText: { fontSize: 13 },
  resendLink: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  nicknameRow: { flexDirection: 'row', gap: Spacing.sm },
  input: { height: 44, borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing.md, fontSize: 15 },
  saveBtn: { height: 44, paddingHorizontal: Spacing.lg, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, justifyContent: 'center' },
  avatarOption: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarOptionSelected: { borderWidth: 3, borderColor: '#E6BF33' },
  avatarOptionInitial: { fontSize: 18, fontWeight: '700', color: '#ffffff' },
  avatarOptionEmoji: { fontSize: 22 },
  linkText: { fontSize: 14, fontWeight: '600', marginTop: Spacing.md },
  secondaryBtn: { height: 40, borderRadius: Radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm },
  secondaryBtnText: { fontSize: 14, fontWeight: '600' },
  // Deck
  deckPreview: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.lg, marginTop: Spacing.md },
  previewSuit: { fontSize: 28, fontWeight: '700' },
  // Logout
  logoutBtn: { height: 48, borderRadius: Radius.lg, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  logoutText: { fontSize: 15, fontWeight: '600' },
  // Toast
  toast: { position: 'absolute', bottom: 40, left: Spacing.lg, right: Spacing.lg, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center' },
  toastText: { fontSize: 14, fontWeight: '500' },
});

export default SettingsScreen;
