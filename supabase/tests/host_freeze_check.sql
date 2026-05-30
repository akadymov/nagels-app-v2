-- Manual verification for the host-freeze migration. Transaction-wrapped (ROLLBACK).
-- Run: docker exec -i supabase_db_nigels-app-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/host_freeze_check.sql
BEGIN;

-- 'paused' is now an accepted room phase.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000','dddddddd-dddd-dddd-dddd-dddddddddddd','authenticated','authenticated','freeze@nigels.test','',now(),now(),now());
INSERT INTO public.room_sessions (id, auth_user_id, display_name)
VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','dddddddd-dddd-dddd-dddd-dddddddddddd','Freeze');
INSERT INTO public.rooms (id, code, host_session_id, player_count, phase, paused_at, paused_lineup)
VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff','FRZ001','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',4,
        'paused', now(), ARRAY['eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee']::uuid[]);
INSERT INTO public.room_players (room_id, session_id, seat_index, last_seen_at)
VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',0, now() - INTERVAL '10 minutes');

-- get_room_state emits paused_at + paused_lineup on the room object.
DO $$
DECLARE v jsonb;
BEGIN
  v := public.get_room_state('ffffffff-ffff-ffff-ffff-ffffffffffff');
  IF NOT ((v->'room') ? 'paused_at') OR NOT ((v->'room') ? 'paused_lineup') THEN
    RAISE EXCEPTION 'FAIL: room object missing paused_at/paused_lineup';
  END IF;
  IF (v->'room'->>'phase') <> 'paused' THEN
    RAISE EXCEPTION 'FAIL: room phase should be paused';
  END IF;
END $$;

SELECT 'PASS: paused phase accepted + snapshot carries paused fields' AS result;
ROLLBACK;
