-- 005_drop_legacy_measurement_columns.sql
-- Roadmap step 3, final step: drop the old fixed measurement columns
-- (value, instrument, conditions, notes). Their data lives in field_values since 004.
--
-- Run ONLY after the new frontend is live in PRODUCTION (see CLAUDE.md → deploy order):
-- the old frontend selects these columns, so after this it cannot load measurements at all.
--
-- Safety check first: every non-empty old value must be present, unchanged, in field_values.
-- If even one row does not match, nothing is dropped and the error lists example ids.
-- Safe to re-run: does nothing once the columns are gone.

do $$
declare
  bad text;
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'measurements' and column_name = 'value') then
    raise notice 'legacy columns already dropped, nothing to do';
    return;
  end if;

  execute $q$
    select string_agg(id, ', ' order by id)
    from (
      select m.id
      from public.measurements m
      left join public.campaign_fields f
        on f.campaign_id = m.observation_id and f.is_primary
      where (m.value is not null
             and (f.key is null or (m.field_values ->> f.key)::double precision is distinct from m.value))
         or (nullif(m.instrument, '') is not null and m.field_values ->> 'instrument' is distinct from m.instrument)
         or (nullif(m.conditions, '') is not null and m.field_values ->> 'conditions' is distinct from m.conditions)
         or (nullif(m.notes, '')      is not null and m.field_values ->> 'notes'      is distinct from m.notes)
      limit 20
    ) x
  $q$ into bad;

  if bad is not null then
    raise exception 'not dropping: old values missing from field_values in measurements: %', bad
      using hint = 'Compare these rows'' value/instrument/conditions/notes with field_values, fix, and re-run.';
  end if;

  alter table public.measurements
    drop column value,
    drop column instrument,
    drop column conditions,
    drop column notes;
end
$$;

notify pgrst, 'reload schema';
