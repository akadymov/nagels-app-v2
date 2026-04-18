/**
 * Nägels Online - Haptic Feedback Utilities
 * Provides tactile feedback for user interactions
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Light haptic feedback for card selection
 */
export const cardSelectHaptic = async () => {
  if (Platform.OS === 'web') return;

  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch (error) {
    console.warn('[Haptics] Card select feedback failed:', error);
  }
};

/**
 * Medium haptic feedback for bet placement
 */
export const betPlacedHaptic = async () => {
  if (Platform.OS === 'web') return;

  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch (error) {
    console.warn('[Haptics] Bet placed feedback failed:', error);
  }
};

/**
 * Neutral haptic feedback for trick win
 * (Note: winning a trick isn't always positive - depends on your bet)
 */
export const trickWonHaptic = async () => {
  if (Platform.OS === 'web') return;

  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch (error) {
    console.warn('[Haptics] Trick won feedback failed:', error);
  }
};

/**
 * Light haptic feedback for button presses
 */
export const buttonPressHaptic = async () => {
  if (Platform.OS === 'web') return;

  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch (error) {
    console.warn('[Haptics] Button press feedback failed:', error);
  }
};

/**
 * Selection change haptic feedback
 */
export const selectionHaptic = async () => {
  if (Platform.OS === 'web') return;

  try {
    await Haptics.selectionAsync();
  } catch (error) {
    console.warn('[Haptics] Selection feedback failed:', error);
  }
};
