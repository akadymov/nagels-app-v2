/**
 * Nägels Online - Connection Status Component
 *
 * Shows connection status and reconnect button when disconnected
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useMultiplayer } from '../hooks/useMultiplayer';
import { Colors } from '../constants/colors';
import { Spacing } from '../constants/spacing';
import { TextStyles } from '../constants/typography';

export const ConnectionStatus: React.FC = () => {
  const { isConnected, isReconnecting, error, reconnect, syncStatus } = useMultiplayer();

  // Don't show anything if connected
  if (isConnected && !error) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {isReconnecting ? (
          <View style={styles.row}>
            <ActivityIndicator size="small" color={Colors.warning} />
            <Text style={styles.reconnectingText}>Reconnecting...</Text>
          </View>
        ) : (
          <>
            <View style={styles.row}>
              <View style={styles.errorDot} />
              <Text style={styles.disconnectedText}>
                {error || 'Disconnected'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.reconnectButton}
              onPress={reconnect}
              activeOpacity={0.7}
            >
              <Text style={styles.reconnectButtonText}>Reconnect</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: Spacing.md,
    right: Spacing.md,
    zIndex: 1000,
  },
  content: {
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    borderRadius: 12,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.error,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  errorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.error,
  },
  disconnectedText: {
    ...TextStyles.body,
    color: Colors.error,
    fontWeight: '600',
  },
  reconnectingText: {
    ...TextStyles.body,
    color: Colors.warning,
    fontWeight: '600',
  },
  reconnectButton: {
    backgroundColor: Colors.accent,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 8,
  },
  reconnectButtonText: {
    ...TextStyles.body,
    color: Colors.textPrimary,
    fontWeight: '700',
  },
});
