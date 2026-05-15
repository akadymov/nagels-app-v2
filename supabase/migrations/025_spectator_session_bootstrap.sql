-- ============================================================
-- 025_spectator_session_bootstrap — auto-create room_sessions
-- row for spectators landing via deep link.
-- ============================================================
--
-- 024 assumed room_sessions row already existed (created by the
-- game-action Edge Function on the player path). Spectators reach
-- join_room_as_spectator directly from the client, so no row exists
-- and the RPC raised 'no_session'. Mirror the Edge Function's
-- bootstrap (auth.ts:43-48) inside the RPC.
-- ============================================================

CREATE OR REPLACE FUNCTION public.join_room_as_spectator(p_room_id UUID)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_session_id UUID;
  v_auth_uid   UUID := auth.uid();
  v_count      INT;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'auth_failed' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('spectators:' || p_room_id::text));

  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = p_room_id) THEN
    RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0001';
  END IF;

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
     WHERE room_id = p_room_id AND session_id = v_session_id
  ) THEN
    RAISE EXCEPTION 'cannot_spectate_own_seat' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_count
    FROM public.room_spectators
   WHERE room_id = p_room_id;
  IF v_count >= 10 AND NOT EXISTS (
    SELECT 1 FROM public.room_spectators
     WHERE room_id = p_room_id AND session_id = v_session_id
  ) THEN
    RAISE EXCEPTION 'too_many_spectators' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.room_spectators (room_id, session_id)
       VALUES (p_room_id, v_session_id)
  ON CONFLICT (room_id, session_id)
    DO UPDATE SET last_seen_at = now();

  RETURN v_session_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.join_room_as_spectator(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.join_room_as_spectator(UUID) TO anon, authenticated;
