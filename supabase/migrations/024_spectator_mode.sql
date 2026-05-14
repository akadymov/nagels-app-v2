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
