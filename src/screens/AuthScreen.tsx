/**
 * Nägels Online - Auth Screen
 * Full-screen Sign In / Create Account with Forgot Password.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing, Radius } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { signInWithEmail, signUpWithEmail, linkEmailToAnonymous, resetPasswordForEmail } from '../lib/supabase/authService';
import { GameLogo } from '../components/GameLogo';

type AuthTab = 'signIn' | 'signUp';
type AuthMode = 'form' | 'forgotPassword' | 'resetSent';

export interface AuthScreenProps {
  onBack: () => void;
  onSuccess: () => void;
}

// Random avatar colors
const AVATAR_COLORS = ['#3380CC', '#CC4D80', '#66B366', '#9966CC', '#CC9933', '#33AAAA', '#CC6633', '#6666CC'];
const randomColor = () => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

export const AuthScreen: React.FC<AuthScreenProps> = ({ onBack, onSuccess }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { isGuest, user } = useAuthStore();

  const [tab, setTab] = useState<AuthTab>('signIn');
  const [mode, setMode] = useState<AuthMode>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSignIn = async () => {
    setErrorMsg('');
    if (!email.trim()) { setErrorMsg(String(t('auth.invalidEmail'))); return; }
    if (!password.trim()) { setErrorMsg(String(t('auth.weakPassword'))); return; }
    setIsLoading(true);
    try {
      const signedInUser = await signInWithEmail(email.trim(), password);
      // Sync display name from user metadata
      const metaName = signedInUser.user_metadata?.display_name;
      if (metaName) {
        useAuthStore.getState().setDisplayName(metaName);
      }
      // Clear pending email if confirmed
      if (signedInUser.email_confirmed_at) {
        useSettingsStore.getState().setPendingEmail(null);
        useSettingsStore.getState().resetGamesPlayed();
      }
      onSuccess();
    } catch (err: any) {
      setErrorMsg(String(t(err.message, err.message)));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async () => {
    setErrorMsg('');
    if (!nickname.trim()) { setErrorMsg(String(t('auth.nicknameRequired', 'Please enter a nickname'))); return; }
    if (!email.trim()) { setErrorMsg(String(t('auth.invalidEmail'))); return; }
    if (password.length < 6) { setErrorMsg(String(t('auth.weakPassword'))); return; }
    setIsLoading(true);
    try {
      // If user has an anonymous session — upgrade it (preserves UUID + game history)
      // Otherwise create fresh account
      if (isGuest && user) {
        await linkEmailToAnonymous(email.trim(), password, nickname.trim());
      } else {
        await signUpWithEmail(email.trim(), password, nickname.trim());
      }
      // Save nickname and pending email for confirmation tracking
      useAuthStore.getState().setDisplayName(nickname.trim());
      useSettingsStore.getState().setPendingEmail(email.trim());
      onSuccess();
    } catch (err: any) {
      setErrorMsg(String(t(err.message, err.message)));
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) return;
    setIsLoading(true);
    try {
      await resetPasswordForEmail(email.trim());
      setMode('resetSent');
    } catch (err: any) {
      Alert.alert(String(t('common.error')), String(t(err.message, err.message)));
    } finally {
      setIsLoading(false);
    }
  };

  const renderForgotPassword = () => (
    <View style={styles.formSection}>
      {mode === 'resetSent' ? (
        <>
          <Text style={[styles.successText, { color: colors.success }]}>
            ✓ {t('auth.resetSent', 'Reset link sent! Check your email.')}
          </Text>
          <Pressable onPress={() => { setMode('form'); setTab('signIn'); }}>
            <Text style={[styles.linkText, { color: colors.accent }]}>
              {t('auth.backToSignIn', '← Back to Sign In')}
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>
            {t('auth.forgotPassword', 'Forgot Password?')}
          </Text>
          <Text style={[styles.helpText, { color: colors.textMuted }]}>
            {t('auth.forgotDesc', 'Enter your email and we\'ll send a reset link.')}
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, color: colors.textPrimary, borderColor: colors.glassLight }]}
            value={email}
            onChangeText={setEmail}
            placeholder={t('auth.email')}
            placeholderTextColor={colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: email.trim() ? 1 : 0.5 }]}
            onPress={handleForgotPassword}
            disabled={!email.trim() || isLoading}
          >
            {isLoading ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.primaryBtnText}>{t('auth.sendResetLink', 'Send Reset Link')}</Text>
            )}
          </Pressable>
          <Pressable onPress={() => setMode('form')}>
            <Text style={[styles.linkText, { color: colors.accent }]}>
              {t('auth.backToSignIn', '← Back to Sign In')}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );

  const renderForm = () => (
    <View style={styles.formSection}>
      {/* Tabs */}
      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tab, { backgroundColor: tab === 'signIn' ? colors.accent : colors.surface, borderColor: colors.accent }]}
          onPress={() => setTab('signIn')}
        >
          <Text style={[styles.tabText, { color: tab === 'signIn' ? '#fff' : colors.accent }]}>
            {t('auth.signIn')}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, { backgroundColor: tab === 'signUp' ? colors.accent : colors.surface, borderColor: colors.accent }]}
          onPress={() => setTab('signUp')}
        >
          <Text style={[styles.tabText, { color: tab === 'signUp' ? '#fff' : colors.accent }]}>
            {t('auth.signUp')}
          </Text>
        </Pressable>
      </View>

      {/* Nickname (sign up only) */}
      {tab === 'signUp' && (
        <>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, color: colors.textPrimary, borderColor: colors.glassLight }]}
            value={nickname}
            onChangeText={setNickname}
            placeholder={t('auth.displayName')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
            maxLength={20}
          />
        </>
      )}

      {/* Email */}
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface, color: colors.textPrimary, borderColor: colors.glassLight }]}
        value={email}
        onChangeText={setEmail}
        placeholder={t('auth.email')}
        placeholderTextColor={colors.textMuted}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      {/* Password */}
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface, color: colors.textPrimary, borderColor: colors.glassLight }]}
        value={password}
        onChangeText={setPassword}
        placeholder={t('auth.password')}
        placeholderTextColor={colors.textMuted}
        secureTextEntry
      />

      {/* Forgot Password (sign in only) */}
      {tab === 'signIn' && (
        <Pressable onPress={() => setMode('forgotPassword')}>
          <Text style={[styles.forgotLink, { color: colors.accent }]}>
            {t('auth.forgotPassword', 'Forgot Password?')}
          </Text>
        </Pressable>
      )}

      {/* Error message */}
      {errorMsg ? (
        <Text style={[styles.errorText, { color: colors.error }]}>{errorMsg}</Text>
      ) : null}

      {/* Submit */}
      <Pressable
        style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
        onPress={tab === 'signIn' ? handleSignIn : handleSignUp}
        disabled={isLoading}
      >
        {isLoading ? <ActivityIndicator color="#fff" /> : (
          <Text style={styles.primaryBtnText}>
            {tab === 'signIn' ? t('auth.signIn') : t('auth.signUp')}
          </Text>
        )}
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Back button */}
          <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
            <Text style={[styles.backText, { color: colors.accent }]}>←</Text>
          </Pressable>

          {/* Logo */}
          <View style={styles.logoWrap}>
            <GameLogo size="sm" />
          </View>

          {/* Form */}
          {mode === 'form' ? renderForm() : renderForgotPassword()}

          {/* Continue as Guest */}
          <Pressable onPress={onBack} style={styles.guestLink}>
            <Text style={[styles.guestText, { color: colors.textMuted }]}>
              {t('auth.continueAsGuest')}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  backBtn: {
    alignSelf: 'flex-start',
    marginBottom: Spacing.md,
  },
  backText: {
    fontSize: 22,
    fontWeight: '700',
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  formSection: {
    gap: Spacing.md,
  },
  tabRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  tab: {
    flex: 1,
    height: 48,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
  },
  avatarPreview: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  avatarInitial: {
    fontSize: 28,
    fontWeight: '700',
    color: '#ffffff',
  },
  input: {
    height: 52,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.md,
    fontSize: 15,
  },
  forgotLink: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'right',
  },
  primaryBtn: {
    height: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xs,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  sectionLabel: {
    fontSize: 18,
    fontWeight: '700',
  },
  helpText: {
    fontSize: 14,
    lineHeight: 20,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  successText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginVertical: Spacing.lg,
  },
  guestLink: {
    alignItems: 'center',
    marginTop: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  guestText: {
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});

export default AuthScreen;
