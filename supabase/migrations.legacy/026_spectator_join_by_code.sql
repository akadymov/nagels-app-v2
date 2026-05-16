-- ============================================================
-- 026_spectator_join_by_code — accept room code in the RPC so
-- spectators don't need anon SELECT on public.rooms.
-- ============================================================
--
-- public.rooms has RLS enabled with no SELECT policy. Anon users
-- cannot resolve a room id by code from the client; players got
-- away with it because they go through the game-action Edge
-- Function (service role). Spectators don't — they hit the RPC
-- directly. Move the lookup inside the RPC (SECURITY DEFINER
-- bypasses RLS) and return the resolved room_id to the caller.
-- ============================================================

DROP FUNCTION IF EXISTS public.join_room_as_spectator(UUID);

CREATE OR REPLACE FUNCTION public.join_room_as_spectator(p_room_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_room_id    UUID;
  v_session_id UUID;
  v_auth_uid   UUID := auth.uid();
  v_count      INT;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'auth_failed' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_room_id
    FROM public.rooms
   WHERE code = upper(p_room_code)
   LIMIT 1;
  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0001';
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

REVOKE EXECUTE ON FUNCTION public.join_room_as_spectator(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.join_room_as_spectator(TEXT) TO anon, authenticated;
