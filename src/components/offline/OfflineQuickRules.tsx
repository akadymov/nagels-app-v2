/**
 * Nägels Online — Offline Quick Rules
 *
 * Collapsible "quick rules" reminder shared by the offline (scorekeeper)
 * screens: the hand briefing (betting) and the tricks recorder. Single
 * source of truth for the rule list and its toggle UI.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { Spacing } from '../../constants';

const RULE_KEYS = [
  'offline.rules.bets',
  'offline.rules.follow',
  'offline.rules.trumpBeats',
  'offline.rules.noDumpTrump',
  'offline.rules.jackException',
  'offline.rules.scoring',
];

export const OfflineQuickRules: React.FC = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => setOpen((v) => !v)} testID="offline-rules-toggle">
        <Text style={[styles.toggle, { color: colors.accent }]}>
          {open ? '▾ ' : '▸ '}{t('offline.briefing.rulesToggle')}
        </Text>
      </Pressable>
      {open && (
        <View style={styles.rules} testID="offline-rules-list">
          {RULE_KEYS.map((k) => (
            <Text key={k} style={[styles.ruleItem, { color: colors.textSecondary }]}>
              •  {t(k)}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    marginTop: Spacing.xs,
  },
  toggle: {
    fontSize: 14,
    fontWeight: '600',
  },
  rules: {
    gap: 4,
    marginTop: 2,
  },
  ruleItem: {
    fontSize: 13,
    lineHeight: 18,
  },
});
