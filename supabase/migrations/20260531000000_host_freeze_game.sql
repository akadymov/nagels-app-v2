-- Host freeze game: a 'paused' room phase the host can enter at any moment.
-- State (hand/trick/scores/seats) is preserved; gameplay mutations are gated
-- in the edge dispatcher while paused. paused_lineup pins the session_ids that
-- must all be back+live before the host may resume. 48h TTL → abandon (handled
-- in the edge layer / read RPCs below), no rating settle.

ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_phase_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_phase_check
  CHECK (phase = ANY (ARRAY['waiting'::text, 'playing'::text, 'paused'::text, 'finished'::text]));

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS paused_at     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS paused_lineup uuid[]      NULL;

-- get_my_active_room: keep returning a paused room to its participants while it
-- is within the 48h TTL window (even when everyone has stepped away and
-- room_is_alive is false). Past TTL it is simply not returned (read-only).
-- Also expose paused_at so the lobby can render the countdown.
CREATE OR REPLACE FUNCTION public.get_my_active_room()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_sid  uuid;
  v_row  RECORD;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_sid FROM public.room_sessions
    WHERE auth_user_id = v_uid LIMIT 1;
  IF v_sid IS NULL THEN RETURN NULL; END IF;

  -- Player seat first; prefer playing > waiting > scoring; tie-break by
  -- updated_at DESC to pick the most recently active room.
  SELECT r.id AS room_id, r.phase, r.code, r.paused_at, 'player' AS role
    INTO v_row
  FROM public.rooms r
  JOIN public.room_players rp ON rp.room_id = r.id
  WHERE rp.session_id = v_sid
    AND r.phase <> 'finished'
    AND (public.room_is_alive(r.id)
         OR (r.phase = 'paused' AND r.paused_at > now() - INTERVAL '48 hours'))
  ORDER BY
    CASE r.phase WHEN 'playing' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END,
    r.updated_at DESC
  LIMIT 1;

  IF v_row.room_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'room_id', v_row.room_id, 'code', v_row.code,
      'phase', v_row.phase, 'role', v_row.role, 'paused_at', v_row.paused_at
    );
  END IF;

  -- Spectator fallback.
  SELECT r.id AS room_id, r.phase, r.code, r.paused_at, 'spectator' AS role
    INTO v_row
  FROM public.rooms r
  JOIN public.room_spectators rsp ON rsp.room_id = r.id
  WHERE rsp.session_id = v_sid
    AND r.phase <> 'finished'
    AND (public.room_is_alive(r.id)
         OR (r.phase = 'paused' AND r.paused_at > now() - INTERVAL '48 hours'))
  ORDER BY r.updated_at DESC
  LIMIT 1;

  IF v_row.room_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'room_id', v_row.room_id, 'code', v_row.code,
      'phase', v_row.phase, 'role', v_row.role, 'paused_at', v_row.paused_at
    );
  END IF;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_active_room() TO authenticated;

-- True iff any seated player in the room is an anonymous guest. Used by
-- pause_game to block freezing rooms whose guests can't reliably return.
CREATE OR REPLACE FUNCTION public.room_has_guest(p_room_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.room_players rp
    JOIN public.room_sessions rs ON rs.id = rp.session_id
    JOIN auth.users au ON au.id = rs.auth_user_id
    WHERE rp.room_id = p_room_id AND au.is_anonymous = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.room_has_guest(uuid) TO service_role;

-- Redefine get_room_state to carry paused_at + paused_lineup in the room object.
CREATE OR REPLACE FUNCTION public.get_room_state(p_room_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH
  room AS (
    SELECT id, code, host_session_id, player_count, max_cards, min_cards_per_hand,
           mode, phase, current_hand_id, version, stake, stake_locked,
           paused_at, paused_lineup
    FROM public.rooms WHERE id = p_room_id
  ),
  players AS (
    SELECT json_agg(jsonb_build_object(
      'session_id',   rp.session_id,
      'display_name', rs.display_name,
      'seat_index',   rp.seat_index,
      'is_ready',     rp.is_ready,
      'last_seen_at', rp.last_seen_at,
      'avatar',       au.raw_user_meta_data->>'avatar',
      'avatar_url',   au.raw_user_meta_data->>'avatar_url',
      'avatar_color', au.raw_user_meta_data->>'avatar_color',
      'opt_in_stake', rp.opt_in_stake,
      'is_guest',     COALESCE(au.is_anonymous, false)
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
      'avatar_url',   au.raw_user_meta_data->>'avatar_url',
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
  ),
  claims AS (
    SELECT json_agg(DISTINCT ge.session_id) AS list
    FROM public.game_events ge
    JOIN current_hand ch ON (ch.row ->> 'id')::uuid = ge.hand_id
    WHERE ge.kind = 'claim_tricks'
  )
  SELECT jsonb_build_object(
    'room',              (SELECT to_jsonb(room.*) FROM room),
    'players',           COALESCE((SELECT list FROM players), '[]'::json),
    'spectators',        COALESCE((SELECT list FROM spectators), '[]'::json),
    'current_hand',      (SELECT row FROM current_hand),
    'hand_scores',       COALESCE((SELECT list FROM hand_scores), '[]'::json),
    'current_trick',     (SELECT row FROM current_trick),
    'last_closed_trick', (SELECT row FROM last_closed_trick),
    'score_history',     COALESCE((SELECT list FROM history), '[]'::json),
    'claim_sessions',    COALESCE((SELECT list FROM claims), '[]'::json)
  );
$$;

ALTER FUNCTION public.get_room_state(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_room_state(uuid) TO anon, authenticated;
