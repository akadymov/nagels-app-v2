-- Offline tournament mode: a tournament owns N scorekeeper rooms per tour,
-- seated with proxy room_sessions (no auth user). See
-- docs/superpowers/specs/2026-10-17-offline-tournament-design.md.

-- 1. Tables.
CREATE TABLE IF NOT EXISTS public.tournaments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  admin_session_id UUID REFERENCES public.room_sessions(id) ON DELETE SET NULL,
  max_cards        INT  NOT NULL CHECK (max_cards BETWEEN 1 AND 10),
  table_secret     TEXT NOT NULL,
  current_tour     INT  NOT NULL DEFAULT 0,
  version          BIGINT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tournament_participants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  no_stakes     BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (tournament_id, display_name)
);

-- Reads go through get_tournament_state (SECURITY DEFINER); no direct access,
-- so table_secret never leaves the server.
ALTER TABLE public.tournaments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_participants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournaments, public.tournament_participants FROM anon, authenticated;

-- 2. Rooms belong to a tournament tour/table.
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS tournament_id UUID REFERENCES public.tournaments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS tour_number   INT,
  ADD COLUMN IF NOT EXISTS table_number  INT,
  ADD COLUMN IF NOT EXISTS table_claimed BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS rooms_tournament_idx ON public.rooms (tournament_id, tour_number);

