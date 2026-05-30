import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../hooks/useTheme';
import { Spacing, Radius, TextStyles } from '../constants';

export interface ConfirmModalProps {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  visible, title, body, confirmLabel, cancelLabel, danger, onConfirm, onCancel,
}) => {
  const { colors } = useTheme();
  const confirmBg = danger ? colors.error : colors.accent;
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop} testID="confirm-modal">
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
          <Text style={[styles.title, { color: colors.accent }]}>{title}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{body}</Text>
          <Pressable testID="btn-confirm-modal" onPress={onConfirm}
            style={[styles.btnPrimary, { backgroundColor: confirmBg }]}>
            <Text style={[styles.btnPrimaryText, { color: '#fff' }]}>{confirmLabel}</Text>
          </Pressable>
          <Pressable testID="btn-cancel-modal" onPress={onCancel} style={styles.btnGhost}>
            <Text style={[styles.btnGhostText, { color: colors.textSecondary }]}>{cancelLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, backgroundColor: 'rgba(0,0,0,0.6)' },
  card: { width: '100%', maxWidth: 420, borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm },
  title: { ...TextStyles.h2, textAlign: 'center' },
  body: { ...TextStyles.body, textAlign: 'center' },
  btnPrimary: { paddingVertical: Spacing.sm, borderRadius: Radius.md, alignItems: 'center', marginTop: Spacing.sm },
  btnPrimaryText: { ...TextStyles.button },
  btnGhost: { paddingVertical: Spacing.sm, alignItems: 'center' },
  btnGhostText: { ...TextStyles.button },
});

export default ConfirmModal;
