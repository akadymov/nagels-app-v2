-- ============================================================
-- 028_sync_display_name — let the client backfill the visible
-- player name from auth.users.raw_user_meta_data.display_name
-- to public.room_sessions for users who acquired a real name
-- AFTER their room_sessions row was created with 'Guest' (e.g.
-- linked Google to an anon session that had already played).
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_my_display_name()
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT NULLIF(trim(raw_user_meta_data->>'display_name'), '')
    INTO v_name
    FROM auth.users
   WHERE id = auth.uid();

  IF v_name IS NULL THEN
    RETURN;
  END IF;

  -- Only overwrite the placeholder / empty value. Never clobber a name
  -- the user (or another path) deliberately set.
  UPDATE public.room_sessions
     SET display_name = v_name
   WHERE auth_user_id = auth.uid()
     AND (display_name IS NULL OR display_name = '' OR display_name = 'Guest');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_my_display_name() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.sync_my_display_name() TO authenticated;
