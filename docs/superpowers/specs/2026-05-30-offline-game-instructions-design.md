# Offline game instructions + player-count copy fix

Date: 2026-05-30
Status: Approved (design), pending implementation plan
Owner: Akula

## Summary

Two independent items from `docs/BACKLOG.md` → "Next Up":

1. **Offline game instructions** — dynamic, personalised hints shown during a
   scorekeeper (offline) game telling players how to physically run the hand:
   seating, who deals and how many cards, the trump, who bets/leads first, plus
   a brief rules reminder. Personalised from the live snapshot (seating + turn
   order). Scorekeeper-mode only.
2. **Player-count copy fix** — the "0 игрока" label above the bot-game player
   selector. Fixed by defaulting the selection to 4 players.

A related engine edge case (under-trumping on all-trump hands) is surfaced as a
separate `BACKLOG.md` entry and is explicitly **out of scope** here.

## Context (verified against code)

- Scorekeeper mode already exists (`rooms.mode = 'scorekeeper'`): no cards are
  dealt, players record trick results via `TricksRecorder.tsx`. The room is an
  offline arbitrator.
- The snapshot (`supabase/functions/_shared/types.ts`) already carries
  everything the briefing needs:
  - `players[]` with `seat_index`, `display_name`, avatar fields
  - `current_hand.trump_suit`, `starting_seat`, `cards_per_player`, `hand_number`
  - `room.mode`, `room.player_count`, `room.min_cards_per_hand`
- **Trump is deterministic**, not flipped from a card:
  `getTrumpForHand(handNumber)` rotates `diamonds → hearts → clubs → spades →
  notrump` by hand number (`rules.ts:120`). The app simply announces the trump;
  offline players adopt it (no physical flip).
- **Cards per hand** come from `getHandCards(handNumber, maxCards, minCards)`
  (`rules.ts:80`) — a ladder `max…1,1…max` with a host-chosen floor
  (`min_cards_per_hand`: 1 = standard, 2 = "skip 1-card rounds" → centre is 2
  cards). The briefing must read the card count from
  `current_hand.cards_per_player` only — **never recompute the ladder on the
  client** — so floor=2 and any future variation stay correct automatically.
- **Play direction is counter-clockwise by decreasing index**:
  `getNextPlayerIndex = (i + N − 1) % N` (`rules.ts:618`). The first player is
  `starting_seat`; betting and play proceed `starting_seat → starting_seat−1 →
  …`.
- **There is no dealer concept in the engine** — it is introduced for the
  offline briefing only, derived (not stored).

## Dealer derivation

The dealer is the player who, in play direction, immediately precedes the first
player — i.e. the dealer deals and the next player counter-clockwise leads:

```
dealerSeat = (starting_seat + 1) % player_count
```

Worked check (N=4, starting_seat=2): next(2)=1, next(1)=0, next(0)=3, next(3)=2.
The predecessor of seat 2 is seat 3 = (2+1)%4. Dealer = seat 3; after the dealer
comes seat 2 = the first player. Correct.

No DB column is added — `starting_seat` is the single source of truth.

## Component design

### `<OfflineHandBriefing>` (new)

A pinned, collapsible card rendered at the **top of the betting screen**
(`BettingPhase`), only when `room.mode === 'scorekeeper'`.

**Collapsed header (always visible):**

```
▼ Как раздать · Раздача 5
  ♦ Бубны · Раздаёт Дима · ▶ Аня ходит первой
```

**Expanded body:**

- *(hand 1 only)* seat intro line: "Сядьте за стол в этом порядке (ход против
  часовой стрелки):"
- **Play-order strip** — avatar+name chips in play order starting from the first
  player; the dealer is last and carries a 🃏 "раздаёт" badge:
  `▶ Аня → Вика → Олег → Дима 🃏`
- **Deal line**: "Раздаёт **Дима**. Сдайте по **{{count}} карт** каждому, по
  одной по кругу, начиная с **Аня**." (count from `cards_per_player`)
- **Trump line**: "Козырь этой раздачи: **♦ Бубны**" (or "Без козыря" for
  `notrump`)
- **First-player line**: "Первой ставку делает и ходит **Аня**."
- **▸ Краткие правила** — nested toggle revealing 6 rule bullets (below).

**Collapse state:** persisted in `settingsStore` as `offlineBriefingExpanded`
(default `true`). On hand 1 it is force-expanded once (seating is essential);
afterwards the card respects the user's last toggle. The nested "Краткие
правила" toggle has its own local state (default collapsed).

### `TricksRecorder` (existing) — minimal reminder

Add a single non-collapsible reminder line at the top:
`♦ Бубны · ▶ Аня ходила первой` — so trump/first-player stay visible while
players physically play out the tricks before recording. Reuses the same
helpers; no new layout.

### Pure helpers — `src/lib/offline/handBriefing.ts` (new, unit-tested)

- `getDealerSeat(startingSeat: number, playerCount: number): number`
  → `(startingSeat + 1) % playerCount`
- `getPlayOrder(players, startingSeat): Player[]`
  → players ordered `startingSeat, startingSeat−1, … (mod N)`; first element is
  the first player, last is the dealer.
- `suitGlyph(suit): string` → `♦ ♥ ♣ ♠` / `''` for notrump
- `suitLabelKey(suit): string` → i18n key for the localised suit name

These are the only pieces with real logic and get a focused unit test
(`handBriefing.test.ts`): dealer seat for N=2..6, play order ordering and
dealer-last invariant.

## Copy (i18n)

New namespace `offline.*` plus suit names. EN is the source; RU is authored
below; ES/FR added during implementation (full i18n is a project principle).
Card-count strings use i18next `count` pluralisation so "по **1** карте" / "по
**2** карты" / "по **6** карт" decline correctly (RU/ES/FR plural forms).

