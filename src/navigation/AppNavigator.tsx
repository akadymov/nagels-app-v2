/**
 * Nägels Online - Navigation
 * Stack navigator for main app flow
 */

import React, { useEffect, useRef } from 'react';
import { Platform, View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import {
  WelcomeScreen,
  PrimerScreen,
  LobbyScreen,
  GameTableScreen,
  WaitingRoomScreen,
  SettingsScreen,
  AuthScreen,
  ProfileScreen,
  EmailConfirmedScreen,
} from '../screens';
import { ResetPasswordScreen } from '../screens/ResetPasswordScreen';
import { Colors, Spacing, TextStyles } from '../constants';
import { onAuthStateChange } from '../lib/supabase/authService';
import { getGuestSession } from '../lib/supabase/auth';
import { useAuthStore } from '../store/authStore';

export type RootStackParamList = {
  Welcome: {
    onQuickStart?: () => void;
    onAlreadyPlay?: () => void;
  };
  Primer: {
    onComplete?: () => void;
    onSkip?: () => void;
  };
  Lobby: undefined;
  WaitingRoom: {
    roomCode?: string;
  };
  GameTable: {
    isMultiplayer?: boolean;
    botDifficulty?: 'easy' | 'medium' | 'hard';
    botCount?: number;
    playerName?: string;
    onExit?: () => void;
  };
  Settings: undefined;
  Auth: undefined;
  Profile: undefined;
  EmailConfirmed: undefined;
  ResetPassword: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

// Capture URL hash AND pathname at module load — before Supabase client and
// React Navigation's linking system consume them. RN's linking rewrites the
// pathname to the matched screen (e.g. /join/ABC → /Welcome) when no screen
// is registered for the path, so live `window.location.pathname` is unreliable.
const _initialHash = (Platform.OS === 'web' && typeof window !== 'undefined')
  ? window.location.hash
  : '';
const _initialPath = (Platform.OS === 'web' && typeof window !== 'undefined')
  ? window.location.pathname
  : '';
const _cameFromEmailConfirmation = _initialHash.includes('access_token') && !_initialHash.includes('error') && !_initialHash.includes('type=recovery');
const _cameFromPasswordReset = _initialHash.includes('access_token') && _initialHash.includes('type=recovery');
const _initialJoinMatch = _initialPath.match(/^\/join\/([A-Z0-9]{4,8})/i);
const _initialJoinCode = _initialJoinMatch ? _initialJoinMatch[1].toUpperCase() : null;

/**
 * Deep link configuration.
 * nagels://join/ABCDEF  → JoinRoom screen with code pre-filled
 * On web: /join/ABCDEF  → same
 */
const linking = {
  prefixes: [
    'nagels://',
    'exp://localhost:8081/--/',
    'exp://127.0.0.1:8081/--/',
    ...(Platform.OS === 'web' && typeof window !== 'undefined'
      ? [window.location.origin + '/']
      : []),
  ],
  config: {
    screens: {
      EmailConfirmed: 'auth/callback',
      ResetPassword: 'reset-password',
    },
  },
};

// ============================================================
// AUTH PROVIDER — initialises auth + attempts rejoin
// ============================================================

/**
 * AuthProvider wraps the navigator and handles:
 *   1. Subscribing to Supabase auth state changes
 *   2. Initialising the authStore on first mount
 *   3. Attempting to rejoin an active room after auth is ready
 */
const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { setUser, setDisplayName, setIsLoading, setIsInitialized, isInitialized } = useAuthStore();
  const rejoinAttempted = useRef(false);

  useEffect(() => {
    // Ensure a session exists (creates anonymous if needed)
    getGuestSession().catch(() => {});

    // Subscribe to auth state changes (Supabase fires this on mount with current session)
    const unsubscribe = onAuthStateChange(async (user, isGuest, event) => {
      setUser(user, isGuest);

      // PASSWORD_RECOVERY event — navigate to reset password screen
      if (event === 'PASSWORD_RECOVERY') {
        (global as any).__passwordRecovery = true;
      }

      // Sync settings from user profile (theme, deck, language)
      if (user?.user_metadata) {
        const { useSettingsStore } = require('../store/settingsStore');
        useSettingsStore.getState().syncFromUserMetadata(user.user_metadata);
        const lang = user.user_metadata.language;
        if (lang) {
          const i18n = require('../i18n/config').default;
          i18n.changeLanguage(lang);
        }
      }

      // Load player session — only use guest name if no auth display name
      try {
        const session = await getGuestSession();
        if (session) {
          const authName = user?.user_metadata?.display_name;
          if (!authName) {
            setDisplayName(session.playerName);
          }
        }
      } catch {
        // Non-fatal
      }

      setIsLoading(false);
      setIsInitialized(true);
    });

    return unsubscribe;
  }, []);

  return <>{children}</>;
};

// ============================================================
// REJOIN GUARD — runs once after auth initialised
// ============================================================

/**
 * Inner component that has access to the navigation context.
 * Attempts to rejoin an active room after the auth state is ready.
 */
const RejoinGuard: React.FC = () => {
  const navigation = useNavigation<any>();
  const { isInitialized, user } = useAuthStore();
  const rejoinAttempted = useRef(false);

  // Detect email confirmation (password reset handled by NavigatorGuard)
  const confirmChecked = useRef(false);
  useEffect(() => {
    if (!isInitialized || confirmChecked.current) return;
    confirmChecked.current = true;

    if (_cameFromEmailConfirmation) {
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', window.location.pathname);
      }
      const { useSettingsStore } = require('../store/settingsStore');
      useSettingsStore.getState().resetGamesPlayed();
      navigation.navigate('EmailConfirmed');
      return;
    }

    // Method 2: User has email_confirmed_at that is very recent (< 60 seconds)
    if (user && user.email_confirmed_at) {
      const confirmedAt = new Date(user.email_confirmed_at).getTime();
      const now = Date.now();
      const isRecent = (now - confirmedAt) < 60000; // within 1 minute
      if (isRecent) {
        const { useSettingsStore } = require('../store/settingsStore');
        useSettingsStore.getState().resetGamesPlayed();
        navigation.navigate('EmailConfirmed');
        return;
      }
    }

    // Method 3: pendingEmail matches confirmed user (same browser)
    if (user && user.email_confirmed_at) {
      const { useSettingsStore } = require('../store/settingsStore');
      const pendingEmail = useSettingsStore.getState().pendingEmail;
      if (pendingEmail && user.email === pendingEmail) {
        useSettingsStore.getState().resetGamesPlayed();
        navigation.navigate('EmailConfirmed');
      }
    }
  }, [isInitialized, user, navigation]);

  useEffect(() => {
    if (!isInitialized || rejoinAttempted.current) return;
    rejoinAttempted.current = true;
    // Rejoin path is being rebuilt on top of the new server-authoritative
    // pipeline (see plan §M8). For now, just no-op.
  }, [isInitialized]);

  return null;
};

