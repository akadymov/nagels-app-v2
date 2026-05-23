import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Switch, ActivityIndicator,
  Platform,
} from 'react-native';
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

  // Optimistic pending markers — the edge round-trip is ~600-900ms in prod
  // and without feedback the chip looks dead. We render an ActivityIndicator
  // over the pending value until the snapshot prop catches up.
  const [pendingStake, setPendingStake] = useState<number | null>(null);
  const [pendingOptIn, setPendingOptIn] = useState<boolean | null>(null);
  // We clear pending only after the prop changes — but a no-op press (clicking
  // the already-active value) would never trigger that, so guard with a ref.
  const lastSubmittedStake = useRef<number | null>(null);
  useEffect(() => {
    if (pendingStake !== null && stake === pendingStake) {
      setPendingStake(null);
    }
  }, [stake, pendingStake]);
  useEffect(() => {
    if (pendingOptIn !== null && optedIn === pendingOptIn) {
      setPendingOptIn(null);
    }
  }, [optedIn, pendingOptIn]);

  const submitStake = (next: number) => {
    if (next === stake) return;
    lastSubmittedStake.current = next;
    setPendingStake(next);
    onStakeChange(next);
  };

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
    submitStake(n);
  };

  // Match the rest of the app: brand blue (accent) for the "on" track,
  // matte gray for "off". Web defaults to a lime green that isn't used
  // anywhere else in the UI.
  const switchTrackColor = { false: colors.glassLight, true: colors.accent };
  const switchThumbColor = Platform.OS === 'web'
    ? '#ffffff'
    : optedIn ? '#ffffff' : '#f4f4f5';

  return (
    <View style={[styles.root, { borderColor: colors.glassLight, backgroundColor: colors.surface }]}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {t('stakes.title')}
      </Text>
      <View style={styles.chipRow}>
        {PRESETS.map((v) => {
          const active = stake === v && !isCustomActive;
          const isPending = pendingStake === v;
          const disabledThis = chipsDisabled || pendingStake !== null;
          return (
            <Pressable
              key={v}
              onPress={() => {
                if (disabledThis) return;
                setCustomOpen(false);
                submitStake(v);
              }}
              disabled={disabledThis}
              style={[
                styles.chip,
                {
                  borderColor: active || isPending ? colors.accent : colors.glassLight,
                  backgroundColor: active ? colors.accent : 'transparent',
                  opacity: chipsDisabled && !active ? 0.4 : 1,
                },
              ]}
              testID={`stake-chip-${v}`}
            >
              {isPending ? (
                <ActivityIndicator size="small" color={colors.accent} style={styles.chipSpinner} />
              ) : (
                <Text style={[styles.chipText, { color: active ? '#ffffff' : colors.textPrimary }]}>
                  {v === 0 ? t('stakes.off') : String(v)}
                </Text>
              )}
            </Pressable>
          );
        })}
        {/* Custom chip — toggles a numeric input alongside the chip row. */}
        {(() => {
          const isPending = pendingStake !== null && !PRESETS.includes(pendingStake);
          const disabledThis = chipsDisabled || pendingStake !== null;
          return (
            <Pressable
              onPress={() => {
                if (disabledThis) return;
                setCustomOpen((prev) => !prev);
              }}
              disabled={disabledThis}
              style={[
                styles.chip,
                {
                  borderColor: isCustomActive || isPending ? colors.accent : colors.glassLight,
                  backgroundColor: isCustomActive ? colors.accent : 'transparent',
                  opacity: chipsDisabled && !isCustomActive ? 0.4 : 1,
                },
              ]}
              testID="stake-chip-custom"
            >
              {isPending ? (
                <ActivityIndicator size="small" color={colors.accent} style={styles.chipSpinner} />
              ) : (
                <Text style={[styles.chipText, { color: isCustomActive ? '#ffffff' : colors.textPrimary }]}>
                  {t('stakes.custom')}
                </Text>
              )}
            </Pressable>
          );
        })()}
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
            editable={pendingStake === null}
            testID="stake-custom-input"
          />
          <Pressable
            onPress={commitCustom}
            disabled={pendingStake !== null}
            style={[styles.customApply, { backgroundColor: colors.accent, opacity: pendingStake !== null ? 0.5 : 1 }]}
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
          <View style={styles.optInControl}>
            {pendingOptIn !== null && (
              <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: 6 }} />
            )}
            <Switch
              value={optedIn}
              onValueChange={(next) => {
                setPendingOptIn(next);
                onToggleOptIn(next);
              }}
              disabled={!selfEligible || locked || pendingOptIn !== null}
              trackColor={switchTrackColor}
              thumbColor={switchThumbColor}
              ios_backgroundColor={colors.glassLight}
              {...(Platform.OS === 'web'
                ? ({ activeThumbColor: '#ffffff', activeTrackColor: colors.accent } as object)
                : {})}
              testID="stake-optin-toggle"
            />
          </View>
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
    minWidth: 50, alignItems: 'center', justifyContent: 'center',
  },
  chipText: { fontSize: 14, fontWeight: '700' },
  chipSpinner: { transform: [{ scale: 0.75 }] },
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
  optInControl: { flexDirection: 'row', alignItems: 'center' },
  optInLabel: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 12, marginTop: 4, fontStyle: 'italic' },
});
