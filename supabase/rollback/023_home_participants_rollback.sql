-- 023_home_participants_rollback.sql — NOT part of the normal order; do not run by default.
-- Removes the function of 023. The home page of part B then shows "—" for participants (the
-- rest of the page keeps working). Safe to re-run.
drop function if exists public.measurement_participants_total();
notify pgrst, 'reload schema';
