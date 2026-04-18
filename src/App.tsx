/**
 * Nägels Online - Main App Component
 */

import React from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppNavigator } from './navigation';
import i18n from './i18n/config';

/**
 * Main App component
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <I18nextProvider i18n={i18n}>
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <StatusBar barStyle="dark-content" backgroundColor="#e8e8e8" />
          <AppNavigator />
        </SafeAreaView>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#e8e8e8', // Light background
  },
});
