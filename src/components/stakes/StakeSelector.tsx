import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';

export interface StakeSelectorProps {
  /** Any non-negative integer up to 999. 0 = stakes off. */
  stake: number;
  isHost: boolean;
  isHostEligible: boolean;
  optedIn: boolean;
  selfEligible: boolean;
  locked: boolean;
  onStakeChange: (s: number) => void;
  onToggleOptIn: (next: boolean) => void;
}

const PRESETS: number[] = [0, 1, 5, 10, 25];
const MAX_STAKE = 999;

export const StakeSelector: React.FC<StakeSelectorProps> = ({
  stake, isHost, isHostEligible, optedIn, selfEligible, locked,
  onStakeChange, onToggleOptIn,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const chipsDisabled = !isHost || !isHostEligible || locked;
  const isCustomActive = stake > 0 && !PRESETS.includes(stake);

  // Local draft for the Custom input — committed on blur / Enter / submit so
  // a single keystroke doesn't fire a round-trip per character.
  const [customDraft, setCustomDraft] = useState<string>(
    isCustomActive ? String(stake) : '',
  );
  const [customOpen, setCustomOpen] = useState<boolean>(isCustomActive);

  // Keep the draft in sync if the room's stake is changed elsewhere
  // (e.g. another host action, restart reset to 0, server snapshot landing).
  useEffect(() => {
    if (isCustomActive) {
      setCustomDraft(String(stake));
      setCustomOpen(true);
    } else if (stake === 0 && customDraft === '' && !customOpen) {
      // nothing to sync
    } else if (PRESETS.includes(stake)) {
      setCustomOpen(false);
    }
  }, [stake, isCustomActive]);

  const commitCustom = () => {
    const n = parseInt(customDraft, 10);
    if (!Number.isFinite(n) || n < 0 || n > MAX_STAKE) return;
    if (n === stake) return;
    onStakeChange(n);
  };

  return (
    <View style={[styles.root, { borderColor: colors.glassLight, backgroundColor: colors.surface }]}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {t('stakes.title')}
      </Text>
      <View style={styles.chipRow}>
        {PRESETS.map((v) => {
          const active = stake === v && !isCustomActive;
          return (
            <Pressable
              key={v}
              onPress={() => {
                if (chipsDisabled) return;
                setCustomOpen(false);
                onStakeChange(v);
              }}
              disabled={chipsDisabled}
              style={[
                styles.chip,
                {
                  borderColor: active ? colors.accent : colors.glassLight,
                  backgroundColor: active ? colors.accent : 'transparent',
                  opacity: chipsDisabled && !active ? 0.4 : 1,
                },
              ]}
              testID={`stake-chip-${v}`}
            >
              <Text style={[styles.chipText, { color: active ? '#ffffff' : colors.textPrimary }]}>
                {v === 0 ? t('stakes.off') : String(v)}
              </Text>
            </Pressable>
          );
        })}
        {/* Custom chip — toggles a numeric input alongside the chip row. */}
        <Pressable
          onPress={() => {
            if (chipsDisabled) return;
            setCustomOpen((prev) => !prev);
          }}
          disabled={chipsDisabled}
          style={[
            styles.chip,
            {
              borderColor: isCustomActive ? colors.accent : colors.glassLight,
              backgroundColor: isCustomActive ? colors.accent : 'transparent',
              opacity: chipsDisabled && !isCustomActive ? 0.4 : 1,
            },
          ]}
          testID="stake-chip-custom"
        >
          <Text style={[styles.chipText, { color: isCustomActive ? '#ffffff' : colors.textPrimary }]}>
            {t('stakes.custom')}
          </Text>
        </Pressable>
      </View>
      {customOpen && !chipsDisabled && (
        <View style={styles.customRow}>
          <TextInput
            value={customDraft}
            onChangeText={(s) => setCustomDraft(s.replace(/[^0-9]/g, '').slice(0, 3))}
            onBlur={commitCustom}
            onSubmitEditing={commitCustom}
            keyboardType="number-pad"
            placeholder={t('stakes.customPlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={[styles.customInput, { color: colors.textPrimary, borderColor: colors.glassLight, backgroundColor: colors.background }]}
            maxLength={3}
            testID="stake-custom-input"
          />
          <Pressable
            onPress={commitCustom}
            style={[styles.customApply, { backgroundColor: colors.accent }]}
            testID="stake-custom-apply"
          >
            <Text style={{ color: '#ffffff', fontWeight: '700' }}>{t('stakes.apply')}</Text>
          </Pressable>
        </View>
      )}
      {stake > 0 && (
        <View style={styles.optInRow}>
          <Text style={[styles.optInLabel, { color: colors.textPrimary }]}>
            {t('stakes.optInToggle')}
          </Text>
          <Switch
            value={optedIn}
            onValueChange={(next) => onToggleOptIn(next)}
            disabled={!selfEligible || locked}
            testID="stake-optin-toggle"
          />
        </View>
      )}
      {stake > 0 && !selfEligible && !locked && (
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          {t('stakes.guestHint')}
        </Text>
      )}
      {locked && (
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          {t('stakes.lockedHint')}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { padding: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, marginBottom: Spacing.sm },
  label: { fontSize: 12, fontWeight: '600', marginBottom: Spacing.xs, textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: Radius.full, borderWidth: 1.5,
  },
  chipText: { fontSize: 14, fontWeight: '700' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm },
  customInput: {
    flex: 1, borderWidth: 1, borderRadius: Radius.md,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 14,
  },
  customApply: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.md },
  optInRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: Spacing.sm,
  },
  optInLabel: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 12, marginTop: 4, fontStyle: 'italic' },
});
