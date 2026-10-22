-- Offline tournament: expose each participant's bonus count (hands where
-- bet = tricks taken) across all tours in the standings.

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
    SELECT hs.hand_id, r.id AS room_id, rs.tournament_participant_id AS pid,
           hs.hand_score, hs.bet, hs.taken_tricks, r.stake
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
  room_totals AS (
    SELECT room_id, pid,
           sum(hand_score)                             AS pts,
           count(*) FILTER (WHERE bet = taken_tricks)  AS bonuses
    FROM scored GROUP BY room_id, pid
  ),
  ranked AS (
    SELECT pid,
           count(*) OVER (PARTITION BY room_id)                                    AS n,
           rank()   OVER (PARTITION BY room_id ORDER BY pts DESC, bonuses DESC)    AS rk,
           count(*) OVER (PARTITION BY room_id, pts, bonuses)                      AS tied
    FROM room_totals
  ),
  places AS (
    -- Tied players span places rk..rk+tied-1 and share their average points.
    SELECT pid, sum(n - rk - (tied - 1) / 2.0) AS place_points
    FROM ranked GROUP BY pid
  ),
  money AS (
    SELECT s.pid, sum((s.hand_score - m.mean) * s.stake) AS balance,
           count(*) FILTER (WHERE s.bet = s.taken_tricks) AS bonuses
    FROM scored s JOIN means m USING (hand_id)
    GROUP BY s.pid
  ),
  board AS (
    SELECT json_agg(jsonb_build_object(
      'participant_id', x.pid, 'balance', x.balance, 'place_points', x.place_points,
      'bonuses', x.bonuses
    ) ORDER BY x.place_points DESC, x.balance DESC) AS list
    FROM (
      SELECT m.pid, m.balance, m.bonuses, COALESCE(p.place_points, 0) AS place_points
      FROM money m LEFT JOIN places p USING (pid)
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
