/**
 * Branded Google sign-in / link button.
 *
 * Visuals follow Google's Identity Branding Guidelines
 *  (https://developers.google.com/identity/branding-guidelines):
 *  - official multicolor G mark (inline SVG)
 *  - light theme:  bg #FFFFFF, fg #1F1F1F, border #747775
 *  - dark  theme:  bg #131314, fg #E3E3E3, border #8E918F
 *  - 4px corner radius, min-height 40, 12px logo-text gap, 18px logo
 *  - Roboto / system medium weight
 *
 * The label is provided by the caller (Sign in / Continue / Link / Unlink)
 * so the same component covers AuthScreen, Settings, and any future surface.
 *
 * `loading` swaps the body for a spinner so the user gets feedback while the
 * OAuth redirect is in flight (Supabase's signInWithOAuth takes a couple of
 * seconds to bounce the browser to Google).
 */

import React from 'react';
import {
  Pressable, Image, Text, StyleSheet, ActivityIndicator, Platform,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../hooks/useTheme';

const GOOGLE_G_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">' +
  '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
  '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
  '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
  '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
  '</svg>';

// Base64 first (universally accepted, including by RN Web's Image); utf-8 URI
// has rendered inconsistently on Chrome PWA. btoa is fine here — the SVG is
// pure ASCII.
const GOOGLE_G_URI = (() => {
  if (typeof btoa === 'function') {
    try { return `data:image/svg+xml;base64,${btoa(GOOGLE_G_SVG)}`; } catch {}
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(GOOGLE_G_SVG)}`;
})();

// On web, render a real DOM <img> — RN Web's <Image> has been flaky with SVG
// data URIs and skipped rendering on Chrome PWA standalone in our testing.
const GoogleLogo: React.FC = () => {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Img = 'img' as any;
    return (
      <Img
        src={GOOGLE_G_URI}
        width={18}
        height={18}
        alt=""
        style={{ display: 'block' }}
      />
    );
  }
  return <Image source={{ uri: GOOGLE_G_URI }} style={styles.logo} />;
};

export interface GoogleButtonProps {
  onPress: () => void | Promise<void>;
  label: string;
  testID?: string;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle | ViewStyle[];
}

export const GoogleButton: React.FC<GoogleButtonProps> = ({
  onPress, label, testID, disabled, loading, style,
}) => {
  const { isDark } = useTheme();
  const bg     = isDark ? '#131314' : '#FFFFFF';
  const fg     = isDark ? '#E3E3E3' : '#1F1F1F';
  const border = isDark ? '#8E918F' : '#747775';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      testID={testID}
      style={[
        styles.btn,
        { backgroundColor: bg, borderColor: border, opacity: (disabled || loading) ? 0.7 : 1 },
        style as any,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          <GoogleLogo />
          <Text style={[styles.label, { color: fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 4,
    borderWidth: 1,
    gap: 12,
  },
  logo: { width: 18, height: 18 },
  label: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: 'Roboto, Arial, sans-serif',
    letterSpacing: 0.25,
  },
});

export default GoogleButton;
