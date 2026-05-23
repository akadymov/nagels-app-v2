# Conditional Stakes — design

**Date:** 2026-05-23
**Author:** Akula + Claude
**Status:** Draft, awaiting review

## Goal

Let players opt in to wagering **rating points** on a multiplayer game. The host proposes a stake size before the game starts; each player decides individually whether to play "for rating". At game end, opted-in players settle a zero-sum redistribution based on their final scores. Their persistent `rating` balance updates and is visible in the profile.

This adds stakes for engaged players without forcing it on casual / guest play, and is the foundation for the eventual leaderboard.

## Non-goals

- No real money. Rating is an abstract internal score; nothing converts to currency or anything else.
- No bot rating. Bots don't accumulate or settle ratings. Single-player vs bots stays untouched.
- No matchmaking by rating. Rating is displayed; the lobby is still join-by-code / quick-match.
- No tournament/season structure. One global rolling balance per user.
- No anti-cheat hardening beyond "settlement is server-authoritative". Collusion in a 4-player room is acceptable risk at this stage.
- No retroactive recalc tools. Once a game is settled, the rating events are immutable.
- Scorekeeper-mode rooms participate identically — stakes don't care how scores arrived.

## Terminology

| Term | Meaning |
| --- | --- |
| **Rating** | A signed integer balance per user. Default 0 at account creation. Can go negative. |
| **Stake** | Integer chosen by the host before a game (one of `0 / 1 / 5 / 10 / 25`). `0` means "no stakes". |
| **Opt-in** | A session's decision to wager. Only opted-in sessions settle at game end. |
| **Settlement** | Zero-sum redistribution at game end. For each opted-in player `i`: `delta_i = (score_i − mean(scores)) * stake`. |
| **Eligible user** | Logged-in user whose `auth.users.email_confirmed_at IS NOT NULL` OR who signed in via Google (which provides a confirmed email at OAuth). Guests and unconfirmed-email users are **not** eligible. |

## Behavior

### Lifecycle

```
[WaitingRoom: room.phase='waiting']
  - Host: pick stake (chips 0 / 1 / 5 / 10 / 25). Default 0.
  - Each eligible session: opt-in toggle. Default off.
  - Visibility: every chip shows "in stake" / "—" badge. Stake size shown above the player grid.
  - Guards: host must be eligible to set a non-zero stake. Guests / unconfirmed users see the
    opt-in toggle in a disabled state with hint "Sign in to play for rating".
  - Changing stake (incl. → 0) resets every opt-in to false (terms changed).

[Game starts: room.phase='playing']
  - Stake and opt-ins are LOCKED for the duration of the game.
  - room.stake_locked = true.
  - During each hand, scoreboard shows provisional delta for opted-in players (visible to opt-in
    players only — see Visibility below).

[Game ends: room.phase='finished']
  - Server computes settlement (see Settlement below).
  - rating_events inserted, user_ratings.balance updated, snapshot broadcasts new state.
  - Opted-in players see an additional "Rating settlement" screen after the normal scoreboard.

[Restart: host taps "Play again"]
  - room.stake stays the same (so the same group can keep playing the same stakes).
  - All opt-ins reset to false. Each player must re-opt-in for the new game.
  - room.stake_locked = false again until next start.
```

### Settlement formula

Given the set of opted-in sessions `S` with final game totals `score_i`, and the locked `stake`:

```
mean = sum(score_i for i in S) / |S|
delta_i = round((score_i - mean) * stake)
```

Properties:

- `sum(delta_i) == 0` (mathematically; rounding can introduce a ±1 drift in edge cases — see Rounding below).
- `|S| < 2` → no settlement runs, no rating_events are written, opted-in player(s) simply don't see a settlement screen.
- `stake == 0` → no settlement regardless of opt-ins. Equivalent to the feature being off for this game.

