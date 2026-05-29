-- Manual verification for public.room_is_alive. Run against local Supabase
-- (see plan note: psql only exists inside the Docker container).
-- Wrapped in a transaction that ROLLBACKs — no rows persist.
-- Note: UUIDs use aaaa.../bbbb.../cccc... prefix to avoid collisions with
-- existing seed data (11111.../22222.../33333... are taken by Alice/Bob/etc.).
BEGIN;

-- Minimal seed: one auth user -> one room_session -> one room -> one player.
INSERT INTO auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'authenticated', 'authenticated', 'livecheck@nigels.test',
        '', now(), now(), now());

INSERT INTO public.room_sessions (id, auth_user_id, display_name)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'LiveCheck');

INSERT INTO public.rooms (id, code, host_session_id, player_count, phase)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'LIVE01',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 4, 'waiting');

INSERT INTO public.room_players (room_id, session_id, seat_index, last_seen_at)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 0, now());

-- Fresh heartbeat -> alive.
DO $$
BEGIN
  IF public.room_is_alive('cccccccc-cccc-cccc-cccc-cccccccccccc') IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: fresh participant should be alive';
  END IF;
END $$;

-- Backdate heartbeat past 5 min -> dead.
UPDATE public.room_players
   SET last_seen_at = now() - INTERVAL '6 minutes'
 WHERE room_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

DO $$
BEGIN
  IF public.room_is_alive('cccccccc-cccc-cccc-cccc-cccccccccccc') IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: stale-only participant should be dead';
  END IF;
END $$;

-- Spectator branch: player still stale, but a fresh spectator -> alive again.
-- Exercises the room_spectators leg of the UNION ALL (player leg alone would
-- pass even if that leg were deleted).
INSERT INTO public.room_spectators (room_id, session_id, last_seen_at)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', now());

DO $$
BEGIN
  IF public.room_is_alive('cccccccc-cccc-cccc-cccc-cccccccccccc') IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: stale player + fresh spectator should still be alive';
  END IF;
END $$;

SELECT 'PASS: room_is_alive liveness thresholds correct (player + spectator branches)' AS result;

ROLLBACK;
