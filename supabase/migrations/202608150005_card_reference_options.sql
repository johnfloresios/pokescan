-- Card option reference data. Add future values here (or through Supabase)
-- and the app will pick them up without a mobile release.

create table if not exists public.conditions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists public.variants (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists public.rarities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

insert into public.conditions (code,label,sort_order) values
  ('NM','Near Mint',10),('LP','Lightly Played',20),('MP','Moderately Played',30),
  ('HP','Heavily Played',40),('DMG','Damaged',50)
on conflict (code) do update set label=excluded.label,sort_order=excluded.sort_order;

insert into public.variants (code,label,sort_order) values
  ('Normal','Normal',10),('Holo','Holo',20),('Reverse Holo','Reverse Holo',30),
  ('Illustration Rare','Illustration Rare',40),
  ('Special Illustration Rare','Special Illustration Rare',50),
  ('Hyper Rare','Hyper Rare',60),('1st Edition','1st Edition',70)
on conflict (code) do update set label=excluded.label,sort_order=excluded.sort_order;

insert into public.rarities (code,label,sort_order) values
  ('Common','Common',10),('Uncommon','Uncommon',20),('Rare','Rare',30),
  ('Double Rare','Double Rare',40),('Illustration Rare','Illustration Rare',50),
  ('Special Illustration Rare','Special Illustration Rare',60),('Hyper Rare','Hyper Rare',70)
on conflict (code) do update set label=excluded.label,sort_order=excluded.sort_order;

alter table public.conditions enable row level security;
alter table public.variants enable row level security;
alter table public.rarities enable row level security;

drop policy if exists "Reference conditions are readable" on public.conditions;
create policy "Reference conditions are readable" on public.conditions for select using (is_active);
drop policy if exists "Reference variants are readable" on public.variants;
create policy "Reference variants are readable" on public.variants for select using (is_active);
drop policy if exists "Reference rarities are readable" on public.rarities;
create policy "Reference rarities are readable" on public.rarities for select using (is_active);

create index if not exists conditions_active_order_idx on public.conditions (is_active,sort_order);
create index if not exists variants_active_order_idx on public.variants (is_active,sort_order);
create index if not exists rarities_active_order_idx on public.rarities (is_active,sort_order);
