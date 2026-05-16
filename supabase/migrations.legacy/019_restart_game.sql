-- Host-only "Play again" handler. Resets a finished room to a fresh
-- 'waiting' phase, keeping the same player roster, and drops every
-- artefact of the previous match (hands → tricks → trick_cards /
-- dealt_cards / hand_scores cascade) so the next start_game deals a
-- clean board. Marks every player as not_ready so the readiness
-- handshake has to repeat — identical to a brand-new room.

CREATE OR REPLACE FUNCTION public.restart_game(p_room_id UUID, p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_room   public.rooms%ROWTYPE;
  v_state  JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_room_id::text));

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'room_not_found',
      'state', '{}'::jsonb, 'version', 0);
  END IF;

  IF v_room.host_session_id <> p_session_id THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', 'host_only',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  IF v_room.phase <> 'finished' THEN
    SELECT public.get_room_state(p_room_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'error', 'not_finished',
      'state', v_state, 'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
  END IF;

  DELETE FROM public.hands WHERE room_id = p_room_id;
  DELETE FROM public.game_events WHERE room_id = p_room_id;

  UPDATE public.room_players
     SET is_ready = FALSE
   WHERE room_id = p_room_id;

  UPDATE public.rooms
     SET phase = 'waiting',
         current_hand_id = NULL,
         version = COALESCE(version, 0) + 1,
         updated_at = now()
   WHERE id = p_room_id;

  SELECT public.get_room_state(p_room_id) INTO v_state;
  RETURN jsonb_build_object('ok', true, 'state', v_state,
    'version', COALESCE((v_state->'room'->>'version')::bigint, 0));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restart_game(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.restart_game(UUID, UUID) TO service_role;
