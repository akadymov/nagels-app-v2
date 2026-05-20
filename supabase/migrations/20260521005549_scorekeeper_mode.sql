-- Scorekeeper mode: offline games where players record trick results
-- manually instead of playing cards through the app. No cards are dealt;
-- after betting, the hand sits in a new 'tricks_recording' phase until
-- every seated player has called record_tricks_action and the sum of
-- recorded tricks equals cards_per_player. Mismatch keeps the phase
-- so players can correct their inputs.

-- 1. Mode flag on rooms (fixed at create time).
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE public.rooms
  DROP CONSTRAINT IF EXISTS rooms_mode_check;
ALTER TABLE public.rooms
  ADD CONSTRAINT rooms_mode_check
  CHECK (mode IN ('standard', 'scorekeeper'));

-- 2. Allow new 'tricks_recording' phase on hands.
ALTER TABLE public.hands DROP CONSTRAINT IF EXISTS hands_phase_check;
ALTER TABLE public.hands
  ADD CONSTRAINT hands_phase_check
  CHECK (phase = ANY (ARRAY[
    'betting'::text,
    'playing'::text,
    'tricks_recording'::text,
    'scoring'::text,
    'closed'::text
  ]));

-- 3. place_bet_action: when room.mode='scorekeeper' and this is the last bet,
--    go to 'tricks_recording' instead of 'playing' and skip the tricks INSERT.
CREATE OR REPLACE FUNCTION "public"."place_bet_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_bet" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_hand            RECORD;
  v_room_mode       TEXT;
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
  PERFORM pg_advisory_xact_lock(hashtext(p_room_id::text));

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

  SELECT mode INTO v_room_mode FROM public.rooms WHERE id = p_room_id;

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

  IF p_bet < 0 OR p_bet > v_hand.cards_per_player THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object(
      'ok', false, 'error', 'invalid_bet',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0)
    );
  END IF;

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

  v_bets_so_far := v_bets_so_far + 1;
  IF v_bets_so_far = v_num_players THEN
    v_next_seat  := v_hand.starting_seat;
    IF v_room_mode = 'scorekeeper' THEN
      -- Offline mode: skip tricks INSERT, freeze in tricks_recording until
      -- record_tricks_action collects every player's claim.
      v_next_phase := 'tricks_recording';
    ELSE
      v_next_phase := 'playing';
      INSERT INTO public.tricks (hand_id, trick_number, lead_seat)
      VALUES (p_hand_id, 1, v_next_seat);
    END IF;
  ELSE
    v_next_seat  := (v_hand.current_seat + 1) % v_num_players;
    v_next_phase := 'betting';
  END IF;

  UPDATE public.hands
     SET current_seat = v_next_seat,
         phase        = v_next_phase
   WHERE id = p_hand_id;

  INSERT INTO public.game_events (room_id, hand_id, session_id, kind, payload)
  VALUES (p_room_id, p_hand_id, p_session_id, 'bet',
          jsonb_build_object('bet', p_bet, 'seat', v_seat));

  UPDATE public.rooms SET version = version + 1 WHERE id = p_room_id
    RETURNING version INTO v_new_version;

  SELECT public.get_room_state(p_room_id) INTO v_state;
  RETURN jsonb_build_object(
    'ok', true, 'state', v_state, 'version', v_new_version
  );
END;
$$;