**Rounding.** `round((score_i - mean) * stake)` per player can leave the sum at ±1 due to integer rounding. The server post-processes: if `sum != 0`, the leftover ±1 is absorbed by the player with the largest absolute delta (so a winner gets one less, or a loser gets one less, to make the books square). This keeps the invariant `sum(delta_i) == 0` strict in `rating_events`.

### Visibility rules

| Surface | Audience |
| --- | --- |
| WaitingRoom stake selector | Host only. Other sessions see it as read-only "Stake: X". |
| WaitingRoom opt-in toggle | The session itself (eligible only). Others see read-only "in stake" / "—" badge on the player chip. |
| In-game provisional delta column | **Opted-in players only.** Non-opt-in participants and spectators do not see this column. |
| End-of-game settlement screen | **Opted-in players only.** Non-opt-in players see the normal scoreboard with no settlement step. |
| Profile balance | The user themselves. Other users see only nickname/avatar (no leaderboard exposure yet). |

Rationale for "opt-in only" provisional delta (per user direction): players who chose not to play for rating shouldn't be looking over the shoulders of those who did. Keeps the stakes table semi-private.

### Mid-game leaves

If an opted-in player leaves after `room.phase` flips to `playing`:

- Their opt-in stays locked. They settle on the final state of the game just like any other opted-in player.
- Their score continues to evolve according to whatever bot / inactivity rules already govern absent players in the existing engine. **No new auto-loss penalty is introduced** — settlement uses whatever score history ends up in `score_history`.
- If they fully disconnect and never see the settlement screen, the rating change is still applied server-side. They'll see the change next time they open their Profile.

### Guards & error cases

