// src/components/HostLeftBanner.tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';

interface Props {
  visible: boolean;
  onLeave: () => void;
}

export const HostLeftBanner: React.FC<Props> = ({ visible, onLeave }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (!visible) return null;
  return (
    <View
      pointerEvents="box-none"
      style={styles.wrap}
      testID="host-left-banner"
    >
      <View style={[styles.bar, { backgroundColor: colors.error, borderColor: colors.glassLight }]}>
        <Text style={[styles.text, { color: '#ffffff' }]} numberOfLines={2}>
          {t('multiplayer.hostLeftBannerText', 'Host left the room.')}
        </Text>
        <Pressable
          testID="host-left-banner-leave"
          onPress={onLeave}
          accessibilityRole="button"
          accessibilityLabel={String(t('multiplayer.leaveRoom', 'Leave Room'))}
          style={({ pressed }) => [styles.btn, { backgroundColor: '#ffffff', opacity: pressed ? 0.75 : 1 }]}
        >
          <Text style={[styles.btnText, { color: colors.error }]}>
            {t('multiplayer.leaveRoom', 'Leave Room')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 1000,
    paddingTop: 8, paddingHorizontal: 12,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  text: { flex: 1, fontSize: 14, fontWeight: '600' },
  btn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  btnText: { fontSize: 13, fontWeight: '700' },
});
