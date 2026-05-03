-- play_card_action server-side enforced "must follow suit" but never
-- implemented Nägels' Jack-of-trump exception that the client engine
-- already had: when the lead suit IS the trump suit AND the player's
-- only remaining trumps are Jacks, they may withhold the Jack and play
-- an off-suit card.
--
-- Effect of the missing rule: a player with J♣ + non-trump cards (and
-- no other clubs) on a clubs-trump-led trick was forced by the server
-- to play J♣. They couldn't keep the Jack for a stronger trick. Olya's
-- complaint: "была вынуждена ходить Валетом, хотя по правилам можно
-- его попридержать."
--
-- Rule mirrors src/../engine/rules.ts: hasOnlyJackTrump(handCards,
-- trumpSuit) — true iff every remaining trump card in the hand is a
-- Jack. When that flag is true and the lead suit equals trump, the
-- must_follow_suit check is bypassed.

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
  v_state          JSONB;
  v_hand           public.hands%ROWTYPE;
  v_room           public.rooms%ROWTYPE;
  v_seat           INT;
  v_trick          public.tricks%ROWTYPE;
  v_lead_card      TEXT;
  v_card_suit      TEXT;
  v_lead_suit      TEXT;
  v_has_lead       BOOLEAN;
  v_only_jack_trumps BOOLEAN;
  v_played_count   INT;
  v_num_players    INT;
  v_winner_seat    INT;
  v_cards          JSONB;
  v_next_seat      INT;
  v_owns           BOOLEAN;
  v_already_used   BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_room_id::text));

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'room_not_found',
      'state', '{}'::jsonb, 'version', 0);
  END IF;

  SELECT * INTO v_hand FROM public.hands WHERE id = p_hand_id;
  IF NOT FOUND OR v_hand.room_id <> p_room_id THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', 'hand_not_found',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  IF v_hand.phase <> 'playing' THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_phase',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  SELECT seat_index INTO v_seat
    FROM public.room_players
   WHERE room_id = p_room_id AND session_id = p_session_id;
  IF v_seat IS NULL THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', 'not_in_room',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  IF v_seat <> v_hand.current_seat THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', 'not_your_turn',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.dealt_cards
    WHERE hand_id = p_hand_id AND session_id = p_session_id AND card = p_card
  ) INTO v_owns;
  IF NOT v_owns THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', 'card_not_in_hand',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.trick_cards tc
      JOIN public.tricks t ON t.id = tc.trick_id
     WHERE t.hand_id = p_hand_id AND tc.seat_index = v_seat AND tc.card = p_card
  ) INTO v_already_used;
  IF v_already_used THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', 'card_already_played',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  SELECT * INTO v_trick FROM public.tricks
   WHERE hand_id = p_hand_id AND closed_at IS NULL
   ORDER BY trick_number DESC LIMIT 1;
  IF NOT FOUND THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', 'no_open_trick',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  SELECT card INTO v_lead_card FROM public.trick_cards
   WHERE trick_id = v_trick.id ORDER BY played_at LIMIT 1;

  v_card_suit := split_part(p_card, '-', 1);
  v_lead_suit := CASE WHEN v_lead_card IS NULL THEN NULL ELSE split_part(v_lead_card, '-', 1) END;

  IF v_lead_suit IS NOT NULL
     AND v_card_suit <> v_lead_suit
     AND v_card_suit <> v_hand.trump_suit
  THEN
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
      -- JACK-OF-TRUMP EXCEPTION: when the lead suit IS the trump suit
      -- and the player's only remaining trumps are Jacks, they may
      -- withhold the Jack and play an off-suit card. Mirrors the
      -- client engine's hasOnlyJackTrump rule (rules.ts).
      v_only_jack_trumps := FALSE;
      IF v_lead_suit = v_hand.trump_suit THEN
        SELECT NOT EXISTS (
          SELECT 1 FROM public.dealt_cards dc
          WHERE dc.hand_id = p_hand_id AND dc.session_id = p_session_id
            AND split_part(dc.card, '-', 1) = v_hand.trump_suit
            AND split_part(dc.card, '-', 2) <> 'J'
            AND NOT EXISTS (
              SELECT 1 FROM public.trick_cards tc
                JOIN public.tricks t ON t.id = tc.trick_id
                WHERE t.hand_id = p_hand_id
                  AND tc.seat_index = v_seat
                  AND tc.card = dc.card
            )
        ) INTO v_only_jack_trumps;
      END IF;

      IF NOT v_only_jack_trumps THEN
        SELECT public.get_room_state(p_room_id) INTO v_state;
        RETURN jsonb_build_object('ok', false, 'error', 'must_follow_suit',
          'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
      END IF;
    END IF;
  END IF;

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

  SELECT COUNT(*) INTO v_played_count FROM public.trick_cards WHERE trick_id = v_trick.id;
  SELECT COUNT(*) INTO v_num_players FROM public.room_players WHERE room_id = p_room_id;

  IF v_played_count = v_num_players THEN
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

    PERFORM public.increment_taken_tricks(p_hand_id, (
      SELECT session_id FROM public.room_players
       WHERE room_id = p_room_id AND seat_index = v_winner_seat
    ));

    IF (SELECT COUNT(*) FROM public.trick_cards
          JOIN public.tricks t ON t.id = trick_cards.trick_id
         WHERE t.hand_id = p_hand_id) = v_hand.cards_per_player * v_num_players THEN
      UPDATE public.hands
         SET phase = 'scoring', closed_at = now()
       WHERE id = p_hand_id;
      UPDATE public.hand_scores
         SET hand_score = public._compute_hand_score(bet, taken_tricks)
       WHERE hand_id = p_hand_id;
    ELSE
      INSERT INTO public.tricks (hand_id, trick_number, lead_seat)
      VALUES (p_hand_id, v_trick.trick_number + 1, v_winner_seat);
      UPDATE public.hands SET current_seat = v_winner_seat WHERE id = p_hand_id;
    END IF;
  ELSE
    v_next_seat := (v_seat + 1) % v_num_players;
    UPDATE public.hands SET current_seat = v_next_seat WHERE id = p_hand_id;
  END IF;

  UPDATE public.rooms SET version = version + 1, updated_at = now() WHERE id = p_room_id;

  SELECT public.get_room_state(p_room_id) INTO v_state;
  RETURN jsonb_build_object('ok', true, 'error', NULL,
    'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
END;
$$;
