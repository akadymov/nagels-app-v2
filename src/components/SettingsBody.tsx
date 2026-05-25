/**
 * Pure-content settings panel: profile + theme + deck + language + haptics
 * + notifications + install-app + logout. No SafeAreaView, no header — host
 * components (SettingsModal) provide the chrome.
 *
 * onClose: closes the host modal. Called when a section needs to navigate
 * away (e.g., logout) so the modal isn't left open underneath.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { Spacing, Radius, TextStyles } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { useSettingsStore, type ThemePreference } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';
import { useRoomStore } from '../store/roomStore';
import { gameClient } from '../lib/gameClient';
import { UserAvatar } from './UserAvatar';
import { signOut, updateUserMetadata, resetPasswordForEmail, resendConfirmationEmail, setUserPassword } from '../lib/supabase/authService';
import { linkGoogle, unlinkGoogle, hasGoogleIdentity } from '../lib/auth/google';
import { GoogleButton } from './GoogleButton';
import { setPlayerName as setPlayerNameInStorage } from '../lib/supabase/auth';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import i18n from '../i18n/config';
import { usePushSubscribe } from '../lib/push/usePushSubscribe';
import { PwaInstallModal } from './PwaInstallModal';
import { isStandalone, isMobileWeb } from '../lib/pwaInstall';
import { BrandSwitch } from './BrandSwitch';
import { useRatingStore } from '../store/ratingStore';
import { canPlayForRating } from '../utils/ratingEligibility';
import { AdminRatingBlock } from './admin/AdminRatingBlock';
import { TransferRatingModal } from '../screens/TransferRatingModal';

export interface SettingsBodyProps {
  onClose: () => void;
  /** Render only a slice of the body — used by the Welcome page
   *  desktop layout where identity sits inline after the nickname
   *  input and the rest of the settings sit below the lobby CTAs.
   *  Undefined = render everything (existing behavior). */
  only?: 'identity' | 'preferences';
  /** Hide the Profile-section nickname row. Lobby provides its
   *  own nickname input — duplicating it here is just noise. */
  hideNickname?: boolean;
}

const AVATAR_PRESETS = ['🦈', '🐺', '🦊', '🐻', '🐱', '🎯', '🎲', '🃏', '👑', '💎', '🔥', '⭐', '🏆'];
const AVATAR_COLORS = ['#3380CC', '#CC4D80', '#66B366', '#9966CC', '#CC9933', '#33AAAA', '#CC6633', '#6666CC'];

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

