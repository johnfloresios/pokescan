alter table public.profiles
  add column if not exists revenuecat_product_id text,
  add column if not exists pro_expires_at timestamptz;

comment on column public.profiles.revenuecat_product_id is
  'Mirror of the active RevenueCat NicePull Pro product identifier.';
comment on column public.profiles.pro_expires_at is
  'RevenueCat entitlement expiration; null for a lifetime purchase.';
