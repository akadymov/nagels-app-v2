# Offline Game Instructions + Player-Count Copy Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a personalised, collapsible "how to run this hand" briefing (seating, dealer, cards, trump, first player, quick rules) to scorekeeper (offline) games, and fix the "0 игрока" label above the bot-game player selector.

**Architecture:** A self-gating presentational component `<OfflineHandBriefing>` reads the live room snapshot from `useRoomStore`, derives the dealer and play order via pure helpers, and renders only when `room.mode === 'scorekeeper'`. It is mounted at the top of the betting screen; a one-line trump/first reminder is added to the tricks recorder. Collapse state persists in `settingsStore`. The bug fix is a one-line default change in `LobbyScreen`.

**Tech Stack:** Expo / React Native + TypeScript, Zustand (`useRoomStore`, `useSettingsStore`), react-i18next (EN/RU/ES/FR), Jest (ts-jest) for unit tests.

**Spec:** `docs/superpowers/specs/2026-05-30-offline-game-instructions-design.md`

---

## File Structure

- `src/screens/LobbyScreen.tsx` — **modify** (bug fix: default player count = 4)
- `src/i18n/locales/{en,ru,es,fr}.json` — **modify** (new `offline.*` namespace; reuse existing `trumps.*` for suit names)
- `src/lib/offline/handBriefing.ts` — **create** (pure helpers: dealer seat, play order, suit glyph/label-key)
- `src/lib/offline/__tests__/handBriefing.test.ts` — **create** (unit test for the helpers)
- `src/store/settingsStore.ts` — **modify** (persisted `offlineBriefingExpanded` boolean)
- `src/components/offline/OfflineHandBriefing.tsx` — **create** (the briefing card)
- `src/components/betting/BettingPhase.tsx` — **modify** (mount the briefing)
- `src/components/scorekeeper/TricksRecorder.tsx` — **modify** (one-line trump/first reminder)

**Key facts locked from code review:**
- Play is counter-clockwise by **decreasing** seat index: `getNextPlayerIndex = (i + N − 1) % N` (`supabase/functions/_shared/engine/rules.ts:618`). First player = `current_hand.starting_seat`.
- Dealer (new, derived — no engine concept): `dealerSeat = (starting_seat + 1) % player_count`.
- Card count is **read from `current_hand.cards_per_player`** (already honours `min_cards_per_hand` floor=2). Never recompute the ladder client-side.
- Trump is announced by the app (deterministic rotation), value in `current_hand.trump_suit` ∈ `diamonds|hearts|clubs|spades|notrump`.
- Suit glyphs already exist: `SuitSymbols` in `src/constants/colors.ts`. Localised suit names already exist under the `trumps.*` i18n namespace (incl. `trumps.notrump`).

---

## Task 1: Bug fix — default bot-game player count to 4

**Files:**
- Modify: `src/screens/LobbyScreen.tsx:148`

- [ ] **Step 1: Change the default**

In `src/screens/LobbyScreen.tsx`, line 148 currently reads:

```tsx
  const [playerCount, setPlayerCount] = useState<number | null>(null);
```

Change it to:

```tsx
  const [playerCount, setPlayerCount] = useState<number | null>(4);
```

This makes the "Боты" tab open with 4 players pre-selected, so `lobby.playerCount` (line 575: `{t('lobby.playerCount', { count: playerCount ?? 0 })}`) renders "4 игрока" instead of "0 игрока", and `canStartMatch` (line 249) then depends only on difficulty. No i18n change needed.

- [ ] **Step 2: Verify the change**

