/**
 * Nägels Online - Network Monitor
 *
 * Monitors network connectivity and handles reconnection logic
 */

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { AppState, AppStateStatus } from 'react-native';
import { useMultiplayerStore } from '../../store/multiplayerStore';
import { reconcileState } from './gameStateSync';
import { useGameStore } from '../../store/gameStore';

// ============================================================
// STATE TRACKING
// ============================================================

let isOnline = true;
let isAppActive = true;
let reconnectionAttempts = 0;
let reconnectionTimer: NodeJS.Timeout | null = null;
let lastSyncVersion = 0;
let resubscribeCallback: (() => void) | null = null;
let isHandlingAppStateChange = false; // Prevent stop/start loop during resubscribe

const MAX_RECONNECTION_ATTEMPTS = 5;
const RECONNECTION_DELAY_MS = 2000;
const RECONNECTION_BACKOFF_MULTIPLIER = 1.5;

// ============================================================
// NETWORK MONITORING
// ============================================================

/**
 * Start monitoring network status
 */
export function startNetworkMonitoring(): void {
  console.log('[NetworkMonitor] Starting network monitoring');

  // Monitor network connectivity
  const unsubscribeNetInfo = NetInfo.addEventListener(handleNetworkChange);

  // Monitor app state (foreground/background)
  const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

  // Store cleanup functions
  (global as any).__networkMonitorCleanup = () => {
    unsubscribeNetInfo();
    appStateSubscription.remove();
    stopReconnectionTimer();
  };
}

/**
 * Stop monitoring network status
 */
export function stopNetworkMonitoring(): void {
  // Don't tear down listeners if we're in the middle of handling an app state change
  // (e.g. resubscribeCallback called from handleAppStateChange would trigger this)
  if (isHandlingAppStateChange) {
    console.log('[NetworkMonitor] Skipping stopNetworkMonitoring during app state change');
    return;
  }

  console.log('[NetworkMonitor] Stopping network monitoring');
  const cleanup = (global as any).__networkMonitorCleanup;
  if (cleanup) {
    cleanup();
    delete (global as any).__networkMonitorCleanup;
  }

  // Reset all module-level state to prevent memory leaks
  isOnline = true;
  isAppActive = true;
  reconnectionAttempts = 0;
  lastSyncVersion = 0;
  isHandlingAppStateChange = false;
  stopReconnectionTimer();
}

/**
 * Handle network state changes
 */
function handleNetworkChange(state: NetInfoState): void {
  const wasOnline = isOnline;
  isOnline = state.isConnected ?? false;

  console.log('[NetworkMonitor] Network state changed:', {
    isConnected: isOnline,
    type: state.type,
    wasOnline,
  });

  const store = useMultiplayerStore.getState();

  if (!wasOnline && isOnline) {
    // Went from offline to online - attempt reconnection
    console.log('[NetworkMonitor] Network restored, attempting reconnection...');
    store.setIsReconnecting(true);
    store.setError(null);
    attemptReconnection();
  } else if (wasOnline && !isOnline) {
    // Went from online to offline
    console.log('[NetworkMonitor] Network lost');
    store.setIsConnected(false);
    store.setSyncStatus('disconnected');
    store.setError('Network connection lost');
    stopReconnectionTimer();
  }
}

/**
 * Handle app state changes (foreground/background)
 */
function handleAppStateChange(nextAppState: AppStateStatus): void {
  const wasActive = isAppActive;
  isAppActive = nextAppState === 'active';

  console.log('[NetworkMonitor] App state changed:', {
    state: nextAppState,
    wasActive,
    isActive: isAppActive,
  });

  const store = useMultiplayerStore.getState();

  if (!wasActive && isAppActive && isOnline && store.currentRoom) {
    // App came to foreground - re-establish subscription first, then reconcile state
    console.log('[NetworkMonitor] App resumed, re-subscribing and reconciling state...');
    store.setIsReconnecting(true);
    // Re-subscribe to Supabase channel (it drops when app goes to background).
    // Guard against stop/start loop: subscribeToRoomEvents → unsubscribeFromRoomEvents
    // → stopNetworkMonitoring would remove this very listener. The flag prevents that.
    if (resubscribeCallback) {
      isHandlingAppStateChange = true;
      resubscribeCallback();
      isHandlingAppStateChange = false;
    }
    attemptReconnection();
  }
}

