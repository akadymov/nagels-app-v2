/**
 * PWA install helpers.
 *
 * - Chromium browsers fire `beforeinstallprompt` before showing their built-in
 *   install affordance; we capture it so our own UI can call `prompt()` later.
 * - iOS Safari has no programmatic install API — the modal shows manual
 *   "Share → Add to Home Screen" instructions instead.
 * - Inside in-app browsers (Telegram, Facebook, etc.) installation is usually
 *   impossible; we surface a hint to open in the system browser.
 */

import { create } from 'zustand';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

interface PwaInstallState {
  deferredPrompt: BeforeInstallPromptEvent | null;
  setDeferredPrompt: (e: BeforeInstallPromptEvent | null) => void;
}

// Reactive store so the modal re-renders when beforeinstallprompt fires
// after the modal has opened (timing-dependent on Chromium).
const usePwaInstallStore = create<PwaInstallState>((set) => ({
  deferredPrompt: null,
  setDeferredPrompt: (e) => set({ deferredPrompt: e }),
}));

let listenerSetup = false;

export function setupPwaInstallListener(): void {
  if (listenerSetup) return;
  if (typeof window === 'undefined') return;
  listenerSetup = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    usePwaInstallStore.getState().setDeferredPrompt(e as BeforeInstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => {
    usePwaInstallStore.getState().setDeferredPrompt(null);
  });
}

export function hasDeferredPrompt(): boolean {
  return usePwaInstallStore.getState().deferredPrompt !== null;
}

/** Reactive variant of hasDeferredPrompt — components re-render on change. */
export function useHasDeferredPrompt(): boolean {
  return usePwaInstallStore((s) => s.deferredPrompt !== null);
}

export async function triggerInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = usePwaInstallStore.getState().deferredPrompt;
  if (!e) return 'unavailable';
  usePwaInstallStore.getState().setDeferredPrompt(null);
  try {
    await e.prompt();
    const choice = await e.userChoice;
    return choice.outcome;
  } catch {
    return 'dismissed';
  }
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  if ((window.navigator as { standalone?: boolean }).standalone === true) return true;
  return false;
}

export function isMobileWeb(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod|Android/i.test(navigator.userAgent);
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/i.test(navigator.userAgent);
}

export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Instagram|FBAN|FBAV|Twitter|Line\/|MicroMessenger|TelegramBot/i.test(ua);
}
