-- Tighten the feedback INSERT policy.
--
-- The baseline shipped `feedback_insert_anyone WITH CHECK (true)`, which let a
-- caller stamp an arbitrary `player_id` UUID onto a row (forgeable attribution)
-- on top of being a wide-open spam target. Replace it so:
--   * anonymous rows must leave player_id NULL (auth.uid() is NULL for anon, so
--     `player_id = auth.uid()` can never be true for them);
--   * authenticated rows may only claim their own uid (or NULL).
--
-- See BACKLOG: "[tech][security][MEDIUM] Feedback table accepts anon inserts +
-- forgeable player_id". The IP/session rate-limit trigger noted there is a
-- separate follow-up and intentionally not bundled here.

DROP POLICY IF EXISTS "feedback_insert_anyone" ON public.feedback;

CREATE POLICY "feedback_insert_own" ON public.feedback
  FOR INSERT TO authenticated, anon
  WITH CHECK (player_id IS NULL OR player_id = auth.uid());
