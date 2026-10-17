# Offline tournament mode — design

**Status:** draft
**Date:** 2026-10-17
**Owner:** Akula
**Deadline:** in-person tournament on 2026-10-20

## Goal

Run an in-person Nägels tournament (2–3 tables, 4–6 players each, physical cards and chips) where:

- one **recorder** per table enters everything for that table from a single phone — random seating, bets, tricks taken after each hand;
- a **big screen (TV)** shows every table live: seating, dealer, trump and cards-per-hand, whose turn it is, the bets / tricks / score table, and each player's money balance;
- the tournament runs in several **tours** with random reseating between them; the money balance accumulates across tours and updates after every closed hand;
- each table in each tour has its own **stake** (units per point); `0` means the table plays for fun and contributes nothing to the balance;
- some participants never play for money: they are flagged **no-stakes** and may only sit at stake-0 tables;
- the admin can place specific participants at specific tables by hand; random shuffle fills in the rest.

Built as an extension of the existing scorekeeper room mode (`rooms.mode = 'scorekeeper'`), not as a separate app.

## Non-goals (YAGNI)

- No timers of any kind in tournament rooms: no turn timer, no disconnect timeout, no host-absent rescue, no connection badges.
- No per-trick turn tracking. During play the TV shows only who leads the first trick.
- No editing a hand after it closed. Bets can be undone during betting; tricks are validated (sum = cards dealt) before the hand closes.
- No link to account rating. The tournament balance is symbolic units, scoped to the tournament, keyed by participant name; it never writes `rating_events`.
- No per-player stake opt-in. Stake is per table per tour.
- No player devices. Participants are names only.
- No external notifications for tournament rooms, ever: no Telegram announce, no Web Push. This is a hard server-side rule, not a client flag (see Notifications).

## Roles

| Role | Device | Can do |
|---|---|---|
| **Admin** | phone | create tournament, edit participants, shuffle seating, set per-table stakes, start tours; may also act as recorder on any table |
| **Recorder** | phone | after claiming a table via QR: enter bets for the current bidder, undo the last bet, enter tricks for all players, continue to the next hand |
| **TV** | laptop/TV browser | read-only dashboard of all tables in the current tour plus the tournament leaderboard |

A recorder is never a seat. If the recorder also plays, they are simply one of the participants.

## User flow

1. Admin opens `/tournament/new`, enters a name, the participant names (each with a **no-stakes** toggle), the number of tables and `max_cards`. Default `max_cards` = `floor(52 / largest table size)`, the same for all tables so the tours are fair.
2. Tour setup, in this order:
   1. **Stakes:** admin sets a stake per table (chips 0 / 1 / 5 / 10 / 25, default 0). Stakes come first because they constrain seating.
   2. **Pins (optional):** admin assigns specific participants to specific tables by hand. A pinned participant stays at that table through every reshuffle of this tour.
   3. **Shuffle seating:** the shuffle keeps pins, puts no-stakes participants only at stake-0 tables, then fills the remaining places so table sizes are as even as possible (e.g. 14 → 5/5/4), and randomizes the seat order inside each table. Admin can reshuffle as often as they like.
   4. **Manual fix-up:** in the preview the admin can tap a participant and move them to another table, or swap them with someone. A move that would put a no-stakes participant at a stake table, or push a table above 6 or below 2 players, is blocked inline.
   If the constraints can't be met (e.g. 7 no-stakes participants and only one stake-0 table), the shuffle shows the reason and suggests making one more table stake-0.
3. **Start tour** creates one scorekeeper room per table with proxy players already seated and ready, and immediately starts the game in each room (hand 1, betting). Rooms are created `silent` with no Telegram announce.
4. The TV opens `/tournament/<CODE>/tv`. Each table column shows a QR code until it is claimed. The QR encodes `/tournament/<CODE>/table/<n>?k=<secret>`.
5. The recorder scans the QR and becomes the room's host (`claim_table`). The recorder screen shows:
   - the existing briefing (dealer, play order, trump, cards in this hand);
   - **betting:** "<Name> bets", a 0..N number pad with the forbidden last-bidder value disabled, and an **Undo last bet** button;
   - **tricks recording:** a ± stepper per player on one screen with a running sum against cards dealt, and a **Submit** button that stays disabled until the sum matches;
   - **scoring:** this hand's result and a **Next hand** button.
6. When every table finishes the game, admin taps **Next tour**: new shuffle, new stakes, new rooms. Old tours' rooms stay `finished` and keep counting in the balance.
7. The TV switches to the newest tour automatically and always shows the cumulative leaderboard.

