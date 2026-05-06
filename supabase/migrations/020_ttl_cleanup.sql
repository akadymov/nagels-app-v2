-- ============================================================
-- 020_ttl_cleanup — drop stale rooms and inactive guest accounts
-- ============================================================
--
-- Background:
--   Rooms accumulate forever once created — abandoned waiting rooms,
--   half-played games where everyone walked away, finished games no
--   one cleaned up. Same for anonymous auth.users: every guest visit
--   creates a row that never goes away on its own.
--
-- Policy:
--   * Rooms: 24 hours since the last activity signal (any player's
--     last_seen_at, or the room's updated_at / created_at as a
--     fallback when no players have ever heartbeat'd).
--   * Anonymous auth.users: 24 hours with no recent room activity AND
--     no recent sign-in. Deleting the auth.users row cascades into
--     room_sessions (and through that, room_players) via the foreign
--     keys defined in 002_sync_redesign.sql.
--
--   Email-confirmed accounts are never touched here — they're real
--   users, even if dormant.
--
-- Mechanism:
--   pg_cron schedules each function hourly. The extension is created
--   if it isn't already (Supabase Cloud whitelists pg_cron 1.6+).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── 1. Cleanup functions ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cleanup_stale_rooms()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_deleted INT;
BEGIN
  WITH stale AS (
    SELECT r.id
      FROM public.rooms r
      LEFT JOIN public.room_players rp ON rp.room_id = r.id
     GROUP BY r.id, r.created_at, r.updated_at
    HAVING GREATEST(
             COALESCE(MAX(rp.last_seen_at), 'epoch'::timestamptz),
             r.updated_at,
             r.created_at
           ) < now() - INTERVAL '24 hours'
  )
  DELETE FROM public.rooms
   WHERE id IN (SELECT id FROM stale);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE LOG '[cleanup_stale_rooms] deleted % stale room(s)', v_deleted;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_stale_rooms() FROM PUBLIC;
-- Intentionally NOT granted to anon/authenticated — only the cron job
-- (running as the function owner via SECURITY DEFINER) should call it.

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
      LEFT JOIN public.room_sessions rs ON rs.auth_user_id = u.id
      LEFT JOIN public.room_players  rp ON rp.session_id   = rs.id
     WHERE u.is_anonymous = true
     GROUP BY u.id, u.created_at, u.last_sign_in_at
    HAVING GREATEST(
             COALESCE(MAX(rp.last_seen_at), 'epoch'::timestamptz),
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

REVOKE EXECUTE ON FUNCTION public.cleanup_stale_guests() FROM PUBLIC;

-- ── 2. Schedule via pg_cron ──────────────────────────────────
--
-- Wrapped in a DO block so the migration still applies on projects
-- where pg_cron isn't enabled yet — schedule failures are logged but
-- don't abort the function definitions above.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Idempotency: drop any prior schedules with the same name first.
    PERFORM cron.unschedule(jobid)
       FROM cron.job
      WHERE jobname IN ('nigels-cleanup-rooms', 'nigels-cleanup-guests');

    PERFORM cron.schedule(
      'nigels-cleanup-rooms',
      '15 * * * *',
      $cron$ SELECT public.cleanup_stale_rooms() $cron$
    );
    PERFORM cron.schedule(
      'nigels-cleanup-guests',
      '45 * * * *',
      $cron$ SELECT public.cleanup_stale_guests() $cron$
    );
    RAISE NOTICE 'pg_cron schedules registered for cleanup functions';
  ELSE
    RAISE NOTICE 'pg_cron not enabled — cleanup functions exist but are not scheduled. Enable pg_cron in Supabase Dashboard → Database → Extensions, then re-run the cron.schedule block.';
  END IF;
END
$$;