// ============================================================
// RECONNECTION LOGIC
// ============================================================

/**
 * Attempt to reconnect and reconcile state
 */
async function attemptReconnection(): Promise<void> {
  const store = useMultiplayerStore.getState();
  const gameStore = useGameStore.getState();

  if (!store.currentRoom) {
    console.log('[NetworkMonitor] No active room, skipping reconnection');
    store.setIsReconnecting(false);
    return;
  }

  reconnectionAttempts++;
  console.log('[NetworkMonitor] Reconnection attempt', reconnectionAttempts, 'of', MAX_RECONNECTION_ATTEMPTS);

  try {
    // Reconcile state with server
    const result = await reconcileState(store.currentRoom.id, lastSyncVersion);

    if (result.success) {
      console.log('[NetworkMonitor] State reconciled successfully');

      // Update last sync version if server state available
      if (result.newState?.version) {
        lastSyncVersion = result.newState.version;
      }

      // Note: missed events replay not yet implemented.
      // Re-subscribing to the channel (done before this call) will
      // deliver any new events going forward.
      if (result.missedEvents && result.missedEvents.length > 0) {
        console.log('[NetworkMonitor] Missed', result.missedEvents.length, 'events — will catch up via re-subscription');
      }

      // Mark as reconnected
      store.setIsConnected(true);
      store.setIsReconnecting(false);
      store.setSyncStatus('connected');
      store.setError(null);
      reconnectionAttempts = 0;
      stopReconnectionTimer();
    } else {
      throw new Error('Failed to reach server');
    }
  } catch (error) {
    console.error('[NetworkMonitor] Reconnection failed:', error);

    if (reconnectionAttempts >= MAX_RECONNECTION_ATTEMPTS) {
      // Give up after max attempts
      console.error('[NetworkMonitor] Max reconnection attempts reached');
      store.setIsReconnecting(false);
      store.setSyncStatus('disconnected');
      store.setError('Failed to reconnect after multiple attempts');
      reconnectionAttempts = 0;
      stopReconnectionTimer();
    } else {
      // Schedule retry with exponential backoff
      const delay = RECONNECTION_DELAY_MS * Math.pow(RECONNECTION_BACKOFF_MULTIPLIER, reconnectionAttempts - 1);
      console.log('[NetworkMonitor] Retrying in', delay, 'ms');

      reconnectionTimer = setTimeout(() => {
        attemptReconnection();
      }, delay);
    }
  }
}

/**
 * Stop reconnection timer
 */
function stopReconnectionTimer(): void {
  if (reconnectionTimer) {
    clearTimeout(reconnectionTimer);
    reconnectionTimer = null;
  }
}

/**
 * Manually trigger reconnection
 */
export function manualReconnect(): void {
  console.log('[NetworkMonitor] Manual reconnection triggered');
  reconnectionAttempts = 0;
  stopReconnectionTimer();
  attemptReconnection();
}

/**
 * Update last sync version (called after successful state sync)
 */
export function updateLastSyncVersion(version: number): void {
  lastSyncVersion = version;
  console.log('[NetworkMonitor] Last sync version updated to', version);
}

/**
 * Reset reconnection state
 */
export function resetReconnectionState(): void {
  reconnectionAttempts = 0;
  stopReconnectionTimer();
  lastSyncVersion = 0;
}

/**
 * Set a callback to re-establish the Realtime subscription after reconnection.
 * Called by eventHandler to avoid circular imports.
 */
export function setResubscribeCallback(callback: () => void): void {
  resubscribeCallback = callback;
}

/**
 * Clear the resubscribe callback
 */
export function clearResubscribeCallback(): void {
  resubscribeCallback = null;
}
