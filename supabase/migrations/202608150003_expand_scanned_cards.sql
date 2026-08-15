-- Collection management fields. Safe to run against an existing pokeScan database.

alter table public.scanned_cards
  add column if not exists quantity integer not null default 1,
  add column if not exists condition text not null default 'Near Mint',
  add column if not exists variant text not null default 'Normal';

update public.scanned_cards set quantity = 1 where quantity is null or quantity < 1;
update public.scanned_cards set condition = 'Near Mint' where condition is null or btrim(condition) = '';
update public.scanned_cards set variant = 'Normal' where variant is null or btrim(variant) = '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scanned_cards_quantity_positive') then
    alter table public.scanned_cards
      add constraint scanned_cards_quantity_positive check (quantity >= 1);
  end if;
end $$;

create index if not exists scanned_cards_user_name_idx
  on public.scanned_cards (user_id, card_name);

create index if not exists scanned_cards_user_value_idx
  on public.scanned_cards (user_id, price_estimate desc);