Run: `grep -n "useState<number | null>(4)" src/screens/LobbyScreen.tsx`
Expected: one match on line 148.

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i lobbyscreen || echo "no LobbyScreen type errors"`
Expected: `no LobbyScreen type errors`.

- [ ] **Step 3: Commit**

```bash
git add src/screens/LobbyScreen.tsx
git commit -m "fix(lobby): default bot-game player count to 4 (no more '0 игрока')

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: i18n — add the `offline.*` namespace to all four locales

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/es.json`
- Modify: `src/i18n/locales/fr.json`

In each file, insert a new top-level `"offline"` object **immediately after the closing `}` of the existing top-level `"trumps"` block** (find it with `grep -n '"trumps"' src/i18n/locales/<file>.json`). Suit names are NOT duplicated — the component reuses `trumps.*`.

- [ ] **Step 1: Add the EN block** (`src/i18n/locales/en.json`)

```json
  "offline": {
    "briefing": {
      "header": "How to deal · Hand {{n}}",
      "seatIntro": "Sit around the table in this order (play goes counter-clockwise):",
      "deal": "{{dealer}} deals — {{count}} to each, one card at a time around the table, starting with {{first}}.",
      "trump": "Trump this hand: {{glyph}} {{suit}}",
      "noTrump": "No trump this hand",
      "first": "{{first}} bets and leads first.",
      "dealsBadge": "deals",
      "firstReminder": "{{glyph}} {{suit}} · ▶ {{first}} led",
      "rulesToggle": "Quick rules"
    },
    "rules": {
      "bets": "Bets go in turn; the total must not equal the number of cards — the last player must break the tie.",
      "follow": "Follow the lead suit; if you can't, play trump or any card.",
      "trumpBeats": "Trump beats any non-trump card.",
      "noDumpTrump": "If the lead isn't trump and a trump is already down, you may only play a higher trump. You can't dump a lower trump while you still hold non-trump cards or a trump high enough to over-trump.",
      "jackException": "Exception — the trump Jack: if trump is led and your only trump is the Jack, you don't have to play it.",
      "scoring": "Exact bid earns points and a bonus; a miss is penalised."
    }
  },
```

- [ ] **Step 2: Add the RU block** (`src/i18n/locales/ru.json`)

```json
  "offline": {
    "briefing": {
      "header": "Как раздать · Раздача {{n}}",
      "seatIntro": "Сядьте за стол в этом порядке (ход против часовой стрелки):",
      "deal": "Раздаёт {{dealer}}, по {{count}} на руки — сдавайте по одной по кругу, начиная с {{first}}.",
      "trump": "Козырь этой раздачи: {{glyph}} {{suit}}",
      "noTrump": "Без козыря в этой раздаче",
      "first": "Первой ставку делает и ходит {{first}}.",
      "dealsBadge": "раздаёт",
      "firstReminder": "{{glyph}} {{suit}} · ▶ {{first}} ходила первой",
      "rulesToggle": "Краткие правила"
    },
    "rules": {
      "bets": "Ставки по очереди; сумма ставок не должна равняться числу карт — последний игрок обязан сломать равенство.",
      "follow": "Ходите в масть; нет масти — козырь или любая карта.",
      "trumpBeats": "Козырь бьёт любую некозырную карту.",
      "noDumpTrump": "Зашли не с козыря, а козырь уже лёг? Класть можно только козырь старше уже лежащего. «Слить» младший козырь нельзя, пока на руках есть некозырные карты или козырь, которым можно перебить.",
      "jackException": "Исключение — козырный валет: заходят с козыря, а из козырей у тебя только валет — его можно не скидывать.",
      "scoring": "За точную заявку — очки и бонус; за расхождение — штраф."
    }
  },
