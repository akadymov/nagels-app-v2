-- ============================================================
-- 024_spectator_mode — invited friends can watch a room
-- ============================================================
--
-- Spectators are session-scoped, seatless observers. They live in
-- room_spectators (separate from room_players so the seat-index
-- machinery is untouched). They see public room state only.
-- Per-room cap: 10. TTL cleanup mirrors room_players.
-- ============================================================

CREATE TABLE public.room_spectators (
  room_id       UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  session_id    UUID NOT NULL REFERENCES public.room_sessions(id) ON DELETE CASCADE,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, session_id)
);

CREATE INDEX idx_room_spectators_session ON public.room_spectators(session_id);

ALTER TABLE public.room_spectators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "room_spectators readable to all"
  ON public.room_spectators FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.join_room_as_spectator(p_room_id UUID)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_session_id UUID;
  v_count      INT;
BEGIN
  -- Serialize concurrent joins to enforce the 10-spectator cap deterministically.
  -- Same convention as 019_restart_game.sql.
  PERFORM pg_advisory_xact_lock(hashtext('spectators:' || p_room_id::text));

  SELECT id INTO v_session_id
    FROM public.room_sessions
   WHERE auth_user_id = auth.uid()
   LIMIT 1;
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'no_session' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = p_room_id) THEN
    RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.room_players
     WHERE room_id = p_room_id AND session_id = v_session_id
  ) THEN
    RAISE EXCEPTION 'cannot_spectate_own_seat' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_count
    FROM public.room_spectators
   WHERE room_id = p_room_id;
  IF v_count >= 10 AND NOT EXISTS (
    SELECT 1 FROM public.room_spectators
     WHERE room_id = p_room_id AND session_id = v_session_id
  ) THEN
    RAISE EXCEPTION 'too_many_spectators' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.room_spectators (room_id, session_id)
       VALUES (p_room_id, v_session_id)
  ON CONFLICT (room_id, session_id)
    DO UPDATE SET last_seen_at = now();

  RETURN v_session_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.join_room_as_spectator(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.join_room_as_spectator(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.leave_room_as_spectator(p_room_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_session_id UUID;
BEGIN
  SELECT id INTO v_session_id
    FROM public.room_sessions
   WHERE auth_user_id = auth.uid()
   LIMIT 1;
  IF v_session_id IS NULL THEN RETURN; END IF;

  DELETE FROM public.room_spectators
   WHERE room_id    = p_room_id
     AND session_id = v_session_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.leave_room_as_spectator(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.leave_room_as_spectator(UUID) TO anon, authenticated;

-- ============================================================================
-- Step 1: Extend get_room_state with spectators
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_room_state(p_room_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH
  room AS (
    SELECT id, code, host_session_id, player_count, max_cards,
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

-- ============================================================================
-- Step 2: Extend heartbeat to update room_spectators.last_seen_at
-- ============================================================================

CREATE OR REPLACE FUNCTION public.heartbeat(p_room_id UUID)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_session_id UUID;
BEGIN
  SELECT id INTO v_session_id
    FROM public.room_sessions
   WHERE auth_user_id = auth.uid()
   LIMIT 1;
  IF v_session_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.room_players
     SET last_seen_at = now(),
         is_connected = true
   WHERE room_id    = p_room_id
     AND session_id = v_session_id;

  UPDATE public.room_spectators
     SET last_seen_at = now()
   WHERE room_id    = p_room_id
     AND session_id = v_session_id;

  RETURN v_session_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.heartbeat(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.heartbeat(UUID) TO anon, authenticated;

-- ============================================================================
-- Step 3: Extend cleanup_stale_rooms to consider room_spectators.last_seen_at
-- ============================================================================

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
      LEFT JOIN public.room_players     rp  ON rp.room_id  = r.id
      LEFT JOIN public.room_spectators  rsp ON rsp.room_id = r.id
     GROUP BY r.id, r.created_at, r.updated_at
    HAVING GREATEST(
             COALESCE(MAX(rp.last_seen_at),  'epoch'::timestamptz),
             COALESCE(MAX(rsp.last_seen_at), 'epoch'::timestamptz),
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
