# Rating Transfers — Design Spec

**Date:** 2026-05-25
**Status:** Approved (pre-implementation)
**Related:** `2026-05-23-conditional-stakes-design.md` (introduced `user_ratings` and `rating_events`)

## 1. Problem

Players accumulate rating points by playing for stakes (see Conditional Stakes spec). Today the balance is read-only — a player cannot gift points to another player. This spec adds peer-to-peer rating transfers.

## 2. Scope and decisions

In scope:

- A "Transfer" button on `ProfileScreen` (visible only when `balance > 0`).
- A modal that takes a recipient email and an integer amount, previews the recipient, and commits the transfer atomically.
- A "Recent operations" history block on `ProfileScreen` covering all `rating_events` (settle, admin_reset, transfer_in, transfer_out).

Out of scope (intentionally):

- Push / email / Telegram notifications to the recipient. The recipient sees the transfer the next time they open `ProfileScreen`.
- Daily limits, caps, or fees. Only invariants: `amount ≥ 1`, `amount ≤ sender.balance`, sender ≠ recipient.
- Lookup by display name. Display names are not unique. Email only.
- Transfers to or from guests / anonymous accounts. Both parties must be authenticated.
- Free-text comment / memo attached to the transfer.

## 3. Architecture

A single SECURITY DEFINER RPC `transfer_rating(p_to_email, p_amount)` performs the whole operation inside one transaction: locks both `user_ratings` rows, validates invariants, moves balances, writes two `rating_events` rows. A second RPC `lookup_rating_recipient(p_email)` powers the preview step — it returns the recipient's display name, avatar and a masked echo of the email, without revealing the recipient's balance.

A third RPC `get_my_rating_events(p_limit)` powers the history block.

Why RPC and not a new action in the `game-action` edge function: the transfer requires no admin gate, no room context, and benefits from being one DB round-trip. Edge actions are reserved for flows that need TS-side composition (admin search, settlement). A SECURITY DEFINER RPC with `auth.uid()` is sufficient.

## 4. Database changes

New migration: `supabase/migrations/20260525000000_rating_transfers.sql`.

### 4.1 Extend reason CHECK

```sql
ALTER TABLE public.rating_events DROP CONSTRAINT rating_events_reason_check;
ALTER TABLE public.rating_events
  ADD CONSTRAINT rating_events_reason_check
  CHECK (reason IN ('settle', 'admin_reset', 'transfer_in', 'transfer_out'));
```

### 4.2 Counterparty column

```sql
ALTER TABLE public.rating_events
  ADD COLUMN counterparty_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
```

NULL for `settle` and `admin_reset`. NOT NULL semantically for `transfer_*` (enforced in the RPC, not as a constraint, to keep historical rows valid if a counterparty account is later deleted — the FK cascades to SET NULL).

### 4.3 Relax columns that don't apply to transfers

```sql
ALTER TABLE public.rating_events
  ALTER COLUMN base_score DROP NOT NULL,
  ALTER COLUMN mean_score DROP NOT NULL,
  ALTER COLUMN stake      DROP NOT NULL;
```

For `settle` / `admin_reset` these stay populated. For `transfer_*` they are NULL.

### 4.4 RPC `lookup_rating_recipient(p_email text) RETURNS jsonb`

SECURITY DEFINER, `SET search_path = public, pg_catalog`. GRANT EXECUTE TO authenticated.

Behavior:

1. Resolve `v_from := auth.uid()`. If NULL → return `{ "ok": false, "error": "unauthenticated" }`.
2. `v_email := lower(trim(p_email))`. If not a syntactically valid email → return `{ "found": false }`.
3. SELECT `id, email, is_anonymous` from `auth.users` WHERE `lower(email) = v_email`.
   - Not found OR `is_anonymous = true` → `{ "found": false }`.
4. If `id = v_from` → `{ "found": true, "is_self": true }` (no other fields).
5. Else fetch latest `display_name` from `room_sessions` (ORDER BY `updated_at DESC` LIMIT 1) and avatar fields from `auth.users.raw_user_meta_data`.
6. Return:
```json
{
  "found": true,
  "is_self": false,
  "recipient": {
    "display_name":  "...",   // may be null if no session yet
    "masked_email":  "a***@gmail.com",
    "avatar":        "...",
    "avatar_url":    "...",
    "avatar_color":  "..."
  }
}
```

