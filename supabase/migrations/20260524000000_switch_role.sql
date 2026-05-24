-- switch_role(p_room_id, p_target_session_id, p_to_role)
--
-- Allows converting a player ↔ spectator during the pause windows
-- (rooms.phase IN ('waiting', 'finished')). Once a hand is active
-- (phase = 'playing') the seat layout is frozen and the RPC errors out.
--
-- Authorization:
--   - The caller may convert their own session at any time.
--   - The host may convert anyone EXCEPT themselves (host stays a player
--     to keep the host/hand-rotation invariants intact).
--   - The host can never be downgraded to spectator via this RPC.
--
-- Capacity:
--   - spectator → player: rejected if the room has no free seat
--     (current player count + 1 > rooms.player_count).
--
-- Returns a JSON `{ ok: true, version }` on success. Errors are raised
-- with predictable codes that the client maps to i18n strings.

CREATE OR REPLACE FUNCTION public.switch_role(
  p_room_id           uuid,
  p_target_session_id uuid,
  p_to_role           text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_auth_uid    uuid := auth.uid();
  v_my_session  uuid;
  v_phase       text;
  v_host        uuid;
  v_max_players int;
  v_cur_players int;
  v_seat        int;
  v_taken       int[];
  v_i           int;
  v_new_version bigint;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'auth_failed' USING ERRCODE = 'P0001';
  END IF;

  IF p_to_role NOT IN ('player', 'spectator') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_my_session
    FROM public.room_sessions
   WHERE auth_user_id = v_auth_uid
   LIMIT 1;
  IF v_my_session IS NULL THEN
    RAISE EXCEPTION 'no_session' USING ERRCODE = 'P0001';
  END IF;

  SELECT phase, host_session_id, player_count
    INTO v_phase, v_host, v_max_players
    FROM public.rooms
   WHERE id = p_room_id
   FOR UPDATE;
  IF v_phase IS NULL THEN
    RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_phase NOT IN ('waiting', 'finished') THEN
    RAISE EXCEPTION 'cannot_switch_during_game' USING ERRCODE = 'P0001';
  END IF;

  -- Authorization
  IF p_target_session_id = v_my_session THEN
    -- Self-toggle: host cannot demote themselves.
    IF v_my_session = v_host AND p_to_role = 'spectator' THEN
      RAISE EXCEPTION 'host_cannot_spectate' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- Host toggling someone else.
    IF v_my_session <> v_host THEN
      RAISE EXCEPTION 'not_host' USING ERRCODE = 'P0001';
    END IF;
    IF p_target_session_id = v_host THEN
      RAISE EXCEPTION 'host_cannot_spectate' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('switch_role:' || p_room_id::text));

  IF p_to_role = 'spectator' THEN
    -- Player → spectator.
    DELETE FROM public.room_players
     WHERE room_id = p_room_id AND session_id = p_target_session_id;
    INSERT INTO public.room_spectators (room_id, session_id)
         VALUES (p_room_id, p_target_session_id)
    ON CONFLICT (room_id, session_id) DO UPDATE SET last_seen_at = now();
  ELSE
    -- Spectator → player.
    SELECT count(*) INTO v_cur_players
      FROM public.room_players
     WHERE room_id = p_room_id;
    IF v_cur_players >= v_max_players THEN
      RAISE EXCEPTION 'room_full' USING ERRCODE = 'P0001';
    END IF;

    -- Pick the first free seat (mirrors joinRoom edge logic).
    SELECT array_agg(seat_index) INTO v_taken
      FROM public.room_players
     WHERE room_id = p_room_id;
    v_seat := -1;
    FOR v_i IN 0 .. v_max_players - 1 LOOP
      IF v_taken IS NULL OR NOT (v_i = ANY(v_taken)) THEN
        v_seat := v_i;
        EXIT;
      END IF;
    END LOOP;
    IF v_seat = -1 THEN
      RAISE EXCEPTION 'room_full' USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM public.room_spectators
     WHERE room_id = p_room_id AND session_id = p_target_session_id;
    INSERT INTO public.room_players (room_id, session_id, seat_index, is_ready)
         VALUES (p_room_id, p_target_session_id, v_seat, false);
  END IF;

  INSERT INTO public.game_events (room_id, session_id, kind, payload)
       VALUES (p_room_id, v_my_session, 'switch_role',
               jsonb_build_object('target', p_target_session_id, 'to', p_to_role));

  UPDATE public.rooms
     SET version = version + 1,
         updated_at = now()
   WHERE id = p_room_id
  RETURNING version INTO v_new_version;

  RETURN jsonb_build_object('ok', true, 'version', v_new_version);
END;
$$;

ALTER FUNCTION public.switch_role(uuid, uuid, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.switch_role(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.switch_role(uuid, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.switch_role(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.switch_role(uuid, uuid, text) TO service_role;
