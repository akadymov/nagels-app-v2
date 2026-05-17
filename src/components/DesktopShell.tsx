/**
 * DesktopShell — top bar shared across desktop layouts.
 *
 * Renders the brand cluster (suits + NÄGELS wordmark) on the left and an
 * optional right slot (typically a user pill or action buttons). Wraps
 * the page content in a max-1920 centered container so the layout
 * doesn't sprawl on ultrawide monitors.
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, type ViewStyle } from 'react-native';
import { useTheme } from '../hooks/useTheme';
import { Spacing, Radius } from '../constants';

interface DesktopShellProps {
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
  /** When false, the top bar is omitted (e.g. Welcome + Auth has its own header). */
  showTopBar?: boolean;
  contentStyle?: ViewStyle;
}

const SUITS: Array<{ glyph: string; colorKey: 'textPrimary' | 'error' | 'success' | 'accent' }> = [
  { glyph: '♠', colorKey: 'textPrimary' },
  { glyph: '♥', colorKey: 'error' },
  { glyph: '♣', colorKey: 'success' },
  { glyph: '♦', colorKey: 'accent' },
];

export const DesktopShell: React.FC<DesktopShellProps> = ({
  children, rightSlot, showTopBar = true, contentStyle,
}) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.inner}>
        {showTopBar && (
          <View
            style={[
              styles.topBar,
              { backgroundColor: colors.surface, borderColor: colors.glassLight },
            ]}
          >
            <View style={styles.brand}>
              {SUITS.map((s) => (
                <Text
                  key={s.glyph}
                  style={[styles.suit, { color: colors[s.colorKey] as string }]}
                >
                  {s.glyph}
                </Text>
              ))}
              <Text style={[styles.wordmark, { color: colors.accent }]}>NÄGELS</Text>
            </View>
            <View style={styles.rightSlot}>{rightSlot}</View>
          </View>
        )}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, contentStyle]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Center content on ultrawide; cap at 1280 so the visible content
  // box (1280 − 2 × 32 padding) is exactly 1216 — matching the
  // 600 + 16 gap + 600 pane row used inside this shell (Akula:
  // "the brand row should line up with the panes below").
  inner: {
    flex: 1,
    width: '100%',
    maxWidth: 1280,
    alignSelf: 'center',
    paddingHorizontal: 32,
    paddingTop: 24,
    paddingBottom: 24,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: Spacing.lg,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  suit: { fontSize: 22, fontWeight: '700' },
  wordmark: { fontSize: 22, fontWeight: '800', letterSpacing: 3, marginLeft: 4 },
  rightSlot: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  scroll: { flex: 1 },
  content: { flexGrow: 1 },
});
