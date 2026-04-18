/**
 * Nägels Online - Welcome Screen
 * First screen users see with Quick Start entry point
 * Light theme matching legacy app aesthetic
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Pressable,
  Platform,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GlassButton } from '../components/buttons';
import { Colors, Spacing, Radius, TextStyles, SuitSymbols } from '../constants';
import { useTranslation } from 'react-i18next';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface WelcomeScreenProps {
  onQuickStart: () => void;
  onAlreadyPlay?: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onQuickStart,
  onAlreadyPlay,
}) => {
  const { t } = useTranslation();

  const logoOpacity = useRef(new Animated.Value(0)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(logoOpacity, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start(() => {
      Animated.timing(taglineOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start(() => {
        Animated.timing(buttonOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      });
    });
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.content}>

        {/* Logo block */}
        <Animated.View style={[styles.logoContainer, { opacity: logoOpacity }]}>
          <View style={styles.logoCard}>
            <Text style={styles.logoTitle}>{t('welcome.title')}</Text>
            <View style={styles.suitRow}>
              <Text style={[styles.suit, { color: Colors.spades }]}>{SuitSymbols.spades}</Text>
              <Text style={[styles.suit, { color: Colors.hearts }]}>{SuitSymbols.hearts}</Text>
              <Text style={[styles.suit, { color: Colors.clubs }]}>{SuitSymbols.clubs}</Text>
              <Text style={[styles.suit, { color: Colors.diamonds }]}>{SuitSymbols.diamonds}</Text>
            </View>
          </View>
        </Animated.View>

        {/* Tagline */}
        <Animated.View style={[styles.taglineContainer, { opacity: taglineOpacity }]}>
          <Text style={styles.tagline}>{t('welcome.tagline')}</Text>
        </Animated.View>

        {/* Spacer to push button toward thumb zone */}
        <View style={styles.spacer} />

        {/* Quick Start Button */}
        <Animated.View style={[styles.buttonContainer, { opacity: buttonOpacity }]}>
          <GlassButton
            title={t('welcome.quickStart')}
            onPress={onQuickStart}
            size="large"
            variant="primary"
            accentColor={Colors.accent}
            style={styles.quickStartButton}
            testID="btn-learn-to-play"
          />
        </Animated.View>

        {/* "I already play" link */}
        <Animated.View style={[styles.alreadyPlayContainer, { opacity: buttonOpacity }]}>
          <Pressable onPress={onAlreadyPlay} hitSlop={12} testID="btn-skip-to-lobby">
            <Text style={styles.alreadyPlayText}>
              {t('welcome.alreadyPlay')}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: SCREEN_HEIGHT * 0.12,
    paddingBottom: Spacing.xl,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  logoContainer: {
    marginBottom: Spacing.lg,
    width: '100%',
    alignItems: 'center',
  },
  logoCard: {
    backgroundColor: '#ffffff',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.glassLight,
    paddingVertical: Spacing.xl * 1.5,
    paddingHorizontal: Spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    width: '100%',
  },
  logoTitle: {
    fontSize: 36,
    fontWeight: '700' as const,
    color: Colors.accent,
    marginBottom: Spacing.md,
    letterSpacing: 4,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    textAlign: 'center',
  },
  suitRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
  },
  suit: {
    fontSize: 28,
    lineHeight: 32,
  },
  taglineContainer: {
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
  },
  tagline: {
    ...TextStyles.body,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  spacer: {
    flex: 1,
  },
  buttonContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  quickStartButton: {
    width: Math.min(SCREEN_WIDTH * 0.8, 340),
  },
  alreadyPlayContainer: {
    marginBottom: Spacing.xl,
  },
  alreadyPlayText: {
    ...TextStyles.caption,
    color: Colors.accent,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
});

export default WelcomeScreen;
