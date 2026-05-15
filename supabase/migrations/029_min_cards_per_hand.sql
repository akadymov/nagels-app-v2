-- ============================================================
-- 029_min_cards_per_hand — host-selectable game mode.
--
-- Default rules drop to 1-card hands in the middle of the ladder
-- (10,9,...,2,1,1,2,...,10). Some groups dislike the 1-card hands.
-- A new column min_cards_per_hand lets the host pin the floor,
-- so the engine returns Math.max(originalCount, minCards) for any
-- hand. With min=2 the ladder becomes 10,9,...,2,2,2,2,...,10
-- (same number of hands, the two 1-card hands become 2-card hands
-- alongside their neighbours).
-- ============================================================

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS min_cards_per_hand INT NOT NULL DEFAULT 1
    CHECK (min_cards_per_hand BETWEEN 1 AND 3);

-- Host-only RPC: set the floor while the room is still in 'waiting' phase
-- (changing the floor mid-game would mean re-dealing hands we've already
-- played, so we just refuse it).
CREATE OR REPLACE FUNCTION public.set_min_cards_per_hand(
  p_room_id UUID,
  p_min     INT
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_session_id    UUID;
  v_host_session  UUID;
  v_phase         TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_failed' USING ERRCODE = 'P0001';
  END IF;

  IF p_min < 1 OR p_min > 3 THEN
    RAISE EXCEPTION 'min_out_of_range' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_session_id
    FROM public.room_sessions
   WHERE auth_user_id = auth.uid()
   LIMIT 1;
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'no_session' USING ERRCODE = 'P0001';
  END IF;

  SELECT host_session_id, phase INTO v_host_session, v_phase
    FROM public.rooms
   WHERE id = p_room_id
   FOR UPDATE;
  IF v_host_session IS NULL THEN
    RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_host_session <> v_session_id THEN
    RAISE EXCEPTION 'not_host' USING ERRCODE = 'P0001';
  END IF;
  IF v_phase <> 'waiting' THEN
    RAISE EXCEPTION 'cannot_change_after_start' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.rooms
     SET min_cards_per_hand = p_min,
         version            = version + 1,
         updated_at         = now()
   WHERE id = p_room_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_min_cards_per_hand(UUID, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.set_min_cards_per_hand(UUID, INT) TO anon, authenticated;

-- Extend get_room_state to surface the new field. Re-declare the function
-- in full (matching the convention from migrations 024/026).
CREATE OR REPLACE FUNCTION public.get_room_state(p_room_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH
  room AS (
    SELECT id, code, host_session_id, player_count, max_cards, min_cards_per_hand,
           phase, current_hand_id, version
    FROM public.rooms WHERE id = p_room_id
  ),
  players AS (
    SELECT json_agg(jsonb_build_object(
      'session_id',   rp.session_id,
      'display_name', rs.display_name,
      'seat_index',   rp.seat_index,
      'is_ready',     rp.is_ready,
      'is_connected', rp.is_connected,
      'last_seen_at', rp.last_seen_at,
      'avatar',       au.raw_user_meta_data->>'avatar',
      'avatar_color', au.raw_user_meta_data->>'avatar_color'
    ) ORDER BY rp.seat_index) AS list
    FROM public.room_players rp
    JOIN public.room_sessions rs ON rs.id = rp.session_id
    LEFT JOIN auth.users au ON au.id = rs.auth_user_id
    WHERE rp.room_id = p_room_id
  ),
  spectators AS (
    SELECT json_agg(jsonb_build_object(
      'session_id',   rsp.session_id,
      'display_name', rs.display_name,
      'avatar',       au.raw_user_meta_data->>'avatar',
      'avatar_color', au.raw_user_meta_data->>'avatar_color',
      'joined_at',    rsp.joined_at
    ) ORDER BY rsp.joined_at) AS list
    FROM public.room_spectators rsp
    JOIN public.room_sessions rs ON rs.id = rsp.session_id
    LEFT JOIN auth.users au ON au.id = rs.auth_user_id
    WHERE rsp.room_id = p_room_id
  ),
  current_hand AS (
    SELECT to_jsonb(h.*) AS row
    FROM public.hands h
    JOIN room ON room.current_hand_id = h.id
  ),
  hand_scores AS (
    SELECT json_agg(to_jsonb(hs.*)) AS list
    FROM public.hand_scores hs
    JOIN current_hand ch ON (ch.row ->> 'id')::uuid = hs.hand_id
  ),
  current_trick AS (
    SELECT jsonb_build_object(
      'id',           t.id,
      'trick_number', t.trick_number,
      'lead_seat',    t.lead_seat,
      'winner_seat',  t.winner_seat,
      'cards',        COALESCE((
        SELECT json_agg(jsonb_build_object('seat', tc.seat_index, 'card', tc.card)
                        ORDER BY tc.played_at)
        FROM public.trick_cards tc WHERE tc.trick_id = t.id
      ), '[]'::json)
    ) AS row
    FROM public.tricks t
    JOIN current_hand ch ON (ch.row ->> 'id')::uuid = t.hand_id
    WHERE t.closed_at IS NULL
    ORDER BY t.trick_number DESC
    LIMIT 1
  ),
  last_closed_trick AS (
    SELECT jsonb_build_object(
      'id',           t.id,
      'trick_number', t.trick_number,
      'lead_seat',    t.lead_seat,
      'winner_seat',  t.winner_seat,
      'cards',        COALESCE((
        SELECT json_agg(jsonb_build_object('seat', tc.seat_index, 'card', tc.card)
                        ORDER BY tc.played_at)
        FROM public.trick_cards tc WHERE tc.trick_id = t.id
      ), '[]'::json)
    ) AS row
    FROM public.tricks t
    JOIN current_hand ch ON (ch.row ->> 'id')::uuid = t.hand_id
    WHERE t.closed_at IS NOT NULL
    ORDER BY t.closed_at DESC
    LIMIT 1
  ),
  history AS (
    SELECT json_agg(jsonb_build_object(
      'hand_number', h.hand_number,
      'closed_at',   h.closed_at,
      'scores',      (SELECT json_agg(to_jsonb(hs2.*))
                      FROM public.hand_scores hs2 WHERE hs2.hand_id = h.id)
    ) ORDER BY h.hand_number) AS list
    FROM public.hands h
    WHERE h.room_id = p_room_id AND h.phase = 'closed'
  )
  SELECT jsonb_build_object(
    'room',              (SELECT to_jsonb(room.*) FROM room),
    'players',           COALESCE((SELECT list FROM players), '[]'::json),
    'spectators',        COALESCE((SELECT list FROM spectators), '[]'::json),
    'current_hand',      (SELECT row FROM current_hand),
    'hand_scores',       COALESCE((SELECT list FROM hand_scores), '[]'::json),
    'current_trick',     (SELECT row FROM current_trick),
    'last_closed_trick', (SELECT row FROM last_closed_trick),
    'score_history',     COALESCE((SELECT list FROM history), '[]'::json)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_room_state(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_room_state(UUID) TO anon, authenticated;