// ============================================================
// LOADING SCREEN — shown while auth initialises
// ============================================================

const AuthLoadingScreen: React.FC = () => (
  <View style={loadingStyles.container}>
    <ActivityIndicator color={Colors.accent} size="large" />
  </View>
);

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

// ============================================================
// MAIN NAVIGATOR
// ============================================================

export interface AppNavigatorProps {
  onWelcomeComplete?: () => void;
  onPrimerComplete?: () => void;
}

/**
 * Navigator-level guard: runs on every screen, handles password reset
 * and rejoin logic after auth initializes.
 */
const NavigatorGuard: React.FC = () => {
  const navigation = useNavigation<any>();
  const { isInitialized, isLoading, user } = useAuthStore();
  const guardRan = useRef(false);

  useEffect(() => {
    if (isLoading || !isInitialized || guardRan.current) return;
    guardRan.current = true;

    // Password reset detection (URL hash or auth event)
    if (_cameFromPasswordReset || (global as any).__passwordRecovery) {
      (global as any).__passwordRecovery = false;
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', window.location.pathname);
      }
      console.log('[NavigatorGuard] Password reset detected → ResetPassword');
      navigation.navigate('ResetPassword');
      return;
    }

    // Also check URL path directly (deep link fallback)
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.pathname === '/reset-password') {
      console.log('[NavigatorGuard] URL path /reset-password → ResetPassword');
      navigation.navigate('ResetPassword');
      return;
    }

    // Invite-link deep link: /join/ABCDEF — extract the code, auto-join.
    // We use _initialJoinCode (captured at module load) because React Navigation's
    // linking system rewrites window.location.pathname before this guard runs.
    if (Platform.OS === 'web' && typeof window !== 'undefined' && _initialJoinCode) {
      const code = _initialJoinCode;
      console.log('[NavigatorGuard] /join/ deeplink matched, code=', code);
      // Strip the path so refresh doesn't loop.
      window.history.replaceState(null, '', '/');
      (async () => {
        // Wait up to 3 s for an auth session — anonymous sign-in may still
        // be in flight when the URL path is parsed.
        const { getSupabaseClient } = await import('../lib/supabase/client');
        const supabase = getSupabaseClient();
        let session = null as any;
        for (let i = 0; i < 30 && !session; i++) {
          const { data } = await supabase.auth.getSession();
          session = data.session;
          if (!session) await new Promise((r) => setTimeout(r, 100));
        }
        if (!session) {
          (window as any).alert(`Couldn't sign in to join ${code}. Try refresh.`);
          return;
        }
        try {
          const { gameClient } = await import('../lib/gameClient');
          const { setActiveRoom } = await import('../lib/activeRoom');
          const { subscribeRoom } = await import('../lib/realtimeBroadcast');
          const displayName = useAuthStore.getState().displayName || 'Guest';
          const result = await gameClient.joinRoom(displayName, code);
          console.log('[NavigatorGuard] auto-join result', result);
          if (result.ok && result.state.room?.id) {
            await setActiveRoom(result.state.room.id);
            subscribeRoom(result.state.room.id);
            navigation.navigate('WaitingRoom');
          } else {
            (window as any).alert(`Couldn't join ${code}: ${(result as any).error ?? 'unknown error'}`);
          }
        } catch (err) {
          console.error('[NavigatorGuard] auto-join failed:', err);
          (window as any).alert(`Auto-join failed: ${(err as Error)?.message ?? err}`);
        }
      })();
    }
  }, [isLoading, isInitialized, navigation]);

  return null;
};

