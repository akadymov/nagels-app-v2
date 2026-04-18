/**
 * Nägels Online - i18n Configuration
 * Supports English, Russian, and Spanish
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Platform } from 'react-native';
import enTranslations from './locales/en.json';
import ruTranslations from './locales/ru.json';
import esTranslations from './locales/es.json';

export const resources = {
  en: { translation: enTranslations },
  ru: { translation: ruTranslations },
  es: { translation: esTranslations },
} as const;

export type TranslationResources = typeof resources;

export const languages = {
  en: { code: 'en', name: 'English', nativeName: 'English' },
  ru: { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  es: { code: 'es', name: 'Spanish', nativeName: 'Español' },
} as const;

export type LanguageCode = keyof typeof languages;

const LANGUAGE_STORAGE_KEY = '@nagels_language';

// Get initial language (from storage or default) - synchronous for web
const getInitialLanguage = (): string => {
  if (typeof window !== 'undefined' && window.localStorage) {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored || 'en';
  }
  return 'en';
};

// Custom missing key handler to prevent truncated keys
const handleMissingKey = (langs: readonly string[], ns: string, key: string) => {
  // Log missing translation keys for debugging
  if (__DEV__) {
    console.warn(`[i18n] Missing translation: ${key} for languages: ${langs.join(', ')}`);
  }
  // Return a fallback instead of the truncated key
  return key;
};

// Initialize i18next synchronously
i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
  // Add missing key handler
  saveMissing: false,
  missingKeyHandler: handleMissingKey,
  // Ensure we have proper defaults
  returnEmptyString: false,
  returnNull: false,
});

// Ensure i18n is ready before using (for mobile)
export const ensureI18nReady = (): void => {
  // i18n is already initialized synchronously above
  // This is a no-op for compatibility
};

export default i18n;