## Balance

For each closed hand `h` at a table with stake `s > 0`:

```
delta(player, h) = (hand_score(player, h) − mean(hand_score(*, h))) × s
```

The balance is the sum of `delta` over all closed hands of all tours, grouped by `tournament_participant_id`. It is zero-sum per hand, and over a full game it equals the existing conditional-stakes settlement `(total − mean(total)) × stake`. It is computed on read by `get_tournament_state` and never stored, so there is nothing to reconcile. Values are shown rounded to 1 decimal (means can be fractional with 5 players).

The leaderboard also shows total game points summed across tours, which is meaningful for tables at stake 0 too.

## Schema (one migration)

```sql
CREATE TABLE public.tournaments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT NOT NULL UNIQUE,          -- 6-char, same alphabet as rooms
  name             TEXT NOT NULL,
  admin_session_id UUID NOT NULL REFERENCES public.room_sessions(id),
  max_cards        INT  NOT NULL,
  table_secret     TEXT NOT NULL,                 -- QR claim secret
  current_tour     INT  NOT NULL DEFAULT 0,
  version          BIGINT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.tournament_participants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  no_stakes     BOOLEAN NOT NULL DEFAULT false,  -- may only sit at stake-0 tables
  UNIQUE (tournament_id, display_name)
);

ALTER TABLE public.rooms
  ADD COLUMN tournament_id UUID REFERENCES public.tournaments(id) ON DELETE CASCADE,
  ADD COLUMN tour_number   INT,
  ADD COLUMN table_number  INT,
  ADD COLUMN table_claimed BOOLEAN NOT NULL DEFAULT false;  -- set by claim_table

-- Proxy sessions: one per participant per tour, no auth user.
ALTER TABLE public.room_sessions
  ALTER COLUMN auth_user_id DROP NOT NULL,
  ADD COLUMN tournament_participant_id UUID
    REFERENCES public.tournament_participants(id) ON DELETE CASCADE;
-- UNIQUE(auth_user_id) still holds; NULLs don't collide.
```

`authenticate()` resolves sessions by `auth_user_id`, so proxy rows (NULL) are never picked up as a real user's session. `get_room_state` already uses `LEFT JOIN auth.users`, so it renders proxies unchanged. It gets one extra field per player, `is_proxy`.

RLS: the new tables get read-only `SELECT` for `anon` and `authenticated` (the TV needs to read them); all writes go through the edge function with the service role.

New RPCs:

- `get_tournament_state(p_code)` returns the tournament, participants, the current tour's rooms (each embedding `get_room_state(room_id)` plus `stake` and `claimed`), and the leaderboard (`balance` and `total_points` per participant). It returns no secret.
- `undo_last_bet_action(p_room_id, p_hand_id)` is scorekeeper-only and allowed only while `phase = 'betting'`. It deletes the latest `hand_scores` row of the hand, moves `current_seat` back one seat, writes a `bet_undone` game event and bumps `version`. It takes the same advisory lock as `place_bet_action`.

`place_bet_action` and `record_tricks_action` stay unchanged.

## Edge function (`game-action`)

New action kinds:

| Kind | Who | Effect |
|---|---|---|
| `create_tournament` `{name, participants[], max_cards}` | anyone (becomes admin) | insert tournament + participants |
| `update_participants` `{tournament_id, participants[]}` | admin, between tours | replace the list |
| `start_tour` `{tournament_id, tables: [{seats: participant_id[], stake}]}` | admin | for each table: proxy sessions → room (`mode='scorekeeper'`, `tournament_id`, `tour_number`, `table_number`, `stake`, `host_session_id` = admin) → seated ready `room_players` → `startGame`; bump `current_tour` |
| `claim_table` `{code, table_number, secret}` | anyone with the secret | set the room's `host_session_id` to the caller, `table_claimed = true` |
| `undo_bet` `{room_id, hand_id}` | room host | calls `undo_last_bet_action` |

The client does the shuffle and the manual edits, so the admin sees the final seating before committing. Pins are a client-side setup aid for the current tour and are not stored. The server validates that every participant is seated at most once, that each table has 2–6 seats, and that no `no_stakes` participant is at a table with `stake > 0` (error `no_stakes_at_stake_table`).

Existing actions get an optional `on_behalf_of_seat?: number` on `place_bet` and `record_tricks`. When it is present the handler requires the room to have a `tournament_id` and the caller to be the room host or the tournament admin. It then looks up the proxy session at that seat and passes that session id to the unchanged RPC. Without the field, behaviour is identical to today.

