-- ============================================================
-- Nägels Online — Auth Support Migration
-- ============================================================
--
-- BEFORE RUNNING THIS SCRIPT:
--
--   1. Go to Supabase Dashboard → Authentication → Providers
--   2. Enable "Anonymous sign-ins" (toggle it on)
--   3. Optionally disable email confirmation for smoother onboarding:
--      Authentication → Email → "Confirm email" → OFF
--
-- Then run this script in the Supabase SQL Editor.
-- ============================================================


-- ============================================================
-- 1. Allow player_sessions to be created with an explicit id
--    (needed so Supabase Auth user.id can be used as the row id)
-- ============================================================

-- Remove the default gen_random_uuid() constraint if it exists,
-- so we can INSERT with explicit UUID values.
-- (Safe to run even if already removed.)
ALTER TABLE public.player_sessions
  ALTER COLUMN id DROP DEFAULT;

-- Re-add a default only if no value is provided
ALTER TABLE public.player_sessions
  ALTER COLUMN id SET DEFAULT gen_random_uuid();


-- ============================================================
-- 2. Add auth_user_id column for linking to Supabase Auth
--    (used for lookups when Supabase Auth anonymous sign-in
--     is NOT enabled and we fall back to device-ID sessions)
-- ============================================================

ALTER TABLE public.player_sessions
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_player_sessions_auth_user_id
  ON public.player_sessions(auth_user_id);


-- ============================================================
-- 3. Row-Level Security (RLS) — recommended hardening
--    Enable if not already enabled. Adjust to your needs.
-- ============================================================

-- Allow anyone with a valid anon key to read rooms they're in
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_sessions ENABLE ROW LEVEL SECURITY;

-- Drop old permissive policies if they exist
DROP POLICY IF EXISTS "Allow all" ON public.rooms;
DROP POLICY IF EXISTS "Allow all" ON public.room_players;
DROP POLICY IF EXISTS "Allow all" ON public.game_states;
DROP POLICY IF EXISTS "Allow all" ON public.game_events;
DROP POLICY IF EXISTS "Allow all" ON public.player_sessions;

-- Permissive policies (open, required for anon key access)
-- Tighten these once you have a stable auth flow.

CREATE POLICY "anon_all_rooms" ON public.rooms
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon_all_room_players" ON public.room_players
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon_all_game_states" ON public.game_states
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon_all_game_events" ON public.game_events
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon_all_player_sessions" ON public.player_sessions
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);


-- ============================================================
-- Done.
-- After running this script, test the flow:
--   1. Open the app → anonymous sign-in should create a Supabase Auth user
--   2. Create / join a room → active room is saved to AsyncStorage
--   3. Refresh the browser → app restores session and navigates back to room
--   4. Register with email → same player_id, all game history preserved
-- ============================================================
