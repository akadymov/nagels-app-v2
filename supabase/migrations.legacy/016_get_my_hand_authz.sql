-- Tighten get_my_hand: when called with a JWT (auth.uid() IS NOT NULL),
-- enforce that the requested session_id actually belongs to that auth
-- user. Service-role callers (the edge function) bypass the check —
-- they're the trusted backend and pass session_id explicitly from the
-- request actor.
--
-- Without this guard a client that ended up with a stale or corrupted
-- myPlayerId in its store could ask for any other player's hand and
-- get it back. Now mismatched session_ids return an empty hand instead.
--
-- Akula's report: "переключил вкладку, вернулся, увидел карты соперника
-- у себя на руках. Refresh — вернулись свои." A stale myPlayerId in the
-- client's roomStore was driving refreshSnapshot to ask for a different
-- player's hand; the server happily returned it.

CREATE OR REPLACE FUNCTION public.get_my_hand(p_hand_id UUID, p_session_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(json_agg(dc.card), '[]'::json)::jsonb
  FROM public.dealt_cards dc
  WHERE dc.hand_id = p_hand_id
    AND dc.session_id = p_session_id
    AND (
      auth.uid() IS NULL
      OR EXISTS (
        SELECT 1 FROM public.room_sessions rs
        WHERE rs.id = p_session_id AND rs.auth_user_id = auth.uid()
      )
    );
$$;
