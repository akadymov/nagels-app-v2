/**
 * Nägels Online - Language Switcher Component
 *
 * Allows users to switch between English, Russian, and Spanish
 * Persists selection using localStorage
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { GlassCard } from './glass';
import { Colors, Spacing, Radius, TextStyles } from '../constants';
import { useTranslation } from 'react-i18next';
import { languages, type LanguageCode } from '../i18n';

const LANGUAGE_STORAGE_KEY = '@nagels_language';

const saveLanguage = (langCode: string): void => {
  if (typeof window !== 'undefined' && window.localStorage) {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, langCode);
  }
};

export const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();
  const [currentLang, setCurrentLang] = useState<LanguageCode>(i18n.language as LanguageCode);

  const changeLanguage = async (langCode: LanguageCode) => {
    try {
      await i18n.changeLanguage(langCode);
      saveLanguage(langCode);
      setCurrentLang(langCode);
    } catch (error) {
      console.error('Failed to change language:', error);
    }
  };

  return (
    <GlassCard style={styles.container} blurAmount={15}>
      <Text style={styles.title}>Language / Язык / Idioma</Text>
      <View style={styles.buttonsContainer}>
        {(Object.keys(languages) as LanguageCode[]).map((langCode) => {
          const lang = languages[langCode];
          const isSelected = currentLang === langCode;

          return (
            <TouchableOpacity
              key={langCode}
              style={[
                styles.langButton,
                isSelected && styles.selectedButton,
              ]}
              onPress={() => changeLanguage(langCode)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.langName,
                  isSelected && styles.selectedText,
                ]}
              >
                {lang.nativeName}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.glassLight,
  },
  title: {
    ...TextStyles.caption,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  buttonsContainer: {
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'center',
  },
  langButton: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.glassDark,
    borderWidth: 1,
    borderColor: Colors.glassLight,
  },
  selectedButton: {
    backgroundColor: Colors.highlight,
    borderColor: Colors.highlight,
  },
  langName: {
    ...TextStyles.caption,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  selectedText: {
    color: '#ffffff',
    fontWeight: '700',
  },
});

export default LanguageSwitcher;