`masked_email` formula: first character of local-part + `***@` + domain. This is an echo of the searched email, not a leak.

### 4.5 RPC `transfer_rating(p_to_email text, p_amount integer) RETURNS jsonb`

SECURITY DEFINER, `SET search_path = public, pg_catalog`. GRANT EXECUTE TO authenticated.

Errors are returned in the result, not raised, so the client can handle them uniformly.

Pseudocode:

```
v_from := auth.uid()
if v_from is null            → return { ok: false, error: 'unauthenticated' }
if p_amount is null or < 1   → return { ok: false, error: 'invalid_amount' }

v_to_row := SELECT id, is_anonymous FROM auth.users WHERE lower(email) = lower(trim(p_to_email))
if v_to_row is null
   or v_to_row.is_anonymous  → return { ok: false, error: 'recipient_not_found' }
if v_to_row.id = v_from      → return { ok: false, error: 'self_transfer' }

-- ensure both rows exist before locking
INSERT INTO user_ratings (user_id, balance) VALUES (v_from, 0)
  ON CONFLICT (user_id) DO NOTHING;
INSERT INTO user_ratings (user_id, balance) VALUES (v_to_row.id, 0)
  ON CONFLICT (user_id) DO NOTHING;

-- lock in deterministic order to avoid deadlock
PERFORM 1 FROM user_ratings
  WHERE user_id IN (v_from, v_to_row.id)
  ORDER BY user_id
  FOR UPDATE;

SELECT balance INTO v_from_balance FROM user_ratings WHERE user_id = v_from;
if v_from_balance < p_amount → return { ok: false, error: 'insufficient_balance' }

UPDATE user_ratings SET balance = balance - p_amount, updated_at = now()
  WHERE user_id = v_from;
UPDATE user_ratings SET balance = balance + p_amount, updated_at = now()
  WHERE user_id = v_to_row.id;

INSERT INTO rating_events (user_id, room_id, reason, delta, counterparty_user_id)
  VALUES (v_from, NULL, 'transfer_out', -p_amount, v_to_row.id);
INSERT INTO rating_events (user_id, room_id, reason, delta, counterparty_user_id)
  VALUES (v_to_row.id, NULL, 'transfer_in', +p_amount, v_from);

-- fetch recipient preview for the success screen
v_recipient_name := <latest display_name from room_sessions>
v_recipient_mask := <masked email>

return {
  ok: true,
  new_balance: v_from_balance - p_amount,
  recipient: { display_name: v_recipient_name, masked_email: v_recipient_mask }
}
```

Error vocabulary returned to clients: `unauthenticated`, `invalid_amount`, `recipient_not_found`, `self_transfer`, `insufficient_balance`.

### 4.6 RPC `get_my_rating_events(p_limit integer DEFAULT 20) RETURNS jsonb`

SECURITY DEFINER, returns a JSON array sorted by `created_at DESC`. Each row:

```json
{
  "id": "...",
  "reason": "transfer_in",
  "delta": 50,
  "created_at": "2026-05-25T...",
  "counterparty_display_name": "Akula",
  "room_id": null
}
```

`counterparty_display_name` is fetched via LEFT JOIN on `room_sessions` (latest by `updated_at`). NULL when `counterparty_user_id` is NULL or the counterparty has never had a session row.

GRANT EXECUTE TO authenticated. Filters by `user_id = auth.uid()` — RLS on `rating_events` already enforces self-select, but explicit predicate keeps the query plan tight.

## 5. Client — `src/lib/gameClient.ts`

Three new methods:

```ts
async lookupRatingRecipient(email: string): Promise<{
  found: boolean;
  is_self?: boolean;
  recipient?: {
    display_name: string | null;
    masked_email: string;
    avatar: string | null;
    avatar_url: string | null;
    avatar_color: string | null;
  };
}>;

async transferRating(toEmail: string, amount: number): Promise<{
  ok: boolean;
  error?: 'unauthenticated' | 'invalid_amount' | 'recipient_not_found'
        | 'self_transfer' | 'insufficient_balance';
  new_balance?: number;
  recipient?: { display_name: string | null; masked_email: string };
}>;

async getMyRatingEvents(limit?: number): Promise<RatingEvent[]>;
```

