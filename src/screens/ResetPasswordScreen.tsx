/**
 * Nägels Online - Reset Password Screen
 * User lands here after clicking reset link in email.
 * Supabase puts access_token in URL hash — client auto-restores session.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing, Radius } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase/client';
import { GameLogo } from '../components/GameLogo';

export interface ResetPasswordScreenProps {
  onComplete: () => void;
}

export const ResetPasswordScreen: React.FC<ResetPasswordScreenProps> = ({ onComplete }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleReset = async () => {
    setError('');
    if (password.length < 6) {
      setError(String(t('auth.weakPassword', 'Password must be at least 6 characters')));
      return;
    }
    if (password !== confirmPassword) {
      setError(String(t('auth.passwordMismatch', 'Passwords do not match')));
      return;
    }

    setIsLoading(true);
    try {
      if (!isSupabaseConfigured()) throw new Error('Not configured');
      const supabase = getSupabaseClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setSuccess(true);
      setTimeout(onComplete, 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
        <View style={styles.content}>
          <Text style={styles.successEmoji}>✅</Text>
          <Text style={[styles.successTitle, { color: colors.accent }]}>
            {t('auth.passwordChanged', 'Password changed!')}
          </Text>
          <Text style={[styles.successSub, { color: colors.textSecondary }]}>
            {t('auth.redirecting', 'Redirecting to lobby...')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <GameLogo size="sm" />

        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t('auth.setNewPassword', 'Set New Password')}
        </Text>

        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.textPrimary, borderColor: colors.glassLight }]}
          value={password}
          onChangeText={setPassword}
          placeholder={t('auth.newPassword', 'New password')}
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          returnKeyType="next"
        />

        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.textPrimary, borderColor: colors.glassLight }]}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder={t('auth.confirmNewPassword', 'Confirm new password')}
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          returnKeyType="go"
          onSubmitEditing={handleReset}
        />

        {error ? (
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        ) : null}

        <Pressable
          style={[styles.button, { backgroundColor: colors.accent }]}
          onPress={handleReset}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {t('auth.savePassword', 'Save Password')}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  input: {
    width: '100%',
    maxWidth: 340,
    height: 52,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.md,
    fontSize: 15,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  button: {
    width: '100%',
    maxWidth: 340,
    height: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  successEmoji: {
    fontSize: 64,
    marginBottom: Spacing.md,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
  },
  successSub: {
    fontSize: 14,
    marginTop: Spacing.sm,
  },
});

export default ResetPasswordScreen;
