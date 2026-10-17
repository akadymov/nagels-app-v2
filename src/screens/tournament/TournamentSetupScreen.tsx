/**
 * Offline tournament admin: create a tournament, manage participants, set
 * per-table stakes, pin people to tables, shuffle, fix seating by hand and
 * start tours. Navigation lives elsewhere (props only).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';
import { gameClient } from '../../lib/gameClient';
import { useTournamentState } from '../../lib/tournament/useTournamentState';
import { shuffleSeating, validateSeating, defaultMaxCards, STAKE_CHIPS } from '../../lib/tournament';
import { parseParticipants, moveParticipant } from '../../lib/tournament/setupDraft';
import { TableBoard } from '../../components/tournament/TableBoard';
import { Leaderboard } from '../../components/tournament/Leaderboard';

interface Props {
  code?: string;
  secret?: string;
  initialTableCount?: number;
  onCreated?: (r: { code: string; secret: string; tableCount: number }) => void;
}

const MAX_TABLES = 4;

function evenSizes(n: number, tables: number): number[] {
  const base = Math.floor(n / tables);
  const extra = n % tables;
  return Array.from({ length: tables }, (_, i) => base + (i < extra ? 1 : 0));
}

function origin(): string {
  try {
    return typeof window !== 'undefined' && window.location ? window.location.origin : '';
  } catch {
    return '';
  }
}

export const TournamentSetupScreen: React.FC<Props> = ({ code, secret, initialTableCount, onCreated }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const isAdmin = !!code && !!secret;

  const [tableCount, setTableCount] = useState(Math.min(MAX_TABLES, Math.max(1, initialTableCount ?? 2)));
  const [error, setError] = useState<string | null>(null);
  const errText = (e: string | null | undefined) => {
    if (!e) return null;
    const key = `tournament.errors.${e}`;
    const s = t(key);
    return s === key ? t('tournament.errors.generic') : s;
  };

  const card = { backgroundColor: colors.surface, borderColor: colors.glassLight };
  const input = { color: colors.textPrimary, borderColor: colors.glassLight, backgroundColor: colors.background };

  const Stepper: React.FC<{ id: string; value: number; min: number; max: number; onChange: (v: number) => void }> = ({ id, value, min, max, onChange }) => (
    <View style={styles.row}>
      <TouchableOpacity testID={`${id}-dec`} disabled={value <= min} onPress={() => onChange(value - 1)}
        style={[styles.step, { borderColor: colors.glassLight, opacity: value <= min ? 0.4 : 1 }]}>
        <Text style={{ color: colors.textPrimary, fontSize: 18 }}>−</Text>
      </TouchableOpacity>
      <Text testID={id} style={[styles.stepVal, { color: colors.textPrimary }]}>{value}</Text>
      <TouchableOpacity testID={`${id}-inc`} disabled={value >= max} onPress={() => onChange(value + 1)}
        style={[styles.step, { borderColor: colors.glassLight, opacity: value >= max ? 0.4 : 1 }]}>
        <Text style={{ color: colors.textPrimary, fontSize: 18 }}>+</Text>
      </TouchableOpacity>
    </View>
  );

  const Btn: React.FC<{ id: string; label: string; onPress: () => void; disabled?: boolean }> = ({ id, label, onPress, disabled }) => (
    <TouchableOpacity testID={id} onPress={onPress} disabled={disabled}
      style={[styles.primary, { backgroundColor: colors.accent, opacity: disabled ? 0.5 : 1 }]}>
      <Text style={styles.primaryText}>{label}</Text>
    </TouchableOpacity>
  );

  // ---------------------------------------------------------------- create mode
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const participants = parseParticipants(text);
    if (!name.trim() || participants.length < 2) { setError('invalid_participants'); return; }
    setBusy(true); setError(null);
    try {
      const sizes = evenSizes(participants.length, tableCount);
      const r = await gameClient.tournamentCreate(name.trim(), participants, defaultMaxCards(sizes));
      if (r?.ok) onCreated?.({ code: r.code, secret: r.secret, tableCount });
      else setError(r?.error ?? 'generic');
    } catch (e: any) {
      setError(e?.message ?? 'generic');
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------- admin mode
  const { data, refetch } = useTournamentState(isAdmin ? code : undefined);
  const participants = data?.participants ?? [];
  const tables = data?.tables ?? [];
  const hasTour = tables.length > 0;
  const allFinished = hasTour && tables.every((tb) => tb.state?.room?.phase === 'finished');
  const tourInProgress = hasTour && !allFinished;

  const [pText, setPText] = useState('');
  const [pOpen, setPOpen] = useState(false);
  const prefilled = useRef(false);
  useEffect(() => {
    if (!data || prefilled.current) return;
    prefilled.current = true;
    setPText(data.participants.map((p) => p.display_name + (p.no_stakes ? ' -' : '')).join('\n'));
  }, [data]);

  const [stakes, setStakes] = useState<number[]>(() => Array(tableCount).fill(0));
  const [pins, setPins] = useState<Record<string, number>>({});
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[][] | null>(null);
  const [forceOpen, setForceOpen] = useState(false);
  const [links, setLinks] = useState<number[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const changeTableCount = (n: number) => {
    setTableCount(n);
    setStakes((s) => Array.from({ length: n }, (_, i) => s[i] ?? 0));
    setPins((p) => Object.fromEntries(Object.entries(p).filter(([, ti]) => ti < n)));
    setPreview(null); setMoveFor(null); setPinFor(null);
  };

  const setStake = (i: number, v: number) => {
    const next = stakes.map((s, j) => (j === i ? v : s));
    setStakes(next);
    if (preview && validateSeating(preview, participants, next) !== null) setPreview(null);
  };

  const sizes = useMemo(
    () => evenSizes(participants.length, Math.max(1, tableCount)),
    [participants.length, tableCount],
  );
  const hintMax = defaultMaxCards(sizes);

  const copy = async (key: string, value: string) => {
    try { await Clipboard.setStringAsync(value); setCopied(key); setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500); } catch { /* ignore */ }
  };

  const savePeople = async () => {
    if (!data) return;
    setError(null);
    const r = await gameClient.tournamentUpdateParticipants(data.tournament.id, secret!, parseParticipants(pText));
    if (r?.ok) { setPreview(null); setPins({}); void refetch(); } else setError(r?.error ?? 'generic');
  };

  const setMax = async (v: number) => {
    if (!data) return;
    setError(null);
    const r = await gameClient.tournamentSetMaxCards(data.tournament.id, secret!, v);
    if (r?.ok) void refetch(); else setError(r?.error ?? 'generic');
  };

  const shuffle = () => {
    setError(null); setMoveFor(null); setLinks(null);
    const r = shuffleSeating({ participants, stakes, pins });
    if (r.ok) setPreview(r.tables); else { setPreview(null); setError(r.reason); }
  };

  const move = (pid: string, to: number) => {
    if (!preview) return;
    const next = moveParticipant(preview, pid, to);
    setMoveFor(null);
    const bad = validateSeating(next, participants, stakes);
    if (bad) setError(bad); else { setError(null); setPreview(next); }
  };

  const startTour = async () => {
    if (!data || !preview) return;
    setBusy(true); setError(null);
    try {
      const r = await gameClient.tournamentStartTour(
        data.tournament.id, secret!, preview.map((seats, i) => ({ seats, stake: stakes[i] })), forceOpen,
      );
      if (r?.ok) {
        setLinks(preview.map((_, i) => i + 1));
        setPreview(null); setForceOpen(false);
        void refetch();
      } else setError(r?.error ?? 'generic');
    } catch (e: any) {
      setError(e?.message ?? 'generic');
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (pid: string) => participants.find((p) => p.id === pid)?.display_name ?? '?';
  const abs = (path: string) => `${origin()}${path}`;
  const errorView = error ? (
    <Text testID="tournament-error" style={[styles.err, { color: colors.error }]}>{errText(error)}</Text>
  ) : null;

  if (!isAdmin) {
    return (
      <ScrollView testID="tournament-setup" style={{ backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t('tournament.newTitle')}</Text>
        <Text style={[styles.label, { color: colors.textSecondary }]}>{t('tournament.name')}</Text>
        <TextInput testID="tournament-name" value={name} onChangeText={setName} maxLength={60}
          placeholderTextColor={colors.textSecondary} style={[styles.input, input]} />
        <Text style={[styles.label, { color: colors.textSecondary }]}>{t('tournament.participants')}</Text>
        <TextInput testID="tournament-participants" value={text} onChangeText={setText} multiline
          placeholder={t('tournament.participantsHint')} placeholderTextColor={colors.textSecondary}
          style={[styles.input, styles.area, input]} />
        <Text style={[styles.label, { color: colors.textSecondary }]}>{t('tournament.tables')}</Text>
        <Stepper id="tournament-table-count" value={tableCount} min={1} max={MAX_TABLES} onChange={setTableCount} />
        {errorView}
        <Btn id="tournament-create" label={t('tournament.create')} onPress={create} disabled={busy} />
      </ScrollView>
    );
  }

  const showSetup = !hasTour || allFinished || forceOpen;
  const nextTour = (data?.tournament.current_tour ?? 0) + 1;
  const tvPath = `/tournament/${code}/tv?k=${secret}`;
  const adminPath = `/tournament/${code}/admin?k=${secret}&t=${tableCount}`;

  const LinkRow: React.FC<{ id?: string; label: string; path: string }> = ({ id, label, path }) => (
    <View style={styles.linkRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
        <Text testID={id} selectable style={{ color: colors.textPrimary, fontSize: 12 }}>{abs(path)}</Text>
      </View>
      <TouchableOpacity onPress={() => copy(path, abs(path))} style={[styles.chip, { borderColor: colors.glassLight }]}>
        <Text style={{ color: colors.textPrimary }}>{copied === path ? t('tournament.copied') : t('tournament.copy')}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView testID="tournament-setup" style={{ backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <View style={[styles.card, card]}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{data?.tournament.name ?? ''}</Text>
        <Text style={{ color: colors.textSecondary }}>
          {code}{data && data.tournament.current_tour > 0 ? ` · ${t('tournament.tour', { n: data.tournament.current_tour })}` : ''}
        </Text>
        <LinkRow id="tournament-tv-link" label={t('tournament.tvLink')} path={tvPath} />
        <LinkRow label={t('tournament.adminLink')} path={adminPath} />
      </View>

      <View style={[styles.card, card]}>
        <TouchableOpacity onPress={() => setPOpen((o) => !o)}>
          <Text style={[styles.section, { color: colors.textPrimary }]}>
            {t('tournament.participantsPanel')} ({participants.length}) {pOpen ? '▾' : '▸'}
          </Text>
        </TouchableOpacity>
        {pOpen && (
          <>
            <TextInput testID="tournament-participants" value={pText} onChangeText={setPText} multiline
              editable={!tourInProgress} placeholder={t('tournament.participantsHint')}
              placeholderTextColor={colors.textSecondary} style={[styles.input, styles.area, input]} />
            <Btn id="tournament-save-participants" label={t('tournament.save')} onPress={savePeople} disabled={tourInProgress} />
          </>
        )}
        <Text style={[styles.label, { color: colors.textSecondary }]}>{t('tournament.maxCards')} ({hintMax})</Text>
        <Stepper id="tournament-max-cards" value={data?.tournament.max_cards ?? hintMax} min={1} max={10} onChange={setMax} />
      </View>

      {hasTour && !showSetup && (
        <View style={[styles.card, card]}>
          <Text style={{ color: colors.textPrimary }}>{t('tournament.tourInProgress')}</Text>
          <Btn id="tournament-next-tour" label={t('tournament.nextTour')} onPress={() => setForceOpen(true)} />
        </View>
      )}

      {showSetup && (
        <View style={[styles.card, card]}>
          <Text style={[styles.section, { color: colors.textPrimary }]}>{t('tournament.startTour', { n: nextTour })}</Text>
          <Text style={[styles.label, { color: colors.textSecondary }]}>{t('tournament.tables')}</Text>
          <Stepper id="tournament-table-count" value={tableCount} min={1} max={MAX_TABLES} onChange={changeTableCount} />

          {stakes.map((s, i) => (
            <View key={i} style={{ marginTop: Spacing.sm }}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>{t('tournament.table', { n: i + 1 })} · {t('tournament.stake')}</Text>
              <View style={styles.wrap}>
                {STAKE_CHIPS.map((chip) => (
                  <TouchableOpacity key={chip} testID={`tournament-stake-${i}-${chip}`} onPress={() => setStake(i, chip)}
                    style={[styles.chip, { borderColor: colors.glassLight }, s === chip && { backgroundColor: colors.accent }]}>
                    <Text style={{ color: s === chip ? '#fff' : colors.textPrimary }}>{chip === 0 ? t('tournament.stakeNone') : chip}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}

          <Text style={[styles.label, { color: colors.textSecondary, marginTop: Spacing.md }]}>{t('tournament.pin')}</Text>
          <View style={styles.wrap}>
            {participants.map((p) => (
              <TouchableOpacity key={p.id} testID={`tournament-pin-${p.id}`} onPress={() => setPinFor(pinFor === p.id ? null : p.id)}
                style={[styles.chip, { borderColor: colors.glassLight }, p.id in pins && { backgroundColor: colors.accent }]}>
                <Text style={{ color: p.id in pins ? '#fff' : colors.textPrimary }}>
                  {p.display_name}{p.no_stakes ? ' -' : ''}{p.id in pins ? ` → ${pins[p.id] + 1}` : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {pinFor && (
            <View style={styles.wrap}>
              <TouchableOpacity style={[styles.chip, { borderColor: colors.glassLight }]}
                onPress={() => { setPins((p) => { const n = { ...p }; delete n[pinFor]; return n; }); setPinFor(null); }}>
                <Text style={{ color: colors.textPrimary }}>{t('tournament.unpinned')}</Text>
              </TouchableOpacity>
              {stakes.map((_, i) => (
                <TouchableOpacity key={i} style={[styles.chip, { borderColor: colors.glassLight }]}
                  onPress={() => { setPins((p) => ({ ...p, [pinFor]: i })); setPinFor(null); }}>
                  <Text style={{ color: colors.textPrimary }}>{i + 1}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Btn id="tournament-shuffle" label={t('tournament.shuffle')} onPress={shuffle} />
          {errorView}

          {preview && preview.map((seats, i) => (
            <View key={i} testID={`tournament-preview-${i}`} style={[styles.card, { backgroundColor: colors.background, borderColor: colors.glassLight }]}>
              <Text style={[styles.section, { color: colors.textPrimary }]}>
                {t('tournament.table', { n: i + 1 })}{stakes[i] > 0 ? ` · ${t('tournament.stakeUnits', { stake: stakes[i] })}` : ''}
              </Text>
              <View style={styles.wrap}>
                {seats.map((pid) => (
                  <TouchableOpacity key={pid} onPress={() => setMoveFor(moveFor === pid ? null : pid)}
                    style={[styles.chip, { borderColor: colors.glassLight }, moveFor === pid && { backgroundColor: colors.accent }]}>
                    <Text style={{ color: moveFor === pid ? '#fff' : colors.textPrimary }}>{nameOf(pid)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {moveFor && seats.includes(moveFor) && (
                <View style={styles.wrap}>
                  <Text style={{ color: colors.textSecondary, alignSelf: 'center' }}>{t('tournament.moveTo')}</Text>
                  {preview.map((_, j) => j !== i && (
                    <TouchableOpacity key={j} style={[styles.chip, { borderColor: colors.glassLight }]} onPress={() => move(moveFor, j)}>
                      <Text style={{ color: colors.textPrimary }}>{j + 1}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          ))}

          {preview && (
            <Btn id="tournament-start-tour" label={t('tournament.startTour', { n: nextTour })} onPress={startTour} disabled={busy} />
          )}
        </View>
      )}

      {links && (
        <View style={[styles.card, card]}>
          <Text style={[styles.section, { color: colors.textPrimary }]}>{t('tournament.tableLinks')}</Text>
          {links.map((n) => (
            <LinkRow key={n} label={t('tournament.table', { n })} path={`/tournament/${code}/table/${n}?k=${secret}`} />
          ))}
        </View>
      )}

      {hasTour && (
        <View style={[styles.card, card]}>
          <Text style={[styles.section, { color: colors.textPrimary }]}>{t('tournament.currentTour')}</Text>
          {tables.map((tb) => <TableBoard key={tb.room_id} table={tb} size="phone" />)}
          {data && <Leaderboard state={data} />}
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  pad: { padding: Spacing.md, gap: Spacing.md },
  card: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  title: { fontSize: 22, fontWeight: '700' },
  section: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 13, marginTop: Spacing.xs },
  input: { borderWidth: 1, borderRadius: Radius.sm, padding: Spacing.sm, fontSize: 16 },
  area: { minHeight: 140, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  step: { width: 40, height: 40, borderWidth: 1, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  stepVal: { fontSize: 18, fontWeight: '600', minWidth: 24, textAlign: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  primary: { borderRadius: Radius.md, paddingVertical: 12, alignItems: 'center', marginTop: Spacing.sm },
  primaryText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  err: { fontSize: 14, marginTop: Spacing.xs },
});
