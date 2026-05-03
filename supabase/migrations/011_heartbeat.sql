-- ============================================================
-- 011_heartbeat — client → last_seen_at + is_connected ping
-- ============================================================
--
-- The room_players.is_connected and last_seen_at columns existed since
-- migration 002 but nothing wrote to them. This RPC is called from the
-- client every ~10s while the user is in a room, marking them as alive.
--
-- A separate concern (not in this migration) reads these columns to
-- decide whether the current_seat player has gone offline and should
-- be auto-skipped via request_timeout sooner than the 5-min default.
--
-- Returns the resolved session_id so the caller can update local state
-- without a separate get_my_session_id round-trip.
-- ============================================================

CREATE OR REPLACE FUNCTION public.heartbeat(p_room_id UUID)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_session_id UUID;
BEGIN
  SELECT id INTO v_session_id
    FROM public.room_sessions
   WHERE auth_user_id = auth.uid()
   LIMIT 1;

  IF v_session_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.room_players
     SET last_seen_at = now(),
         is_connected = true
   WHERE room_id    = p_room_id
     AND session_id = v_session_id;

  RETURN v_session_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.heartbeat(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.heartbeat(UUID) TO anon, authenticated;
