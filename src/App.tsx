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
        /* Pin html+body to the visual viewport so the document can never
           scroll the app behind the browser chrome. iOS Safari ignores
           plain "overflow: hidden" once a Modal mounts and unmounts —
           position:fixed plus inset:0 keeps the root anchored regardless. */
        html, body {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          width: 100%;
          height: var(--app-height);
          margin: 0;
          overflow: hidden !important;
          overscroll-behavior: none;
          touch-action: pan-y !important;
        }
        #root {
          touch-action: pan-y !important;
          overflow: hidden;
          height: var(--app-height);
          display: flex;
          flex-direction: column;
        }
        /* Force the first 4 levels of wrapper divs (RN-web,
           SafeAreaProvider, navigation stack, screen wrapper) to be a
           flex column that doesn't introduce its own min-height. We
           deliberately do NOT clamp max-height here — body already
           pins the viewport via position:fixed + var(--app-height),
           and a max-height clamp on every nested div was suffocating
           ScrollView's internal overflow:auto wrapper, breaking
           vertical scroll on Settings/Profile across browsers. */
        #root > div,
        #root > div > div,
        #root > div > div > div,
        #root > div > div > div > div {
          display: flex !important;
          flex-direction: column !important;
          flex: 1 !important;
          min-height: 0 !important;
        }
        div[style*="overflow"][style*="auto"],
        div[style*="overflow"][style*="scroll"] {
          -webkit-overflow-scrolling: touch !important;
          touch-action: pan-y !important;
        }
      `;
      document.head.appendChild(style);

      // Keep --app-height in sync with the *visible* viewport, and
      // force the document back to scrollY=0. iOS Safari leaves a stray
      // scroll offset after a Modal closes (the chat panel, scoreboard,
      // settings, etc.) which yanks the top of the app behind the URL
      // bar; resetting on every resize/scroll/visibility tick keeps the
      // root anchored.
      const setAppHeight = () => {
        const h =
          (typeof window !== 'undefined' && window.visualViewport?.height) ||
          window.innerHeight;
        document.documentElement.style.setProperty('--app-height', `${h}px`);
        // Re-anchor — cheap and idempotent.
        if (window.scrollY !== 0 || window.scrollX !== 0) {
          window.scrollTo(0, 0);
        }
      };

      setAppHeight();
      window.addEventListener('resize', setAppHeight);
      window.addEventListener('orientationchange', setAppHeight);
      window.addEventListener('focus', setAppHeight);
      document.addEventListener('visibilitychange', setAppHeight);
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
