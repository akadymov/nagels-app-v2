-- ============================================================
-- Nägels Online — Feedback Table Migration
-- ============================================================
-- Allows any user (including anonymous guests) to submit
-- in-app feedback. Submissions are write-only from the client;
-- reads are restricted (use the Supabase dashboard / service
-- role to review).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Author
  player_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name TEXT,                              -- name typed in form (for non-logged-in users)
  email TEXT,                                     -- present if user is signed in with email

  -- Body
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('bug', 'idea', 'ux', 'general')),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),

  -- Auto-context (helps reproduce bugs)
  screen TEXT,                                    -- current screen name
  room_id UUID,                                   -- current room if any
  app_version TEXT,                               -- from package.json / app.json
  platform TEXT,                                  -- 'web' | 'ios' | 'android'
  user_agent TEXT,                                -- browser UA on web
  language TEXT,                                  -- current i18n locale
  extra JSONB                                     -- catch-all for future fields
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON public.feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_category   ON public.feedback(category);
CREATE INDEX IF NOT EXISTS idx_feedback_player_id  ON public.feedback(player_id);

-- ============================================================
-- Row-Level Security
-- Anyone (anon + authenticated) may INSERT.
-- No-one may SELECT/UPDATE/DELETE through the anon key —
-- review feedback via the dashboard or service role.
-- ============================================================

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_insert_anyone" ON public.feedback;
CREATE POLICY "feedback_insert_anyone" ON public.feedback
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);
