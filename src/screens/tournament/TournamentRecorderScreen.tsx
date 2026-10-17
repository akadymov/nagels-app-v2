/**
 * Offline tournament recorder: one phone per table. Claims the table room,
 * enters bets / tricks on behalf of the players, advances hands. Moves to the
 * next tour automatically on the same URL. No heartbeat / timers / chat.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';
import { gameClient } from '../../lib/gameClient';
import { useRoomStore } from '../../store/roomStore';
import { subscribeRoom, unsubscribeRoom } from '../../lib/realtimeBroadcast';
import { useTournamentState } from '../../lib/tournament/useTournamentState';
import { tableRows } from '../../lib/tournament/view';
import type { TournamentTable } from '../../lib/tournament/types';
import { OfflineHandBriefing } from '../../components/offline/OfflineHandBriefing';
import { TableBoard } from '../../components/tournament/TableBoard';
import { RecorderBetPad } from '../../components/tournament/RecorderBetPad';
import { RecorderTricks } from '../../components/tournament/RecorderTricks';
import { RecorderHands } from '../../components/tournament/RecorderHands';

interface Props { code: string; tableNumber: number; secret: string; onExit: () => void }

export const TournamentRecorderScreen: React.FC<Props> = ({ code, tableNumber, secret, onExit }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const snapshot = useRoomStore((s) => s.snapshot);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [showBoard, setShowBoard] = useState(false);
  const [showHands, setShowHands] = useState(false);
  // Someone else is already recording this table: watch until the user
  // explicitly confirms the takeover (scanning the TV's small QR).
  const [confirmTakeover, setConfirmTakeover] = useState(false);
  const [busy, setBusy] = useState(false);
  const claimSeq = useRef(0);
  const claimedTour = useRef<number | null>(null);
  const roomIdRef = useRef<string | undefined>(undefined);

  const { data } = useTournamentState(code, { roomChannels: false });

  const claim = useCallback(async (fresh: boolean): Promise<boolean> => {
    const seq = ++claimSeq.current;
    if (fresh) useRoomStore.getState().reset();
    setClaimError(null);
    try {
      const r = await gameClient.tournamentClaimTable(code, tableNumber, secret);
      if (seq !== claimSeq.current) return false;
      if (r.ok) {
        roomIdRef.current = r.room_id;
        subscribeRoom(r.room_id);
        claimedTour.current = r.state?.room?.tour_number ?? claimedTour.current;
        return true;
      }
      setClaimError(r.error ?? 'generic');
    } catch (e: any) {
      if (seq === claimSeq.current) setClaimError(e?.message ?? 'generic');
    }
    return false;
  }, [code, tableNumber, secret]);

  // A reload of the recording phone continues silently; any other phone only
  // watches until the takeover is confirmed. A failed pre-check never claims.
  const start = useCallback(async () => {
    const seq = ++claimSeq.current;
    setClaimError(null);
    try {
      const [ts, me] = await Promise.all([
        gameClient.getTournamentState(code), gameClient.getMySessionId(),
      ]);
      if (seq !== claimSeq.current) return;
      const tb = ts?.tables.find((x) => x.table_number === tableNumber);
      const host = tb?.state?.room?.host_session_id;
      if (ts && tb?.claimed && host && host !== me) {
        useRoomStore.getState().reset();
        roomIdRef.current = tb.room_id;
        claimedTour.current = ts.tournament.current_tour;
        subscribeRoom(tb.room_id);
        setConfirmTakeover(true);
        return;
      }
    } catch (e: any) {
      if (seq === claimSeq.current) setClaimError(e?.message ?? 'generic');
      return;
    }
    void claim(true);
  }, [claim, code, tableNumber]);

  useEffect(() => {
    void start();
    return () => { claimSeq.current++; unsubscribeRoom(); };
  }, [start]);

  const [confirming, setConfirming] = useState(false);
  const confirmClaim = async () => {
    if (confirming) return;
    setConfirming(true);
    try {
      if (await claim(false)) {
        setConfirmTakeover(false);
        setPendingRoomId(null);
      }
    } finally {
      setConfirming(false);
    }
  };

  // Follow the tournament to the next tour on the same QR/URL.
  const currentTour = data?.tournament.current_tour;
  const tourTables = data?.tables ?? [];
  const tourTable = tourTables.find((tb) => tb.table_number === tableNumber);
  const tourRoomId = tourTable?.room_id ?? '';
  // Derived, never latched: start_tour creates rooms table by table.
  const missingTour =
    currentTour != null && claimedTour.current != null && currentTour !== claimedTour.current
      && tourTables.length > 0 && !tourTable
      ? currentTour : null;

  const room = snapshot?.room ?? null;
  const hand = snapshot?.current_hand ?? null;
  const takenOver = !!room && !!myPlayerId && room.host_session_id !== myPlayerId;
  // A new tour's table this phone did not auto-claim (it was taken over, or
  // someone else already claimed the new table). Shows the Take back screen.
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);
  // The hands modal only belongs to the live recorder view.
  useEffect(() => {
    if (takenOver || pendingRoomId || confirmTakeover) setShowHands(false);
  }, [takenOver, pendingRoomId, confirmTakeover]);

  useEffect(() => {
    if (currentTour == null || claimedTour.current == null) return;
    if (!tourRoomId || tourRoomId === roomIdRef.current || tourRoomId === pendingRoomId) return;
    // Only the phone that was actually recording the old table follows the
    // tour automatically, and only onto a table nobody has claimed yet —
    // otherwise a reseated player's leftover phone would steal the table.
    const wasHost = !pendingRoomId && !!room && !!myPlayerId && room.host_session_id === myPlayerId;
    claimedTour.current = currentTour;
    unsubscribeRoom();
    if (wasHost && tourTable?.claimed === false) {
      setPendingRoomId(null);
      void claim(true);
    } else {
      claimSeq.current++;
      useRoomStore.getState().reset();
      setPendingRoomId(tourRoomId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTour + ':' + tourRoomId]);

  const takeBackPending = () => {
    setPendingRoomId(null);
    void claim(true);
  };

  const liveTable: TournamentTable | null = snapshot && room
    ? (data?.tables.find((tb) => tb.table_number === tableNumber && tb.room_id === room.id)
        ? { ...data!.tables.find((tb) => tb.table_number === tableNumber)!, state: snapshot }
        : { table_number: tableNumber, room_id: room.id, stake: room.stake, claimed: true, state: snapshot })
    : null;

  const Centered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <View testID="tournament-recorder" style={[styles.center, { backgroundColor: colors.background }]}>{children}</View>
  );

  const exitBtn = (
    <TouchableOpacity testID="recorder-exit" onPress={onExit} style={[styles.btn, { borderColor: colors.glassLight, borderWidth: 1 }]}>
      <Text style={{ color: colors.textPrimary, fontSize: 16 }}>✕</Text>
    </TouchableOpacity>
  );

  if (missingTour !== null) {
    return (
      <Centered>
        <Text style={[styles.msg, { color: colors.textPrimary }]}>
          {t('tournament.tableNotInTour', { n: tableNumber, tour: missingTour })}
        </Text>
        {exitBtn}
      </Centered>
    );
  }
  if (claimError) {
    return (
      <Centered>
        <Text style={[styles.msg, { color: colors.error }]}>
          {t(`tournament.errors.${claimError}`, { defaultValue: t('tournament.errors.generic') })}
        </Text>
        <TouchableOpacity testID="recorder-retry" onPress={() => { void start(); }} style={[styles.primary, { backgroundColor: colors.accent }]}>
          <Text style={styles.primaryText}>{t('common.retry')}</Text>
        </TouchableOpacity>
        {exitBtn}
      </Centered>
    );
  }
  if (confirmTakeover) {
    const watched = snapshot?.room ? { table_number: tableNumber, room_id: snapshot.room.id,
      stake: snapshot.room.stake, claimed: true, state: snapshot } as TournamentTable : null;
    return (
      <ScrollView testID="tournament-recorder" style={{ backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
        <View testID="recorder-confirm-takeover" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.msg, { color: colors.textPrimary }]}>{t('tournament.takeOverTitle', { n: tableNumber })}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{t('tournament.takeOverBody')}</Text>
          <TouchableOpacity testID="recorder-confirm-takeover-yes" disabled={confirming} onPress={confirmClaim} style={[styles.primary, { backgroundColor: colors.accent, opacity: confirming ? 0.5 : 1 }]}>
            <Text style={styles.primaryText}>{t('tournament.takeOver')}</Text>
          </TouchableOpacity>
          <Text style={[styles.body, { color: colors.textSecondary, marginTop: Spacing.md }]}>{t('tournament.watchOnlyHint')}</Text>
        </View>
        {watched && <TableBoard table={watched} size="phone" />}
        {exitBtn}
      </ScrollView>
    );
  }
  if (pendingRoomId) {
    const pendingTable = tourTable && tourTable.room_id === pendingRoomId ? tourTable : null;
    return (
      <ScrollView testID="tournament-recorder" style={{ backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
        <View testID="recorder-taken-over" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.msg, { color: colors.textPrimary }]}>{t('tournament.takenOver')}</Text>
          <TouchableOpacity testID="recorder-take-back" onPress={takeBackPending} style={[styles.primary, { backgroundColor: colors.accent }]}>
            <Text style={styles.primaryText}>{t('tournament.takeBack')}</Text>
          </TouchableOpacity>
        </View>
        {pendingTable && <TableBoard table={pendingTable} size="phone" />}
        {exitBtn}
      </ScrollView>
    );
  }
  if (!snapshot || !room) {
    return (
      <Centered>
        <Text style={{ color: colors.textSecondary }}>{t('tournament.reconnecting')}</Text>
      </Centered>
    );
  }

  const onNext = async () => {
    if (busy || !hand) return;
    setBusy(true);
    try { await gameClient.continueHand(room.id, hand.id); } finally { setBusy(false); }
  };

  const board = liveTable && <TableBoard table={liveTable} size="phone" />;

  if (takenOver) {
    return (
      <ScrollView testID="tournament-recorder" style={{ backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
        <View testID="recorder-taken-over" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}>
          <Text style={[styles.msg, { color: colors.textPrimary }]}>{t('tournament.takenOver')}</Text>
          <TouchableOpacity testID="recorder-take-back" onPress={() => claim(false)} style={[styles.primary, { backgroundColor: colors.accent }]}>
            <Text style={styles.primaryText}>{t('tournament.takeBack')}</Text>
          </TouchableOpacity>
        </View>
        {board}
      </ScrollView>
    );
  }

  const rows = tableRows(snapshot);

  return (
    <View testID="tournament-recorder" style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.topBar}>
        <Text style={[styles.topTitle, { color: colors.textPrimary }]}>{t('tournament.table', { n: tableNumber })}</Text>
        <TouchableOpacity testID="recorder-hands-toggle" onPress={() => setShowHands(true)} style={styles.btn}>
          <Text style={{ color: colors.accent, fontSize: 16 }}>{t('tournament.hands')}</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="recorder-board-toggle" onPress={() => setShowBoard(true)} style={styles.btn}>
          <Text style={{ color: colors.accent, fontSize: 16 }}>{t('tournament.showBoard')}</Text>
        </TouchableOpacity>
        {exitBtn}
      </View>
      <ScrollView contentContainerStyle={styles.pad}>
        {room.phase === 'finished' ? (
          <>
            <Text style={[styles.msg, { color: colors.textPrimary }]}>{t('tournament.finished')}</Text>
            {board}
          </>
        ) : (
          <>
            <OfflineHandBriefing />
            {hand?.phase === 'betting' && <RecorderBetPad state={snapshot} />}
            {hand?.phase === 'tricks_recording' && <RecorderTricks state={snapshot} />}
            {hand?.phase === 'scoring' && (
              <View style={styles.pad}>
                {rows.map((r) => (
                  <View key={r.seat} style={styles.resRow}>
                    <Text style={[styles.resName, { color: colors.textPrimary }]} numberOfLines={1}>{r.name}</Text>
                    <Text style={[styles.resNum, { color: colors.textSecondary }]}>{r.bet ?? '—'}</Text>
                    <Text style={[styles.resNum, { color: colors.textSecondary }]}>{r.taken ?? '—'}</Text>
                    <Text style={[styles.resNum, { color: colors.textPrimary, fontWeight: '700' }]}>{r.hand_score ?? '—'}</Text>
                  </View>
                ))}
                <TouchableOpacity
                  testID="recorder-next-hand"
                  disabled={busy}
                  onPress={onNext}
                  style={[styles.primary, { backgroundColor: colors.accent, opacity: busy ? 0.5 : 1 }]}
                >
                  <Text style={styles.primaryText}>{t('tournament.nextHand')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </ScrollView>
      <Modal visible={showHands} animationType="slide" onRequestClose={() => setShowHands(false)}>
        <ScrollView style={{ flex: 1, backgroundColor: colors.background }} keyboardShouldPersistTaps="handled">
          <RecorderHands state={snapshot} onDone={() => setShowHands(false)} />
        </ScrollView>
      </Modal>
      <Modal visible={showBoard} transparent animationType="fade" onRequestClose={() => setShowBoard(false)}>
        <View style={styles.modalBg}>
          <ScrollView contentContainerStyle={styles.pad}>
            {board}
            <TouchableOpacity onPress={() => setShowBoard(false)} style={[styles.primary, { backgroundColor: colors.accent }]}>
              <Text style={styles.primaryText}>✕</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  pad: { padding: Spacing.md, gap: Spacing.md },
  msg: { fontSize: 18, fontWeight: '600', textAlign: 'center', marginBottom: Spacing.md },
  body: { fontSize: 16, textAlign: 'center', lineHeight: 22 },
  card: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, width: '100%' },
  topBar: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, gap: Spacing.sm },
  topTitle: { flex: 1, fontSize: 18, fontWeight: '700' },
  btn: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.sm, borderRadius: Radius.md },
  primary: { minHeight: 56, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg, marginTop: Spacing.md },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  resRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  resName: { flex: 1, fontSize: 18 },
  resNum: { width: 48, textAlign: 'right', fontSize: 18 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center' },
});
