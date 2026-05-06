-- 022_push_subscriptions.sql
-- Browser-side Web Push endpoints, one row per browser instance.
-- Bound to auth_user_id (stable across rooms), NOT session_id (transient).

CREATE TABLE public.push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL,
  p256dh        TEXT NOT NULL,
  auth_secret   TEXT NOT NULL,
  lang          TEXT NOT NULL DEFAULT 'en',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (endpoint)
);

CREATE INDEX idx_push_subs_user ON public.push_subscriptions(auth_user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_subs_owner_all ON public.push_subscriptions
  FOR ALL
  USING (auth.uid() = auth_user_id)
  WITH CHECK (auth.uid() = auth_user_id);
