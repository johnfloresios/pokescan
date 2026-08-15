-- pokeScan dashboard schema and ownership policies.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  first_name text,
  last_name text,
  nickname text
);

alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists nickname text;

create table if not exists public.scanned_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_name text not null,
  set_name text not null,
  set_number text not null,
  image_url text,
  price_estimate numeric(12, 2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists scanned_cards_user_created_idx
  on public.scanned_cards (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.scanned_cards enable row level security;

drop policy if exists "Users can read their profile" on public.profiles;
create policy "Users can read their profile"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Users can read their cards" on public.scanned_cards;
create policy "Users can read their cards"
on public.scanned_cards for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their cards" on public.scanned_cards;
create policy "Users can insert their cards"
on public.scanned_cards for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their cards" on public.scanned_cards;
create policy "Users can update their cards"
on public.scanned_cards for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their cards" on public.scanned_cards;
create policy "Users can delete their cards"
on public.scanned_cards for delete
using (auth.uid() = user_id);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name, nickname)
  values (new.id, new.email, new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data ->> 'last_name', new.raw_user_meta_data ->> 'nickname')
  on conflict (id) do update set email = excluded.email, first_name = excluded.first_name, last_name = excluded.last_name, nickname = excluded.nickname;
  return new;
end;
$$;

drop trigger if exists create_profile_after_signup on auth.users;
create trigger create_profile_after_signup
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

-- Ensure accounts created before this migration also have profiles.
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do update set email = excluded.email;
