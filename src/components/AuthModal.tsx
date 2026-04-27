/**
 * Nägels Online - Auth Modal
 *
 * Glass-style modal with Sign In / Create Account tabs.
 * Also offers "Continue as Guest" to dismiss without auth.
 *
 * - For anonymous users: shows both tabs + guest option
 * - For registered users: shows only Sign Out + account info
 */

import React, { useState, useCallback } from 'react';
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
import { useTranslation } from 'react-i18next';
import { GlassButton } from './buttons';
import { Colors, Spacing, Radius, TextStyles } from '../constants';
import {
  signInWithEmail,
  signUpWithEmail,
  linkEmailToAnonymous,
  signOut,
} from '../lib/supabase/authService';
import { getGuestSession } from '../lib/supabase/auth';
import { useAuthStore } from '../store/authStore';

// ============================================================
// TYPES
// ============================================================

type AuthTab = 'signIn' | 'signUp';

export interface AuthModalProps {
  visible: boolean;
  onClose: () => void;
}

// ============================================================
// COMPONENT
// ============================================================

export const AuthModal: React.FC<AuthModalProps> = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const { user, isGuest, displayName, setUser, setDisplayName } = useAuthStore();

  const [tab, setTab] = useState<AuthTab>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setEmail('');
    setPassword('');
    setName('');
    setError(null);
    setSuccessMsg(null);
    setIsLoading(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  // ---- Sign In ----
  const handleSignIn = useCallback(async () => {
    if (!email.trim() || !password) {
      setError(t('auth.invalidEmail'));
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const authUser = await signInWithEmail(email.trim(), password);
      const playerName = (authUser.user_metadata?.display_name as string) || email.split('@')[0];
      setUser(authUser, false);
      setDisplayName(playerName);
      // Refresh guest session (anonymous → registered upgrade)
      await getGuestSession();
      setSuccessMsg(t('auth.signedIn', { name: playerName }));
      setTimeout(handleClose, 1000);
    } catch (err: any) {
      const key = err.message as string;
      setError(t(key, { defaultValue: t('auth.unknownError') }));
    } finally {
      setIsLoading(false);
    }
  }, [email, password, t, setUser, setDisplayName, handleClose]);

  // ---- Sign Up ----
  const handleSignUp = useCallback(async () => {
    const trimmedName = name.trim() || email.split('@')[0];
    if (!email.trim() || !password) {
      setError(t('auth.invalidEmail'));
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      let authUser;
      if (isGuest && user) {
        // Upgrade anonymous → registered (same UUID, preserves game history)
        authUser = await linkEmailToAnonymous(email.trim(), password);
      } else {
        authUser = await signUpWithEmail(email.trim(), password, trimmedName);
      }
      const playerName = trimmedName;
      setUser(authUser, false);
      setDisplayName(playerName);
      await getGuestSession();
      setSuccessMsg(t('auth.accountCreated'));
      setTimeout(handleClose, 1200);
    } catch (err: any) {
      const key = err.message as string;
      setError(t(key, { defaultValue: t('auth.unknownError') }));
    } finally {
      setIsLoading(false);
    }
  }, [email, password, name, isGuest, user, t, setUser, setDisplayName, handleClose]);

  // ---- Sign Out ----
  const handleSignOut = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signOut();
      // Create fresh anonymous session
      const session = await getGuestSession();
      if (session) {
        setDisplayName(session.playerName);
      }
      setUser(null, true);
      setSuccessMsg(t('auth.signedOut'));
      setTimeout(handleClose, 800);
    } catch {
      setError(t('auth.unknownError'));
    } finally {
      setIsLoading(false);
    }
  }, [t, setUser, setDisplayName, handleClose]);

  // ============================================================
  // RENDER — Signed-in view
  // ============================================================

  if (!isGuest && user) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
        <Pressable style={styles.overlay} onPress={handleClose}>
          <Pressable onPress={() => {}} style={styles.sheet}>
            <Text style={styles.title}>{displayName}</Text>
            <Text style={styles.subtitle}>{user.email}</Text>

            {successMsg && <Text style={styles.success}>{successMsg}</Text>}
            {error && <Text style={styles.errorText}>{error}</Text>}

            {isLoading ? (
              <ActivityIndicator color={Colors.accent} style={{ marginVertical: Spacing.md }} />
            ) : (
              <GlassButton
                title={t('auth.signOut')}
                onPress={handleSignOut}
                variant="secondary"
                size="large"
                accentColor={Colors.error}
                style={styles.fullWidth}
              />
            )}

            <Pressable onPress={handleClose} style={styles.guestLink}>
              <Text style={styles.guestLinkText}>{t('common.close')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  // ============================================================
  // RENDER — Guest / anonymous view (sign in + sign up tabs)
  // ============================================================

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        <View style={styles.sheet}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: Spacing.sm }}
          >
            {/* Tab switcher */}
            <View style={styles.tabs}>
              <Pressable
                style={[styles.tab, tab === 'signIn' && styles.tabActive]}
                onPress={() => { setTab('signIn'); setError(null); setSuccessMsg(null); }}
              >
                <Text style={[styles.tabText, tab === 'signIn' && styles.tabTextActive]}>
                  {t('auth.signIn')}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.tab, tab === 'signUp' && styles.tabActive]}
                onPress={() => { setTab('signUp'); setError(null); setSuccessMsg(null); }}
              >
                <Text style={[styles.tabText, tab === 'signUp' && styles.tabTextActive]}>
                  {t('auth.signUp')}
                </Text>
              </Pressable>
            </View>

            {/* Display name (sign up only) */}
            {tab === 'signUp' && (
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder={t('auth.displayName')}
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
              />
            )}

            {/* Email */}
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder={t('auth.email')}
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
              returnKeyType="next"
            />

            {/* Password */}
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder={t('auth.password')}
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={tab === 'signIn' ? handleSignIn : handleSignUp}
            />

            {/* Feedback */}
            {error && <Text style={styles.errorText}>{error}</Text>}
            {successMsg && <Text style={styles.success}>{successMsg}</Text>}

            {/* Submit */}
            {isLoading ? (
              <ActivityIndicator color={Colors.accent} style={{ marginVertical: Spacing.md }} />
            ) : (
              <GlassButton
                title={tab === 'signIn' ? t('auth.signIn') : t('auth.signUp')}
                onPress={tab === 'signIn' ? handleSignIn : handleSignUp}
                variant="primary"
                size="large"
                accentColor={Colors.accent}
                style={styles.fullWidth}
              />
            )}

            {/* Switch tab hint */}
            <Pressable
              style={styles.switchRow}
              onPress={() => { setTab(tab === 'signIn' ? 'signUp' : 'signIn'); setError(null); }}
            >
              <Text style={styles.switchText}>
                {tab === 'signIn' ? t('auth.noAccount') : t('auth.alreadyHaveAccount')}{' '}
                <Text style={styles.switchLink}>
                  {tab === 'signIn' ? t('auth.signUp') : t('auth.signIn')}
                </Text>
              </Text>
            </Pressable>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{t('lobby.or')}</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Continue as guest */}
            <Pressable onPress={handleClose} style={styles.guestLink}>
              <Text style={styles.guestLinkText}>{t('auth.continueAsGuest')}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
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
    maxWidth: 380,
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
  tabs: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    marginBottom: Spacing.lg,
    padding: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  tabText: {
    ...TextStyles.body,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  tabTextActive: {
    color: Colors.accent,
    fontWeight: '700' as const,
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
  errorText: {
    ...TextStyles.caption,
    color: Colors.error,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  success: {
    ...TextStyles.caption,
    color: Colors.success,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  fullWidth: {
    width: '100%',
    marginTop: Spacing.xs,
  },
  switchRow: {
    marginTop: Spacing.md,
    alignItems: 'center',
  },
  switchText: {
    ...TextStyles.caption,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  switchLink: {
    color: Colors.accent,
    fontWeight: '600' as const,
    textDecorationLine: 'underline',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.glassLight,
  },
  dividerText: {
    ...TextStyles.caption,
    color: Colors.textMuted,
    marginHorizontal: Spacing.md,
  },
  guestLink: {
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  guestLinkText: {
    ...TextStyles.caption,
    color: Colors.accent,
    textDecorationLine: 'underline',
  },
});

export default AuthModal;