Type shared with the store:

```ts
export type RatingEvent = {
  id: string;
  reason: 'settle' | 'admin_reset' | 'transfer_in' | 'transfer_out';
  delta: number;
  created_at: string;
  counterparty_display_name: string | null;
  room_id: string | null;
};
```

## 6. Client — `src/store/ratingStore.ts`

Extend the existing store:

- New field `events: RatingEvent[]`, `eventsLoading: boolean`.
- New method `loadEvents()` → calls `gameClient.getMyRatingEvents()` and updates `events`.
- New method `transfer(email, amount)` → calls `gameClient.transferRating`. On `ok=true`, sets `balance = new_balance` and triggers `loadEvents()`. On error, returns the error code to the caller without mutating state.

Recipient lookup state lives in the modal, not in the store — it is per-flow and never needs to outlive the modal.

## 7. UI — `ProfileScreen.tsx`

### 7.1 Transfer entry point

Inside the existing `profile-rating-row`, to the right of the balance number, add a button labelled `t('profile.transferRating.button', 'Перевести')`. testID `btn-transfer-rating`. Rendered only when `balance > 0`. Tapping opens `TransferRatingModal`.

### 7.2 History block

A new section directly below `profile-rating-row`, testID `profile-rating-history`. Title from `t('profile.history.title', 'Последние операции')`. Loaded via `ratingStore.loadEvents()` on screen mount. Displays the last 10 events (slice client-side from the loaded 20).

Each row:

| Reason          | Icon | Text                                                        | Δ color                  |
| --------------- | ---- | ----------------------------------------------------------- | ------------------------ |
| `transfer_out`  | `↗`  | `Перевод игроку {counterparty_display_name ?? '—'}`         | `colors.danger`          |
| `transfer_in`   | `↙`  | `Перевод от {counterparty_display_name ?? '—'}`             | `colors.success`         |
| `settle`        | `🏆` | `Розыгрыш в комнате`                                        | success if Δ>0 else danger |
| `admin_reset`   | `⚙`  | `Сброс администратором`                                     | `colors.textSecondary` (neutral, regardless of sign — operational event, not a loss) |

Date on the right, small (`HH:MM` for today, `DD MMM` otherwise).

Empty state: text `t('profile.history.empty', 'Пока нет операций')`.

## 8. UI — `src/screens/TransferRatingModal.tsx`

Single React component with internal state `step: 'form' | 'preview' | 'success'`.

### 8.1 Step: form

```
┌─ Перевод очков рейтинга ──────────[×]┐
│ Ваш баланс: 142                       │
│                                       │
│ Email получателя                      │
│ ┌───────────────────────────────────┐ │  testID input-recipient-email
│ │ player@example.com                │ │  keyboardType email-address, autoCap none
│ └───────────────────────────────────┘ │
│                                       │
│ Сумма                                 │
│ ┌───────────────────────────────────┐ │  testID input-transfer-amount
│ │ 50                                │ │  keyboardType numeric
│ └───────────────────────────────────┘ │
│                                       │
│        [   Найти получателя   ]       │  testID btn-lookup-recipient
└───────────────────────────────────────┘
```

- "Найти получателя" disabled while email does not pass a simple regex (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), or `amount < 1`, or `amount > balance`.
- Inline error under amount when `amount > balance`: `t('profile.transferRating.modal.amountTooHigh', 'Не больше {{max}}')`.
- On tap → `gameClient.lookupRatingRecipient(email)`:
  - `is_self === true` → inline error under email `t('...error.selfTransfer')`, stay on form.
  - `found === false` → inline error `t('...error.recipientNotFound')`, stay on form.
  - `found === true && !is_self` → set `recipient` in local state, go to `step='preview'`.

### 8.2 Step: preview

