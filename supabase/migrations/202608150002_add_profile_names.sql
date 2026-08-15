-- Add registration names to existing pokeScan profiles.
-- Safe to run more than once.

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists nickname text;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name, nickname)
  values (
    new.id,
    new.email,
    nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'last_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'nickname'), '')
  )
  on conflict (id) do update set
    email = excluded.email,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    nickname = excluded.nickname;
  return new;
end;
$$;

drop trigger if exists create_profile_after_signup on auth.users;
create trigger create_profile_after_signup
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

-- Populate names for accounts registered before this migration.
insert into public.profiles (id, email, first_name, last_name, nickname)
select
  id,
  email,
  nullif(trim(raw_user_meta_data ->> 'first_name'), ''),
  nullif(trim(raw_user_meta_data ->> 'last_name'), ''),
  nullif(trim(raw_user_meta_data ->> 'nickname'), '')
from auth.users
on conflict (id) do update set
  email = excluded.email,
  first_name = coalesce(excluded.first_name, public.profiles.first_name),
  last_name = coalesce(excluded.last_name, public.profiles.last_name),
  nickname = coalesce(excluded.nickname, public.profiles.nickname);

