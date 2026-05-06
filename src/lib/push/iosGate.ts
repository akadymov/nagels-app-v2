export type PushPlatformState = 'unsupported' | 'ios-needs-pwa' | 'ok';

export function getPushPlatformState(): PushPlatformState {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS) {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;
    if (!standalone) return 'ios-needs-pwa';
  }
  return 'ok';
}
