-- 023_home_participants.sql
-- Final hardening, part B (audit M7): the home page counts participants instead of "schools"
-- (schools existed only for the demo authors in mockData.js).
--
-- measurement_participants_total() → one number: how many different people made measurements in
-- the labs the caller may see (published ones; every lab for admins — the same rule as
-- measurement_participant_counts in 020). SECURITY DEFINER because anon can't read
-- measurements.user_id (020); it returns only the count — no id, no name. Works with the demo
-- rows present and after they are deleted (demo authors count like anyone else while they exist;
-- a deleted account's kept measurements count as one "unknown participant").
--
-- Run once in the Supabase SQL Editor BEFORE the preview of part B (the new home page calls it;
-- without it the participants counter shows "—"). Only adds a function: the running production
-- code doesn't use it. Safe to re-run. Rollback: supabase/rollback/023_home_participants_rollback.sql.

create or replace function public.measurement_participants_total()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct m.user_id)
  from public.measurements m
  join public.campaigns c on c.id = m.observation_id
  where c.publication = 'published' or public.is_admin()
$$;

revoke all on function public.measurement_participants_total() from public;
grant execute on function public.measurement_participants_total() to anon, authenticated;

notify pgrst, 'reload schema';
