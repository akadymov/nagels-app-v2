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

import { useWindowDimensions } from 'react-native';

export const DESKTOP_MIN_WIDTH = 1024;

export function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return width >= DESKTOP_MIN_WIDTH;
}