```
┌─ Подтверждение перевода ──────────[×]┐
│      ┌───┐                            │
│      │🦈 │  Akula                     │
│      └───┘  a***@gmail.com            │
│                                       │
│      Вы переводите:  50 очков         │
│      Останется:      92 очка          │
│                                       │
│   [  ← Назад  ]   [ Перевести 50 ]    │
└───────────────────────────────────────┘
```

testIDs `btn-transfer-back`, `btn-transfer-confirm`.

If `recipient.display_name` is null (recipient registered but never joined a room), render `masked_email` in place of the display name and omit the second line.

On confirm → `ratingStore.transfer(email, amount)`:

- `ok === true` → `step='success'`. Balance and events are already refreshed by the store.
- `error === 'insufficient_balance'` (race: another tab / game settled in between) → toast `t('...error.insufficientBalance')`, return to `step='form'`.
- `error === 'recipient_not_found'` (recipient deleted between steps) → toast, return to `step='form'`.
- Any other error → toast `t('...error.unknown')`, stay on preview.

### 8.3 Step: success

```
┌─ Готово ──────────────────────────[×]┐
│              ✓                        │
│   50 очков отправлено игроку Akula    │
│                                       │
│        Ваш баланс: 92                 │
│                                       │
│           [   Закрыть   ]             │  testID btn-transfer-done
└───────────────────────────────────────┘
```

Closing returns to `ProfileScreen` where the new balance and history row are already visible.

## 9. i18n keys

Add to `src/i18n/locales/en.json`, `ru.json`, `es.json`:

```
profile.transferRating.button
profile.transferRating.modal.title
profile.transferRating.modal.balance
profile.transferRating.modal.emailLabel
profile.transferRating.modal.amountLabel
profile.transferRating.modal.amountTooHigh        // takes {max}
profile.transferRating.modal.lookup
profile.transferRating.modal.invalidEmail

profile.transferRating.preview.title
profile.transferRating.preview.youSend            // takes {amount}
profile.transferRating.preview.willRemain         // takes {balance}
profile.transferRating.preview.back
profile.transferRating.preview.confirm            // takes {amount}

profile.transferRating.success.title
profile.transferRating.success.message            // takes {amount, recipient}
profile.transferRating.success.close

profile.transferRating.error.selfTransfer
profile.transferRating.error.recipientNotFound
profile.transferRating.error.insufficientBalance
profile.transferRating.error.unknown

profile.history.title
profile.history.empty
profile.history.transferOut                       // takes {name}
profile.history.transferIn                        // takes {name}
profile.history.settle
profile.history.adminReset
```

EN copy is canonical; RU and ES translations follow `project_nagels_terminology` conventions.

## 10. Testing and side effects

- No DB-level unit tests in this repo today; the migration is validated through `npm run smoke`.
- New testIDs (`btn-transfer-rating`, `input-recipient-email`, `input-transfer-amount`, `btn-lookup-recipient`, `btn-transfer-back`, `btn-transfer-confirm`, `btn-transfer-done`, `profile-rating-history`) will appear in `npm run test:lint -- --update-todo` output; surfaced in the final user message per CLAUDE.md §"Keeping tests in sync".
- Smoke (`npm run smoke`) must continue to pass — the feature only adds UI on `ProfileScreen` and new RPCs.
- No external side effects: pure RPC + UI. No Telegram, no push, no email. Compliant with `docs/principles.md` §8.

## 11. Concurrency, safety and edge cases

- Both `user_ratings` rows are locked `FOR UPDATE` in `user_id` order before the balance check — prevents the classic double-spend race when a player taps Confirm twice or runs two tabs.
- Sender's balance check happens after the lock, so a parallel `settle` writing to the same row will be serialized.
- Counterparty FK is `ON DELETE SET NULL` — if a counterparty deletes their auth account later, history rows survive but show `—` in place of a name. This matches existing handling of `rooms` deletion in `rating_events.room_id`.
- The preview-step recipient may technically change between lookup and confirm (rename, account deletion). The confirm RPC re-resolves the email; stale preview data does not corrupt the transfer.
- Anonymous / guest auth users are excluded from both lookup and lookup-by-id-during-transfer via `is_anonymous = true`. Guests cannot receive transfers (would have no account to read the balance back from).
- The masked email is computed server-side. The client never sees the recipient's full email.
