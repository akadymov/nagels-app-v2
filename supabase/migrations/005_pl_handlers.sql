BEGIN;

-- ============================================================
-- place_bet_action — atomic, transaction-scoped lock
-- Returns: { ok: bool, error: text|null, state: jsonb, version: bigint }
-- ============================================================
CREATE OR REPLACE FUNCTION public.place_bet_action(
  p_room_id    UUID,
  p_session_id UUID,
  p_hand_id    UUID,
  p_bet        INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_hand            RECORD;
  v_seat            INT;
  v_num_players     INT;
  v_bets_so_far     INT;
  v_sum_so_far      INT;
  v_is_last_bidder  BOOLEAN;
  v_next_seat       INT;
  v_next_phase      TEXT;
  v_new_version     BIGINT;
  v_state           JSONB;
BEGIN
  -- 1. Per-room serialization: held for the duration of this transaction.
  PERFORM pg_advisory_xact_lock(hashtext(p_room_id::text));

  -- 2. Read the hand row with FOR UPDATE so subsequent reads see the same view.
  SELECT * INTO v_hand FROM public.hands
  WHERE id = p_hand_id AND room_id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object(
      'ok', false, 'error', 'unknown_hand',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0)
    );
  END IF;

  IF v_hand.phase <> 'betting' THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object(
      'ok', false, 'error', 'not_in_betting',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0)
    );
  END IF;

  -- 3. Caller must be sitting at current_seat.
  SELECT seat_index INTO v_seat FROM public.room_players
  WHERE room_id = p_room_id AND session_id = p_session_id;

  IF v_seat IS NULL THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object(
      'ok', false, 'error', 'not_in_room',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0)
    );
  END IF;

  IF v_seat <> v_hand.current_seat THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object(
      'ok', false, 'error', 'not_your_turn',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0)
    );
  END IF;

  -- 4. Bet range.
  IF p_bet < 0 OR p_bet > v_hand.cards_per_player THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object(
      'ok', false, 'error', 'invalid_bet',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0)
    );
  END IF;

  -- 5. Last-bidder rule (sum of bets ≠ tricks available).
  SELECT COUNT(*), COALESCE(SUM(bet), 0) INTO v_bets_so_far, v_sum_so_far
  FROM public.hand_scores WHERE hand_id = p_hand_id;

  SELECT COUNT(*) INTO v_num_players FROM public.room_players WHERE room_id = p_room_id;
  v_is_last_bidder := (v_bets_so_far = v_num_players - 1);

  IF v_is_last_bidder AND (v_sum_so_far + p_bet) = v_hand.cards_per_player THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object(
      'ok', false, 'error', 'someone_must_be_unhappy',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0)
    );
  END IF;

  -- 6. Insert. UNIQUE(hand_id, session_id) catches double-bet race.
  BEGIN
    INSERT INTO public.hand_scores (hand_id, session_id, bet)
    VALUES (p_hand_id, p_session_id, p_bet);
  EXCEPTION WHEN unique_violation THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object(
      'ok', false, 'error', 'already_bet',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0)
    );
  END;

  -- 7. Determine next seat / phase.
  v_bets_so_far := v_bets_so_far + 1;
  IF v_bets_so_far = v_num_players THEN
    -- All bets in: switch to playing, lead = starting_seat, create trick 1.
    v_next_seat  := v_hand.starting_seat;
    v_next_phase := 'playing';
    INSERT INTO public.tricks (hand_id, trick_number, lead_seat)
    VALUES (p_hand_id, 1, v_next_seat);
  ELSE
    v_next_seat  := (v_hand.current_seat + 1) % v_num_players;
    v_next_phase := 'betting';
  END IF;

  UPDATE public.hands
     SET current_seat = v_next_seat,
         phase        = v_next_phase
   WHERE id = p_hand_id;

  -- 8. Audit + version bump.
  INSERT INTO public.game_events (room_id, hand_id, session_id, kind, payload)
  VALUES (p_room_id, p_hand_id, p_session_id, 'bet',
          jsonb_build_object('bet', p_bet, 'seat', v_seat));

  UPDATE public.rooms SET version = version + 1 WHERE id = p_room_id
    RETURNING version INTO v_new_version;

  -- 9. Return fresh snapshot.
  SELECT public.get_room_state(p_room_id) INTO v_state;
  RETURN jsonb_build_object(
    'ok', true, 'state', v_state, 'version', v_new_version
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.place_bet_action(UUID, UUID, UUID, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.place_bet_action(UUID, UUID, UUID, INT) TO service_role;

-- ============================================================
-- play_card_action — atomic, transaction-scoped lock
-- Returns: { ok: bool, error: text|null, state: jsonb, version: bigint }
-- ============================================================
CREATE OR REPLACE FUNCTION public.play_card_action(
  p_room_id    UUID,
  p_session_id UUID,
  p_hand_id    UUID,
  p_card       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_hand            RECORD;
  v_seat            INT;
  v_num_players     INT;
  v_trick           RECORD;
  v_lead_card       TEXT;
  v_played_count    INT;
  v_new_version     BIGINT;
  v_winner_seat     INT;
  v_winner_session  UUID;
  v_closed_tricks   INT;
  v_state           JSONB;
  v_card_suit       TEXT;
  v_lead_suit       TEXT;
  v_has_lead        BOOLEAN;
  v_cards           JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_room_id::text));

  SELECT * INTO v_hand FROM public.hands
  WHERE id = p_hand_id AND room_id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_hand',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  IF v_hand.phase <> 'playing' THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', 'not_in_playing',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  SELECT seat_index INTO v_seat FROM public.room_players
  WHERE room_id = p_room_id AND session_id = p_session_id;
  IF v_seat IS NULL OR v_seat <> v_hand.current_seat THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', 'not_your_turn',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  -- Card must be dealt to caller.
  PERFORM 1 FROM public.dealt_cards
   WHERE hand_id = p_hand_id AND session_id = p_session_id AND card = p_card;
  IF NOT FOUND THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', 'card_not_in_hand',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  -- Find the open trick.
  SELECT * INTO v_trick FROM public.tricks
   WHERE hand_id = p_hand_id AND closed_at IS NULL
   ORDER BY trick_number DESC LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', 'no_open_trick',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  -- Lead suit (if any) and follow-suit check.
  SELECT card INTO v_lead_card FROM public.trick_cards
   WHERE trick_id = v_trick.id ORDER BY played_at LIMIT 1;

  v_card_suit := split_part(p_card, '-', 1);
  v_lead_suit := CASE WHEN v_lead_card IS NULL THEN NULL ELSE split_part(v_lead_card, '-', 1) END;

  IF v_lead_suit IS NOT NULL AND v_card_suit <> v_lead_suit THEN
    SELECT EXISTS (
      SELECT 1 FROM public.dealt_cards dc
      WHERE dc.hand_id = p_hand_id AND dc.session_id = p_session_id
        AND split_part(dc.card, '-', 1) = v_lead_suit
        AND NOT EXISTS (
          SELECT 1 FROM public.trick_cards tc
            JOIN public.tricks t ON t.id = tc.trick_id
            WHERE t.hand_id = p_hand_id
              AND tc.seat_index = v_seat
              AND tc.card = dc.card
        )
    ) INTO v_has_lead;
    IF v_has_lead THEN
      SELECT public.get_room_state(p_room_id) INTO v_state;
      RETURN jsonb_build_object('ok', false, 'error', 'must_follow_suit',
        'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
    END IF;
  END IF;

  -- Insert. UNIQUE(trick_id, seat_index) handles double-play race.
  BEGIN
    INSERT INTO public.trick_cards (trick_id, seat_index, card)
    VALUES (v_trick.id, v_seat, p_card);
  EXCEPTION WHEN unique_violation THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', 'already_played',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END;

  INSERT INTO public.game_events (room_id, hand_id, session_id, kind, payload)
  VALUES (p_room_id, p_hand_id, p_session_id, 'play_card',
          jsonb_build_object('card', p_card, 'seat', v_seat, 'trick_id', v_trick.id));

  -- Trick complete?
  SELECT COUNT(*) INTO v_played_count FROM public.trick_cards WHERE trick_id = v_trick.id;
  SELECT COUNT(*) INTO v_num_players FROM public.room_players WHERE room_id = p_room_id;

  IF v_played_count = v_num_players THEN
    -- Settle the trick.
    SELECT jsonb_agg(jsonb_build_object(
      'seat', tc.seat_index,
      'suit', split_part(tc.card, '-', 1),
      'rank', split_part(tc.card, '-', 2)
    ) ORDER BY tc.played_at) INTO v_cards
    FROM public.trick_cards tc WHERE tc.trick_id = v_trick.id;

    v_winner_seat := public._determine_trick_winner(v_cards, v_hand.trump_suit);

    UPDATE public.tricks
       SET winner_seat = v_winner_seat, closed_at = now()
     WHERE id = v_trick.id;

    SELECT session_id INTO v_winner_session
      FROM public.room_players
     WHERE room_id = p_room_id AND seat_index = v_winner_seat;
    UPDATE public.hand_scores
       SET taken_tricks = taken_tricks + 1
     WHERE hand_id = p_hand_id AND session_id = v_winner_session;

    SELECT COUNT(*) INTO v_closed_tricks
      FROM public.tricks WHERE hand_id = p_hand_id AND closed_at IS NOT NULL;

    IF v_closed_tricks = v_hand.cards_per_player THEN
      -- Hand done — compute scores per player.
      UPDATE public.hand_scores
         SET hand_score = public._compute_hand_score(bet, taken_tricks)
       WHERE hand_id = p_hand_id;

      UPDATE public.hands
         SET phase = 'scoring', closed_at = now()
       WHERE id = p_hand_id;
    ELSE
      -- Open next trick. Lead = winner.
      INSERT INTO public.tricks (hand_id, trick_number, lead_seat)
      VALUES (p_hand_id, v_trick.trick_number + 1, v_winner_seat);
      UPDATE public.hands SET current_seat = v_winner_seat WHERE id = p_hand_id;
    END IF;
  ELSE
    UPDATE public.hands
       SET current_seat = (v_seat + 1) % v_num_players
     WHERE id = p_hand_id;
  END IF;

  UPDATE public.rooms SET version = version + 1 WHERE id = p_room_id
    RETURNING version INTO v_new_version;

  SELECT public.get_room_state(p_room_id) INTO v_state;
  RETURN jsonb_build_object('ok', true, 'state', v_state, 'version', v_new_version);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.play_card_action(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.play_card_action(UUID, UUID, UUID, TEXT) TO service_role;

-- ============================================================
-- Helper: determine trick winner given cards and trump suit
-- ============================================================
CREATE OR REPLACE FUNCTION public._determine_trick_winner(
  p_cards JSONB,    -- [{ seat, suit, rank }] in play order
  p_trump TEXT
)
RETURNS INT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_lead_suit  TEXT;
  v_card       JSONB;
  v_winner     JSONB;
  v_w_is_trump BOOLEAN;
  v_c_is_trump BOOLEAN;
  v_w_rank     INT;
  v_c_rank     INT;
  v_w_suit     TEXT;
  v_c_suit     TEXT;
BEGIN
  v_lead_suit := p_cards->0->>'suit';
  v_winner := p_cards->0;
  FOR i IN 1 .. jsonb_array_length(p_cards) - 1 LOOP
    v_card := p_cards->i;
    v_w_suit := v_winner->>'suit';
    v_c_suit := v_card->>'suit';
    v_w_is_trump := (v_w_suit = p_trump);
    v_c_is_trump := (v_c_suit = p_trump);
    v_w_rank := public._rank_to_int(v_winner->>'rank');
    v_c_rank := public._rank_to_int(v_card->>'rank');

    IF v_c_is_trump AND NOT v_w_is_trump THEN
      v_winner := v_card;
    ELSIF v_c_is_trump AND v_w_is_trump AND v_c_rank > v_w_rank THEN
      v_winner := v_card;
    ELSIF NOT v_c_is_trump AND NOT v_w_is_trump
          AND v_c_suit = v_lead_suit AND v_w_suit = v_lead_suit
          AND v_c_rank > v_w_rank THEN
      v_winner := v_card;
    END IF;
  END LOOP;
  RETURN (v_winner->>'seat')::int;
END;
$$;

CREATE OR REPLACE FUNCTION public._rank_to_int(p_rank TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_rank
    WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8
    WHEN '9' THEN 9 WHEN '10' THEN 10
    WHEN 'J' THEN 11 WHEN 'Q' THEN 12 WHEN 'K' THEN 13 WHEN 'A' THEN 14
    ELSE 0 END;
$$;

-- ============================================================
-- Helper: compute hand score from bet + tricks (Nagels rules)
--   Exact = 10 + bet
--   Off   = -|bet - taken|  (negative)
-- ============================================================
CREATE OR REPLACE FUNCTION public._compute_hand_score(p_bet INT, p_taken INT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_bet = p_taken THEN 10 + p_bet
    ELSE -ABS(p_bet - p_taken)
  END;
$$;

COMMIT;
