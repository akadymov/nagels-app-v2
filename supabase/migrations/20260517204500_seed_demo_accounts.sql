-- Seed 4 confirmed test accounts for the multiplayer-demo spec
-- (tests/e2e/multiplayer-demo.spec.ts). All four pre-confirmed,
-- password = 'demo-pass-1234' (bcrypt-hashed at INSERT time), and
-- pre-populated user_metadata so the demo doesn't have to click
-- through Settings on each boot.
--
-- Idempotent via ON CONFLICT — re-running `supabase db reset`
-- against an already-seeded DB is a no-op. Safe to drop into any
-- isolated :8082 test stack.
--
-- Password override: edit DEMO_LOGIN_PASS in the spec to match if
-- you change the value here.

DO $$
DECLARE
  demo_password TEXT := 'demo-pass-1234';
  alice_id UUID := '11111111-1111-1111-1111-111111111111';
  bob_id   UUID := '22222222-2222-2222-2222-222222222222';
  dave_id  UUID := '44444444-4444-4444-4444-444444444444';
  eve_id   UUID := '55555555-5555-5555-5555-555555555555';
BEGIN
  -- Alice — P1 (host) — EN / light / 4-color
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', alice_id,
    'authenticated', 'authenticated', 'alice@nigels.test',
    crypt(demo_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Alice","lang":"en","theme":"light","deck":"fourColor","avatar":"🦈"}'::jsonb,
    now(), now(), '', '', '', ''
  )
  ON CONFLICT (id) DO NOTHING;

  -- Bob — P2 — RU / dark / 4-color
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', bob_id,
    'authenticated', 'authenticated', 'bob@nigels.test',
    crypt(demo_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Bob","lang":"ru","theme":"dark","deck":"fourColor","avatar":"🐺"}'::jsonb,
    now(), now(), '', '', '', ''
  )
  ON CONFLICT (id) DO NOTHING;

  -- Dave — P4 — EN / dark / 4-color
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', dave_id,
    'authenticated', 'authenticated', 'dave@nigels.test',
    crypt(demo_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Dave","lang":"en","theme":"dark","deck":"fourColor","avatar":"🦊"}'::jsonb,
    now(), now(), '', '', '', ''
  )
  ON CONFLICT (id) DO NOTHING;

  -- Eve — P5 — RU / light / 4-color (desktop)
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', eve_id,
    'authenticated', 'authenticated', 'eve@nigels.test',
    crypt(demo_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Eve","lang":"ru","theme":"light","deck":"fourColor","avatar":"🦝"}'::jsonb,
    now(), now(), '', '', '', ''
  )
  ON CONFLICT (id) DO NOTHING;

  -- auth.identities rows for the email provider. Without these,
  -- /auth/v1/token (password grant) refuses the login with
  -- "Invalid login credentials" even when the user exists.
  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  )
  SELECT u.id::text, u.id,
    jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  FROM auth.users u
  WHERE u.email IN ('alice@nigels.test', 'bob@nigels.test', 'dave@nigels.test', 'eve@nigels.test')
  ON CONFLICT (provider_id, provider) DO NOTHING;
END $$;
