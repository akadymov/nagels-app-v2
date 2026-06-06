-- Throttle the rating-recipient email lookup to kill the enumeration oracle.
--
-- `lookup_rating_recipient(email)` returns {found:true|false}, so any logged-in
-- user could loop it to test whether an email has a Nägels account. Add a small
-- per-user/per-function call log and reject once a caller exceeds the budget.
--
-- See BACKLOG: "[tech][security][HIGH] Rate-limit lookup_rating_recipient".

-- 1. Call log. No RLS policies → unreachable by anon/authenticated directly;
--    only SECURITY DEFINER functions (running as owner) and service_role write
--    here. RLS is still enabled so a missing policy means "deny", not "allow".
CREATE TABLE IF NOT EXISTS public.rpc_throttle (
  user_id   uuid        NOT NULL,
  fn_name   text        NOT NULL,
  called_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rpc_throttle_lookup
  ON public.rpc_throttle (user_id, fn_name, called_at DESC);

ALTER TABLE public.rpc_throttle ENABLE ROW LEVEL SECURITY;

-- 2. Reusable guard. Returns TRUE if the call is within budget (and records it),
--    FALSE if the caller is over the limit for this function in the window.
--    auth.uid() resolves from the JWT claims even under SECURITY DEFINER, so the
--    per-user accounting is correct when called from another definer function.
CREATE OR REPLACE FUNCTION public.rpc_throttle_check(
  p_fn     text,
  p_max    integer,
  p_window interval
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_user IS NULL THEN
    RETURN false;
  END IF;

  -- Opportunistic cleanup keeps the table from growing unbounded.
  DELETE FROM public.rpc_throttle
    WHERE user_id = v_user
      AND fn_name = p_fn
      AND called_at < now() - p_window;

  SELECT count(*) INTO v_count
    FROM public.rpc_throttle
    WHERE user_id = v_user
      AND fn_name = p_fn;

  IF v_count >= p_max THEN
    RETURN false;
  END IF;

  INSERT INTO public.rpc_throttle (user_id, fn_name) VALUES (v_user, p_fn);
  RETURN true;
END;
$$;

-- Not granted to anon/authenticated: it's an internal helper invoked only from
-- other SECURITY DEFINER functions.
REVOKE ALL ON FUNCTION public.rpc_throttle_check(text, integer, interval) FROM PUBLIC;

-- 3. Re-define lookup_rating_recipient with the throttle gate. It now writes a
--    throttle row, so it must be VOLATILE (a STABLE function may not modify the
--    database). Budget: 30 calls / 10 minutes per user.
CREATE OR REPLACE FUNCTION public.lookup_rating_recipient(p_email text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_from         uuid := auth.uid();
  v_email        text;
  v_to_id        uuid;
  v_to_anon      boolean;
  v_display_name text;
  v_meta         jsonb;
  v_local        text;
  v_domain       text;
  v_masked       text;
BEGIN
  IF v_from IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  IF NOT public.rpc_throttle_check('lookup_rating_recipient', 30, interval '10 minutes') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  v_email := lower(trim(coalesce(p_email, '')));
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT id, coalesce(is_anonymous, false)
    INTO v_to_id, v_to_anon
    FROM auth.users
    WHERE lower(email) = v_email
    LIMIT 1;

  IF v_to_id IS NULL OR v_to_anon THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  IF v_to_id = v_from THEN
    RETURN jsonb_build_object('found', true, 'is_self', true);
  END IF;

  SELECT display_name INTO v_display_name
    FROM public.room_sessions
    WHERE auth_user_id = v_to_id
    ORDER BY created_at DESC
    LIMIT 1;

  SELECT raw_user_meta_data INTO v_meta
    FROM auth.users WHERE id = v_to_id;

  v_local  := split_part(v_email, '@', 1);
  v_domain := split_part(v_email, '@', 2);
  v_masked := substr(v_local, 1, 1) || '***@' || v_domain;

  RETURN jsonb_build_object(
    'found',     true,
    'is_self',   false,
    'recipient', jsonb_build_object(
      'display_name',  v_display_name,
      'masked_email',  v_masked,
      'avatar',        v_meta->>'avatar',
      'avatar_url',    v_meta->>'avatar_url',
      'avatar_color',  v_meta->>'avatar_color'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_rating_recipient(text) TO authenticated;
