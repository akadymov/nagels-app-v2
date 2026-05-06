/**
 * Nägels Online - Haptic Feedback Utilities
 * Provides tactile feedback for user interactions.
 *
 * On native (iOS/Android) we use expo-haptics which routes to the
 * platform's haptic engine. On web we fall back to navigator.vibrate
 * with hand-tuned patterns that approximate the native feel — works on
 * Android Chrome (and most Android browsers); silently no-ops on iOS
 * Safari and desktop browsers because Apple chose not to expose the
 * Vibration API there.
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Web fallback. navigator.vibrate exists on Android Chrome/Firefox/etc.
// but not on iOS Safari or desktop Chrome on most platforms.
type VibratePattern = number | number[];
const vibrate = (pattern: VibratePattern) => {
  if (Platform.OS !== 'web') return;
  if (typeof navigator === 'undefined') return;
  const fn = (navigator as Navigator & { vibrate?: (p: VibratePattern) => boolean }).vibrate;
  if (typeof fn !== 'function') return;
  try {
    fn.call(navigator, pattern);
  } catch {
    // Some browsers throw if the page is hidden / lacks user gesture.
  }
};

/**
 * Light haptic feedback for card selection
 */
export const cardSelectHaptic = async () => {
  if (Platform.OS === 'web') {
    vibrate(10);
    return;
  }

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
  if (Platform.OS === 'web') {
    vibrate(25);
    return;
  }

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
  if (Platform.OS === 'web') {
    vibrate(25);
    return;
  }

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
  if (Platform.OS === 'web') {
    vibrate(10);
    return;
  }

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
  if (Platform.OS === 'web') {
    vibrate(8);
    return;
  }

  try {
    await Haptics.selectionAsync();
  } catch (error) {
    console.warn('[Haptics] Selection feedback failed:', error);
  }
};

/**
 * Success notification — fires on a "perfect-bid" bonus at hand close.
 * Distinct from a plain trick-win impact: the system "success" pattern
 * (two-pulse on iOS) signals that an objective was met.
 */
export const bonusEarnedHaptic = async () => {
  if (Platform.OS === 'web') {
    // Double-pulse to mirror the iOS Success notification pattern.
    vibrate([20, 60, 30]);
    return;
  }

  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (error) {
    console.warn('[Haptics] Bonus earned feedback failed:', error);
  }
};

/**
 * Game-won celebration haptic — fires once when the winner banner
 * mounts and the local player is the winner.
 */
export const gameWonHaptic = async () => {
  if (Platform.OS === 'web') {
    // Triple-pulse celebration — longer than bonus so the user can tell
    // "I won the whole game" from "I made my bid this hand".
    vibrate([30, 80, 30, 80, 50]);
    return;
  }

  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (error) {
    console.warn('[Haptics] Game won feedback failed:', error);
  }
};

