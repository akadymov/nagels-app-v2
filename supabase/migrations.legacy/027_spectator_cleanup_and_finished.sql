-- ============================================================
-- 027 — finish-spec compliance for spectators:
--   (1) cleanup_stale_guests now considers room_spectators.last_seen_at
--       so passive spectators aren't reaped after 24h of just watching.
--   (2) join_room_as_spectator rejects rooms whose phase = 'finished'
--       (spec §134).
-- ============================================================

CREATE OR REPLACE FUNCTION public.cleanup_stale_guests()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
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

CREATE OR REPLACE FUNCTION public.join_room_as_spectator(p_room_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
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

REVOKE EXECUTE ON FUNCTION public.join_room_as_spectator(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.join_room_as_spectator(TEXT) TO anon, authenticated;
