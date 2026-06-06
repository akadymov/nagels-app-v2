-- Least-privilege on rpc_throttle.
--
-- New tables in the public schema inherit ALL grants for anon/authenticated via
-- Supabase's default privileges. RLS-enabled-with-no-policy already denies those
-- roles, but the dangling grants contradict the "internal only" intent and read
-- badly under a security review. Revoke them so the table is reachable only by
-- the owner (SECURITY DEFINER functions) and service_role.

REVOKE ALL ON TABLE public.rpc_throttle FROM anon, authenticated;