-- 4. record_tricks_action: scorekeeper-only RPC. Writes the caller's claim
--    into hand_scores.taken_tricks and emits a 'claim_tricks' game_event.
--    When every seated player has claimed AND the sum equals cards_per_player,
--    flips the hand to 'scoring' and computes hand_score (matching the
--    normal play_card_action closing path). Mismatch keeps phase as-is so
--    players can adjust.
CREATE OR REPLACE FUNCTION "public"."record_tricks_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_tricks" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_room_mode    TEXT;
  v_hand         RECORD;
  v_num_players  INT;
  v_claimed      INT;
  v_sum          INT;
  v_updated      INT;
  v_new_version  BIGINT;
  v_state        JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_room_id::text));

  SELECT mode INTO v_room_mode FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF v_room_mode IS NULL THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object(
      'ok', false, 'error', 'unknown_room',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0)
    );
  END IF;

  IF v_room_mode <> 'scorekeeper' THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object(
      'ok', false, 'error', 'not_scorekeeper',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0)
    );
  END IF;

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

  IF v_hand.phase <> 'tricks_recording' THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object(
      'ok', false, 'error', 'wrong_phase',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0)
    );
  END IF;

  IF p_tricks < 0 OR p_tricks > v_hand.cards_per_player THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object(
      'ok', false, 'error', 'invalid_tricks',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0)
    );
  END IF;

  UPDATE public.hand_scores
     SET taken_tricks = p_tricks
   WHERE hand_id = p_hand_id AND session_id = p_session_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    -- Caller never placed a bet for this hand → not allowed to record.
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object(
      'ok', false, 'error', 'no_bet',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0)
    );
  END IF;

  INSERT INTO public.game_events (room_id, hand_id, session_id, kind, payload)
  VALUES (p_room_id, p_hand_id, p_session_id, 'claim_tricks',
          jsonb_build_object('tricks', p_tricks));

  SELECT COUNT(*) INTO v_num_players FROM public.room_players WHERE room_id = p_room_id;
  SELECT COUNT(DISTINCT session_id) INTO v_claimed
    FROM public.game_events
   WHERE hand_id = p_hand_id AND kind = 'claim_tricks';
  SELECT COALESCE(SUM(taken_tricks), 0) INTO v_sum
    FROM public.hand_scores WHERE hand_id = p_hand_id;

  IF v_claimed = v_num_players AND v_sum = v_hand.cards_per_player THEN
    UPDATE public.hands
       SET phase = 'scoring', closed_at = now()
     WHERE id = p_hand_id;
    UPDATE public.hand_scores
       SET hand_score = public._compute_hand_score(bet, taken_tricks)
     WHERE hand_id = p_hand_id;
  END IF;

  UPDATE public.rooms SET version = version + 1 WHERE id = p_room_id
    RETURNING version INTO v_new_version;

  SELECT public.get_room_state(p_room_id) INTO v_state;
  RETURN jsonb_build_object(
    'ok', true, 'state', v_state, 'version', v_new_version
  );
END;
$$;

ALTER FUNCTION "public"."record_tricks_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_tricks" integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."record_tricks_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_tricks" integer) FROM PUBLIC;
GRANT  ALL ON FUNCTION "public"."record_tricks_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_tricks" integer) TO "anon";
GRANT  ALL ON FUNCTION "public"."record_tricks_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_tricks" integer) TO "authenticated";
GRANT  ALL ON FUNCTION "public"."record_tricks_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_tricks" integer) TO "service_role";

