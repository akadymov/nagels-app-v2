


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."_compute_hand_score"("p_bet" integer, "p_taken" integer) RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT p_taken + CASE WHEN p_bet = p_taken THEN 10 ELSE 0 END;
$$;


ALTER FUNCTION "public"."_compute_hand_score"("p_bet" integer, "p_taken" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_determine_trick_winner"("p_cards" "jsonb", "p_trump" "text") RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE
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
    v_w_rank := public._rank_value(v_winner->>'rank', v_w_is_trump);
    v_c_rank := public._rank_value(v_card->>'rank',   v_c_is_trump);

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


ALTER FUNCTION "public"."_determine_trick_winner"("p_cards" "jsonb", "p_trump" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_rank_to_int"("p_rank" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT CASE p_rank
    WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8
    WHEN '9' THEN 9 WHEN '10' THEN 10
    WHEN 'J' THEN 11 WHEN 'Q' THEN 12 WHEN 'K' THEN 13 WHEN 'A' THEN 14
    ELSE 0 END;
$$;


ALTER FUNCTION "public"."_rank_to_int"("p_rank" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_rank_value"("p_rank" "text", "p_is_trump" boolean) RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT CASE
    WHEN p_is_trump THEN
      CASE p_rank
        WHEN '2'  THEN 0  WHEN '3' THEN 1  WHEN '4' THEN 2  WHEN '5' THEN 3
        WHEN '6'  THEN 4  WHEN '7' THEN 5  WHEN '8' THEN 6
        WHEN '10' THEN 7  WHEN 'Q' THEN 8  WHEN 'K' THEN 9  WHEN 'A' THEN 10
        WHEN '9'  THEN 11 WHEN 'J' THEN 12
        ELSE 0
      END
    ELSE
      CASE p_rank
        WHEN '2'  THEN 0  WHEN '3' THEN 1  WHEN '4' THEN 2  WHEN '5' THEN 3
        WHEN '6'  THEN 4  WHEN '7' THEN 5  WHEN '8' THEN 6  WHEN '9' THEN 7
        WHEN '10' THEN 8  WHEN 'J' THEN 9  WHEN 'Q' THEN 10 WHEN 'K' THEN 11 WHEN 'A' THEN 12
        ELSE 0
      END
  END;
$$;


ALTER FUNCTION "public"."_rank_value"("p_rank" "text", "p_is_trump" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."acquire_room_lock"("p_room_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  PERFORM pg_advisory_lock(hashtext(p_room_id::text));
END;
$$;


ALTER FUNCTION "public"."acquire_room_lock"("p_room_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_stale_guests"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog', 'auth'
    AS $$
DECLARE
  v_deleted INT;
BEGIN
  WITH stale AS (
    SELECT u.id
      FROM auth.users u
      LEFT JOIN public.room_sessions    rs  ON rs.auth_user_id = u.id
      LEFT JOIN public.room_players     rp  ON rp.session_id   = rs.id
      LEFT JOIN public.room_spectators  rsp ON rsp.session_id  = rs.id
     WHERE u.is_anonymous = true
     GROUP BY u.id, u.created_at, u.last_sign_in_at
    HAVING GREATEST(
             COALESCE(MAX(rp.last_seen_at),  'epoch'::timestamptz),
             COALESCE(MAX(rsp.last_seen_at), 'epoch'::timestamptz),
             COALESCE(u.last_sign_in_at, u.created_at)
           ) < now() - INTERVAL '24 hours'
  )
  DELETE FROM auth.users
   WHERE id IN (SELECT id FROM stale);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE LOG '[cleanup_stale_guests] deleted % stale guest user(s)', v_deleted;
  RETURN v_deleted;
END;
$$;


ALTER FUNCTION "public"."cleanup_stale_guests"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_stale_rooms"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_deleted INT;
BEGIN
  WITH stale AS (
    SELECT r.id
      FROM public.rooms r
      LEFT JOIN public.room_players     rp  ON rp.room_id  = r.id
      LEFT JOIN public.room_spectators  rsp ON rsp.room_id = r.id
     GROUP BY r.id, r.created_at, r.updated_at
    HAVING GREATEST(
             COALESCE(MAX(rp.last_seen_at),  'epoch'::timestamptz),
             COALESCE(MAX(rsp.last_seen_at), 'epoch'::timestamptz),
             r.updated_at,
             r.created_at
           ) < now() - INTERVAL '24 hours'
  )
  DELETE FROM public.rooms
   WHERE id IN (SELECT id FROM stale);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE LOG '[cleanup_stale_rooms] deleted % stale room(s)', v_deleted;
  RETURN v_deleted;
END;
$$;


ALTER FUNCTION "public"."cleanup_stale_rooms"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_hand"("p_hand_id" "uuid", "p_session_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  SELECT COALESCE(json_agg(dc.card), '[]'::json)::jsonb
  FROM public.dealt_cards dc
  JOIN public.hands h ON h.id = dc.hand_id
  JOIN public.room_players rp
    ON rp.room_id = h.room_id AND rp.session_id = dc.session_id
  WHERE dc.hand_id = p_hand_id
    AND dc.session_id = p_session_id
    -- JWT-callers must own the requested session (migration 016).
    AND (
      auth.uid() IS NULL
      OR EXISTS (
        SELECT 1 FROM public.room_sessions rs
        WHERE rs.id = p_session_id AND rs.auth_user_id = auth.uid()
      )
    )
    -- Hide cards the player has already laid into a trick this hand.
    -- trick_cards keys by seat_index, so we look up the seat via
    -- room_players first.
    AND NOT EXISTS (
      SELECT 1
      FROM public.trick_cards tc
      JOIN public.tricks t ON t.id = tc.trick_id
      WHERE t.hand_id = p_hand_id
        AND tc.seat_index = rp.seat_index
        AND tc.card = dc.card
    );
$$;


ALTER FUNCTION "public"."get_my_hand"("p_hand_id" "uuid", "p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_session_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  SELECT id FROM public.room_sessions WHERE auth_user_id = auth.uid() LIMIT 1;
$$;


ALTER FUNCTION "public"."get_my_session_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_room_state"("p_room_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  WITH
  room AS (
    SELECT id, code, host_session_id, player_count, max_cards, min_cards_per_hand,
           phase, current_hand_id, version
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
  )
  SELECT jsonb_build_object(
    'room',              (SELECT to_jsonb(room.*) FROM room),
    'players',           COALESCE((SELECT list FROM players), '[]'::json),
    'spectators',        COALESCE((SELECT list FROM spectators), '[]'::json),
    'current_hand',      (SELECT row FROM current_hand),
    'hand_scores',       COALESCE((SELECT list FROM hand_scores), '[]'::json),
    'current_trick',     (SELECT row FROM current_trick),
    'last_closed_trick', (SELECT row FROM last_closed_trick),
    'score_history',     COALESCE((SELECT list FROM history), '[]'::json)
  );
$$;


ALTER FUNCTION "public"."get_room_state"("p_room_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."heartbeat"("p_room_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_session_id UUID;
BEGIN
  SELECT id INTO v_session_id
    FROM public.room_sessions
   WHERE auth_user_id = auth.uid()
   LIMIT 1;
  IF v_session_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.room_players
     SET last_seen_at = now(),
         is_connected = true
   WHERE room_id    = p_room_id
     AND session_id = v_session_id;

  UPDATE public.room_spectators
     SET last_seen_at = now()
   WHERE room_id    = p_room_id
     AND session_id = v_session_id;

  RETURN v_session_id;
END;
$$;


ALTER FUNCTION "public"."heartbeat"("p_room_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_taken_tricks"("p_hand_id" "uuid", "p_session_id" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  UPDATE public.hand_scores
  SET taken_tricks = taken_tricks + 1
  WHERE hand_id = p_hand_id AND session_id = p_session_id;
$$;


ALTER FUNCTION "public"."increment_taken_tricks"("p_hand_id" "uuid", "p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_room_as_spectator"("p_room_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_room_id    UUID;
  v_phase      TEXT;
  v_session_id UUID;
  v_auth_uid   UUID := auth.uid();
  v_count      INT;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'auth_failed' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, phase INTO v_room_id, v_phase
    FROM public.rooms
   WHERE code = upper(p_room_code)
   LIMIT 1;
  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_phase = 'finished' THEN
    RAISE EXCEPTION 'room_finished' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('spectators:' || v_room_id::text));

  INSERT INTO public.room_sessions (auth_user_id, display_name)
       SELECT v_auth_uid,
              COALESCE(au.raw_user_meta_data->>'display_name', 'Guest')
         FROM auth.users au
        WHERE au.id = v_auth_uid
  ON CONFLICT (auth_user_id) DO NOTHING;

  SELECT id INTO v_session_id
    FROM public.room_sessions
   WHERE auth_user_id = v_auth_uid
   LIMIT 1;
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'no_session' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.room_players
     WHERE room_id = v_room_id AND session_id = v_session_id
  ) THEN
    RAISE EXCEPTION 'cannot_spectate_own_seat' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_count
    FROM public.room_spectators
   WHERE room_id = v_room_id;
  IF v_count >= 10 AND NOT EXISTS (
    SELECT 1 FROM public.room_spectators
     WHERE room_id = v_room_id AND session_id = v_session_id
  ) THEN
    RAISE EXCEPTION 'too_many_spectators' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.room_spectators (room_id, session_id)
       VALUES (v_room_id, v_session_id)
  ON CONFLICT (room_id, session_id)
    DO UPDATE SET last_seen_at = now();

  RETURN jsonb_build_object('room_id', v_room_id, 'session_id', v_session_id);
END;
$$;


ALTER FUNCTION "public"."join_room_as_spectator"("p_room_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."leave_room_as_spectator"("p_room_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_session_id UUID;
BEGIN
  SELECT id INTO v_session_id
    FROM public.room_sessions
   WHERE auth_user_id = auth.uid()
   LIMIT 1;
  IF v_session_id IS NULL THEN RETURN; END IF;

  DELETE FROM public.room_spectators
   WHERE room_id    = p_room_id
     AND session_id = v_session_id;
END;
$$;


ALTER FUNCTION "public"."leave_room_as_spectator"("p_room_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_bet_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_bet" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
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


ALTER FUNCTION "public"."place_bet_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_bet" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."play_card_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_card" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
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


ALTER FUNCTION "public"."play_card_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_card" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_room_lock"("p_room_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  PERFORM pg_advisory_unlock(hashtext(p_room_id::text));
END;
$$;


ALTER FUNCTION "public"."release_room_lock"("p_room_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restart_game"("p_room_id" "uuid", "p_session_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_room   public.rooms%ROWTYPE;
  v_state  JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_room_id::text));

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'room_not_found',
      'state', '{}'::jsonb, 'version', 0);
  END IF;

  IF v_room.host_session_id <> p_session_id THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', 'host_only',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  IF v_room.phase <> 'finished' THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', 'not_finished',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  -- Wipe everything from the previous match. Cascades on hands → tricks
  -- → trick_cards / dealt_cards / hand_scores via FK ON DELETE CASCADE.
  DELETE FROM public.hands WHERE room_id = p_room_id;
  DELETE FROM public.game_events WHERE room_id = p_room_id;

  -- Bring everyone back to "not ready" — host has to start manually
  -- once players confirm again, identical to a fresh room.
  UPDATE public.room_players
     SET is_ready = FALSE
   WHERE room_id = p_room_id;

  UPDATE public.rooms
     SET phase = 'waiting',
         current_hand_id = NULL,
         version = COALESCE(version, 0) + 1,
         updated_at = now()
   WHERE id = p_room_id;

  SELECT public.get_room_state(p_room_id) INTO v_state;
  RETURN jsonb_build_object('ok', true, 'state', v_state,
    'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
END;
$$;


ALTER FUNCTION "public"."restart_game"("p_room_id" "uuid", "p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_min_cards_per_hand"("p_room_id" "uuid", "p_min" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_session_id    UUID;
  v_host_session  UUID;
  v_phase         TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_failed' USING ERRCODE = 'P0001';
  END IF;

  IF p_min < 1 OR p_min > 3 THEN
    RAISE EXCEPTION 'min_out_of_range' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_session_id
    FROM public.room_sessions
   WHERE auth_user_id = auth.uid()
   LIMIT 1;
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'no_session' USING ERRCODE = 'P0001';
  END IF;

  SELECT host_session_id, phase INTO v_host_session, v_phase
    FROM public.rooms
   WHERE id = p_room_id
   FOR UPDATE;
  IF v_host_session IS NULL THEN
    RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_host_session <> v_session_id THEN
    RAISE EXCEPTION 'not_host' USING ERRCODE = 'P0001';
  END IF;
  IF v_phase <> 'waiting' THEN
    RAISE EXCEPTION 'cannot_change_after_start' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.rooms
     SET min_cards_per_hand = p_min,
         version            = version + 1,
         updated_at         = now()
   WHERE id = p_room_id;
END;
$$;


ALTER FUNCTION "public"."set_min_cards_per_hand"("p_room_id" "uuid", "p_min" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_my_display_name"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT NULLIF(trim(raw_user_meta_data->>'display_name'), '')
    INTO v_name
    FROM auth.users
   WHERE id = auth.uid();

  IF v_name IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.room_sessions
     SET display_name = v_name
   WHERE auth_user_id = auth.uid()
     AND (display_name IS NULL OR display_name = '' OR display_name = 'Guest');
END;
$$;


ALTER FUNCTION "public"."sync_my_display_name"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."dealt_cards" (
    "hand_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "card" "text" NOT NULL
);


ALTER TABLE "public"."dealt_cards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "player_id" "uuid",
    "display_name" "text",
    "email" "text",
    "category" "text" DEFAULT 'general'::"text" NOT NULL,
    "message" "text" NOT NULL,
    "screen" "text",
    "room_id" "uuid",
    "app_version" "text",
    "platform" "text",
    "user_agent" "text",
    "language" "text",
    "extra" "jsonb",
    CONSTRAINT "feedback_category_check" CHECK (("category" = ANY (ARRAY['bug'::"text", 'idea'::"text", 'ux'::"text", 'general'::"text"]))),
    CONSTRAINT "feedback_message_check" CHECK ((("char_length"("message") >= 1) AND ("char_length"("message") <= 4000)))
);


ALTER TABLE "public"."feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."game_events" (
    "id" bigint NOT NULL,
    "room_id" "uuid" NOT NULL,
    "hand_id" "uuid",
    "session_id" "uuid",
    "kind" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."game_events" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."game_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."game_events_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."game_events_id_seq" OWNED BY "public"."game_events"."id";



CREATE TABLE IF NOT EXISTS "public"."hand_scores" (
    "hand_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "bet" integer NOT NULL,
    "taken_tricks" integer DEFAULT 0 NOT NULL,
    "hand_score" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."hand_scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hands" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "room_id" "uuid" NOT NULL,
    "hand_number" integer NOT NULL,
    "cards_per_player" integer NOT NULL,
    "trump_suit" "text" NOT NULL,
    "starting_seat" integer NOT NULL,
    "current_seat" integer NOT NULL,
    "phase" "text" DEFAULT 'betting'::"text" NOT NULL,
    "deck_seed" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_at" timestamp with time zone,
    CONSTRAINT "hands_phase_check" CHECK (("phase" = ANY (ARRAY['betting'::"text", 'playing'::"text", 'scoring'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."hands" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth_secret" "text" NOT NULL,
    "lang" "text" DEFAULT 'en'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."room_players" (
    "room_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "seat_index" integer NOT NULL,
    "is_ready" boolean DEFAULT false NOT NULL,
    "is_connected" boolean DEFAULT true NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."room_players" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."room_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."room_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."room_spectators" (
    "room_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."room_spectators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rooms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "host_session_id" "uuid" NOT NULL,
    "player_count" integer NOT NULL,
    "max_cards" integer DEFAULT 10 NOT NULL,
    "phase" "text" DEFAULT 'waiting'::"text" NOT NULL,
    "current_hand_id" "uuid",
    "version" bigint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "min_cards_per_hand" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "rooms_min_cards_per_hand_check" CHECK ((("min_cards_per_hand" >= 1) AND ("min_cards_per_hand" <= 3))),
    CONSTRAINT "rooms_phase_check" CHECK (("phase" = ANY (ARRAY['waiting'::"text", 'playing'::"text", 'finished'::"text"]))),
    CONSTRAINT "rooms_player_count_check" CHECK ((("player_count" >= 2) AND ("player_count" <= 6)))
);


ALTER TABLE "public"."rooms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trick_cards" (
    "trick_id" "uuid" NOT NULL,
    "seat_index" integer NOT NULL,
    "card" "text" NOT NULL,
    "played_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."trick_cards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tricks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hand_id" "uuid" NOT NULL,
    "trick_number" integer NOT NULL,
    "lead_seat" integer NOT NULL,
    "winner_seat" integer,
    "closed_at" timestamp with time zone
);


ALTER TABLE "public"."tricks" OWNER TO "postgres";


ALTER TABLE ONLY "public"."game_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."game_events_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."dealt_cards"
    ADD CONSTRAINT "dealt_cards_pkey" PRIMARY KEY ("hand_id", "session_id", "card");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_events"
    ADD CONSTRAINT "game_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hand_scores"
    ADD CONSTRAINT "hand_scores_pkey" PRIMARY KEY ("hand_id", "session_id");



ALTER TABLE ONLY "public"."hands"
    ADD CONSTRAINT "hands_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hands"
    ADD CONSTRAINT "hands_room_id_hand_number_key" UNIQUE ("room_id", "hand_number");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_endpoint_key" UNIQUE ("auth_user_id", "endpoint");



ALTER TABLE ONLY "public"."room_players"
    ADD CONSTRAINT "room_players_pkey" PRIMARY KEY ("room_id", "session_id");



ALTER TABLE ONLY "public"."room_players"
    ADD CONSTRAINT "room_players_room_id_seat_index_key" UNIQUE ("room_id", "seat_index");



ALTER TABLE ONLY "public"."room_sessions"
    ADD CONSTRAINT "room_sessions_auth_user_id_key" UNIQUE ("auth_user_id");



ALTER TABLE ONLY "public"."room_sessions"
    ADD CONSTRAINT "room_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."room_spectators"
    ADD CONSTRAINT "room_spectators_pkey" PRIMARY KEY ("room_id", "session_id");



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trick_cards"
    ADD CONSTRAINT "trick_cards_pkey" PRIMARY KEY ("trick_id", "seat_index");



ALTER TABLE ONLY "public"."tricks"
    ADD CONSTRAINT "tricks_hand_id_trick_number_key" UNIQUE ("hand_id", "trick_number");



ALTER TABLE ONLY "public"."tricks"
    ADD CONSTRAINT "tricks_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_dealt_cards_session" ON "public"."dealt_cards" USING "btree" ("session_id");



CREATE INDEX "idx_feedback_category" ON "public"."feedback" USING "btree" ("category");



CREATE INDEX "idx_feedback_created_at" ON "public"."feedback" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_feedback_player_id" ON "public"."feedback" USING "btree" ("player_id");



CREATE INDEX "idx_game_events_room_created" ON "public"."game_events" USING "btree" ("room_id", "created_at");



CREATE INDEX "idx_hands_room" ON "public"."hands" USING "btree" ("room_id");



CREATE INDEX "idx_push_subs_user" ON "public"."push_subscriptions" USING "btree" ("auth_user_id");



CREATE INDEX "idx_room_players_session" ON "public"."room_players" USING "btree" ("session_id");



CREATE INDEX "idx_room_spectators_session" ON "public"."room_spectators" USING "btree" ("session_id");



CREATE INDEX "idx_rooms_phase" ON "public"."rooms" USING "btree" ("phase");



CREATE INDEX "idx_tricks_hand" ON "public"."tricks" USING "btree" ("hand_id");



ALTER TABLE ONLY "public"."dealt_cards"
    ADD CONSTRAINT "dealt_cards_hand_id_fkey" FOREIGN KEY ("hand_id") REFERENCES "public"."hands"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dealt_cards"
    ADD CONSTRAINT "dealt_cards_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."room_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."game_events"
    ADD CONSTRAINT "game_events_hand_id_fkey" FOREIGN KEY ("hand_id") REFERENCES "public"."hands"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_events"
    ADD CONSTRAINT "game_events_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_events"
    ADD CONSTRAINT "game_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."room_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."hand_scores"
    ADD CONSTRAINT "hand_scores_hand_id_fkey" FOREIGN KEY ("hand_id") REFERENCES "public"."hands"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hand_scores"
    ADD CONSTRAINT "hand_scores_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."room_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hands"
    ADD CONSTRAINT "hands_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."room_players"
    ADD CONSTRAINT "room_players_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."room_players"
    ADD CONSTRAINT "room_players_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."room_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."room_sessions"
    ADD CONSTRAINT "room_sessions_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."room_spectators"
    ADD CONSTRAINT "room_spectators_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."room_spectators"
    ADD CONSTRAINT "room_spectators_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."room_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_current_hand_fk" FOREIGN KEY ("current_hand_id") REFERENCES "public"."hands"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_host_session_id_fkey" FOREIGN KEY ("host_session_id") REFERENCES "public"."room_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trick_cards"
    ADD CONSTRAINT "trick_cards_trick_id_fkey" FOREIGN KEY ("trick_id") REFERENCES "public"."tricks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tricks"
    ADD CONSTRAINT "tricks_hand_id_fkey" FOREIGN KEY ("hand_id") REFERENCES "public"."hands"("id") ON DELETE CASCADE;



ALTER TABLE "public"."dealt_cards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feedback_insert_anyone" ON "public"."feedback" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



ALTER TABLE "public"."game_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hand_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hands" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "push_subs_owner_all" ON "public"."push_subscriptions" USING (("auth"."uid"() = "auth_user_id")) WITH CHECK (("auth"."uid"() = "auth_user_id"));



ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."room_players" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."room_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."room_spectators" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "room_spectators readable to all" ON "public"."room_spectators" FOR SELECT USING (true);



ALTER TABLE "public"."rooms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trick_cards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tricks" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."_compute_hand_score"("p_bet" integer, "p_taken" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."_compute_hand_score"("p_bet" integer, "p_taken" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_compute_hand_score"("p_bet" integer, "p_taken" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."_determine_trick_winner"("p_cards" "jsonb", "p_trump" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_determine_trick_winner"("p_cards" "jsonb", "p_trump" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_determine_trick_winner"("p_cards" "jsonb", "p_trump" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_rank_to_int"("p_rank" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_rank_to_int"("p_rank" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_rank_to_int"("p_rank" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_rank_value"("p_rank" "text", "p_is_trump" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."_rank_value"("p_rank" "text", "p_is_trump" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_rank_value"("p_rank" "text", "p_is_trump" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."acquire_room_lock"("p_room_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."acquire_room_lock"("p_room_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."acquire_room_lock"("p_room_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."acquire_room_lock"("p_room_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_stale_guests"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_stale_guests"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_stale_guests"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_stale_guests"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_stale_rooms"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_stale_rooms"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_stale_rooms"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_stale_rooms"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_hand"("p_hand_id" "uuid", "p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_hand"("p_hand_id" "uuid", "p_session_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_hand"("p_hand_id" "uuid", "p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_hand"("p_hand_id" "uuid", "p_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_session_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_session_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_session_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_session_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_room_state"("p_room_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_room_state"("p_room_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_room_state"("p_room_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_room_state"("p_room_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."heartbeat"("p_room_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."heartbeat"("p_room_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."heartbeat"("p_room_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."heartbeat"("p_room_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."increment_taken_tricks"("p_hand_id" "uuid", "p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."increment_taken_tricks"("p_hand_id" "uuid", "p_session_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_taken_tricks"("p_hand_id" "uuid", "p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_taken_tricks"("p_hand_id" "uuid", "p_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_room_as_spectator"("p_room_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."join_room_as_spectator"("p_room_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."join_room_as_spectator"("p_room_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_room_as_spectator"("p_room_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."leave_room_as_spectator"("p_room_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."leave_room_as_spectator"("p_room_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."leave_room_as_spectator"("p_room_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."leave_room_as_spectator"("p_room_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."place_bet_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_bet" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."place_bet_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_bet" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."place_bet_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_bet" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."place_bet_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_bet" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."play_card_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_card" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."play_card_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_card" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."play_card_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_card" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."play_card_action"("p_room_id" "uuid", "p_session_id" "uuid", "p_hand_id" "uuid", "p_card" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_room_lock"("p_room_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_room_lock"("p_room_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."release_room_lock"("p_room_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."release_room_lock"("p_room_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."restart_game"("p_room_id" "uuid", "p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restart_game"("p_room_id" "uuid", "p_session_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."restart_game"("p_room_id" "uuid", "p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."restart_game"("p_room_id" "uuid", "p_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_min_cards_per_hand"("p_room_id" "uuid", "p_min" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_min_cards_per_hand"("p_room_id" "uuid", "p_min" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."set_min_cards_per_hand"("p_room_id" "uuid", "p_min" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_min_cards_per_hand"("p_room_id" "uuid", "p_min" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_my_display_name"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_my_display_name"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_my_display_name"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_my_display_name"() TO "service_role";



GRANT ALL ON TABLE "public"."dealt_cards" TO "anon";
GRANT ALL ON TABLE "public"."dealt_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."dealt_cards" TO "service_role";



GRANT ALL ON TABLE "public"."feedback" TO "anon";
GRANT ALL ON TABLE "public"."feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback" TO "service_role";



GRANT ALL ON TABLE "public"."game_events" TO "anon";
GRANT ALL ON TABLE "public"."game_events" TO "authenticated";
GRANT ALL ON TABLE "public"."game_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."game_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."game_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."game_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."hand_scores" TO "anon";
GRANT ALL ON TABLE "public"."hand_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."hand_scores" TO "service_role";



GRANT ALL ON TABLE "public"."hands" TO "anon";
GRANT ALL ON TABLE "public"."hands" TO "authenticated";
GRANT ALL ON TABLE "public"."hands" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."room_players" TO "anon";
GRANT ALL ON TABLE "public"."room_players" TO "authenticated";
GRANT ALL ON TABLE "public"."room_players" TO "service_role";



GRANT ALL ON TABLE "public"."room_sessions" TO "anon";
GRANT ALL ON TABLE "public"."room_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."room_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."room_spectators" TO "anon";
GRANT ALL ON TABLE "public"."room_spectators" TO "authenticated";
GRANT ALL ON TABLE "public"."room_spectators" TO "service_role";



GRANT ALL ON TABLE "public"."rooms" TO "anon";
GRANT ALL ON TABLE "public"."rooms" TO "authenticated";
GRANT ALL ON TABLE "public"."rooms" TO "service_role";



GRANT ALL ON TABLE "public"."trick_cards" TO "anon";
GRANT ALL ON TABLE "public"."trick_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."trick_cards" TO "service_role";



GRANT ALL ON TABLE "public"."tricks" TO "anon";
GRANT ALL ON TABLE "public"."tricks" TO "authenticated";
GRANT ALL ON TABLE "public"."tricks" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







