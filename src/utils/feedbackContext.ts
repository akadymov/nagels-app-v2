/**
 * Nägels Online — feedback metadata collector.
 *
 * Centralised so the FeedbackButton modal stays focused on UX. The
 * shape of the returned object is whatever lands in the `extra`
 * jsonb column on `public.feedback`; existing dedicated columns
 * (screen, room_id, platform, user_agent, language, app_version) are
 * still filled by the caller for indexable querying.
 *
 * Everything here is best-effort — if the browser doesn't expose a
 * particular API (older WebViews, headless contexts), we just leave
 * the field undefined and move on.
 */

import { Platform, Dimensions } from 'react-native';
import { useSettingsStore } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';

export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'unknown';
export type UserType = 'guest' | 'guest-pending-email' | 'registered';
export type Orientation = 'portrait' | 'landscape';

export interface FeedbackContext {
  // Device & browser
  deviceType: DeviceType;
  deviceModel?: string;
  osVersion?: string;
  browser?: string;

  // Locale
  appLanguage: string;
  systemLocale?: string;
  systemLocales?: string[];

  // User
  userType: UserType;
  myPlayerId: string | null;

  // Settings
  themePreference: 'system' | 'light' | 'dark';
  themeResolved?: 'light' | 'dark';
  fourColorDeck: boolean;
  hapticsEnabled: boolean;

  // Viewport / display
  viewportW?: number;
  viewportH?: number;
  visualViewportH?: number;
  pixelRatio?: number;
  orientation?: Orientation;

  // Runtime context
  isPWA?: boolean;
  online?: boolean;
  timezone?: string;
  tzOffsetMin?: number;
  timestamp: number;
}

