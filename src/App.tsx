/**
 * Nägels Online - Main App Component
 */

import React, { useEffect } from 'react';
import { StatusBar, StatusBarStyle, StyleSheet } from 'react-native';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppNavigator } from './navigation';
import i18n from './i18n/config';
import { useTheme } from './hooks/useTheme';
import { useSettingsStore } from './store/settingsStore';

function AppContent() {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar
        barStyle={colors.statusBarStyle as StatusBarStyle}
        backgroundColor={colors.statusBarBg}
      />
      <AppNavigator />
    </SafeAreaView>
  );
}

export default function App() {
  const hydrate = useSettingsStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <SafeAreaProvider>
      <I18nextProvider i18n={i18n}>
        <AppContent />
      </I18nextProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
});
