-- 007_measurements_auth_only.sql
-- Roadmap step 4a, final step: remove the TEMPORARY "anyone can insert" rule from 001.
-- After this only logged-in users can add measurements, and only as themselves
-- (policy "logged-in users add their own measurements" from 006).
--
-- Run ONLY after the new frontend (with login) is live in PRODUCTION: the old frontend
-- inserts as anon with user_id 'u-noa', which is rejected from now on.
-- Safe to re-run.

drop policy if exists "TEMPORARY anyone can insert measurements" on public.measurements;
revoke insert on public.measurements from anon;

-- Reading stays public (map, data and campaigns are open to everyone): the TEMPORARY read
-- rule from 001 becomes a permanent one with the same meaning.
drop policy if exists "TEMPORARY anyone can read measurements" on public.measurements;
drop policy if exists "anyone can read measurements" on public.measurements;
create policy "anyone can read measurements"
  on public.measurements
  for select
  to anon, authenticated
  using (true);

notify pgrst, 'reload schema';