| Scenario | Behavior |
| --- | --- |
| Host (guest) sets a non-zero stake | Edge action rejects with `not_eligible_to_set_stake`. Frontend disables chips when host is ineligible. |
| Eligible session opts in when stake = 0 | Allowed but no-op (stored, but with stake 0 there's no settlement). UI hides the opt-in toggle when stake is 0 to avoid confusion. |
| Guest opts in | Edge action rejects with `not_eligible_to_opt_in`. UI disables the toggle. |
| Host changes stake after some opts | Server resets every opt-in to false in the same transaction as the stake update. Clients see "Opt-in cleared, terms changed" toast. |
| Host changes stake during game | Forbidden (`room.stake_locked = true`). Edge action rejects with `stake_locked`. |
| Opt-in toggled during game | Same — rejected with `stake_locked`. |
| `|opt_in_count| < 2` at game end | No settlement. No rating_events. Opt-in players see the normal scoreboard. |

## Architecture

### Database (one migration)

**New tables**

```sql
CREATE TABLE public.user_ratings (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance    INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only journal. One row per rating mutation for full auditability.
CREATE TABLE public.rating_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Nullable so admin-reset rows (which aren't tied to a game) can omit it,
  -- and so historical events survive a room deletion / TTL cleanup.
  room_id    UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  reason     TEXT NOT NULL CHECK (reason IN ('settle', 'admin_reset')),
  delta      INTEGER NOT NULL,
  -- Snapshot of the inputs at settle time, for explainability:
  base_score INTEGER NOT NULL,    -- the player's final game score
  mean_score NUMERIC NOT NULL,    -- mean across opted-in players
  stake      INTEGER NOT NULL,    -- the locked stake for the room
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX rating_events_user_idx ON public.rating_events (user_id, created_at DESC);
CREATE INDEX rating_events_room_idx ON public.rating_events (room_id);
```

`reason='admin_reset'` rows do not reference a real game: `room_id=NULL`, `mean_score=0`, `stake=0`, `base_score=<balance before reset>`, `delta=-<balance before reset>`, so the running sum stays correct and the reset is fully reconstructible from the journal alone.

**Extended tables**

```sql
ALTER TABLE public.rooms
  ADD COLUMN stake        INTEGER NOT NULL DEFAULT 0
                            CHECK (stake IN (0, 1, 5, 10, 25)),
  ADD COLUMN stake_locked BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.room_players
  ADD COLUMN opt_in_stake BOOLEAN NOT NULL DEFAULT false;
```

`opt_in_stake` lives on `room_players` (not `room_sessions`) because the relationship is per-room and resets across rooms / restarts. Spectators do not opt in.

**RLS**

- `user_ratings`: SELECT for the owning user (`auth.uid() = user_id`). Updates only via SECURITY DEFINER RPC.
- `rating_events`: SELECT for the owning user. Inserts only via SECURITY DEFINER RPC during settlement.

**`get_room_state` extension**

Add to the room object: `stake`, `stake_locked`. Add to each `players[]` row: `opt_in_stake`. The history rows stay untouched.

### Edge actions (new)

`game-action` gets three new branches. Same envelope convention as existing actions.

```ts
type Action =
  | { type: 'set_stake'; room_id: string; stake: 0|1|5|10|25 }
  | { type: 'toggle_stake_optin'; room_id: string; opted_in: boolean }
  // settlement is implicit — no client action; see below.
```

**`set_stake`**

- Authority check: caller must be the host.
- Eligibility: caller's `auth.users.email_confirmed_at IS NOT NULL`. Otherwise `not_eligible_to_set_stake`.
- Lock check: `room.stake_locked = false`. Otherwise `stake_locked`.
- Side effect: updates `rooms.stake`. Resets every `room_players.opt_in_stake` to false in the same transaction. Bumps `rooms.version`. Triggers broadcast.

**`toggle_stake_optin`**

- Authority check: caller is a seated player in the room (`room_players.session_id` exists).
- Eligibility: caller's `auth.users.email_confirmed_at IS NOT NULL`. Otherwise `not_eligible_to_opt_in`.
- Lock check: `room.stake_locked = false`. Otherwise `stake_locked`.
- Side effect: updates the caller's `room_players.opt_in_stake`. Bumps `rooms.version`. Triggers broadcast.

**Settlement (server-internal, no direct action)**

Triggered inside the existing transition that flips `room.phase` to `'finished'` (today this happens at the end of `continue_hand_action` / scoring resolution). Pseudocode:

```ts
if (room.stake > 0) {
  const optedIn = rooms_players where opt_in_stake = true;
  if (optedIn.length >= 2) {
    const totals = aggregate score_history per session_id;
    const mean = sum(totals[i]) / optedIn.length;
    const deltas = optedIn.map(p => Math.round((totals[p] - mean) * room.stake));
    fixRoundingDrift(deltas);   // ensures sum === 0
    for each (p, delta) {
      INSERT INTO rating_events (...);
      UPDATE user_ratings SET balance = balance + delta WHERE user_id = ...;
      -- creates user_ratings row on first ever settle (UPSERT)
    }
  }
}
// Always clear the lock when going to 'finished' so a "Play again" can re-arm.
UPDATE rooms SET stake_locked = false;
UPDATE room_players SET opt_in_stake = false WHERE room_id = ...;
```

Concurrency: settlement runs inside the same `BEGIN ... COMMIT` as the phase transition, so it's atomic and cannot run twice. We rely on the existing version-check guard in transition logic to prevent double-execution if two clients race the final action.

**`restart_game_action` adjustment**

- Keep `rooms.stake` as-is.
- Reset `room_players.opt_in_stake = false` for everyone.
- Set `rooms.stake_locked = false`.
- Existing reset logic for `current_hand_id`, `score_history`, etc. stays.

**`start_game_action` adjustment**

- Just before flipping `room.phase = 'playing'`, set `rooms.stake_locked = true`. (Single SQL update in the same transaction.)

### Frontend

**State**

- `useRoomStore.snapshot.room.stake` and `room.stake_locked` — already loaded once `get_room_state` returns the extended object.
- `useRoomStore.snapshot.players[].opt_in_stake` — same.
- `useAuthStore.user.email_confirmed_at` — already loaded.

**New eligibility helper:** `src/utils/ratingEligibility.ts`

```ts
export function canPlayForRating(user: User | null, isGuest: boolean): boolean {
  if (isGuest || !user) return false;
  return !!user.email_confirmed_at;
}
```

**WaitingRoom**

In `src/screens/WaitingRoomScreen.tsx` (and its desktop counterpart):

1. Stake selector chips above the player grid (host-only interactive; others read-only).
   - Chips: `Off / 1 / 5 / 10 / 25`. Highlighted chip = current stake.
   - When host is ineligible, chips are disabled with hint.
   - Tapping a chip calls `gameClient.setStake(stake)`.

2. Player chip badge: small "★ stake" pill next to each player chip whose `opt_in_stake = true`. Greyed "—" otherwise. Visible to everyone.

3. Your-own opt-in toggle: a single switch row directly below the stake-chip strip, labelled `Play for rating` and gated by `canPlayForRating(...)`. Disabled with hint for ineligible users. (Putting it on the player's own card was considered but rejected — chips are crowded on mobile and the switch needs its accessible label.)

**ScoreboardModal / DesktopGameLayout left pane**

In `src/screens/ScoreboardModal.tsx`:

- When `stake > 0` AND the local user is opted-in, render a new column "Δ rating" alongside the existing "Σ" total column.
- Provisional delta is computed client-side from the same totals already in `playerScores`, restricted to the opted-in subset. Reuses the same rounding-drift fix as the server.
- For non-opt-in players, this column is not rendered.

**End-of-game settlement screen**

A new modal: `src/screens/RatingSettlementModal.tsx`.

- Trigger: `room.phase === 'finished'` AND local user was opted-in (`snapshot.players[me].opt_in_stake = true`) AND `room.stake > 0` AND the opt-in count is ≥ 2. The modal then calls a new RPC `get_rating_settlement(room_id)` which returns `{ old_balance, new_balance, rows: [{user_id, name, score, delta}] }` for the requesting user.
- Layout: shows my old balance → animated delta → new balance, plus a per-player breakdown (everyone opted-in: nick + final game score + delta).
- Order: surfaces AFTER the normal `ScoreboardModal`. Game-over scoreboard's existing "Continue" button is repurposed to open the settlement modal for opt-in players, and the host's "Play again" button moves from the scoreboard to the settlement modal so opt-in players see settlement before a new game can start. Non-opt-in players keep the current flow: scoreboard with "Play again" / "Leave" buttons, no settlement step.

**ProfileScreen**

In `src/screens/ProfileScreen.tsx`:

- Add a "Rating" row: shows `user_ratings.balance` (default 0 for users who've never played for stakes). Visible only to eligible users (guests don't see a rating field — they can't play for it).
- New `useRatingStore` (single value: `balance`) loads from a new `get_my_rating()` RPC on profile mount via `useFocusEffect`. After settlement, the `RatingSettlementModal` calls the same RPC once it mounts so the modal shows the freshly-persisted balance; no row-level subscription is needed (Profile isn't a hot screen).

### Admin reset

The owner needs a journaled way to zero a specific user's rating or wipe everyone's at once, without poking the DB directly. Two server-side actions cover both cases; both go through the existing edge function.

**Authorization.** A new edge env var `ADMIN_EMAILS` (comma-separated, no whitespace). The action handler verifies the caller's `auth.users.email` is in that set. Off-list callers get `not_admin` — no leak of who's an admin to other users. This is single-mechanism, no DB schema for roles, easy to extend later if a multi-admin or role table becomes needed.

```ts
type Action =
  | ...
  | { type: 'admin_reset_rating'; user_id: string }     // zero one user
  | { type: 'admin_reset_all_ratings' };                // zero every user
```

**Behavior** (both):

1. Verify caller is admin per `ADMIN_EMAILS`. Otherwise `not_admin`.
2. For each target user with `balance != 0`:
   - Insert a `rating_events` row with `reason='admin_reset'`, `room_id=NULL`, `base_score=<current balance>`, `mean_score=0`, `stake=0`, `delta=-<current balance>`.
   - Update `user_ratings.balance = 0` and bump `updated_at`.
3. Users with `balance = 0` are skipped (no-op rows).
4. Returns `{ ok: true, affected: <count> }` so the UI can confirm.

**UI surface.** A small admin block in `ProfileScreen`, rendered only when `canActAsAdmin(user)` — a client-side helper that reads the SAME env-driven list via a new public RPC `is_current_user_admin() RETURNS BOOLEAN`. Two destructive buttons:

- **Reset rating by user** — opens a small picker (display name + email search, hits a new admin-only RPC `admin_search_users(q)` returning `{id, email, display_name, balance}[]`). Confirm step shows current balance and the resulting delta before commit.
- **Reset all ratings** — typed confirm (the user types `RESET ALL` literally). Confirm dialog shows how many non-zero balances will be affected.

Both buttons are visually distinct (destructive red border) and require a confirm step. No keyboard shortcut, no batch UI beyond these two.

This UI is hidden from non-admins entirely — `is_current_user_admin()` returns `false` for them, so the block doesn't render.

**Audit.** Because every reset writes a `rating_events` row, the future "rating history" view will show users `Admin reset: -123` entries the same way it shows game settlements. No silent zeros.

### Realtime broadcast

No new channel. Stake changes / opt-in toggles bump `rooms.version` like every other state mutation, so the existing `state_changed` event already covers them.

Settlement is a state mutation on the room → same path. The rating values themselves live outside the room, so they're not in the snapshot — the dedicated `get_my_rating()` RPC is how clients see their own balance.

### i18n

New keys (EN / RU / ES; following the existing flat key convention):

```
stakes.title              "Rating stakes" / "Игра на рейтинг" / "Apuesta de rating"
stakes.off                "Off" / "Выкл." / "Apagado"
stakes.optInBadge         "★ stake" / "★ ставка" / "★ apuesta"
stakes.optInToggle        "Play for rating" / "Играть на рейтинг" / "Jugar por rating"
stakes.guestHint          "Sign in to play for rating" / ...
stakes.unconfirmedHint    "Confirm your email to play for rating" / ...
stakes.lockedHint         "Stakes locked — game in progress"
stakes.settlementTitle    "Rating settlement"
stakes.deltaPositive      "+{{n}}"
stakes.deltaNegative      "{{n}}"   (already-signed)
stakes.newBalance         "New balance: {{n}}"
profile.rating            "Rating"
```

## Testing

- **Engine unit tests** (`supabase/functions/_shared/__tests__/`): pure function for `computeSettlement(scores, stake)` covering all-positive, all-negative, mixed, rounding-drift cases, `|S| < 2`, `stake = 0`.
- **Smoke (`tests/smoke/stakes-waitingroom.spec.ts`)**: host (logged in) sets stake; second player (guest) sees disabled toggle; third player (logged in) opts in; chips update across both clients via realtime.
- **e2e** (`tests/e2e/stakes-settlement.spec.ts`): 3-player game with 2 opted-in plays through to finished; verifies `rating_events` are written, `user_ratings.balance` updates, settlement modal appears for opt-in players, sum of deltas = 0.
- **Admin tests** (`supabase/functions/_shared/__tests__/admin_reset.test.ts`): off-list caller → `not_admin`; admin reset of one user writes journal row with `delta = -prior_balance` and sets balance to 0; reset-all skips zero-balance users and counts affected; non-zero balances all settle to zero.

## Open questions

- Should opt-in be exposed to the eligibility-blocked user as a *visible disabled toggle* (so they know the feature exists) or hidden entirely? **Proposal: visible-but-disabled with a "Sign in to play for rating" hint** — discoverability wins.
- Maximum stake cap (currently 25). Revisit once we see actual usage.
- Profile-level "rating history" view — deferred. The `rating_events` table is in place to support it whenever we want.
