-- Scorekeeper rooms: the host records for everyone, like a tournament
-- table recorder. The host can seat offline players (proxy room_sessions
-- with no auth user and no tournament participant) and enter their bets
-- and tricks; the edge function gates who may act for which seat.

-- 1. edit_hand_action: any scorekeeper room, not only tournament tables.
--    Body copied from 20261018000000_tournament_edit_hand.sql; only the
--    room check differs.
CREATE OR REPLACE FUNCTION public.edit_hand_action(p_room_id uuid, p_hand_id uuid, p_entries jsonb, p_actor_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_room        RECORD;
  v_hand        RECORD;
  v_n           INT;
  v_entries     INT;
  v_matched     INT;
  v_bad_range   INT;
  v_sum_bet     INT;
  v_sum_taken   INT;
  v_before      JSONB;
  v_err         TEXT;
  v_new_version BIGINT;
  v_state       JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_room_id::text));

  SELECT id, mode, tournament_id INTO v_room FROM public.rooms WHERE id = p_room_id;
  SELECT * INTO v_hand FROM public.hands WHERE id = p_hand_id AND room_id = p_room_id FOR UPDATE;
  SELECT COUNT(*) INTO v_n FROM public.hand_scores WHERE hand_id = p_hand_id;

  IF v_room.id IS NULL OR v_room.mode IS DISTINCT FROM 'scorekeeper' THEN
    v_err := 'not_scorekeeper';
  ELSIF v_hand.id IS NULL OR v_hand.phase NOT IN ('scoring', 'closed') THEN
    v_err := 'wrong_phase';
  ELSIF jsonb_typeof(p_entries) IS DISTINCT FROM 'array' THEN
    v_err := 'invalid_entries';
  ELSE
    SELECT COUNT(*),
           COUNT(hs.session_id),
           COUNT(*) FILTER (WHERE e->>'bet' IS NULL OR e->>'taken' IS NULL
                               OR (e->>'bet')::int NOT BETWEEN 0 AND v_hand.cards_per_player
                               OR (e->>'taken')::int NOT BETWEEN 0 AND v_hand.cards_per_player),
           COALESCE(SUM((e->>'bet')::int), 0),
           COALESCE(SUM((e->>'taken')::int), 0)
      INTO v_entries, v_matched, v_bad_range, v_sum_bet, v_sum_taken
      FROM jsonb_array_elements(p_entries) e
      LEFT JOIN public.hand_scores hs
        ON hs.hand_id = p_hand_id AND hs.session_id = (e->>'session_id')::uuid;

    IF v_entries <> v_n OR v_matched <> v_n
       OR (SELECT COUNT(DISTINCT e->>'session_id') FROM jsonb_array_elements(p_entries) e) <> v_n THEN
      v_err := 'invalid_entries';
    ELSIF v_bad_range > 0 THEN
      v_err := 'range';
    ELSIF v_sum_taken <> v_hand.cards_per_player THEN
      v_err := 'tricks_sum';
    ELSIF v_sum_bet = v_hand.cards_per_player THEN
      v_err := 'bets_sum';
    END IF;
  END IF;

  IF v_err IS NOT NULL THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', v_err,
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  SELECT jsonb_agg(jsonb_build_object('session_id', session_id, 'bet', bet, 'taken', taken_tricks))
    INTO v_before FROM public.hand_scores WHERE hand_id = p_hand_id;

  UPDATE public.hand_scores hs
     SET bet          = (e->>'bet')::int,
         taken_tricks = (e->>'taken')::int,
         hand_score   = public._compute_hand_score((e->>'bet')::int, (e->>'taken')::int)
    FROM jsonb_array_elements(p_entries) e
   WHERE hs.hand_id = p_hand_id AND hs.session_id = (e->>'session_id')::uuid;

  INSERT INTO public.game_events (room_id, hand_id, session_id, kind, payload)
  VALUES (p_room_id, p_hand_id, p_actor_session_id, 'hand_edited',
          jsonb_build_object('before', v_before, 'after', p_entries));

  UPDATE public.rooms SET version = version + 1, updated_at = now() WHERE id = p_room_id
    RETURNING version INTO v_new_version;

  SELECT public.get_room_state(p_room_id) INTO v_state;
  RETURN jsonb_build_object('ok', true, 'state', v_state, 'version', v_new_version);
END;
$$;
ALTER FUNCTION public.edit_hand_action(uuid, uuid, jsonb, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.edit_hand_action(uuid, uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_hand_action(uuid, uuid, jsonb, uuid) TO service_role;

-- 2. cleanup_stale_rooms: also drop orphaned offline-seat sessions.
--    Body copied from 20261017000000_offline_tournament.sql.
CREATE OR REPLACE FUNCTION public.cleanup_stale_rooms() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_deleted INT;
BEGIN
  WITH stale AS (
    SELECT r.id
      FROM public.rooms r
      LEFT JOIN public.room_players     rp  ON rp.room_id  = r.id
      LEFT JOIN public.room_spectators  rsp ON rsp.room_id = r.id
     WHERE r.tournament_id IS NULL
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

  -- Offline seats (proxy sessions outside a tournament) only live as long
  -- as their room; drop the ones whose room is gone.
  DELETE FROM public.room_sessions rs
   WHERE rs.auth_user_id IS NULL
     AND rs.tournament_participant_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.room_players rp WHERE rp.session_id = rs.id)
     AND NOT EXISTS (SELECT 1 FROM public.hand_scores hs WHERE hs.session_id = rs.id);

  RAISE LOG '[cleanup_stale_rooms] deleted % stale room(s)', v_deleted;
  RETURN v_deleted;
END;
$$;

-- 3. get_room_state: is_proxy now means "no account" (tournament seats and
--    scorekeeper offline seats alike). Body copied from
--    20261017000000_offline_tournament.sql; only the is_proxy line differs.
CREATE OR REPLACE FUNCTION public.get_room_state(p_room_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH
  room AS (
    SELECT id, code, host_session_id, player_count, max_cards, min_cards_per_hand,
           mode, phase, current_hand_id, version, stake, stake_locked,
           paused_at, paused_lineup,
           tournament_id, tour_number, table_number, table_claimed
    FROM public.rooms WHERE id = p_room_id
  ),
  players AS (
    SELECT json_agg(jsonb_build_object(
      'session_id',   rp.session_id,
      'display_name', rs.display_name,
      'seat_index',   rp.seat_index,
      'is_ready',     rp.is_ready,
      'last_seen_at', rp.last_seen_at,
      'avatar',       au.raw_user_meta_data->>'avatar',
      'avatar_url',   au.raw_user_meta_data->>'avatar_url',
      'avatar_color', au.raw_user_meta_data->>'avatar_color',
      'opt_in_stake', rp.opt_in_stake,
      'is_guest',     COALESCE(au.is_anonymous, false),
      'is_proxy',     rs.auth_user_id IS NULL,
      'participant_id', rs.tournament_participant_id
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
      'avatar_url',   au.raw_user_meta_data->>'avatar_url',
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
ALTER FUNCTION public.get_room_state(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_room_state(uuid) TO anon, authenticated;
