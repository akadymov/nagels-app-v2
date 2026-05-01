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
    // Fix mobile web scroll + viewport height
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const style = document.createElement('style');
      // --app-height is set from JS below (visualViewport-aware).
      // Fall back to 100dvh for browsers without visualViewport, and
      // finally to 100vh for very old browsers.
      style.textContent = `
        :root {
          --app-height: 100dvh;
        }
        @supports not (height: 100dvh) {
          :root { --app-height: 100vh; }
        }
        * { -webkit-overflow-scrolling: touch !important; }
        html, body {
          height: var(--app-height);
          margin: 0;
          touch-action: pan-y !important;
          overscroll-behavior: none;
        }
        body { overflow: hidden !important; }
        #root {
          touch-action: pan-y !important;
          overflow: hidden;
          height: var(--app-height);
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
          max-height: var(--app-height) !important;
        }
        div[style*="overflow"][style*="auto"],
        div[style*="overflow"][style*="scroll"] {
          -webkit-overflow-scrolling: touch !important;
          touch-action: pan-y !important;
        }
      `;
      document.head.appendChild(style);

      // Keep --app-height in sync with the *visible* viewport.
      // visualViewport reflects the area not covered by browser UI on
      // iOS Safari, Chrome address bar, and the on-screen keyboard.
      const setAppHeight = () => {
        const h =
          (typeof window !== 'undefined' && window.visualViewport?.height) ||
          window.innerHeight;
        document.documentElement.style.setProperty('--app-height', `${h}px`);
      };

      setAppHeight();
      window.addEventListener('resize', setAppHeight);
      window.addEventListener('orientationchange', setAppHeight);
      window.visualViewport?.addEventListener('resize', setAppHeight);
      window.visualViewport?.addEventListener('scroll', setAppHeight);
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
