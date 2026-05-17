/**
 * Monotone Lucide-style icon, rendered as inline SVG via a data URI.
 *
 * Emoji glyphs (⚙️, 💬, 🚪, …) render with the OS's color emoji font,
 * which on iOS Safari and Chrome desktop blends into the surrounding
 * text color in light mode — buttons read as gray-on-gray. Monotone
 * SVG with an explicit baked-in stroke colour solves that and gives
 * us a consistent set across light/dark themes.
 *
 * On web we render a real DOM <img> (RN Web's <Image> was unreliable
 * with SVG data URIs in our PWA testing — see GoogleButton). On native
 * we fall back to <Image>; the icon system isn't strictly required on
 * non-web platforms today.
 */

import React from 'react';
import { Image, Platform, type ImageStyle } from 'react-native';

export type IconName =
  | 'settings'
  | 'back'
  | 'door'
  | 'trophy'
  | 'chat'
  | 'refresh'
  | 'hourglass'
  | 'corner-up-left';

const PATHS: Record<IconName, string> = {
  settings:
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  back:
    '<path d="M19 12H5"/>' +
    '<path d="M12 19l-7-7 7-7"/>',
  door:
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>' +
    '<polyline points="16 17 21 12 16 7"/>' +
    '<line x1="21" y1="12" x2="9" y2="12"/>',
  // Latest Lucide trophy — rounded bowl + handle ears + stem +
  // base. The previous variant read as "Greek column top" because
  // the bowl had straight vertical sides; this one tapers cleanly
  // into the stem and reads as a championship cup.
  trophy:
    '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>' +
    '<path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>' +
    '<path d="M4 22h16"/>' +
    '<path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>' +
    '<path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>' +
    '<path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  chat:
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  refresh:
    '<polyline points="23 4 23 10 17 10"/>' +
    '<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  hourglass:
    '<path d="M5 22h14"/>' +
    '<path d="M5 2h14"/>' +
    '<path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/>' +
    '<path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  'corner-up-left':
    '<polyline points="9 14 4 9 9 4"/>' +
    '<path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
};

function buildDataUri(name: IconName, color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ` +
    `fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    PATHS[name] +
    `</svg>`;
  if (typeof btoa === 'function') {
    try { return `data:image/svg+xml;base64,${btoa(svg)}`; } catch {}
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export interface IconProps {
  name: IconName;
  color: string;
  size?: number;
  style?: ImageStyle;
}

export const Icon: React.FC<IconProps> = ({ name, color, size = 20, style }) => {
  const uri = buildDataUri(name, color);
  if (Platform.OS === 'web') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Img = 'img' as any;
    return (
      <Img
        src={uri}
        width={size}
        height={size}
        alt=""
        style={{ display: 'block', ...(style as any) }}
      />
    );
  }
  return <Image source={{ uri }} style={[{ width: size, height: size }, style]} />;
};

export default Icon;
