-- Tie a game room to the Discord Activity instance that created it, so an
-- invited friend launching the same Activity can be auto-joined into that
-- room. Nullable: rooms created outside Discord leave it null.
alter table public.rooms add column if not exists discord_instance_id text;

create index if not exists idx_rooms_discord_instance
  on public.rooms (discord_instance_id)
  where discord_instance_id is not null;

-- Returns the current open room for a Discord Activity instance (latest,
-- non-finished), or null. SECURITY DEFINER so it works regardless of RLS;
-- read-only, so anon/authenticated may call it.
create or replace function public.get_active_room_for_instance(p_instance_id text)
returns jsonb
language sql security definer set search_path to 'public', 'pg_catalog' as $$
  select jsonb_build_object(
    'room_id', r.id,
    'code', r.code,
    'phase', r.phase,
    'player_count', r.player_count,
    'seats_taken', (select count(*) from public.room_players rp where rp.room_id = r.id)
  )
  from public.rooms r
  where r.discord_instance_id = p_instance_id
    and r.phase <> 'finished'
  order by r.created_at desc
  limit 1;
$$;

grant execute on function public.get_active_room_for_instance(text)
  to anon, authenticated, service_role;
