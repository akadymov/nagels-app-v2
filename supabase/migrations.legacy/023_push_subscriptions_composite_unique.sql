-- 023_push_subscriptions_composite_unique.sql
-- Replace UNIQUE(endpoint) with UNIQUE(auth_user_id, endpoint).
--
-- Original 022 keyed conflicts on endpoint alone, which let one user's
-- subscribe call silently overwrite another user's row when both shared
-- a browser (same SW = same endpoint). Composite key keeps each user's
-- row independent; push-subscribe explicitly claims the endpoint by
-- deleting other users' rows for the same endpoint after upsert.

ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_key;

ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_user_endpoint_key UNIQUE (auth_user_id, endpoint);
