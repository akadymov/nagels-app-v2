import React from 'react';
import { View, Text, Pressable, StyleSheet, Switch } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';

export interface StakeSelectorProps {
  stake: 0 | 1 | 5 | 10 | 25;
  isHost: boolean;
  isHostEligible: boolean;
  optedIn: boolean;
  selfEligible: boolean;
  locked: boolean;
  onStakeChange: (s: 0 | 1 | 5 | 10 | 25) => void;
  onToggleOptIn: (next: boolean) => void;
}

const VALUES: Array<0 | 1 | 5 | 10 | 25> = [0, 1, 5, 10, 25];

export const StakeSelector: React.FC<StakeSelectorProps> = ({
  stake, isHost, isHostEligible, optedIn, selfEligible, locked,
  onStakeChange, onToggleOptIn,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const chipsDisabled = !isHost || !isHostEligible || locked;

  return (
    <View style={[styles.root, { borderColor: colors.glassLight, backgroundColor: colors.surface }]}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {t('stakes.title')}
      </Text>
      <View style={styles.chipRow}>
        {VALUES.map((v) => {
          const active = stake === v;
          return (
            <Pressable
              key={v}
              onPress={() => !chipsDisabled && onStakeChange(v)}
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
      </View>
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
  optInRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: Spacing.sm,
  },
  optInLabel: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 12, marginTop: 4, fontStyle: 'italic' },
});