export const AppNavigator: React.FC<AppNavigatorProps> = () => {
  const { isLoading, isInitialized } = useAuthStore();

  return (
    <NavigationContainer linking={linking}>
      <AuthProvider>
        <Stack.Navigator
          initialRouteName="Welcome"
          screenOptions={{
            headerShown: false,
            // flex:1 here is *load-bearing on web*. Without it the
            // Stack card renders with flex: 0 0 auto, so the card grows
            // to the height of its content (e.g. all Settings sections
            // stacked, ~1180 px) instead of clamping to the viewport
            // (~932 px). The ScrollView inside SettingsScreen then sees
            // a 1136 px tall parent slot, fits its content with no
            // overflow, and `overflow:auto` never engages — vertical
            // scroll dies on Settings/Profile across mobile browsers.
            cardStyle: { backgroundColor: Colors.backgroundDark, flex: 1 },
            transitionSpec: {
              open: { animation: 'timing', config: { duration: 300 } },
              close: { animation: 'timing', config: { duration: 300 } },
            },
          }}
        >
          <Stack.Screen name="Welcome">
            {(props) => (
              <>
                <RejoinGuard />
                <NavigatorGuard />
                {isLoading ? (
                  <AuthLoadingScreen />
                ) : (
                  <WelcomeScreen
                    onQuickStart={() => (props.navigation as any).navigate('Primer')}
                    onAlreadyPlay={() => (props.navigation as any).navigate('Lobby')}
                    onSignIn={() => (props.navigation as any).navigate('Auth')}
                  />
                )}
              </>
            )}
          </Stack.Screen>

            <Stack.Screen name="Primer">
              {(props) => (
                <PrimerScreen
                  onComplete={() => props.navigation.navigate('Lobby' as never)}
                  onSkip={() => props.navigation.navigate('Lobby' as never)}
                  navigation={props.navigation as any}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="Lobby">
              {(props) => (
                <LobbyScreen
                  onQuickMatch={(difficulty, botCount, playerName) => {
                    (props.navigation as any).navigate('GameTable', {
                      isMultiplayer: false,
                      botDifficulty: difficulty,
                      botCount,
                      playerName,
                    });
                  }}
                  onRoomCreated={() => (props.navigation as any).navigate('WaitingRoom')}
                  onRoomJoined={() => (props.navigation as any).navigate('WaitingRoom')}
                  onSettings={() => (props.navigation as any).navigate('Settings')}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="WaitingRoom">
              {(props) => (
                <WaitingRoomScreen
                  onGameStart={() => {
                    (props.navigation as any).navigate('GameTable', { isMultiplayer: true });
                  }}
                  onLeave={() => (props.navigation as any).goBack()}
                  onSettings={() => (props.navigation as any).navigate('Settings')}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="GameTable">
              {(props) => (
                <GameTableScreen
                  isMultiplayer={props.route?.params?.isMultiplayer || false}
                  botDifficulty={props.route?.params?.botDifficulty}
                  botCount={props.route?.params?.botCount}
                  playerName={props.route?.params?.playerName}
                  onExit={() => (props.navigation as any).goBack()}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="Settings">
              {(props) => (
                <SettingsScreen
                  onBack={() => (props.navigation as any).goBack()}
                  onProfile={() => (props.navigation as any).navigate('Profile')}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="Auth">
              {(props) => (
                <AuthScreen
                  onBack={() => (props.navigation as any).goBack()}
                  onSuccess={() => (props.navigation as any).navigate('Lobby')}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="Profile">
              {(props) => (
                <ProfileScreen
                  onBack={() => (props.navigation as any).goBack()}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="ResetPassword">
              {(props) => (
                <ResetPasswordScreen
                  onComplete={() => (props.navigation as any).navigate('Lobby')}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="EmailConfirmed">
              {(props) => (
                <EmailConfirmedScreen
                  onContinue={() => (props.navigation as any).navigate('Lobby')}
                />
              )}
            </Stack.Screen>
          </Stack.Navigator>
      </AuthProvider>
    </NavigationContainer>
  );
};

export default AppNavigator;