/** Best-effort UA parse — covers the common cases without a dep. */
function parseUserAgent(ua: string): {
  browser?: string;
  osVersion?: string;
  deviceType: DeviceType;
  deviceModel?: string;
} {
  let browser: string | undefined;
  if (/Edg\//.test(ua)) browser = 'Edge ' + (ua.match(/Edg\/(\d+)/)?.[1] ?? '?');
  else if (/Chrome\//.test(ua)) browser = 'Chrome ' + (ua.match(/Chrome\/(\d+)/)?.[1] ?? '?');
  else if (/Firefox\//.test(ua)) browser = 'Firefox ' + (ua.match(/Firefox\/(\d+)/)?.[1] ?? '?');
  else if (/Safari\//.test(ua)) browser = 'Safari ' + (ua.match(/Version\/(\d+)/)?.[1] ?? '?');

  let osVersion: string | undefined;
  if (/iPhone|iPad/.test(ua)) {
    osVersion = 'iOS ' + (ua.match(/OS (\d+_\d+(?:_\d+)?)/)?.[1].replace(/_/g, '.') ?? '?');
  } else if (/Android/.test(ua)) {
    osVersion = 'Android ' + (ua.match(/Android (\d+(?:\.\d+)?)/)?.[1] ?? '?');
  } else if (/Mac OS X/.test(ua)) {
    osVersion = 'macOS ' + (ua.match(/Mac OS X (\d+_\d+(?:_\d+)?)/)?.[1].replace(/_/g, '.') ?? '?');
  } else if (/Windows NT/.test(ua)) {
    osVersion = 'Windows ' + (ua.match(/Windows NT (\d+\.\d+)/)?.[1] ?? '?');
  }

  let deviceType: DeviceType = 'unknown';
  if (/iPad|Tablet/i.test(ua)) deviceType = 'tablet';
  else if (/iPhone|Mobile|Android/i.test(ua)) deviceType = 'mobile';
  else deviceType = 'desktop';

  let deviceModel: string | undefined;
  if (/iPhone/.test(ua)) deviceModel = 'iPhone';
  else if (/iPad/.test(ua)) deviceModel = 'iPad';
  else if (/Android/.test(ua)) {
    // Most Android UAs include "; <model> Build/..." or "; <model>)".
    const m = ua.match(/;\s*([^;)]+?)\s+Build\//) || ua.match(/Linux;[^;]*;\s*([^;)]+?)\)/);
    if (m) deviceModel = m[1].trim();
  }

  return { browser, osVersion, deviceType, deviceModel };
}

/** Read from window with safe fallbacks for SSR/native. */
function safeWindow<T>(get: () => T): T | undefined {
  try {
    return get();
  } catch {
    return undefined;
  }
}

export function collectFeedbackContext(): FeedbackContext {
  const settings = useSettingsStore.getState();
  const auth = useAuthStore.getState();
  const i18nLang = (() => {
    try {
      // Dynamic require so this util can be imported by tests that
      // don't bundle the i18n config.
      return (require('../i18n/config').default?.language as string) || settings.language;
    } catch {
      return settings.language;
    }
  })();

  const userType: UserType = (() => {
    if (!auth.user) return 'guest';
    if (auth.isGuest) return 'guest';
    if (auth.user.email && !auth.user.email_confirmed_at) {
      return 'guest-pending-email';
    }
    return 'registered';
  })();

  // System / browser context — only meaningful on web. Native paths
  // get device info from Platform + Dimensions.
  let browser: string | undefined;
  let osVersion: string | undefined;
  let deviceType: DeviceType = 'unknown';
  let deviceModel: string | undefined;
  let systemLocale: string | undefined;
  let systemLocales: string[] | undefined;
  let viewportW: number | undefined;
  let viewportH: number | undefined;
  let visualViewportH: number | undefined;
  let pixelRatio: number | undefined;
  let orientation: Orientation | undefined;
  let isPWA: boolean | undefined;
  let online: boolean | undefined;
  let timezone: string | undefined;
  let tzOffsetMin: number | undefined;

  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    const ua = navigator.userAgent;
    const parsed = parseUserAgent(ua);
    browser = parsed.browser;
    osVersion = parsed.osVersion;
    deviceType = parsed.deviceType;
    deviceModel = parsed.deviceModel;

    systemLocale = navigator.language;
    systemLocales = (navigator.languages as readonly string[] | undefined)?.slice() as
      | string[]
      | undefined;
    online = (navigator as Navigator & { onLine?: boolean }).onLine;

    viewportW = safeWindow(() => window.innerWidth);
    viewportH = safeWindow(() => window.innerHeight);
    visualViewportH = safeWindow(() =>
      (window.visualViewport as VisualViewport | undefined)?.height,
    );
    pixelRatio = safeWindow(() => window.devicePixelRatio);

    orientation = safeWindow(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      return w >= h ? 'landscape' : 'portrait';
    });

    isPWA = safeWindow(() => {
      if (window.matchMedia) {
        return (
          window.matchMedia('(display-mode: standalone)').matches ||
          // iOS Safari uses navigator.standalone
          (navigator as Navigator & { standalone?: boolean }).standalone === true
        );
      }
      return undefined;
    });
  } else {
    // Native (Expo iOS/Android) — Platform.OS gives the OS itself,
    // pair it with the JS engine version we have access to.
    deviceType =
      Platform.OS === 'ios' || Platform.OS === 'android' ? 'mobile' : 'unknown';
    osVersion = `${Platform.OS} ${String(
      (Platform as { Version?: number | string }).Version ?? '',
    )}`.trim();
    const dims = Dimensions.get('window');
    viewportW = dims.width;
    viewportH = dims.height;
    pixelRatio = dims.scale;
    orientation = dims.width >= dims.height ? 'landscape' : 'portrait';
  }

  // Time / TZ — works in every JS env we care about.
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* ignore */
  }
  try {
    tzOffsetMin = -new Date().getTimezoneOffset();
  } catch {
    /* ignore */
  }

  return {
    deviceType,
    deviceModel,
    osVersion,
    browser,

    appLanguage: i18nLang,
    systemLocale,
    systemLocales,

    userType,
    myPlayerId: null, // populated by caller (it has the room store access already)

    themePreference: settings.themePreference,
    fourColorDeck: settings.fourColorDeck,
    hapticsEnabled: settings.hapticsEnabled,

    viewportW,
    viewportH,
    visualViewportH,
    pixelRatio,
    orientation,

    isPWA,
    online,
    timezone,
    tzOffsetMin,
    timestamp: Date.now(),
  };
}
