-- supabase/migrations/20260526010000_get_my_active_room.sql
-- Cross-device session sync: lookup the calling user's active room.
-- Used by the client on boot / login / focus to auto-navigate the user
-- into whatever room they're currently in on another device.
-- See docs/superpowers/specs/2026-05-26-cross-device-session-design.md

CREATE OR REPLACE FUNCTION public.get_my_active_room()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_sid  uuid;
  v_row  RECORD;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_sid FROM public.room_sessions
    WHERE auth_user_id = v_uid LIMIT 1;
  IF v_sid IS NULL THEN RETURN NULL; END IF;

  -- Player seat first; prefer playing > waiting > scoring; tie-break by
  -- updated_at DESC to pick the most recently active room.
  SELECT r.id AS room_id, r.phase, r.code, 'player' AS role
    INTO v_row
  FROM public.rooms r
  JOIN public.room_players rp ON rp.room_id = r.id
  WHERE rp.session_id = v_sid AND r.phase <> 'finished'
  ORDER BY
    CASE r.phase WHEN 'playing' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END,
    r.updated_at DESC
  LIMIT 1;

  IF v_row.room_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'room_id', v_row.room_id,
      'code',    v_row.code,
      'phase',   v_row.phase,
      'role',    v_row.role
    );
  END IF;

  -- Spectator fallback.
  SELECT r.id AS room_id, r.phase, r.code, 'spectator' AS role
    INTO v_row
  FROM public.rooms r
  JOIN public.room_spectators rsp ON rsp.room_id = r.id
  WHERE rsp.session_id = v_sid AND r.phase <> 'finished'
  ORDER BY r.updated_at DESC
  LIMIT 1;

  IF v_row.room_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'room_id', v_row.room_id,
      'code',    v_row.code,
      'phase',   v_row.phase,
      'role',    v_row.role
    );
  END IF;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_active_room() TO authenticated;