-- 3. Proxy sessions: no auth user; UNIQUE(auth_user_id) still holds (NULLs don't collide).
ALTER TABLE public.room_sessions ALTER COLUMN auth_user_id DROP NOT NULL;
ALTER TABLE public.room_sessions
  ADD COLUMN IF NOT EXISTS tournament_participant_id UUID
    REFERENCES public.tournament_participants(id) ON DELETE CASCADE;

-- 4. get_room_state: + tournament fields on room, + is_proxy on players.
--    Body copied from 20260531000000_host_freeze_game.sql; only the two marked lines differ.
CREATE OR REPLACE FUNCTION public.get_room_state(p_room_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH
  room AS (
    SELECT id, code, host_session_id, player_count, max_cards, min_cards_per_hand,
           mode, phase, current_hand_id, version, stake, stake_locked,
           paused_at, paused_lineup,
           tournament_id, tour_number, table_number, table_claimed          -- NEW
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
      'is_guest',     COALESCE(au.is_anonymous, false),
      'is_proxy',     rs.tournament_participant_id IS NOT NULL,           -- NEW
      'participant_id', rs.tournament_participant_id                       -- NEW
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

-- 5. get_tournament_state: public read model for the TV / recorder / admin.
CREATE OR REPLACE FUNCTION public.get_tournament_state(p_code text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH
  t AS (
    SELECT id, code, name, max_cards, current_tour, version, admin_session_id
    FROM public.tournaments WHERE code = upper(p_code)
  ),
  parts AS (
    SELECT json_agg(jsonb_build_object(
      'id', p.id, 'display_name', p.display_name, 'no_stakes', p.no_stakes
    ) ORDER BY p.display_name) AS list
    FROM public.tournament_participants p JOIN t ON p.tournament_id = t.id
  ),
  tour_tables AS (
    SELECT json_agg(jsonb_build_object(
      'table_number', r.table_number,
      'room_id',      r.id,
      'stake',        r.stake,
      'claimed',      r.table_claimed,
      'state',        public.get_room_state(r.id)
    ) ORDER BY r.table_number) AS list
    FROM public.rooms r JOIN t ON r.tournament_id = t.id AND r.tour_number = t.current_tour
  ),
  scored AS (
    SELECT hs.hand_id, rs.tournament_participant_id AS pid, hs.hand_score, r.stake
    FROM public.hand_scores hs
    JOIN public.hands h          ON h.id = hs.hand_id
    JOIN public.rooms r          ON r.id = h.room_id
    JOIN t                       ON r.tournament_id = t.id
    JOIN public.room_sessions rs ON rs.id = hs.session_id
    WHERE h.phase IN ('scoring', 'closed') AND rs.tournament_participant_id IS NOT NULL
  ),
  means AS (
    SELECT hand_id, avg(hand_score)::numeric AS mean FROM scored GROUP BY hand_id
  ),
  board AS (
    SELECT json_agg(jsonb_build_object(
      'participant_id', x.pid, 'balance', x.balance, 'total_points', x.pts
    ) ORDER BY x.balance DESC, x.pts DESC) AS list
    FROM (
      SELECT s.pid,
             sum((s.hand_score - m.mean) * s.stake) AS balance,
             sum(s.hand_score)                      AS pts
      FROM scored s JOIN means m USING (hand_id)
      GROUP BY s.pid
    ) x
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM t) THEN NULL ELSE jsonb_build_object(
    'tournament',   (SELECT to_jsonb(t.*) FROM t),
    'participants', COALESCE((SELECT list FROM parts), '[]'::json),
    'tables',       COALESCE((SELECT list FROM tour_tables), '[]'::json),
    'leaderboard',  COALESCE((SELECT list FROM board), '[]'::json)
  ) END;
$$;
ALTER FUNCTION public.get_tournament_state(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_tournament_state(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tournament_state(text) TO anon, authenticated, service_role;

-- 6. undo_last_bet_action: scorekeeper-only. Bets advance seat +1 (see
--    place_bet_action), so the last bidder is the seat before current_seat
--    while betting, or the seat before starting_seat once the hand moved to
--    tricks_recording (allowed only before any trick claim).
CREATE OR REPLACE FUNCTION public.undo_last_bet_action(p_room_id uuid, p_hand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_mode        TEXT;
  v_hand        RECORD;
  v_n           INT;
  v_bets        INT;
  v_seat        INT;
  v_session     UUID;
  v_new_version BIGINT;
  v_state       JSONB;
  v_err         TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_room_id::text));

  SELECT mode INTO v_mode FROM public.rooms WHERE id = p_room_id;
  SELECT * INTO v_hand FROM public.hands WHERE id = p_hand_id AND room_id = p_room_id FOR UPDATE;
  SELECT COUNT(*) INTO v_n FROM public.room_players WHERE room_id = p_room_id;
  SELECT COUNT(*) INTO v_bets FROM public.hand_scores WHERE hand_id = p_hand_id;

  IF v_mode IS DISTINCT FROM 'scorekeeper' OR v_hand.id IS NULL THEN
    v_err := 'cannot_undo';
  ELSIF v_hand.phase = 'betting' THEN
    IF v_bets = 0 THEN v_err := 'nothing_to_undo';
    ELSE v_seat := (v_hand.current_seat + v_n - 1) % v_n;
    END IF;
  ELSIF v_hand.phase = 'tricks_recording' THEN
    IF EXISTS (SELECT 1 FROM public.game_events WHERE hand_id = p_hand_id AND kind = 'claim_tricks') THEN
      v_err := 'cannot_undo';
    ELSE v_seat := (v_hand.starting_seat + v_n - 1) % v_n;
    END IF;
  ELSE
    v_err := 'cannot_undo';
  END IF;

  IF v_err IS NOT NULL THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', v_err,
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  SELECT session_id INTO v_session FROM public.room_players
   WHERE room_id = p_room_id AND seat_index = v_seat;
  DELETE FROM public.hand_scores WHERE hand_id = p_hand_id AND session_id = v_session;
  UPDATE public.hands SET current_seat = v_seat, phase = 'betting' WHERE id = p_hand_id;

  INSERT INTO public.game_events (room_id, hand_id, session_id, kind, payload)
  VALUES (p_room_id, p_hand_id, v_session, 'bet_undone', jsonb_build_object('seat', v_seat));

  UPDATE public.rooms SET version = version + 1, updated_at = now() WHERE id = p_room_id
    RETURNING version INTO v_new_version;

  SELECT public.get_room_state(p_room_id) INTO v_state;
  RETURN jsonb_build_object('ok', true, 'state', v_state, 'version', v_new_version);
END;
$$;
ALTER FUNCTION public.undo_last_bet_action(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.undo_last_bet_action(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.undo_last_bet_action(uuid, uuid) TO service_role;

-- 7. cleanup_stale_rooms: keep tournament history (balance is derived from it).
--    Body copied from the baseline with one added WHERE.
CREATE OR REPLACE FUNCTION public.cleanup_stale_rooms() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
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
     WHERE r.tournament_id IS NULL
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
