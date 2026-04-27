BEGIN;

CREATE OR REPLACE FUNCTION public.acquire_room_lock(p_room_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM pg_advisory_lock(hashtext(p_room_id::text));
END;
$$;

CREATE OR REPLACE FUNCTION public.release_room_lock(p_room_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM pg_advisory_unlock(hashtext(p_room_id::text));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.acquire_room_lock(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_room_lock(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.acquire_room_lock(UUID) TO service_role;
GRANT  EXECUTE ON FUNCTION public.release_room_lock(UUID) TO service_role;

COMMIT;
