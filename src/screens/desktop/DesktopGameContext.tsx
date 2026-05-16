/**
 * Context that lets GameTableScreen's top-bar buttons drive the
 * DesktopGameLayout side panes.
 *
 * On mobile this context is absent — GameTableScreen falls back to
 * opening modals like before. On desktop, DesktopGameLayout provides
 * the toggle callbacks and GameTableScreen routes its button presses
 * through them.
 */

import React, { createContext, useContext } from 'react';

export type LeftPanel = 'scoreboard' | 'lastTrick' | 'settings';

export interface DesktopGameUI {
  /** null → left pane hidden entirely. */
  leftPanel: LeftPanel | null;
  /** Click a button: if it's already the active panel, hide it;
   *  otherwise switch to it. */
  toggleLeftPanel: (next: LeftPanel) => void;
  /** Whether the right-pane chat is visible. */
  chatVisible: boolean;
  toggleChat: () => void;
}

export const DesktopGameUIContext = createContext<DesktopGameUI | null>(null);

export function useDesktopGameUI(): DesktopGameUI | null {
  return useContext(DesktopGameUIContext);
}
