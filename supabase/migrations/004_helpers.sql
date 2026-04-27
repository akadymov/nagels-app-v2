BEGIN;

CREATE OR REPLACE FUNCTION public.increment_taken_tricks(p_hand_id UUID, p_session_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  UPDATE public.hand_scores
  SET taken_tricks = taken_tricks + 1
  WHERE hand_id = p_hand_id AND session_id = p_session_id;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_taken_tricks(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.increment_taken_tricks(UUID, UUID) TO service_role;

COMMIT;
