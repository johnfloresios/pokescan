-- Metadata used by the upgraded collection experience.

alter table public.scanned_cards
  add column if not exists set_code text,
  add column if not exists rarity text,
  add column if not exists price_change_24h numeric(8, 3),
  add column if not exists notes text,
  add column if not exists is_graded boolean not null default false;

update public.scanned_cards
set condition = case condition
  when 'Near Mint' then 'NM'
  when 'Lightly Played' then 'LP'
  when 'Moderately Played' then 'MP'
  when 'Heavily Played' then 'HP'
  when 'Damaged' then 'DMG'
  else condition
end;

alter table public.scanned_cards alter column condition set default 'NM';

create index if not exists scanned_cards_user_set_idx
  on public.scanned_cards (user_id, set_name);

create index if not exists scanned_cards_user_rarity_idx
  on public.scanned_cards (user_id, rarity);
