alter table public.conditions
  add column if not exists value_multiplier numeric(4,3) not null default 1.000
  check (value_multiplier > 0 and value_multiplier <= 1);

update public.conditions set value_multiplier = case code
  when 'NM' then 1.000
  when 'LP' then 0.875
  when 'MP' then 0.725
  when 'HP' then 0.550
  when 'DMG' then 0.350
  else value_multiplier
end;

comment on column public.conditions.value_multiplier is
  'Configurable market-value multiplier used by the Smart Trade Builder.';
