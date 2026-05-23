-- Conditional stakes: per-user rating balance + journal, stake column on
-- rooms, opt-in column on room_players, get_room_state extension, read RPCs.

CREATE TABLE public.user_ratings (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance    INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_ratings_self_select
  ON public.user_ratings
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE TABLE public.rating_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id    UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  reason     TEXT NOT NULL CHECK (reason IN ('settle', 'admin_reset')),
  delta      INTEGER NOT NULL,
  base_score INTEGER NOT NULL,
  mean_score NUMERIC NOT NULL,
  stake      INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX rating_events_user_idx ON public.rating_events (user_id, created_at DESC);
CREATE INDEX rating_events_room_idx ON public.rating_events (room_id);

ALTER TABLE public.rating_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY rating_events_self_select
  ON public.rating_events
  FOR SELECT
  USING (auth.uid() = user_id);

-- Extend rooms with stake configuration.
ALTER TABLE public.rooms
  ADD COLUMN stake        INTEGER NOT NULL DEFAULT 0
                            CHECK (stake IN (0, 1, 5, 10, 25)),
  ADD COLUMN stake_locked BOOLEAN NOT NULL DEFAULT false;

-- Per-room opt-in flag.
ALTER TABLE public.room_players
  ADD COLUMN opt_in_stake BOOLEAN NOT NULL DEFAULT false;

-- get_room_state: surface stake fields on the room and opt_in_stake on each player.
CREATE OR REPLACE FUNCTION public.get_room_state(p_room_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH
  room AS (
    SELECT id, code, host_session_id, player_count, max_cards, min_cards_per_hand,
           mode, phase, current_hand_id, version, stake, stake_locked
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
      'avatar_url',   au.raw_user_meta_data->>'avatar_url',
      'avatar_color', au.raw_user_meta_data->>'avatar_color',
      'opt_in_stake', rp.opt_in_stake
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

-- Read RPC: current user's rating balance. Returns 0 if no row yet.
CREATE OR REPLACE FUNCTION public.get_my_rating()
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    (SELECT balance FROM public.user_ratings WHERE user_id = auth.uid()),
    0
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_my_rating() TO authenticated;

-- Read RPC: per-game settlement view for the requesting user.
-- Returns the rows of opted-in players in this room with their final
-- aggregate game score and the delta written for them in rating_events.
-- Only readable by users who themselves opted in to the room.
CREATE OR REPLACE FUNCTION public.get_rating_settlement(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_my_user_id UUID;
  v_my_session UUID;
  v_my_opt_in  BOOLEAN;
  v_rows       JSONB;
  v_old        INTEGER;
  v_new        INTEGER;
BEGIN
  v_my_user_id := auth.uid();
  IF v_my_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT rs.id, rp.opt_in_stake
    INTO v_my_session, v_my_opt_in
  FROM public.room_sessions rs
  JOIN public.room_players rp ON rp.session_id = rs.id
  WHERE rs.auth_user_id = v_my_user_id AND rp.room_id = p_room_id
  LIMIT 1;

  IF v_my_session IS NULL OR v_my_opt_in IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  SELECT json_agg(jsonb_build_object(
    'user_id',      ev.user_id,
    'display_name', rs.display_name,
    'score',        ev.base_score,
    'delta',        ev.delta
  ))
    INTO v_rows
  FROM public.rating_events ev
  JOIN public.room_sessions rs ON rs.auth_user_id = ev.user_id
  JOIN public.room_players  rp ON rp.session_id = rs.id AND rp.room_id = p_room_id
  WHERE ev.room_id = p_room_id AND ev.reason = 'settle';

  SELECT
    COALESCE((SELECT balance FROM public.user_ratings WHERE user_id = v_my_user_id), 0),
    COALESCE((SELECT delta   FROM public.rating_events
              WHERE user_id = v_my_user_id AND room_id = p_room_id AND reason = 'settle'
              LIMIT 1), 0)
    INTO v_new, v_old;

  RETURN jsonb_build_object(
    'old_balance', v_new - v_old,
    'new_balance', v_new,
    'rows',        COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_rating_settlement(uuid) TO authenticated;
