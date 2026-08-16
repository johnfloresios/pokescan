-- RevenueCat is the entitlement authority. These fields are a synchronized
-- mirror for server-side product decisions, reporting, and fast profile reads.

alter table public.profiles
  add column if not exists is_pro boolean not null default false,
  add column if not exists pro_purchased_at timestamptz,
  add column if not exists revenuecat_app_user_id text;

create index if not exists profiles_is_pro_idx on public.profiles (is_pro)
where is_pro = true;

comment on column public.profiles.is_pro is
  'Mirror of the RevenueCat NicePull Pro entitlement; RevenueCat remains authoritative.';
comment on column public.profiles.revenuecat_app_user_id is
  'Supabase auth user UUID used as the RevenueCat App User ID.';