| Key | RU | EN |
|---|---|---|
| `offline.briefing.header` | Как раздать · Раздача {{n}} | How to deal · Hand {{n}} |
| `offline.briefing.seatIntro` | Сядьте за стол в этом порядке (ход против часовой стрелки): | Sit around the table in this order (play goes counter-clockwise): |
| `offline.briefing.deal` | Раздаёт {{dealer}}, по {{count}} на руки — сдавайте по одной по кругу, начиная с {{first}}. | {{dealer}} deals — {{count}} to each, one card at a time around the table, starting with {{first}}. |
| `offline.briefing.trump` | Козырь этой раздачи: {{glyph}} {{suit}} | Trump this hand: {{glyph}} {{suit}} |
| `offline.briefing.noTrump` | Без козыря в этой раздаче | No trump this hand |
| `offline.briefing.first` | Первой ставку делает и ходит {{first}}. | {{first}} bets and leads first. |
| `offline.briefing.dealsBadge` | раздаёт | deals |
| `offline.briefing.firstReminder` | {{glyph}} {{suit}} · ▶ {{first}} ходила первой | {{glyph}} {{suit}} · ▶ {{first}} led |
| `offline.briefing.rulesToggle` | Краткие правила | Quick rules |
| `offline.rules.bets` | Ставки по очереди; сумма ставок не должна равняться числу карт — последний игрок обязан сломать равенство. | Bets go in turn; the total must not equal the number of cards — the last player must break the tie. |
| `offline.rules.follow` | Ходите в масть; нет масти — козырь или любая карта. | Follow the lead suit; if you can't, play trump or any card. |
| `offline.rules.trumpBeats` | Козырь бьёт любую некозырную карту. | Trump beats any non-trump card. |
| `offline.rules.noDumpTrump` | Зашли не с козыря, а козырь уже лёг? Класть можно только козырь старше уже лежащего. «Слить» младший козырь нельзя, пока на руках есть некозырные карты или козырь, которым можно перебить. | If the lead isn't trump and a trump is already down, you may only play a higher trump. You can't dump a lower trump while you still hold non-trump cards or a trump high enough to over-trump. |
| `offline.rules.jackException` | Исключение — козырный валет: заходят с козыря, а из козырей у тебя только валет — его можно не скидывать. | Exception — the trump Jack: if trump is led and your only trump is the Jack, you don't have to play it. |
| `offline.rules.scoring` | За точную заявку — очки и бонус; за расхождение — штраф. | Exact bid earns points and a bonus; a miss is penalised. |

Suit names are **not** duplicated — the briefing reuses the existing `trumps.*`
namespace (`trumps.diamonds/hearts/clubs/spades/notrump`, already localised
EN/RU/ES/FR). The helper `suitLabelKey(suit)` returns `trumps.${suit}`.

Rule bullets render in this order: `bets → follow → trumpBeats → noDumpTrump →
jackException → scoring`.

> Note: the `noDumpTrump` bullet describes the **correct** Nägels rule (must
> over-trump when able). The engine currently under-enforces this on all-trump
> hands — tracked separately in `BACKLOG.md`, not fixed here.

## Player-count copy fix

`LobbyScreen.tsx:148` — change `useState<number | null>(null)` to
`useState<number | null>(4)`. The "Боты" tab opens with 4 players pre-selected;
`lobby.playerCount` renders "4 игрока" immediately and `canStartMatch` then
depends only on difficulty selection. The i18n string itself is unchanged.

## Files touched

- `src/screens/LobbyScreen.tsx` — default player count = 4 (bug fix)
- `src/i18n/locales/{en,ru,es,fr}.json` — new `offline.*` keys + suit names
- `src/lib/offline/handBriefing.ts` (new) — pure helpers
- `src/lib/offline/__tests__/handBriefing.test.ts` (new) — unit test
- `src/components/offline/OfflineHandBriefing.tsx` (new) — the briefing card
- `src/components/betting/BettingPhase.tsx` — mount briefing under scorekeeper gate
- `src/components/scorekeeper/TricksRecorder.tsx` — one-line trump/first reminder
- `src/store/settingsStore.ts` — add persisted `offlineBriefingExpanded` boolean

## Implementation stages

1. **Bug fix** — default 4 players in `LobbyScreen`. Independent, ~5 min.
2. **i18n** — add `offline.*` keys + suit names across EN/RU/ES/FR.
3. **Helpers** — `handBriefing.ts` + unit test (dealer seat, play order, glyphs).
4. **Component** — `<OfflineHandBriefing>`: collapsible card, play-order strip,
   deal/trump/first lines, nested quick-rules, persisted collapse state.
5. **Wiring** — mount in `BettingPhase` (scorekeeper gate); add reminder line to
   `TricksRecorder`.
6. **Test hygiene** — add `testID`s, run `npm run test:lint -- --update-todo`,
   run `npm run smoke`; surface any orphans/new testIDs to the user.

## Out of scope (YAGNI)

- Full-screen briefing wizard (pinned card chosen instead)
- A `dealer_seat` DB column (derived from `starting_seat`)
- A circular mini-table with GameTable geometry (chip strip is enough)
- Instructions in standard / single-player / bot modes (app deals there)
- General "how to play offline" primer outside the room
- Fixing the engine under-trump edge case (separate backlog item, high priority)

## Testing

- Unit: `handBriefing.test.ts` covers dealer derivation and play order.
- Smoke: `npm run smoke` (gate). The briefing only mounts in scorekeeper rooms,
  so existing smoke flows are unaffected; verify no regression in BettingPhase.
- `test:lint` to register new `testID`s in `tests/TEST_TODO.md`.
