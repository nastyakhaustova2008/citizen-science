-- 020_hide_identities.sql
-- Audit H2: logged-out visitors (the anon key) no longer see who made a measurement.
-- Run once in the Supabase SQL Editor, AFTER 019 and AFTER the frontend that goes with it is
-- deployed to production (preview and production share this database). Safe to re-run.
-- Rollback (only if needed, not run by default): supabase/rollback/020_hide_identities_rollback.sql.
--
-- What changes for anon (logged-out visitors):
--   * measurements: readable column by column. Everything the public screens need (map, table,
--     statistics, charts, export, point panel) is granted; user_id and created_at are not. A query
--     that selects, filters, sorts or embeds user_id / created_at as anon fails with 42501
--     ("permission denied"), so user_id can't even be probed with a filter. RLS is unchanged.
--   * profiles: no access at all (no grant, and the read policy is for logged-in users only).
--     Usernames, ids and roles are for logged-in users only — admins included.
--   * measurement_participant_counts(): SECURITY DEFINER (was INVOKER), same signature and output
--     (numbers only), so the home page counts keep working for anon. It is the only DEFINER
--     exception here; it repeats the campaigns read rule (published, or any lab for admins)
--     because a DEFINER function doesn't go through RLS.
-- Unchanged: logged-in users (role authenticated) read everything as before. Public admin
-- credits keep coming only from lab_credits / lab_credits_all (full name, position, workplace,
-- dates — no ids, no usernames; photos only for logged-in callers).
--
-- Compatibility: the production frontend from before this change asks anon for user_id (point
-- panel, data table, export, profile page) and would get "permission denied" there after 020.
-- The new frontend never asks anon for user_id / created_at / profiles and works both before and
-- after 020. Hence: deploy the frontend to production first, then run 020.
--
-- A new column on measurements is NOT readable by anon until it gets its own
-- `grant select (column) on public.measurements to anon` (same rule as campaigns).

-- ---------------------------------------------------------------------------------------------
-- 1. measurements: column privileges for anon
revoke select on public.measurements from anon;
revoke select (user_id, created_at) on public.measurements from anon;
grant select (id, observation_id, place_label, lat, lng, measured_at, verification, photo_seed,
              field_values, form_version)
  on public.measurements to anon;

-- ---------------------------------------------------------------------------------------------
-- 2. profiles: logged-in users only
revoke all on public.profiles from anon;
revoke select (id, username, role, created_at) on public.profiles from anon;

drop policy if exists "anyone can read profiles" on public.profiles;
drop policy if exists "logged-in users read profiles" on public.profiles;
create policy "logged-in users read profiles"
  on public.profiles
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------------------------
-- 3. Participants per lab: SECURITY DEFINER (019 prepared this — same signature, same output).
-- Only labs the caller may see: published ones, and every lab for admins (= the campaigns RLS
-- policy "anyone reads published campaigns, admins all").
create or replace function public.measurement_participant_counts()
returns table (campaign_id text, participants bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select m.observation_id, count(distinct m.user_id)
  from public.measurements m
  join public.campaigns c on c.id = m.observation_id
  where c.publication = 'published' or public.is_admin()
  group by m.observation_id
$$;

revoke all on function public.measurement_participant_counts() from public;
grant execute on function public.measurement_participant_counts() to anon, authenticated;

notify pgrst, 'reload schema';
