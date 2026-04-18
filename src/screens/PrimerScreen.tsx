/**
 * Nägels Online - Primer Carousel Screens
 * 30-second embedded tutorial with 3 screens
 */

import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Pressable,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import { GlassCard } from '../components/glass';
import { GlassButton } from '../components/buttons';
import { Colors, Spacing, Radius, TextStyles, SuitSymbols } from '../constants';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export interface PrimerScreenProps {
  onComplete: () => void;
  onSkip?: () => void;
  navigation?: any;
}

// Colored suit symbol components for the bidding screen
const SuitSpan = ({ suit, symbol }: { suit: keyof typeof Colors; symbol: string }) => (
  <Text style={{ color: suit === 'spades' ? Colors.textPrimary : Colors[suit] as string }}>
    {symbol}
  </Text>
);

const BiddingVisual = () => (
  <Text style={[TextStyles.h2, { textAlign: 'center', color: Colors.textPrimary }]}>
    {'Trump '}
    <SuitSpan suit="hearts" symbol={SuitSymbols.hearts} />
    {' beats\n'}
    <SuitSpan suit="spades" symbol={SuitSymbols.spades} />
    {' '}
    <SuitSpan suit="diamonds" symbol={SuitSymbols.diamonds} />
    {' '}
    <SuitSpan suit="clubs" symbol={SuitSymbols.clubs} />
  </Text>
);

const SCREENS: Array<{
  key: string;
  i18nKey: string;
  visual?: string;
  visualNode?: React.ReactNode;
}> = [
  {
    key: 'basics',
    i18nKey: 'screen1',
    visual: `A > K > Q > J\n10 → 1 → 10`,
  },
  {
    key: 'bidding',
    i18nKey: 'screen2',
    visualNode: <BiddingVisual />,
  },
  {
    key: 'winning',
    i18nKey: 'screen3',
    visual: `Bet 3 → Win 3\n= +10 bonus`,
  },
];

/**
 * PrimerScreen - Onboarding carousel
 *
 * Features:
 * - 3 swipeable screens
 * - Progress dots
 * - Skip button
 * - Animated visuals
 */
