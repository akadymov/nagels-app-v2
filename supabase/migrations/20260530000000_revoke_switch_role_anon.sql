-- Revoke switch_role EXECUTE from the anon Postgres role.
--
-- 20260524000000_switch_role.sql granted EXECUTE to `anon`, which is a formal
-- regression relative to the other client-callable RPCs (transfer_rating,
-- lookup_rating_recipient, get_my_rating_events, get_my_active_room, ...) that
-- are granted `TO authenticated` only.
--
-- The function already rejects unauthenticated callers internally
-- (`auth.uid() IS NULL → auth_failed`), so this is defense-in-depth, not a
-- behavior change. Guest players use anonymous *auth* sessions, which carry a
-- real JWT and run under the `authenticated` role — they are unaffected.

REVOKE EXECUTE ON FUNCTION public.switch_role(uuid, uuid, text) FROM anon;
