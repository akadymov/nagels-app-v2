-- Connection liveness: a single source of truth for "is this room alive".
-- A room is alive iff any participant (player OR spectator) has a heartbeat
-- (last_seen_at) within the last 5 minutes. Heartbeat cadence is ~10s, so
-- 5 min ≈ 30 missed beats — well past brief blips / mobile background sleep.
-- Pure (reads only last_seen_at), SECURITY DEFINER, no auth.uid() dependency,
-- so it is callable from other RPCs and directly verifiable in psql.
CREATE OR REPLACE FUNCTION public.room_is_alive(p_room_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_players rp
     WHERE rp.room_id = p_room_id
       AND rp.last_seen_at > now() - INTERVAL '5 minutes'
    UNION ALL
    SELECT 1 FROM public.room_spectators rsp
     WHERE rsp.room_id = p_room_id
       AND rsp.last_seen_at > now() - INTERVAL '5 minutes'
  );
$$;

GRANT EXECUTE ON FUNCTION public.room_is_alive(uuid) TO anon, authenticated, service_role;

-- Liveness-aware active-room lookup: never resurrect a dead room.
-- Identical to 20260526010000_get_my_active_room.sql except each room-selection
-- branch now also requires public.room_is_alive(r.id). An abandoned waiting room
-- the caller hosted and left for >5 min is intentionally treated as dead.
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
  WHERE rp.session_id = v_sid
    AND r.phase <> 'finished'
    AND public.room_is_alive(r.id)
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
  WHERE rsp.session_id = v_sid
    AND r.phase <> 'finished'
    AND public.room_is_alive(r.id)
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
