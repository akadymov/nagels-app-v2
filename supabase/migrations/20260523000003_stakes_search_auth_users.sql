-- Admin-only email-prefix search across auth.users. Same PostgREST exposure
-- gap as get_auth_user_info — callers must verify admin status first (the
-- adminSearchUsers edge action does so via get_auth_user_info + ADMIN_EMAILS
-- before invoking this).
CREATE OR REPLACE FUNCTION public.search_auth_users_by_email(p_q text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'email', email)), '[]'::jsonb)
  FROM (
    SELECT id, email FROM auth.users
    WHERE email ILIKE '%' || p_q || '%'
    LIMIT 20
  ) m;
$$;

REVOKE EXECUTE ON FUNCTION public.search_auth_users_by_email(text) FROM anon, authenticated, PUBLIC;
