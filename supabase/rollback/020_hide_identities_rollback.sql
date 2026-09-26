-- 020_hide_identities_rollback.sql — NOT part of the normal order; do not run by default.
-- Undoes 020 (audit H2) if it has to be rolled back: logged-out visitors can again read
-- measurements.user_id and profiles (id, username, role, created_at), and
-- measurement_participant_counts() is SECURITY INVOKER again — exactly the state after 019.
-- Only for an emergency (e.g. production still runs a frontend from before H2 and logged-out
-- screens fail with "permission denied"). The frontend from the H2 change works with and without
-- this rollback. Afterwards the privacy policy no longer matches: re-run 020 as soon as possible.
-- Safe to re-run.

grant select on public.measurements to anon;

grant select (id, username, role, created_at) on public.profiles to anon;
drop policy if exists "logged-in users read profiles" on public.profiles;
drop policy if exists "anyone can read profiles" on public.profiles;
create policy "anyone can read profiles"
  on public.profiles
  for select
  to anon, authenticated
  using (true);

create or replace function public.measurement_participant_counts()
returns table (campaign_id text, participants bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.observation_id, count(distinct m.user_id)
  from public.measurements m
  join public.campaigns c on c.id = m.observation_id
  group by m.observation_id
$$;

revoke all on function public.measurement_participant_counts() from public;
grant execute on function public.measurement_participant_counts() to anon, authenticated;

notify pgrst, 'reload schema';
