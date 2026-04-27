-- ============================================================
-- Nägels Online — Sync Redesign Migration
-- See docs/superpowers/specs/2026-04-27-sync-redesign-design.md
-- ============================================================

BEGIN;

-- ── 1. Drop legacy tables ──────────────────────────────────
DROP TABLE IF EXISTS public.game_states CASCADE;
DROP TABLE IF EXISTS public.game_events CASCADE;
DROP TABLE IF EXISTS public.room_players CASCADE;
DROP TABLE IF EXISTS public.rooms CASCADE;
DROP TABLE IF EXISTS public.player_sessions CASCADE;

-- ── 2. Identity ────────────────────────────────────────────
CREATE TABLE public.room_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (auth_user_id)
);

CREATE INDEX idx_room_sessions_auth_user ON public.room_sessions(auth_user_id);

-- ── 3. Rooms ───────────────────────────────────────────────
CREATE TABLE public.rooms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT UNIQUE NOT NULL,
  host_session_id UUID NOT NULL REFERENCES public.room_sessions(id) ON DELETE RESTRICT,
  player_count    INT  NOT NULL CHECK (player_count BETWEEN 2 AND 6),
  max_cards       INT  NOT NULL DEFAULT 10,
  phase           TEXT NOT NULL DEFAULT 'waiting'
                       CHECK (phase IN ('waiting','playing','finished')),
  current_hand_id UUID NULL,
  version         BIGINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rooms_code ON public.rooms(code);
CREATE INDEX idx_rooms_phase ON public.rooms(phase);

CREATE TABLE public.room_players (
  room_id        UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  session_id     UUID NOT NULL REFERENCES public.room_sessions(id) ON DELETE CASCADE,
  seat_index     INT  NOT NULL,
  is_ready       BOOL NOT NULL DEFAULT FALSE,
  is_connected   BOOL NOT NULL DEFAULT TRUE,
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, session_id),
  UNIQUE (room_id, seat_index)
);

CREATE INDEX idx_room_players_session ON public.room_players(session_id);

-- ── 4. Hands ───────────────────────────────────────────────
CREATE TABLE public.hands (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  hand_number      INT  NOT NULL,
  cards_per_player INT  NOT NULL,
  trump_suit       TEXT NOT NULL,
  starting_seat    INT  NOT NULL,
  current_seat     INT  NOT NULL,
  phase            TEXT NOT NULL DEFAULT 'betting'
                        CHECK (phase IN ('betting','playing','scoring','closed')),
  deck_seed        TEXT NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at        TIMESTAMPTZ NULL,
  UNIQUE (room_id, hand_number)
);

ALTER TABLE public.rooms
  ADD CONSTRAINT rooms_current_hand_fk
  FOREIGN KEY (current_hand_id) REFERENCES public.hands(id) ON DELETE SET NULL;

CREATE INDEX idx_hands_room ON public.hands(room_id);

CREATE TABLE public.dealt_cards (
  hand_id    UUID NOT NULL REFERENCES public.hands(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.room_sessions(id) ON DELETE CASCADE,
  card       TEXT NOT NULL,
  PRIMARY KEY (hand_id, session_id, card)
);

CREATE INDEX idx_dealt_cards_session ON public.dealt_cards(session_id);

CREATE TABLE public.hand_scores (
  hand_id      UUID NOT NULL REFERENCES public.hands(id) ON DELETE CASCADE,
  session_id   UUID NOT NULL REFERENCES public.room_sessions(id) ON DELETE CASCADE,
  bet          INT  NOT NULL,
  taken_tricks INT  NOT NULL DEFAULT 0,
  hand_score   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (hand_id, session_id)
);

-- ── 5. Tricks ──────────────────────────────────────────────
CREATE TABLE public.tricks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hand_id       UUID NOT NULL REFERENCES public.hands(id) ON DELETE CASCADE,
  trick_number  INT  NOT NULL,
  lead_seat     INT  NOT NULL,
  winner_seat   INT  NULL,
  closed_at     TIMESTAMPTZ NULL,
  UNIQUE (hand_id, trick_number)
);

CREATE INDEX idx_tricks_hand ON public.tricks(hand_id);

CREATE TABLE public.trick_cards (
  trick_id   UUID NOT NULL REFERENCES public.tricks(id) ON DELETE CASCADE,
  seat_index INT  NOT NULL,
  card       TEXT NOT NULL,
  played_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trick_id, seat_index)
);

-- ── 6. Audit / replay ──────────────────────────────────────
CREATE TABLE public.game_events (
  id          BIGSERIAL PRIMARY KEY,
  room_id     UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  hand_id     UUID NULL REFERENCES public.hands(id) ON DELETE CASCADE,
  session_id  UUID NULL REFERENCES public.room_sessions(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_game_events_room_created ON public.game_events(room_id, created_at);

-- ── 7. RLS — closed by default; reads via SECURITY DEFINER RPC ──
ALTER TABLE public.room_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_players   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hands          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealt_cards    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hand_scores    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tricks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trick_cards    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_events    ENABLE ROW LEVEL SECURITY;

-- No policies = no anon/authenticated access.
-- Edge Function uses service-role key. Read RPC below uses SECURITY DEFINER.

-- ── 8. get_room_state RPC ──────────────────────────────────
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
      'last_seen_at', rp.last_seen_at
    ) ORDER BY rp.seat_index) AS list
    FROM public.room_players rp
    JOIN public.room_sessions rs ON rs.id = rp.session_id
    WHERE rp.room_id = p_room_id
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
    'room',          (SELECT to_jsonb(room.*) FROM room),
    'players',       (SELECT list FROM players),
    'current_hand',  (SELECT row FROM current_hand),
    'hand_scores',   COALESCE((SELECT list FROM hand_scores), '[]'::json),
    'current_trick', (SELECT row FROM current_trick),
    'score_history', COALESCE((SELECT list FROM history), '[]'::json)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_room_state(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_room_state(UUID) TO anon, authenticated;

-- ── 9. Helper: dealt cards for a single player ─────────────
CREATE OR REPLACE FUNCTION public.get_my_hand(p_hand_id UUID, p_session_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(json_agg(card), '[]'::json)::jsonb
  FROM public.dealt_cards
  WHERE hand_id = p_hand_id AND session_id = p_session_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_hand(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_hand(UUID, UUID) TO anon, authenticated;

COMMIT;