The recorder submits tricks as N `record_tricks` calls in seat order. The last one flips the hand to `scoring` (existing logic). A client-side sum check keeps the Submit button disabled until the sum matches, so in practice the server never sees a partial mismatch.

`continue_hand`: the end-of-game settlement block is skipped when `rooms.tournament_id IS NOT NULL`. Proxies would be filtered out anyway (no `auth_user_id`), but the explicit guard keeps tournament stakes away from `rating_events`.

`broadcastStateChanged` already fires per room on success. The new tournament actions also bump `tournaments.version` and broadcast on a `tournament:<id>` channel so the TV can refetch.

## Notifications

Tournament rooms never notify anyone outside the venue:

- `start_tour` inserts rooms directly and never calls `notifyNewRoom`, whatever `silent`/`announce` the client sends; `create_tournament` doesn't notify either;
- the `game-action` push step (`detectTransitions` → `notifyPush`) is skipped when the room has a `tournament_id`;
- tested: an edge unit test asserts `notifyNewRoom` and `notifyPush` are not called for `start_tour` or for bet/tricks actions in a tournament room.

## Timers off

In any room with `tournament_id`:

- `turnTimeout` / `request_timeout` callers in the client do nothing, and the server rejects `request_timeout` with `not_applicable`;
- host-absent detection and the `HostLeftBanner` / `PausedOverlay` disconnect paths are not mounted;
- connection dots / "disconnected" badges are hidden for proxy players;
- heartbeat is still sent by the recorder's session (harmless), but nothing keys off proxies' `last_seen_at`.

## Frontend

New routes in `AppNavigator` linking:

- `/tournament/new` → `TournamentSetupScreen`: participants textarea (one name per line), table count, max cards, then the shuffle preview with per-table stake chips, then **Start tour**. Later it becomes the tour-control screen (**Next tour**, link to TV).
- `/tournament/:code/table/:n` → `TournamentRecorderScreen`: claims the table on mount, then renders by hand phase: briefing + `RecorderBetPad`, the existing `TricksRecorder` adapted to multi-player steppers, the scoring summary + Next hand. **Score** opens the existing `ScoreboardModal`.
- `/tournament/:code/tv` → `TournamentTvScreen`: landscape, one column per table (`TableBoard`), a leaderboard strip at the bottom, and a QR until the table is claimed. Subscribes to the tournament channel and each room's state channel; refetches `get_tournament_state` on any change.

Pure helpers in `src/lib/tournament/` with unit tests:

- `shuffleSeating({participants, tables: [{stake}], pins: {participantId: tableIndex}}, rng)` → `{ok: true, tables: participantId[][]} | {ok: false, reason}`; honours pins and no-stakes, then balances sizes;
- `validateSeating(tables, participants, stakes)`: the same rules for manual moves and the server check, shared via `_shared/engine`;
- `computeBalance(hands, stake)` → per-participant deltas. The same math is mirrored in SQL; a fixture test asserts parity.

All strings go to EN / RU / ES locales.

## Error handling

- A recorder phone that goes to sleep or reloads re-opens the same URL; `claim_table` is idempotent for the current host. A second phone claiming the same table takes over, which is the intended recovery when a phone dies.
- An action rejected with `not_your_turn` / `someone_must_be_unhappy` shows an inline message and the refreshed snapshot; nothing is lost.
- If the TV loses its connection it shows a "reconnecting" badge and refetches on reconnect; it holds no state of its own.

## Testing

- jest: `shuffleSeating` (balance, no duplicates, determinism with a seeded rng, pins kept, no-stakes never at a stake table, infeasible → reason), `validateSeating`, `computeBalance` (zero-sum, stake 0 → 0, equals the game-level settlement over a full game).
- e2e (local Supabase): create a tournament with 4 participants and 1 table, claim it, play 2 hands entirely from one page including an undo and a tricks mismatch, assert the TV page shows bets, trump and balance.
- `npm run smoke` before merge, `npm run test:lint -- --update-todo` for new testIDs.
- Side-effect hygiene: tournament rooms are always created `silent: true` with no announce; proxies have no push subscriptions.

## Rollout

1. Migration → local → `supabase db push` to prod.
2. Deploy the edge function.
3. Push to main → Vercel. Do a dry run on prod with fake names the day before the tournament.
4. Checkpoint on the evening of 2026-10-19: if the TV or the recorder flow isn't solid, use whatever works and keep the rest on paper.
