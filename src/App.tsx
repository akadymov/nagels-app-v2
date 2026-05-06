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
           flex column that doesn't introduce its own min-height. */
        #root > div,
        #root > div > div,
        #root > div > div > div,
        #root > div > div > div > div {
          display: flex !important;
          flex-direction: column !important;
          flex: 1 !important;
          min-height: 0 !important;
        }
        /* Propagate min-height/width: 0 to *every* descendant of
           #root with !important. Without this override, intermediate
           non-View wrappers from React Navigation and SafeAreaProvider
           default to min-height: auto (= content size). A flex parent
           of a ScrollView with min-height: auto cannot shrink, so its
           overflow:auto child never clips, and vertical scroll dies on
           every screen deeper than the navigation card. */
        #root div {
          min-height: 0 !important;
          min-width: 0 !important;
        }
        /* Force scroll on RN-web ScrollView wrappers explicitly.
           ScrollView renders the outer div with inline
           overflow-y:auto/scroll; on iOS Safari that occasionally
           shows but the touch-scroll handler doesn't engage unless
           -webkit-overflow-scrolling:touch is set with !important. */
        div[style*="overflow-y: auto"],
        div[style*="overflow-y: scroll"],
        div[style*="overflow:auto"],
        div[style*="overflow: auto"],
        div[style*="overflow:scroll"],
        div[style*="overflow: scroll"] {
          -webkit-overflow-scrolling: touch !important;
          touch-action: pan-y !important;
          overflow-y: auto !important;
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

      // PWA install support — manifest link, theme color, apple-touch
      // hints, and service worker registration. The default Expo web
      // template ships none of these, so Chrome won't surface the
      // "Install app" affordance and Android's add-to-home-screen
      // creates a plain bookmark instead of a standalone PWA. Inject
      // them at runtime instead of forking the HTML template.
      const ensureHead = (selector: string, build: () => HTMLElement) => {
        if (!document.head.querySelector(selector)) {
          document.head.appendChild(build());
        }
      };
      ensureHead('link[rel="manifest"]', () => {
        const l = document.createElement('link');
        l.rel = 'manifest';
        l.href = '/manifest.json';
        return l;
      });
      ensureHead('meta[name="theme-color"]', () => {
        const m = document.createElement('meta');
        m.name = 'theme-color';
        m.content = '#13428f';
        return m;
      });
      ensureHead('meta[name="apple-mobile-web-app-capable"]', () => {
        const m = document.createElement('meta');
        m.name = 'apple-mobile-web-app-capable';
        m.content = 'yes';
        return m;
      });
      ensureHead('meta[name="apple-mobile-web-app-status-bar-style"]', () => {
        const m = document.createElement('meta');
        m.name = 'apple-mobile-web-app-status-bar-style';
        m.content = 'black-translucent';
        return m;
      });
      ensureHead('link[rel="apple-touch-icon"]', () => {
        const l = document.createElement('link');
        l.rel = 'apple-touch-icon';
        l.href = '/icons/icon.svg';
        return l;
      });

      // Register the service worker. Required for Chrome installability.
      // Wrapped in a load handler so it doesn't block first paint, and
      // gated on navigator.serviceWorker because some embedded
      // browsers (e.g. older Telegram in-app browser) don't ship it.
      if ('serviceWorker' in navigator) {
        const register = () => {
          navigator.serviceWorker
            .register('/sw.js')
            .catch((err) => console.warn('[SW] registration failed:', err));
        };
        if (document.readyState === 'complete') register();
        else window.addEventListener('load', register, { once: true });
      }
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
