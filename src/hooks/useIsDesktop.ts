/**
 * Desktop breakpoint hook.
 *
 * Mobile-first stays the default. When the viewport reaches the desktop
 * width threshold (>= 1024px), we render split-pane layouts that combine
 * pairs of mobile screens onto one canvas (Lobby + Profile, Game + Chat,
 * etc.). Below that, the existing mobile screens render unchanged.
 *
 * react-native-web's useWindowDimensions tracks live viewport changes,
 * so the boolean updates on resize.
 */

import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';

export const DESKTOP_MIN_WIDTH = 1024;

export function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return width >= DESKTOP_MIN_WIDTH;
}

/**
 * Stricter than useIsDesktop: requires a hover-capable, fine-pointer
 * device (mouse / trackpad) in addition to the desktop width.
 *
 * The plain useIsDesktop check passes on iPad Safari in landscape
 * (1024px+) but those are still touch devices where the desktop-only
 * UI (huge cards) doesn't fit ergonomically. Akula's friend hit this
 * on an iPad — cards rendered at desktop scale because innerWidth
 * cleared the 1024 threshold.
 */
export function useIsTrueDesktop(): boolean {
  const isWide = useIsDesktop();
  const [hasHover, setHasHover] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setHasHover(mq.matches);
    update();
    if (mq.addEventListener) mq.addEventListener('change', update);
    else if (mq.addListener) mq.addListener(update);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', update);
      else if (mq.removeListener) mq.removeListener(update);
    };
  }, []);
  return isWide && hasHover;
}
