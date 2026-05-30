/**
 * Nägels Online — Tricks Recorder
 *
 * Overlay rendered during the scorekeeper-mode hand phase 'tricks_recording'.
 * Each player enters how many tricks they took with a ± stepper. When
 * every seat has claimed AND the sum matches cards_per_player, the server
 * (record_tricks_action) moves the hand to 'scoring'. Mismatch → banner,
 * claims are preserved and players adjust their entry.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRoomStore } from '../../store/roomStore';
import { gameClient } from '../../lib/gameClient';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';
import { suitGlyph, suitLabelKey, TrumpSuit } from '../../lib/offline/handBriefing';

export interface TricksRecorderProps {
  visible: boolean;
}

export const TricksRecorder: React.FC<TricksRecorderProps> = ({ visible }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const snapshot = useRoomStore((s) => s.snapshot);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);

  const hand = snapshot?.current_hand ?? null;
  const handScores = snapshot?.hand_scores ?? [];
  const claimSessions = (snapshot?.claim_sessions ?? []) as string[];
  const players = snapshot?.players ?? [];

  const myScore = handScores.find((s) => s.session_id === myPlayerId);
  const myBet = myScore?.bet ?? 0;
  const iHaveClaimed = !!myPlayerId && claimSessions.includes(myPlayerId);
  const cardsPerPlayer = hand?.cards_per_player ?? 0;
  const handNumber = hand?.hand_number ?? 1;
  const trumpSuit = (hand?.trump_suit ?? 'notrump') as TrumpSuit;
  const trumpDisplay =
    trumpSuit === 'notrump'
      ? t('offline.briefing.noTrump')
      : `${suitGlyph(trumpSuit)} ${t(suitLabelKey(trumpSuit))}`;
  const firstName =
    players.find((p) => p.seat_index === (hand?.starting_seat ?? 0))?.display_name ?? '';

  // Local stepper value seeded from server taken_tricks (so reopens
  // show the last submitted value), capped to cards_per_player.
  const [draft, setDraft] = useState<number>(() => myScore?.taken_tricks ?? 0);
  const [submitting, setSubmitting] = useState(false);

  // Re-seed when the hand changes (new round → reset to 0).
  React.useEffect(() => {
    setDraft(myScore?.taken_tricks ?? 0);
  }, [hand?.id, myScore?.taken_tricks]);

  const allClaimed = claimSessions.length === players.length && players.length > 0;
  const sumClaimed = handScores.reduce((acc, s) => acc + (s.taken_tricks ?? 0), 0);
  const mismatch = allClaimed && sumClaimed !== cardsPerPlayer;

  const onSubmit = useCallback(async () => {
    if (!hand || !snapshot?.room?.id || submitting) return;
    setSubmitting(true);
    try {
      await gameClient.recordTricks(snapshot.room.id, hand.id, draft);
    } finally {
      setSubmitting(false);
    }
  }, [draft, hand, snapshot?.room?.id, submitting]);

  const dec = useCallback(() => setDraft((v) => Math.max(0, v - 1)), []);
  const inc = useCallback(
    () => setDraft((v) => Math.min(cardsPerPlayer, v + 1)),
    [cardsPerPlayer],
  );

  const summary = useMemo(() => {
    return players.map((p) => {
      const score = handScores.find((s) => s.session_id === p.session_id);
      const claimed = claimSessions.includes(p.session_id);
      return {
        sessionId: p.session_id,
        name: p.display_name,
        bet: score?.bet ?? 0,
        taken: claimed ? score?.taken_tricks ?? 0 : null,
      };
    });
  }, [players, handScores, claimSessions]);

  if (!visible || !hand) return null;

  return (
    <View style={[styles.overlay, { backgroundColor: colors.background }]} testID="tricks-recorder">
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t('scorekeeper.title')}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t('scorekeeper.subtitle', {
            handNumber,
            cards: cardsPerPlayer,
            bet: myBet,
          })}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]} testID="tricks-recorder-reminder">
          {t('offline.briefing.firstReminder', {
            trump: trumpDisplay,
            first: firstName,
          })}
        </Text>

        {mismatch && (
          <View
            style={[styles.banner, { backgroundColor: colors.warning + '22', borderColor: colors.warning }]}
            testID="tricks-recorder-mismatch"
          >
            <Text style={[styles.bannerTitle, { color: colors.warning }]}>
              {t('scorekeeper.mismatchTitle')}
            </Text>
            <Text style={[styles.bannerBody, { color: colors.textPrimary }]}>
              {t('scorekeeper.mismatchBody', {
                actual: sumClaimed,
                expected: cardsPerPlayer,
              })}
            </Text>
          </View>
        )}

        <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>
          {t('scorekeeper.yourTricks')}
        </Text>
        <View style={styles.stepper}>
          <Pressable
            onPress={dec}
            disabled={draft <= 0}
            testID="tricks-recorder-dec"
            style={[
              styles.stepBtn,
              { backgroundColor: colors.surface, borderColor: colors.glassLight },
              draft <= 0 && { opacity: 0.4 },
            ]}
          >
            <Text style={[styles.stepGlyph, { color: colors.textPrimary }]}>−</Text>
          </Pressable>
          <View style={[styles.stepValue, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
            <Text
              style={[styles.stepValueText, { color: colors.textPrimary }]}
              testID="tricks-recorder-value"
            >
              {draft}
            </Text>
          </View>
          <Pressable
            onPress={inc}
            disabled={draft >= cardsPerPlayer}
            testID="tricks-recorder-inc"
            style={[
              styles.stepBtn,
              { backgroundColor: colors.surface, borderColor: colors.glassLight },
              draft >= cardsPerPlayer && { opacity: 0.4 },
            ]}
          >
            <Text style={[styles.stepGlyph, { color: colors.textPrimary }]}>+</Text>
          </Pressable>
        </View>

        <Pressable
          style={[
            styles.submitBtn,
            { backgroundColor: colors.accent },
            submitting && { opacity: 0.6 },
          ]}
          onPress={onSubmit}
          disabled={submitting}
          testID="tricks-recorder-submit"
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.submitText}>{t('scorekeeper.submit')}</Text>
          )}
        </Pressable>

        {iHaveClaimed && !mismatch && (
          <Text style={[styles.waiting, { color: colors.textSecondary }]}>
            {t('scorekeeper.waitingForOthers')}
          </Text>
        )}

        <Text style={[styles.sectionLabel, { color: colors.textPrimary, marginTop: Spacing.lg }]}>
          {t('scorekeeper.summaryTitle')}
        </Text>
        <View style={[styles.summary, { borderColor: colors.glassLight }]}>
          {summary.map((row) => (
            <View
              key={row.sessionId}
              style={[styles.summaryRow, { borderBottomColor: colors.glassLight }]}
              testID={`tricks-summary-${row.sessionId}`}
            >
              <Text style={[styles.summaryName, { color: colors.textPrimary }]}>{row.name}</Text>
              <Text style={[styles.summaryBet, { color: colors.textSecondary }]}>
                {row.bet}
              </Text>
              <Text style={[styles.summaryTaken, { color: colors.textPrimary }]}>
                {row.taken === null ? t('scorekeeper.notClaimedYet') : row.taken}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 10,
  },
  scroll: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 14,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: Spacing.md,
  },
  banner: {
    borderWidth: 1.5,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  bannerTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  bannerBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  stepper: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtn: {
    width: 56, height: 56,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepGlyph: {
    fontSize: 28,
    fontWeight: '700',
  },
  stepValue: {
    minWidth: 80, height: 56,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  stepValueText: {
    fontSize: 28,
    fontWeight: '700',
  },
  submitBtn: {
    height: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  submitText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  waiting: {
    fontSize: 13,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  summary: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  summaryRow: {
    flexDirection: 'row',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    alignItems: 'center',
  },
  summaryName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  summaryBet: {
    width: 40,
    fontSize: 14,
    textAlign: 'right',
  },
  summaryTaken: {
    width: 40,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
});
