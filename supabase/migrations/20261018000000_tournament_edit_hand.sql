-- Offline tournament: correct a scored hand (bets / tricks taken) after the
-- fact. Tournament rooms only; the edge function checks that the caller is
-- the table's recorder or the tournament admin. hand_score is recomputed,
-- so the table total and the tournament balance (derived on read) follow.
-- Same rules as live play: values in 0..cards, tricks sum to cards, bets
-- don't sum to cards. Every edit is journaled as a 'hand_edited' event.

CREATE OR REPLACE FUNCTION public.edit_hand_action(p_room_id uuid, p_hand_id uuid, p_entries jsonb)
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

  IF v_room.id IS NULL OR v_room.tournament_id IS NULL OR v_room.mode IS DISTINCT FROM 'scorekeeper' THEN
    v_err := 'not_tournament';
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

  INSERT INTO public.game_events (room_id, hand_id, kind, payload)
  VALUES (p_room_id, p_hand_id, 'hand_edited',
          jsonb_build_object('before', v_before, 'after', p_entries));

  UPDATE public.rooms SET version = version + 1, updated_at = now() WHERE id = p_room_id
    RETURNING version INTO v_new_version;

  SELECT public.get_room_state(p_room_id) INTO v_state;
  RETURN jsonb_build_object('ok', true, 'state', v_state, 'version', v_new_version);
END;
$$;
ALTER FUNCTION public.edit_hand_action(uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.edit_hand_action(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_hand_action(uuid, uuid, jsonb) TO service_role;
