-- get_my_hand returned ALL originally dealt cards for the hand and never
-- filtered out cards the player had already laid into a trick. As soon
-- as someone played a card, refreshSnapshot pulled my_hand and the
-- already-played card was still there → the UI rendered it (greyed out
-- on a stale optimistic update, or fully clickable until something else
-- redrew). Akula's report: "хожу картой — она остаётся у меня на руках,
-- в дальнейших раундах ей сходить уже нельзя, но она всё ещё светится."
--
-- The played-cards filter mirrors the one already used inside
-- play_card_action's must-follow-suit check (NOT EXISTS over trick_cards
-- joined to tricks of the same hand, keyed by seat_index). dealt_cards
-- stores by session_id; trick_cards stores by seat_index — so we go
-- through room_players to bridge.

CREATE OR REPLACE FUNCTION public.get_my_hand(p_hand_id UUID, p_session_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(json_agg(dc.card), '[]'::json)::jsonb
  FROM public.dealt_cards dc
  JOIN public.hands h ON h.id = dc.hand_id
  JOIN public.room_players rp
    ON rp.room_id = h.room_id AND rp.session_id = dc.session_id
  WHERE dc.hand_id = p_hand_id
    AND dc.session_id = p_session_id
    AND (
      auth.uid() IS NULL
      OR EXISTS (
        SELECT 1 FROM public.room_sessions rs
        WHERE rs.id = p_session_id AND rs.auth_user_id = auth.uid()
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.trick_cards tc
      JOIN public.tricks t ON t.id = tc.trick_id
      WHERE t.hand_id = p_hand_id
        AND tc.seat_index = rp.seat_index
        AND tc.card = dc.card
    );
$$;
