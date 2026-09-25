-- 003_measurements_campaign_fk.sql
-- Roadmap step 2: every measurement must belong to an existing campaign.
-- Run in the Supabase SQL Editor AFTER migrations/002_campaigns.sql
-- AND seed/002_campaigns_seed.sql (the campaigns must exist first).
--
-- Adds measurements.observation_id → campaigns.id.
-- on delete restrict: a campaign that has measurements cannot be deleted (keeps data safe).
-- on update cascade: if a campaign id is ever renamed, its measurements follow.
-- Safe to re-run: does nothing if the constraint already exists.
--
-- If this fails with "orphan measurements", some rows point to a campaign that doesn't exist
-- (possible because the TEMPORARY insert policy lets anyone insert any observation_id).
-- Find them with:
--
--   select m.observation_id, count(*) as rows, min(m.id) as example_id
--   from public.measurements m
--   left join public.campaigns c on c.id = m.observation_id
--   where c.id is null
--   group by m.observation_id
--   order by rows desc;
--
-- Then either add the missing campaign, or (after checking) delete the junk rows, and re-run.

do $$
declare
  orphans text;
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'measurements_observation_id_fkey'
      and conrelid = 'public.measurements'::regclass
  ) then
    raise notice 'measurements_observation_id_fkey already exists, nothing to do';
    return;
  end if;

  select string_agg(format('%s (%s rows)', observation_id, n), ', ')
    into orphans
  from (
    select m.observation_id, count(*) as n
    from public.measurements m
    left join public.campaigns c on c.id = m.observation_id
    where c.id is null
    group by m.observation_id
  ) o;

  if orphans is not null then
    raise exception 'orphan measurements: observation_id not found in campaigns: %', orphans
      using hint = 'Run the orphan query at the top of this file, fix the rows, then re-run.';
  end if;

  alter table public.measurements
    add constraint measurements_observation_id_fkey
    foreign key (observation_id) references public.campaigns (id)
    on update cascade
    on delete restrict;
end
$$;