```

- [ ] **Step 3: Add the ES block** (`src/i18n/locales/es.json`)

```json
  "offline": {
    "briefing": {
      "header": "Cómo repartir · Mano {{n}}",
      "seatIntro": "Sentaos a la mesa en este orden (el juego va en sentido antihorario):",
      "deal": "Reparte {{dealer}} — {{count}} a cada uno, de una en una alrededor de la mesa, empezando por {{first}}.",
      "trump": "Triunfo de esta mano: {{glyph}} {{suit}}",
      "noTrump": "Sin triunfo esta mano",
      "first": "{{first}} apuesta y sale primero.",
      "dealsBadge": "reparte",
      "firstReminder": "{{glyph}} {{suit}} · ▶ {{first}} salió primero",
      "rulesToggle": "Reglas rápidas"
    },
    "rules": {
      "bets": "Las apuestas van por turno; el total no puede igualar el número de cartas — el último jugador debe romper el empate.",
      "follow": "Sigue el palo de salida; si no puedes, juega triunfo o cualquier carta.",
      "trumpBeats": "El triunfo gana a cualquier carta que no sea triunfo.",
      "noDumpTrump": "¿La salida no es triunfo y ya hay un triunfo en la mesa? Solo puedes poner un triunfo más alto. No puedes deshacerte de un triunfo bajo mientras tengas cartas no triunfo o un triunfo con el que superar.",
      "jackException": "Excepción — la Sota de triunfo: si sale triunfo y tu único triunfo es la Sota, no estás obligado a jugarla.",
      "scoring": "Acertar la apuesta da puntos y bonificación; fallar penaliza."
    }
  },
```

- [ ] **Step 4: Add the FR block** (`src/i18n/locales/fr.json`)

```json
  "offline": {
    "briefing": {
      "header": "Comment distribuer · Donne {{n}}",
      "seatIntro": "Asseyez-vous autour de la table dans cet ordre (le jeu tourne dans le sens antihoraire) :",
      "deal": "{{dealer}} distribue — {{count}} à chacun, une carte à la fois autour de la table, en commençant par {{first}}.",
      "trump": "Atout de cette donne : {{glyph}} {{suit}}",
      "noTrump": "Sans atout cette donne",
      "first": "{{first}} mise et entame en premier.",
      "dealsBadge": "distribue",
      "firstReminder": "{{glyph}} {{suit}} · ▶ {{first}} a entamé",
      "rulesToggle": "Règles en bref"
    },
    "rules": {
      "bets": "Les mises se font à tour de rôle ; le total ne doit pas égaler le nombre de cartes — le dernier joueur doit casser l'égalité.",
      "follow": "Suivez la couleur demandée ; sinon, jouez atout ou n'importe quelle carte.",
      "trumpBeats": "L'atout bat toute carte non-atout.",
      "noDumpTrump": "L'entame n'est pas atout et un atout est déjà posé ? Vous ne pouvez poser qu'un atout supérieur. Impossible de se défausser d'un petit atout tant que vous avez des cartes non-atout ou un atout assez fort pour surcouper.",
      "jackException": "Exception — le Valet d'atout : si l'on entame à l'atout et que votre seul atout est le Valet, vous n'êtes pas obligé de le jouer.",
      "scoring": "Une enchère exacte rapporte des points et un bonus ; une erreur est pénalisée."
    }
  },
```

- [ ] **Step 5: Verify all four locales are valid JSON and have the keys**

Run:
```bash
node -e "for (const l of ['en','ru','es','fr']) { const j=require('./src/i18n/locales/'+l+'.json'); if(!j.offline||!j.offline.briefing.header||!j.offline.rules.noDumpTrump) throw new Error('missing offline keys in '+l); console.log(l,'ok'); }"
```
Expected: `en ok`, `ru ok`, `es ok`, `fr ok` (no thrown error).

- [ ] **Step 6: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/ru.json src/i18n/locales/es.json src/i18n/locales/fr.json
git commit -m "i18n(offline): add offline-briefing strings (EN/RU/ES/FR)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Pure helpers + unit test

**Files:**
- Create: `src/lib/offline/handBriefing.ts`
- Test: `src/lib/offline/__tests__/handBriefing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/offline/__tests__/handBriefing.test.ts`:

```ts
import {
  getDealerSeat,
  getPlayOrder,
  suitGlyph,
  suitLabelKey,
  BriefingPlayer,
} from '../handBriefing';

