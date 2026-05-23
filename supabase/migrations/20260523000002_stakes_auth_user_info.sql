-- Helper for edge actions that need to peek at auth.users fields.
-- PostgREST doesn't expose the auth schema (PGRST106 'Invalid schema: auth'),
-- so direct `.schema('auth').from('users')` calls from the edge runtime
-- return zero rows and break every eligibility/admin gate. Wrap the read in
-- a SECURITY DEFINER RPC and lock it down to service_role.
CREATE OR REPLACE FUNCTION public.get_auth_user_info(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'email', email,
    'email_confirmed_at', email_confirmed_at,
    'confirmed_at', confirmed_at
  )
  FROM auth.users WHERE id = p_user_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_auth_user_info(uuid) FROM anon, authenticated, PUBLIC;
-- service_role (edge runtime) + postgres only. Edge actions call it via .rpc().