-- 5. Surface rooms.mode through get_room_state so the client snapshot
--    can drive scorekeeper UI without an extra round-trip.
CREATE OR REPLACE FUNCTION "public"."get_room_state"("p_room_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  WITH
  room AS (
    SELECT id, code, host_session_id, player_count, max_cards, min_cards_per_hand,
           mode, phase, current_hand_id, version
    FROM public.rooms WHERE id = p_room_id
  ),
  players AS (
    SELECT json_agg(jsonb_build_object(
      'session_id',   rp.session_id,
      'display_name', rs.display_name,
      'seat_index',   rp.seat_index,
      'is_ready',     rp.is_ready,
      'is_connected', rp.is_connected,
      'last_seen_at', rp.last_seen_at,
      'avatar',       au.raw_user_meta_data->>'avatar',
      'avatar_color', au.raw_user_meta_data->>'avatar_color'
    ) ORDER BY rp.seat_index) AS list
    FROM public.room_players rp
    JOIN public.room_sessions rs ON rs.id = rp.session_id
    LEFT JOIN auth.users au ON au.id = rs.auth_user_id
    WHERE rp.room_id = p_room_id
  ),
  spectators AS (
    SELECT json_agg(jsonb_build_object(
      'session_id',   rsp.session_id,
      'display_name', rs.display_name,
      'avatar',       au.raw_user_meta_data->>'avatar',
      'avatar_color', au.raw_user_meta_data->>'avatar_color',
      'joined_at',    rsp.joined_at
    ) ORDER BY rsp.joined_at) AS list
    FROM public.room_spectators rsp
    JOIN public.room_sessions rs ON rs.id = rsp.session_id
    LEFT JOIN auth.users au ON au.id = rs.auth_user_id
    WHERE rsp.room_id = p_room_id
  ),
  current_hand AS (
    SELECT to_jsonb(h.*) AS row
    FROM public.hands h
    JOIN room ON room.current_hand_id = h.id
  ),
  hand_scores AS (
    SELECT json_agg(to_jsonb(hs.*)) AS list
    FROM public.hand_scores hs
    JOIN current_hand ch ON (ch.row ->> 'id')::uuid = hs.hand_id
  ),
  current_trick AS (
    SELECT jsonb_build_object(
      'id',           t.id,
      'trick_number', t.trick_number,
      'lead_seat',    t.lead_seat,
      'winner_seat',  t.winner_seat,
      'cards',        COALESCE((
        SELECT json_agg(jsonb_build_object('seat', tc.seat_index, 'card', tc.card)
                        ORDER BY tc.played_at)
        FROM public.trick_cards tc WHERE tc.trick_id = t.id
      ), '[]'::json)
    ) AS row
    FROM public.tricks t
    JOIN current_hand ch ON (ch.row ->> 'id')::uuid = t.hand_id
    WHERE t.closed_at IS NULL
    ORDER BY t.trick_number DESC
    LIMIT 1
  ),
  last_closed_trick AS (
    SELECT jsonb_build_object(
      'id',           t.id,
      'trick_number', t.trick_number,
      'lead_seat',    t.lead_seat,
      'winner_seat',  t.winner_seat,
      'cards',        COALESCE((
        SELECT json_agg(jsonb_build_object('seat', tc.seat_index, 'card', tc.card)
                        ORDER BY tc.played_at)
        FROM public.trick_cards tc WHERE tc.trick_id = t.id
      ), '[]'::json)
    ) AS row
    FROM public.tricks t
    JOIN current_hand ch ON (ch.row ->> 'id')::uuid = t.hand_id
    WHERE t.closed_at IS NOT NULL
    ORDER BY t.closed_at DESC
    LIMIT 1
  ),
  history AS (
    SELECT json_agg(jsonb_build_object(
      'hand_number', h.hand_number,
      'closed_at',   h.closed_at,
      'scores',      (SELECT json_agg(to_jsonb(hs2.*))
                      FROM public.hand_scores hs2 WHERE hs2.hand_id = h.id)
    ) ORDER BY h.hand_number) AS list
    FROM public.hands h
    WHERE h.room_id = p_room_id AND h.phase = 'closed'
  ),
  -- Sessions that have called record_tricks_action for the current hand.
  -- Lets the client distinguish "claimed 0" from "not claimed yet" in
  -- scorekeeper mode without an extra column on hand_scores.
  claims AS (
    SELECT json_agg(DISTINCT ge.session_id) AS list
    FROM public.game_events ge
    JOIN current_hand ch ON (ch.row ->> 'id')::uuid = ge.hand_id
    WHERE ge.kind = 'claim_tricks'
  )
  SELECT jsonb_build_object(
    'room',              (SELECT to_jsonb(room.*) FROM room),
    'players',           COALESCE((SELECT list FROM players), '[]'::json),
    'spectators',        COALESCE((SELECT list FROM spectators), '[]'::json),
    'current_hand',      (SELECT row FROM current_hand),
    'hand_scores',       COALESCE((SELECT list FROM hand_scores), '[]'::json),
    'current_trick',     (SELECT row FROM current_trick),
    'last_closed_trick', (SELECT row FROM last_closed_trick),
    'score_history',     COALESCE((SELECT list FROM history), '[]'::json),
    'claim_sessions',    COALESCE((SELECT list FROM claims), '[]'::json)
  );
$$;