const mkPlayers = (n: number): BriefingPlayer[] =>
  Array.from({ length: n }, (_, i) => ({
    session_id: `s${i}`,
    display_name: `P${i}`,
    seat_index: i,
  }));

describe('getDealerSeat', () => {
  it('is the seat after the starting seat (mod N)', () => {
    expect(getDealerSeat(2, 4)).toBe(3);
    expect(getDealerSeat(3, 4)).toBe(0);
    expect(getDealerSeat(0, 4)).toBe(1);
    expect(getDealerSeat(0, 2)).toBe(1);
    expect(getDealerSeat(1, 2)).toBe(0);
    expect(getDealerSeat(5, 6)).toBe(0);
  });
});

describe('getPlayOrder', () => {
  it('starts at the first player and steps counter-clockwise', () => {
    const order = getPlayOrder(mkPlayers(4), 2);
    expect(order.map((p) => p.seat_index)).toEqual([2, 1, 0, 3]);
  });
  it('ends on the dealer', () => {
    const players = mkPlayers(4);
    const order = getPlayOrder(players, 2);
    expect(order[order.length - 1].seat_index).toBe(getDealerSeat(2, players.length));
  });
  it('wraps correctly from seat 0', () => {
    expect(getPlayOrder(mkPlayers(3), 0).map((p) => p.seat_index)).toEqual([0, 2, 1]);
  });
  it('returns [] for no players', () => {
    expect(getPlayOrder([], 0)).toEqual([]);
  });
});

