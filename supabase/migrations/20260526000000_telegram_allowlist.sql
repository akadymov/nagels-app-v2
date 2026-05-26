-- supabase/migrations/20260526000000_telegram_allowlist.sql
-- Per-user allow-list for the "new room" Telegram notification.
-- Admins (by ADMIN_EMAILS env) are NOT stored here; they are detected
-- in the edge function and bypass the table check.
-- See docs/superpowers/specs/2026-05-26-telegram-announce-allowlist-design.md

CREATE TABLE public.telegram_announce_allowlist (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by UUID            REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_announce_allowlist ENABLE ROW LEVEL SECURITY;
-- No CRUD policies: only SECURITY DEFINER RPCs and the game-action
-- edge function (service-role) read/write this table.

-- Caller's own permission check. Returns false for guests / unauthenticated.
CREATE OR REPLACE FUNCTION public.can_announce_telegram()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.telegram_announce_allowlist WHERE user_id = v_uid
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_announce_telegram() TO authenticated;
