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
