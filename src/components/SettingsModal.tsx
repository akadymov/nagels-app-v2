import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useSettingsUIStore } from '../store/settingsUIStore';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';
import { Spacing, Radius, TextStyles } from '../constants';
import { SettingsBody } from './SettingsBody';

export const SettingsModal: React.FC = () => {
  const visible = useSettingsUIStore((s) => s.visible);
  const close = useSettingsUIStore((s) => s.close);
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { height } = useWindowDimensions();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={close}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={close} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderColor: colors.glassLight,
              height: height * 0.92,
            },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.glassLight }]}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              {t('settings.title', 'Settings')}
            </Text>
            <Pressable onPress={close} hitSlop={12} testID="settings-modal-close">
              <Text style={[styles.closeX, { color: colors.textMuted }]}>✕</Text>
            </Pressable>
          </View>
          <SettingsBody onClose={close} />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  backdropTap: { ...StyleSheet.absoluteFillObject },
  sheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  title: { ...TextStyles.h3 },
  closeX: { fontSize: 22, fontWeight: '700' },
});
