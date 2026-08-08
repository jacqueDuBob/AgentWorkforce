alter table public.tickets
add column if not exists acceptance_criteria_items jsonb not null default '[]'::jsonb;

-- Preserve every non-empty legacy line as its own independently addressable item.
update public.tickets
set acceptance_criteria_items = coalesce((
  select jsonb_agg(jsonb_build_object('id', gen_random_uuid()::text, 'text', btrim(line), 'completed', false) order by ordinal)
  from regexp_split_to_table(acceptance_criteria, E'\\r?\\n') with ordinality as lines(line, ordinal)
  where btrim(line) <> ''
), '[]'::jsonb)
where acceptance_criteria_items = '[]'::jsonb and acceptance_criteria <> '';