describe('suit helpers', () => {
  it('maps glyphs and returns empty for notrump', () => {
    expect(suitGlyph('spades')).toBe('♠');
    expect(suitGlyph('hearts')).toBe('♥');
    expect(suitGlyph('diamonds')).toBe('♦');
    expect(suitGlyph('clubs')).toBe('♣');
    expect(suitGlyph('notrump')).toBe('');
  });
  it('builds the i18n label key from the trumps namespace', () => {
    expect(suitLabelKey('hearts')).toBe('trumps.hearts');
    expect(suitLabelKey('notrump')).toBe('trumps.notrump');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/lib/offline --no-coverage`
Expected: FAIL — `Cannot find module '../handBriefing'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/offline/handBriefing.ts`:

```ts
/**
 * Nägels Online — offline (scorekeeper) hand-briefing helpers.
 *
 * Pure, dependency-light derivations for the offline instructions card.
 * The engine has NO dealer concept — the dealer is derived here from
 * `starting_seat`. Play is counter-clockwise by DECREASING seat index
 * (engine getNextPlayerIndex = (i + N - 1) % N).
 */

import { SuitSymbols } from '../../constants/colors';

export type TrumpSuit = 'diamonds' | 'hearts' | 'clubs' | 'spades' | 'notrump';

export interface BriefingPlayer {
  session_id: string;
  display_name: string;
  seat_index: number;
}

/**
 * The dealer is the player who, in play direction, immediately precedes the
 * first player: the dealer deals and the next player counter-clockwise leads.
 * Since next(seat) = (seat - 1 + N) % N, the predecessor of the starting seat
 * is (startingSeat + 1) % N.
 */
export function getDealerSeat(startingSeat: number, playerCount: number): number {
  return (startingSeat + 1) % playerCount;
}

/**
 * Players in play order: starts at the first player (`startingSeat`) and steps
 * counter-clockwise. The last element is always the dealer. Seats are assumed
 * to be 0..players.length-1 (true for an active hand).
 */
export function getPlayOrder(
  players: BriefingPlayer[],
  startingSeat: number,
): BriefingPlayer[] {
  const n = players.length;
  if (n === 0) return [];
  const bySeat = new Map(players.map((p) => [p.seat_index, p]));
  const order: BriefingPlayer[] = [];
  for (let i = 0; i < n; i++) {
    const seat = (((startingSeat - i) % n) + n) % n;
    const p = bySeat.get(seat);
    if (p) order.push(p);
  }
  return order;
}

/** Suit glyph for the trump line; empty string for no-trump. */
export function suitGlyph(suit: TrumpSuit): string {
  return suit === 'notrump' ? '' : SuitSymbols[suit];
}

/** i18n key for the localised suit name (reuses the existing `trumps` namespace). */
export function suitLabelKey(suit: TrumpSuit): string {
  return `trumps.${suit}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/lib/offline --no-coverage`
Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/offline/handBriefing.ts src/lib/offline/__tests__/handBriefing.test.ts
git commit -m "feat(offline): pure helpers for dealer seat, play order, suit glyph

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Persist briefing collapse state in settingsStore

**Files:**
- Modify: `src/store/settingsStore.ts`

- [ ] **Step 1: Add the field to the interface**

In `src/store/settingsStore.ts`, in the `SettingsStore` interface (after `shownTips: ShownTips;`, around line 30), add:

```ts
  offlineBriefingExpanded: boolean;
```

And in the actions section (after `setHapticsEnabled: (enabled: boolean) => void;`, around line 35), add:

```ts
  setOfflineBriefingExpanded: (expanded: boolean) => void;
```

- [ ] **Step 2: Add the default and setter to the store body**

In the `create<SettingsStore>` initial state (after `shownTips: { ...DEFAULT_SHOWN_TIPS },`, around line 55), add:

```ts
  offlineBriefingExpanded: true,
```

And add the setter (after the `setHapticsEnabled` block, around line 74):

```ts
  setOfflineBriefingExpanded: (expanded) => {
    set({ offlineBriefingExpanded: expanded });
    persistSettings(get());
  },
```

- [ ] **Step 3: Persist and hydrate the field**

In `persistSettings` (the `data` object, around line 144), add:

```ts
    offlineBriefingExpanded: state.offlineBriefingExpanded,
```

In `hydrate` (the `set({...})` block, around line 124), add:

```ts
          offlineBriefingExpanded: parsed.offlineBriefingExpanded ?? true,
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i settingsstore || echo "no settingsStore type errors"`
Expected: `no settingsStore type errors`.

- [ ] **Step 5: Commit**

```bash
git add src/store/settingsStore.ts
git commit -m "feat(settings): persist offlineBriefingExpanded toggle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: The `<OfflineHandBriefing>` component

**Files:**
- Create: `src/components/offline/OfflineHandBriefing.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/offline/OfflineHandBriefing.tsx`:

```tsx
/**
 * Nägels Online — Offline Hand Briefing
 *
 * Pinned, collapsible card shown at the top of the betting screen in
 * scorekeeper (offline) mode. Tells players how to physically run the hand:
 * seating (hand 1), who deals and how many cards, the trump, who bets/leads
 * first, plus a collapsible quick-rules reminder. Self-gates: renders nothing
 * unless room.mode === 'scorekeeper'. All data comes from the live snapshot.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRoomStore } from '../../store/roomStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useTheme } from '../../hooks/useTheme';
import { Spacing, Radius } from '../../constants';
import {
  getDealerSeat,
  getPlayOrder,
  suitGlyph,
  suitLabelKey,
  TrumpSuit,
  BriefingPlayer,
} from '../../lib/offline/handBriefing';

const RULE_KEYS = [
  'offline.rules.bets',
  'offline.rules.follow',
  'offline.rules.trumpBeats',
  'offline.rules.noDumpTrump',
  'offline.rules.jackException',
  'offline.rules.scoring',
];

export const OfflineHandBriefing: React.FC = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const snapshot = useRoomStore((s) => s.snapshot);
  const expanded = useSettingsStore((s) => s.offlineBriefingExpanded);
  const setExpanded = useSettingsStore((s) => s.setOfflineBriefingExpanded);
  const [rulesOpen, setRulesOpen] = useState(false);

  const room = snapshot?.room ?? null;
  const hand = snapshot?.current_hand ?? null;
  const players = (snapshot?.players ?? []) as BriefingPlayer[];
  const handNumber = hand?.hand_number ?? 1;

  // Hand 1 needs seating, so force the card open regardless of stored pref.
  const isFirstHand = handNumber === 1;
  const showExpanded = expanded || isFirstHand;

  const order = useMemo(
    () => (hand ? getPlayOrder(players, hand.starting_seat) : []),
    [players, hand],
  );

  if (!room || room.mode !== 'scorekeeper' || !hand) return null;

  const trump = (hand.trump_suit ?? 'notrump') as TrumpSuit;
  const first = order[0];
  const dealerSeat = getDealerSeat(hand.starting_seat, players.length);
  const dealer = players.find((p) => p.seat_index === dealerSeat) ?? null;
  const firstName = first?.display_name ?? '';
  const dealerName = dealer?.display_name ?? '';
  const glyph = suitGlyph(trump);
  const suitName = t(suitLabelKey(trump));
  const trumpChip = trump === 'notrump' ? t('offline.briefing.noTrump') : `${glyph} ${suitName}`;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassLight }]}
      testID="offline-briefing"
    >
      <Pressable
        onPress={() => { if (!isFirstHand) setExpanded(!showExpanded); }}
        style={styles.header}
        testID="offline-briefing-toggle"
      >
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
          {showExpanded ? '▼ ' : '▶ '}{t('offline.briefing.header', { n: handNumber })}
        </Text>
        <Text style={[styles.headerSummary, { color: colors.textSecondary }]} numberOfLines={1}>
          {trumpChip} · {dealerName} {t('offline.briefing.dealsBadge')} · ▶ {firstName}
        </Text>
      </Pressable>

      {showExpanded && (
        <View style={styles.body}>
          {isFirstHand && (
            <Text style={[styles.line, { color: colors.textSecondary }]}>
              {t('offline.briefing.seatIntro')}
            </Text>
          )}

          <View style={styles.strip} testID="offline-briefing-order">
            {order.map((p, i) => {
              const isFirst = i === 0;
              const isDealer = p.seat_index === dealerSeat;
              return (
                <View key={p.session_id} style={styles.stripItem}>
                  {i > 0 && <Text style={[styles.arrow, { color: colors.textMuted }]}>→</Text>}
                  <Text
                    style={[
                      styles.chip,
                      {
                        color: colors.textPrimary,
                        backgroundColor: isFirst ? colors.accent + '22' : 'transparent',
                      },
                    ]}
                  >
                    {isFirst ? '▶ ' : ''}{p.display_name}{isDealer ? ' 🃏' : ''}
                  </Text>
                </View>
              );
            })}
          </View>

          <Text style={[styles.line, { color: colors.textPrimary }]}>
            {t('offline.briefing.deal', {
              dealer: dealerName,
              count: hand.cards_per_player,
              first: firstName,
            })}
          </Text>
          <Text style={[styles.line, { color: colors.textPrimary }]}>
            {trump === 'notrump'
              ? t('offline.briefing.noTrump')
              : t('offline.briefing.trump', { glyph, suit: suitName })}
          </Text>
          <Text style={[styles.line, { color: colors.textPrimary }]}>
            {t('offline.briefing.first', { first: firstName })}
          </Text>

          <Pressable onPress={() => setRulesOpen((v) => !v)} testID="offline-briefing-rules-toggle">
            <Text style={[styles.rulesToggle, { color: colors.accent }]}>
              {rulesOpen ? '▾ ' : '▸ '}{t('offline.briefing.rulesToggle')}
            </Text>
          </Pressable>
          {rulesOpen && (
            <View style={styles.rules} testID="offline-briefing-rules">
              {RULE_KEYS.map((k) => (
                <Text key={k} style={[styles.ruleItem, { color: colors.textSecondary }]}>
                  •  {t(k)}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  header: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    gap: 2,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  headerSummary: {
    fontSize: 13,
  },
  body: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    gap: Spacing.xs,
  },
  line: {
    fontSize: 14,
    lineHeight: 19,
  },
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  stripItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  arrow: {
    marginHorizontal: 6,
    fontSize: 14,
  },
  chip: {
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  rulesToggle: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: Spacing.xs,
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "OfflineHandBriefing\|handBriefing" || echo "no briefing type errors"`
Expected: `no briefing type errors`.

> If `Radius.sm` or `colors.textMuted` is reported missing, check `src/constants/index.ts` (Radius) and `src/hooks/useTheme` color keys and substitute the nearest existing token (e.g. `Radius.md`, `colors.textSecondary`). These tokens are used widely (e.g. `TricksRecorder.tsx`, `LobbyScreen.tsx`) so they should exist.

- [ ] **Step 3: Commit**

```bash
git add src/components/offline/OfflineHandBriefing.tsx
git commit -m "feat(offline): OfflineHandBriefing card (seating, dealer, trump, rules)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Wire the briefing into BettingPhase and TricksRecorder

**Files:**
- Modify: `src/components/betting/BettingPhase.tsx`
- Modify: `src/components/scorekeeper/TricksRecorder.tsx`

- [ ] **Step 1: Import and mount in BettingPhase**

In `src/components/betting/BettingPhase.tsx`, add the import near the other component imports (e.g. after the `PausedOverlay` import around line 50):

```tsx
import { OfflineHandBriefing } from '../offline/OfflineHandBriefing';
```

Then mount it inside the `ScrollView`, immediately **before** the `{/* Players grid */}` comment (around line 869). The block currently looks like:

```tsx
        {/* Players grid */}
        <View style={styles.playersGrid}>
```

Change it to:

```tsx
        <OfflineHandBriefing />

        {/* Players grid */}
        <View style={styles.playersGrid}>
```

The component self-gates (`room.mode === 'scorekeeper'`), so it renders nothing in standard / single-player / bot betting screens.

- [ ] **Step 2: Add the reminder line to TricksRecorder**

In `src/components/scorekeeper/TricksRecorder.tsx`, add the import after the existing imports (around line 19, after the `constants` import):

```tsx
import { suitGlyph, suitLabelKey, TrumpSuit } from '../../lib/offline/handBriefing';
```

Then derive trump + first player. After the existing `const handNumber = hand?.hand_number ?? 1;` line (around line 40), add:

```tsx
  const trumpSuit = (hand?.trump_suit ?? 'notrump') as TrumpSuit;
  const firstName =
    players.find((p) => p.seat_index === (hand?.starting_seat ?? 0))?.display_name ?? '';
```

Then render the reminder line right after the existing subtitle `<Text>` block (which ends around line 99, just before the `{mismatch && (` block):

```tsx
        <Text style={[styles.subtitle, { color: colors.textSecondary }]} testID="tricks-recorder-reminder">
          {t('offline.briefing.firstReminder', {
            glyph: suitGlyph(trumpSuit),
            suit: t(suitLabelKey(trumpSuit)),
            first: firstName,
          })}
        </Text>
```

- [ ] **Step 3: Verify both files compile**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "BettingPhase|TricksRecorder" || echo "no wiring type errors"`
Expected: `no wiring type errors`.

- [ ] **Step 4: Commit**

```bash
git add src/components/betting/BettingPhase.tsx src/components/scorekeeper/TricksRecorder.tsx
git commit -m "feat(offline): mount briefing on betting screen + trump reminder in recorder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Test hygiene — testID registration, lint, smoke

**Files:**
- Possibly modify: `tests/TEST_TODO.md` (auto-generated section)

New `testID`s introduced: `offline-briefing`, `offline-briefing-toggle`, `offline-briefing-order`, `offline-briefing-rules-toggle`, `offline-briefing-rules`, `tricks-recorder-reminder`.

- [ ] **Step 1: Run the unit tests (full suite, not just helpers)**

Run: `npm run test:unit`
Expected: PASS, including the new `handBriefing.test.ts`.

- [ ] **Step 2: Register the new testIDs**

Run: `npm run test:lint -- --update-todo`
Expected: exit 0; `tests/TEST_TODO.md` auto-section now lists the new `offline-briefing*` and `tricks-recorder-reminder` testIDs as uncovered. Note the orphan/uncovered counts to report to the user.

- [ ] **Step 3: Run the smoke gate**

> Requires the `:8081` dev server running (the user usually has it open). If `lsof -i :8081` is empty, STOP and surface this to the user — do not start it yourself (per CLAUDE.md).

Run: `lsof -i :8081 >/dev/null && npm run smoke || echo "BLOCKED: :8081 dev server not running — ask the user to start it"`
Expected: smoke passes (jest unit + 9 smoke + 2 desktop-layout). The briefing only mounts in scorekeeper betting, so existing smoke flows are unaffected — confirm no regression in `tests/smoke/`.

- [ ] **Step 4: Commit any TEST_TODO changes**

```bash
git add tests/TEST_TODO.md
git commit -m "test(offline): register new briefing testIDs in TEST_TODO

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Manual verification note (report to user)**

The briefing and reminder only appear in a real scorekeeper room mid-game, which the automated smoke suite does not create. In the final message, tell the user to eyeball it once:
create a private room with **Mode: Scorekeeper**, start a bot/multiplayer game, and confirm on the betting screen:
- hand 1 shows the card expanded with the seating intro + play-order strip (first player marked `▶`, dealer marked `🃏`);
- the deal/trump/first lines read correctly (e.g. "по 6 на руки", "Козырь этой раздачи: ♦ Бубны");
- collapsing on hand 2 persists across hands;
- the "Краткие правила" toggle reveals all six rules including the no-dump-trump and trump-Jack rules;
- the tricks recorder shows the trump/first reminder line.

---

## Self-Review

**Spec coverage:**
- Scorekeeper-only gate → Task 5 (`room.mode === 'scorekeeper'`), Task 6 (self-gating mount). ✓
- Pinned collapsible card on betting screen → Task 5 + Task 6 Step 1. ✓
- Collapsed header (trump · dealer · first) → Task 5 header. ✓
- Hand-1 force-expand + seating intro + play-order strip → Task 5 (`isFirstHand`). ✓
- Deal/trump/first lines, count from `cards_per_player` → Task 5. ✓
- Quick rules incl. noDumpTrump + jackException, correct order → Task 2 copy + Task 5 `RULE_KEYS`. ✓
- Dealer derivation `(starting_seat+1)%N` → Task 3 `getDealerSeat` + test. ✓
- Persisted collapse state → Task 4. ✓
- TricksRecorder reminder → Task 6 Step 2. ✓
- Reuse existing `trumps.*` suit names → Task 2 (no duplicate suit keys), Task 3 `suitLabelKey`. ✓
- Bug fix (default 4 players) → Task 1. ✓
- i18n EN/RU/ES/FR → Task 2. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `BriefingPlayer`, `TrumpSuit`, `getDealerSeat`, `getPlayOrder`, `suitGlyph`, `suitLabelKey` defined in Task 3 and used identically in Tasks 5–6. `offlineBriefingExpanded` / `setOfflineBriefingExpanded` defined in Task 4, consumed in Task 5. i18n keys authored in Task 2 match the keys referenced in Tasks 5–6 (`offline.briefing.*`, `offline.rules.*`, `trumps.*`). ✓

**Out of scope (unchanged):** engine under-trump fix (separate `BACKLOG.md` HIGH item), no `dealer_seat` DB column, no full-screen wizard, no standard/SP/bot instructions.