export const SettingsBody: React.FC<SettingsBodyProps> = ({ onClose, only, hideNickname = false }) => {
  const showSaveProgress = only === undefined;
  const showIdentity = only !== 'preferences';
  const showPreferences = only !== 'identity';
  const showLogout = only !== 'identity'; // logout lives with preferences
  const { t } = useTranslation();
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const { themePreference, fourColorDeck, hapticsEnabled, setThemePreference, setFourColorDeck, setHapticsEnabled } = useSettingsStore();
  const { user, isGuest, displayName } = useAuthStore();
  const ratingEligible = canPlayForRating(user, isGuest);
  const ratingBalance = useRatingStore((s) => s.balance);
  const loadRating = useRatingStore((s) => s.load);
  // SettingsBody is a sibling inside a modal / left pane — useFocusEffect
  // on the parent doesn't fire when we surface, so kick the rating load
  // on mount and whenever eligibility flips. Cheap RPC (single integer).
  useEffect(() => {
    if (ratingEligible) loadRating();
  }, [ratingEligible, loadRating]);
  // "Anonymous" = not a registered user yet. The Supabase user.is_anonymous
  // flag isn't always populated on every session (especially right after
  // a refresh), so we OR with the canonical isGuest flag from authStore.
  const isAnonymous =
    isGuest || (!!user && (user as { is_anonymous?: boolean }).is_anonymous === true);
  const push = usePushSubscribe();
  const [showPwaModal, setShowPwaModal] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const pwaInstalled = isStandalone();
  // Only surface "Install App" on mobile-web browsers — desktop browsers
  // can't meaningfully install a PWA the same way and the prompt is
  // confusing in that context.
  const pwaPromptApplies = !pwaInstalled && isMobileWeb();

  const [nickname, setNickname] = useState(displayName || '');
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(user?.user_metadata?.avatar || null);
  const [avatarColor] = useState(() => user?.user_metadata?.avatar_color || AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showConfirmAlert, setShowConfirmAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');

  const hasEmailIdentity = (user?.identities ?? []).some((i: any) => i.provider === 'email');

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
      useAuthStore.getState().setUser(updated, !!updated.is_anonymous);
      useAuthStore.getState().setDisplayName(nickname.trim());
      await setPlayerNameInStorage(nickname.trim()).catch(() => {});
      // Propagate the new name into the current room (if any) so other
      // players see it live. Avatar/color come from auth.users metadata
      // directly in get_room_state, so they ride along on the broadcast.
      const activeRoomId = useRoomStore.getState().snapshot?.room?.id ?? null;
      if (activeRoomId) {
        try {
          await gameClient.setDisplayName(nickname.trim(), activeRoomId);
        } catch (err) {
          console.warn('[settings] propagate display_name failed:', err);
        }
      }
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

  const [googleLoading, setGoogleLoading] = useState(false);
  const handleToggleGoogle = async () => {
    setGoogleLoading(true);
    try {
      if (hasGoogleIdentity(user)) {
        await unlinkGoogle();
        setGoogleLoading(false);
      } else {
        await linkGoogle();
        // linkIdentity navigates to Google — if we're still here, drop the
        // spinner after a few seconds so the user can retry.
        setTimeout(() => setGoogleLoading(false), 6000);
      }
    } catch (err: any) {
      setGoogleLoading(false);
      setAlertMessage(String(err?.message ?? err));
      setShowConfirmAlert(true);
    }
  };

  const handleSetPassword = async () => {
    try {
      await setUserPassword(newPassword);
      setNewPassword('');
      setShowSetPassword(false);
      setAlertMessage(String(t('auth.passwordSet', 'Password set. You can now sign in with email + password.')));
      setShowConfirmAlert(true);
    } catch (err: any) {
      const code = String(err?.message ?? err);
      const msg = code === 'auth.passwordTooShort'
        ? t('auth.passwordTooShort', 'Password must be at least 6 characters')
        : code;
      setAlertMessage(String(msg));
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
      // Drop the cached nickname so the next session starts as a fresh guest
      // instead of inheriting the previous user's display name in Lobby.
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.removeItem('nagels_player_name');
      useAuthStore.getState().setDisplayName('Guest');
      onClose();
      // Reset the navigation stack to Welcome — landing on Lobby right after
      // logout looks like the previous user is still in.
      navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
    } catch {}
  };

  // When embedded inside another scroll view (LobbyScreen on the
  // Welcome page), we render a plain View — nested ScrollViews break
  // touch behavior and produce a confusing scroll-within-scroll.
  const embedded = only !== undefined;
  const Container = embedded ? (View as any) : ScrollView;
  const containerProps = embedded
    ? { style: { gap: Spacing.md } }
    : {
        style: { flex: 1 },
        contentContainerStyle: { padding: Spacing.md, gap: Spacing.md, paddingBottom: 120 },
        showsVerticalScrollIndicator: false,
        keyboardShouldPersistTaps: 'handled',
      };

  return (
    // When embedded the outer View must NOT flex:1 — inside a
    // centered scroll container that would stretch the slot to the
    // full pane height and look like a huge gap before the next
    // sibling.
    <View style={embedded ? undefined : { flex: 1 }}>
      <Container {...containerProps}>
        {/* === SAVE PROGRESS (anonymous-only) === */}
        {showSaveProgress && isAnonymous && (
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              {t('auth.saveProgressTitle', 'Save your progress')}
            </Text>
            <Text style={[styles.sectionDesc, { color: colors.textMuted }]}>
              {t('auth.saveProgressDesc', 'Sign in to keep your stats, friends, and history across devices.')}
            </Text>
            <Pressable
              onPress={() => {
                onClose();
                navigation.navigate('Auth');
              }}
              style={[styles.saveBtn, { backgroundColor: colors.accent, alignSelf: 'flex-start', paddingHorizontal: Spacing.lg }]}
              testID="settings-save-progress"
            >
              <Text style={styles.saveBtnText}>{t('auth.saveProgress', 'Save progress')}</Text>
            </Pressable>
          </View>
        )}

        {/* === PROFILE / IDENTITY === */}
        {showIdentity && user && (
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
            {only !== 'identity' && (
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                {t('profile.title', 'Profile')}
              </Text>
            )}

            <View style={styles.avatarRow}>
              <UserAvatar
                avatarUrl={(user?.user_metadata?.avatar_url as string | undefined) ?? null}
                emoji={selectedAvatar}
                fallback={initial}
                backgroundColor={avatarColor}
                size={56}
                textSize={28}
              />
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

            {!hideNickname && (
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
            )}

            {/* Hide the emoji picker for Google-linked accounts — their
             *  avatar comes from the Google profile picture, so an
             *  emoji selection would never win against avatar_url. */}
            {!hasGoogleIdentity(user) && (
              <>
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
              </>
            )}

            {isLoggedIn && (
              <>
                {hasEmailIdentity ? (
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
                ) : (
                  <>
                    <Pressable onPress={() => setShowSetPassword(!showSetPassword)} testID="settings-set-password-toggle">
                      <Text style={[styles.linkText, { color: colors.accent }]}>
                        {t('auth.setPassword', 'Set Password')}
                      </Text>
                    </Pressable>
                    {showSetPassword && (
                      <View style={styles.nicknameRow}>
                        <TextInput
                          style={[styles.input, { backgroundColor: colors.surfaceSecondary, color: colors.textPrimary, borderColor: colors.glassLight, flex: 1 }]}
                          value={newPassword}
                          onChangeText={setNewPassword}
                          secureTextEntry
                          autoCapitalize="none"
                          placeholder={String(t('auth.newPassword', 'New password'))}
                          placeholderTextColor={colors.textMuted}
                          testID="settings-set-password-input"
                        />
                        <Pressable
                          style={[styles.saveBtn, { backgroundColor: colors.accent }]}
                          onPress={handleSetPassword}
                          testID="settings-set-password-save"
                        >
                          <Text style={styles.saveBtnText}>{t('common.done', 'Save')}</Text>
                        </Pressable>
                      </View>
                    )}
                  </>
                )}
                <GoogleButton
                  testID="btn-link-google"
                  onPress={handleToggleGoogle}
                  loading={googleLoading}
                  label={hasGoogleIdentity(user)
                    ? t('auth.unlinkGoogle', 'Unlink Google Account')
                    : t('auth.linkGoogle', 'Link Google Account')}
                  style={{ marginTop: Spacing.sm }}
                />
              </>
            )}
            {ratingEligible && (
              <View style={[styles.ratingRow, { borderTopColor: colors.glassLight }]} testID="profile-rating-row">
                <Text style={[styles.sectionTitle, { color: colors.textPrimary, marginBottom: 0 }]}>
                  {t('profile.rating', 'Rating')}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                  <Text style={[styles.ratingValue, { color: colors.accent }]}>
                    {ratingBalance ?? '—'}
                  </Text>
                  {(ratingBalance ?? 0) > 0 && (
                    <Pressable
                      testID="btn-transfer-rating"
                      onPress={() => setTransferOpen(true)}
                      accessibilityRole="button"
                      accessibilityLabel={String(t('profile.transferRating.button', 'Transfer'))}
                      style={({ pressed }) => [{
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: Radius.sm,
                        backgroundColor: colors.accent,
                        opacity: pressed ? 0.75 : 1,
                      }]}
                    >
                      <Text style={{ color: colors.textPrimary, fontSize: 13, fontWeight: '600' }}>
                        {t('profile.transferRating.button', 'Transfer')}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}
          </View>
        )}

        {/* === THEME === */}
        {showPreferences && (
        <View key="theme" style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
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
        )}

        {/* === DECK === */}
        {showPreferences && (
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
        )}

        {/* === LANGUAGE === */}
        {showPreferences && (
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
        )}

        {/* === HAPTICS === */}
        {showPreferences && (
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <View style={styles.toggleRow}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary, marginBottom: 0, flex: 1 }]}>
              {t('settings.haptics', 'Vibration')}
            </Text>
            <BrandSwitch
              value={hapticsEnabled}
              onValueChange={setHapticsEnabled}
              testID="haptics-switch"
            />
          </View>
        </View>
        )}

        {/* === NOTIFICATIONS === */}
        {showPreferences && (
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1, paddingRight: Spacing.sm }}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary, marginBottom: 2 }]}>
                {t('settings.notifications', 'Notifications')}
              </Text>
              <Text style={[styles.sectionDesc, { color: colors.textMuted, marginBottom: 0 }]}>
                {t('settings.notificationsDesc', 'Wake me when it is my turn or the game starts.')}
              </Text>
            </View>
            <BrandSwitch
              value={push.state === 'subscribed'}
              onValueChange={(next) => { void (next ? push.enable() : push.disable()); }}
              disabled={push.state === 'unsupported'}
              testID="notifications-switch"
            />
          </View>
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
        )}

        {/* === ADMIN — visible only when admin_check returns is_admin.
              Gated by showPreferences so it doesn't duplicate when the
              parent splits the body via the `only` prop (e.g. Desktop
              Welcome page renders identity + preferences as two sibling
              SettingsBody instances). */}
        {showPreferences && ratingEligible && <AdminRatingBlock />}

        {/* === INSTALL APP === */}
        {showPreferences && pwaPromptApplies && (
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              {t('pwa.settingsTitle')}
            </Text>
            <Text style={[styles.sectionDesc, { color: colors.textMuted }]}>
              {t('pwa.settingsDesc')}
            </Text>
            <Pressable
              onPress={() => setShowPwaModal(true)}
              style={[styles.saveBtn, { backgroundColor: colors.accent, alignSelf: 'flex-start', paddingHorizontal: Spacing.lg }]}
              testID="settings-pwa-install"
            >
              <Text style={styles.saveBtnText}>{t('pwa.settingsButton')}</Text>
            </Pressable>
          </View>
        )}

        {/* === LOGOUT === */}
        {showLogout && isLoggedIn && (
          <Pressable style={[styles.logoutBtn, { borderColor: colors.error }]} onPress={handleLogout}>
            <Text style={[styles.logoutText, { color: colors.error }]}>{t('auth.signOut')}</Text>
          </Pressable>
        )}
      </Container>

      {showConfirmAlert && (
        <View style={[styles.toast, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.toastText, { color: colors.textPrimary }]}>{alertMessage}</Text>
        </View>
      )}

      <PwaInstallModal visible={showPwaModal} onClose={() => setShowPwaModal(false)} />
      <TransferRatingModal visible={transferOpen} onClose={() => setTransferOpen(false)} />
    </View>
  );
};

const styles = StyleSheet.create({
  section: { borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1 },
  // Single-row toggle: title (+optional description) on the left, BrandSwitch right.
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Rating balance row inside the Profile section.
  ratingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Spacing.md, marginTop: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth,
  },
  ratingValue: { fontSize: 18, fontWeight: '800' },
  sectionTitle: { ...TextStyles.h3, marginBottom: Spacing.sm },
  sectionSubtitle: { fontSize: 13, marginTop: Spacing.md, marginBottom: Spacing.sm },
  sectionDesc: { ...TextStyles.caption, marginBottom: Spacing.md, lineHeight: 20 },
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
  deckPreview: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.lg, marginTop: Spacing.md },
  previewSuit: { fontSize: 28, fontWeight: '700' },
  logoutBtn: { height: 48, borderRadius: Radius.lg, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  logoutText: { fontSize: 15, fontWeight: '600' },
  toast: { position: 'absolute', bottom: 40, left: Spacing.lg, right: Spacing.lg, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center' },
  toastText: { fontSize: 14, fontWeight: '500' },
});
