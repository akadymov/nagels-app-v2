-- Service-role-only helpers for discord-auth: resolve an auth user by verified
-- email or by the discord_id stored in user_metadata. SECURITY DEFINER so the
-- edge function (service role) can read auth.users without broad grants.
create or replace function public.find_user_id_by_email(p_email text)
returns uuid language sql security definer set search_path = '' as $$
  select id from auth.users where email = p_email and email_confirmed_at is not null limit 1;
$$;

create or replace function public.find_user_id_by_discord(p_discord_id text)
returns uuid language sql security definer set search_path = '' as $$
  select id from auth.users where raw_user_meta_data->>'discord_id' = p_discord_id limit 1;
$$;

-- Supabase grants EXECUTE to PUBLIC by default on new public-schema functions;
-- revoke from PUBLIC too, else these SECURITY DEFINER auth.users readers stay
-- callable. service_role retains EXECUTE (not revoked).
revoke execute on function public.find_user_id_by_email(text) from anon, authenticated, public;
revoke execute on function public.find_user_id_by_discord(text) from anon, authenticated, public;
