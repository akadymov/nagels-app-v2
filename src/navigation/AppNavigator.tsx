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
  CreateRoomScreen,
  JoinRoomScreen,
  SettingsScreen,
} from '../screens';
import { Colors, Spacing, TextStyles } from '../constants';
import { onAuthStateChange } from '../lib/supabase/authService';
import { getGuestSession } from '../lib/supabase/auth';
import { tryRejoin } from '../lib/multiplayer/rejoinManager';
import { loadRoom } from '../lib/multiplayer/roomManager';
import { useAuthStore } from '../store/authStore';
import { useMultiplayerStore } from '../store/multiplayerStore';

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
  CreateRoom: { playerCount?: number } | undefined;
  JoinRoom: { code?: string } | undefined;
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
};

const Stack = createStackNavigator<RootStackParamList>();

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
      JoinRoom: {
        path: 'join/:code',
        parse: {
          code: (code: string) => code.toUpperCase(),
        },
      },
      // Email confirmation redirect: /auth/callback?token_hash=...&type=signup
      // Supabase detectSessionInUrl picks up the token automatically on web.
      // We land on Lobby so the user sees they're now confirmed.
      Lobby: 'auth/callback',
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
    // Subscribe to auth state changes (Supabase fires this on mount with current session)
    const unsubscribe = onAuthStateChange(async (user, isGuest) => {
      setUser(user, isGuest);

      // Load player session to get display name
      try {
        const session = await getGuestSession();
        if (session) {
          setDisplayName(session.playerName);
          useMultiplayerStore.getState().setGuestSession(session);
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
  const { isInitialized } = useAuthStore();
  const rejoinAttempted = useRef(false);

  useEffect(() => {
    if (!isInitialized || rejoinAttempted.current) return;
    rejoinAttempted.current = true;

    const attemptRejoin = async () => {
      try {
        const session = await getGuestSession();
        if (!session) return;

        const result = await tryRejoin(session.sessionId);
        if (!result.success || !result.roomId) return;

        // Re-hydrate the multiplayer store with room data
        const room = await loadRoom(result.roomId);
        if (room) {
          useMultiplayerStore.getState().setCurrentRoom(room);
          useMultiplayerStore.getState().setRoomPlayers(room.players);
          useMultiplayerStore.getState().setMyPlayerId(session.sessionId);

          const myPlayer = room.players.find(p => p.playerId === session.sessionId);
          if (myPlayer) {
            useMultiplayerStore.getState().setMyPlayerIndex(myPlayer.playerIndex);
            useMultiplayerStore.getState().setIsHost(room.hostId === session.sessionId);
          }
        }

        // Navigate to appropriate screen
        if (result.screen === 'GameTable') {
          navigation.navigate('GameTable', { isMultiplayer: true });
        } else {
          navigation.navigate('WaitingRoom', { roomCode: result.roomCode });
        }

        console.log('[RejoinGuard] Rejoined room', result.roomCode, '→', result.screen);
      } catch (err) {
        console.warn('[RejoinGuard] Rejoin failed:', err);
      }
    };

    attemptRejoin();
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

export const AppNavigator: React.FC<AppNavigatorProps> = () => {
  const { isLoading } = useAuthStore();

  return (
    <NavigationContainer linking={linking}>
      <AuthProvider>
        {isLoading ? (
          <AuthLoadingScreen />
        ) : (
          <Stack.Navigator
            initialRouteName="Welcome"
            screenOptions={{
              headerShown: false,
              cardStyle: { backgroundColor: Colors.backgroundDark },
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
                  <WelcomeScreen
                    onQuickStart={() => (props.navigation as any).navigate('Primer')}
                    onAlreadyPlay={() => (props.navigation as any).navigate('Lobby')}
                  />
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

            <Stack.Screen name="CreateRoom">
              {(props) => (
                <CreateRoomScreen
                  initialPlayerCount={(props.route?.params as any)?.playerCount}
                  onRoomCreated={(roomCode) => {
                    (props.navigation as any).replace('WaitingRoom', { roomCode });
                  }}
                  onBack={() => (props.navigation as any).goBack()}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="JoinRoom">
              {(props) => (
                <JoinRoomScreen
                  initialCode={(props.route?.params as any)?.code}
                  onRoomJoined={() => (props.navigation as any).replace('WaitingRoom')}
                  onBack={() => (props.navigation as any).goBack()}
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
                />
              )}
            </Stack.Screen>
          </Stack.Navigator>
        )}
      </AuthProvider>
    </NavigationContainer>
  );
};

export default AppNavigator;
