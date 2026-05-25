-- supabase/migrations/20260525000000_rating_transfers.sql
-- Peer-to-peer rating transfers between authenticated players.
-- See docs/superpowers/specs/2026-05-25-rating-transfers-design.md

-- 1. Extend rating_events.reason CHECK to allow transfer_in / transfer_out.
ALTER TABLE public.rating_events DROP CONSTRAINT rating_events_reason_check;
ALTER TABLE public.rating_events
  ADD CONSTRAINT rating_events_reason_check
  CHECK (reason IN ('settle', 'admin_reset', 'transfer_in', 'transfer_out'));

-- 2. Counterparty for transfer rows (NULL for settle / admin_reset).
ALTER TABLE public.rating_events
  ADD COLUMN counterparty_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. Relax columns that don't apply to transfers.
ALTER TABLE public.rating_events
  ALTER COLUMN base_score DROP NOT NULL,
  ALTER COLUMN mean_score DROP NOT NULL,
  ALTER COLUMN stake DROP NOT NULL;

-- 4. lookup_rating_recipient: preview the recipient before the transfer.
CREATE OR REPLACE FUNCTION public.lookup_rating_recipient(p_email text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_from         uuid := auth.uid();
  v_email        text;
  v_to_id        uuid;
  v_to_anon      boolean;
  v_display_name text;
  v_meta         jsonb;
  v_local        text;
  v_domain       text;
  v_masked       text;
BEGIN
  IF v_from IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  v_email := lower(trim(coalesce(p_email, '')));
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT id, coalesce(is_anonymous, false)
    INTO v_to_id, v_to_anon
    FROM auth.users
    WHERE lower(email) = v_email
    LIMIT 1;

  IF v_to_id IS NULL OR v_to_anon THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  IF v_to_id = v_from THEN
    RETURN jsonb_build_object('found', true, 'is_self', true);
  END IF;

  SELECT display_name INTO v_display_name
    FROM public.room_sessions
    WHERE auth_user_id = v_to_id
    ORDER BY created_at DESC
    LIMIT 1;

  SELECT raw_user_meta_data INTO v_meta
    FROM auth.users WHERE id = v_to_id;

  v_local  := split_part(v_email, '@', 1);
  v_domain := split_part(v_email, '@', 2);
  v_masked := substr(v_local, 1, 1) || '***@' || v_domain;

  RETURN jsonb_build_object(
    'found',     true,
    'is_self',   false,
    'recipient', jsonb_build_object(
      'display_name',  v_display_name,
      'masked_email',  v_masked,
      'avatar',        v_meta->>'avatar',
      'avatar_url',    v_meta->>'avatar_url',
      'avatar_color',  v_meta->>'avatar_color'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_rating_recipient(text) TO authenticated;

-- 5. transfer_rating: atomic balance move + two journal rows.
CREATE OR REPLACE FUNCTION public.transfer_rating(p_to_email text, p_amount integer)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_from         uuid := auth.uid();
  v_email        text;
  v_to_id        uuid;
  v_to_anon      boolean;
  v_from_balance integer;
  v_display_name text;
  v_local        text;
  v_domain       text;
  v_masked       text;
BEGIN
  IF v_from IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  IF p_amount IS NULL OR p_amount < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  v_email := lower(trim(coalesce(p_to_email, '')));
  SELECT id, coalesce(is_anonymous, false)
    INTO v_to_id, v_to_anon
    FROM auth.users
    WHERE lower(email) = v_email
    LIMIT 1;

  IF v_to_id IS NULL OR v_to_anon THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipient_not_found');
  END IF;

  IF v_to_id = v_from THEN
    RETURN jsonb_build_object('ok', false, 'error', 'self_transfer');
  END IF;

  -- Make sure both rows exist so the FOR UPDATE actually locks something.
  INSERT INTO public.user_ratings (user_id, balance) VALUES (v_from, 0)
    ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.user_ratings (user_id, balance) VALUES (v_to_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

  -- Lock in user_id order to avoid deadlock when two transfers cross.
  -- Two explicit statements (rather than IN + ORDER BY) make the lock
  -- order unambiguous regardless of planner choices.
  PERFORM 1 FROM public.user_ratings WHERE user_id = least(v_from, v_to_id)    FOR UPDATE;
  PERFORM 1 FROM public.user_ratings WHERE user_id = greatest(v_from, v_to_id) FOR UPDATE;

  SELECT balance INTO v_from_balance
    FROM public.user_ratings WHERE user_id = v_from;

  IF v_from_balance < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance');
  END IF;

  UPDATE public.user_ratings
    SET balance = balance - p_amount, updated_at = now()
    WHERE user_id = v_from;

  UPDATE public.user_ratings
    SET balance = balance + p_amount, updated_at = now()
    WHERE user_id = v_to_id;

  INSERT INTO public.rating_events
    (user_id, room_id, reason,        delta,     counterparty_user_id)
    VALUES
    (v_from,  NULL,    'transfer_out', -p_amount, v_to_id);

  INSERT INTO public.rating_events
    (user_id, room_id, reason,       delta,     counterparty_user_id)
    VALUES
    (v_to_id, NULL,    'transfer_in', p_amount,  v_from);

  SELECT display_name INTO v_display_name
    FROM public.room_sessions
    WHERE auth_user_id = v_to_id
    ORDER BY created_at DESC
    LIMIT 1;

  v_local  := split_part(v_email, '@', 1);
  v_domain := split_part(v_email, '@', 2);
  v_masked := substr(v_local, 1, 1) || '***@' || v_domain;

  RETURN jsonb_build_object(
    'ok',          true,
    'new_balance', v_from_balance - p_amount,
    'recipient',   jsonb_build_object(
      'display_name', v_display_name,
      'masked_email', v_masked
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_rating(text, integer) TO authenticated;

-- 6. get_my_rating_events: last N events for the calling user, with counterparty names.
CREATE OR REPLACE FUNCTION public.get_my_rating_events(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH ev AS (
    SELECT
      e.id,
      e.reason,
      e.delta,
      e.created_at,
      e.room_id,
      e.counterparty_user_id
    FROM public.rating_events e
    WHERE e.user_id = auth.uid()
    ORDER BY e.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 20), 100))
  ),
  with_names AS (
    SELECT
      ev.*,
      (
        SELECT rs.display_name
        FROM public.room_sessions rs
        WHERE rs.auth_user_id = ev.counterparty_user_id
        ORDER BY rs.created_at DESC
        LIMIT 1
      ) AS counterparty_display_name
    FROM ev
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',                        id,
    'reason',                    reason,
    'delta',                     delta,
    'created_at',                created_at,
    'room_id',                   room_id,
    'counterparty_display_name', counterparty_display_name
  ) ORDER BY created_at DESC), '[]'::jsonb)
  FROM with_names;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_rating_events(integer) TO authenticated;