export const PrimerScreen: React.FC<PrimerScreenProps> = ({
  onComplete,
  onSkip,
  navigation,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [currentIndex, setCurrentIndex] = useState(0);

  // Animated value for swipe feedback
  const translateX = useRef(new Animated.Value(0)).current;

  const handleNext = () => {
    if (currentIndex < SCREENS.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      // Last screen - navigate to Lobby
      if (navigation) {
        navigation.navigate('Lobby' as never);
      } else {
        onComplete();
      }
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleSkip = () => {
    if (onSkip) {
      onSkip();
    } else if (navigation) {
      navigation.navigate('Lobby' as never);
    }
  };

  // Pan gesture handler - use ref for the event
  const gestureHandler = useRef(
    Animated.event(
      [{ nativeEvent: { translationX: translateX } }],
      { useNativeDriver: true }
    )
  ).current;

  const handleHandlerStateChange = (_event: any) => {
    const event = _event.nativeEvent;

    if (event.state === State.END) {
      const { translationX } = event;
      const shouldGoNext = translationX < -50;
      const shouldGoPrev = translationX > 50;

      if (shouldGoNext && currentIndex < SCREENS.length - 1) {
        // Swipe left - go next
        Animated.timing(translateX, {
          toValue: -SCREEN_WIDTH,
          duration: 200,
          useNativeDriver: true,
        }).start(() => {
          setCurrentIndex(currentIndex + 1);
          translateX.setValue(0);
        });
      } else if (shouldGoPrev && currentIndex > 0) {
        // Swipe right - go previous
        Animated.timing(translateX, {
          toValue: SCREEN_WIDTH,
          duration: 200,
          useNativeDriver: true,
        }).start(() => {
          setCurrentIndex(currentIndex - 1);
          translateX.setValue(0);
        });
      } else {
        // Snap back
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 0,
        }).start();
      }
    }
  };

  const renderDot = (index: number) => {
    const isActive = index === currentIndex;
    return (
      <View
        key={index}
        style={[
          styles.dot,
          { backgroundColor: colors.glassLight },
          isActive && [styles.dotActive, { backgroundColor: colors.highlight }],
        ]}
      />
    );
  };

  const currentScreen = SCREENS[currentIndex];
  const titleKey = `primer.${currentScreen.i18nKey}.title` as const;
  const descKey = `primer.${currentScreen.i18nKey}.description` as const;
  const btnKey = `primer.${currentScreen.i18nKey}.button` as const;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <LinearGradient
        colors={colors.deepRich as any}
        style={styles.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.3, y: 1 }}
      />

      {/* Header with Skip and Progress */}
      <View style={styles.header}>
        <Pressable onPress={handleSkip} hitSlop={12}>
          <Text style={[styles.skipText, { color: colors.textMuted }]}>{t('common.skip')}</Text>
        </Pressable>
        <Text style={[styles.progress, { color: colors.textMuted }]}>
          {currentIndex + 1}/{SCREENS.length}
        </Text>
      </View>

      {/* Swipeable content area */}
      <PanGestureHandler
        onGestureEvent={gestureHandler}
        onHandlerStateChange={handleHandlerStateChange}
        activeOffsetX={[-15, 15]}
      >
        <Animated.View style={styles.gestureArea}>
          <Animated.View
            style={[
              styles.slide,
              {
                transform: [{ translateX }],
              },
            ]}
          >
            {/* Visual Card */}
            <GlassCard
              style={styles.visualCard}
              blurAmount={10}
            >
              {currentScreen.visualNode ?? (
                <Text style={[styles.visualText, { color: colors.textPrimary }]}>{currentScreen.visual}</Text>
              )}
            </GlassCard>

            {/* Description */}
            <Text style={[styles.description, { color: colors.textSecondary }]}>
              {t(descKey)}
            </Text>

            {/* Progress Dots */}
            <View style={styles.dotsContainer}>
              {SCREENS.map((_, i) => renderDot(i))}
            </View>
          </Animated.View>
        </Animated.View>
      </PanGestureHandler>

      {/* Button - OUTSIDE gesture handler to ensure it works */}
      <View style={styles.buttonContainer}>
        <GlassButton
          title={t(btnKey)}
          onPress={handleNext}
          size="medium"
          variant="primary"
          accentColor={colors.highlight}
          style={styles.nextButton}
          testID={`primer-button-${currentIndex}`}
        />
      </View>

      {/* Swipe hint - only show on first screen */}
      {currentIndex === 0 && (
        <View style={styles.swipeHint}>
          <Text style={[styles.swipeHintText, { color: colors.textMuted }]}>{t('primer.swipeHint')}</Text>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  skipText: {
    ...TextStyles.body,
    color: Colors.textSecondary,
  },
  progress: {
    ...TextStyles.caption,
    color: Colors.textMuted,
  },
  gestureArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: Spacing.xl,
  },
  slide: {
    width: SCREEN_WIDTH,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
  },
  visualCard: {
    paddingVertical: Spacing.xxl,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.xl,
    minWidth: 200,
    alignItems: 'center',
    backgroundColor: Colors.glassDark,
    borderWidth: 1,
    borderColor: Colors.glassLight,
  },
  visualText: {
    ...TextStyles.h2,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  description: {
    ...TextStyles.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.xxl,
    paddingHorizontal: Spacing.md,
  },
  dotsContainer: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.glassLight,
  },
  dotActive: {
    backgroundColor: Colors.highlight,
    width: 20,
  },
  buttonContainer: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
    alignItems: 'center',
  },
  nextButton: {
    width: Math.min(SCREEN_WIDTH * 0.7, 280),
  },
  swipeHint: {
    position: 'absolute',
    bottom: Spacing.xxl + 60,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  swipeHintText: {
    ...TextStyles.caption,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});

export default PrimerScreen;
