/**
 * Nägels Online - Main App Component
 */

import React, { useEffect } from 'react';
import { StatusBar, StatusBarStyle, StyleSheet, Platform } from 'react-native';
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
    // Fix mobile web scroll
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const style = document.createElement('style');
      style.textContent = `
        * { -webkit-overflow-scrolling: touch !important; }
        html, body { height: 100%; margin: 0; touch-action: pan-y !important; }
        body { overflow: hidden !important; }
        #root {
          touch-action: pan-y !important;
          overflow: hidden;
          height: 100vh;
          display: flex;
          flex-direction: column;
        }
        #root > div,
        #root > div > div,
        #root > div > div > div,
        #root > div > div > div > div {
          display: flex !important;
          flex-direction: column !important;
          flex: 1 !important;
          min-height: 0 !important;
          max-height: 100vh !important;
        }
        div[style*="overflow"][style*="auto"],
        div[style*="overflow"][style*="scroll"] {
          -webkit-overflow-scrolling: touch !important;
          touch-action: pan-y !important;
        }
      `;
      document.head.appendChild(style);
    }
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
