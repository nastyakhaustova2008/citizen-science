-- 013b_round_existing_coordinates.sql
-- !!! DESTRUCTIVE — the exact coordinates of existing measurements are lost for good. !!!
-- BEFORE running: export public.measurements as CSV (Table Editor → measurements → Export).
--
-- Run once in the Supabase SQL Editor, AFTER 013 and after the new frontend is deployed to
-- production. Rounds lat/lng of existing rows to 3 decimal places, exactly like the 013
-- trigger does for new rows. Safe to re-run (already rounded rows are not touched).
--
-- Check after running (expected 0):
--   select count(*) from public.measurements
--    where lat <> round(lat::numeric, 3)::double precision
--       or lng <> round(lng::numeric, 3)::double precision;

update public.measurements
   set lat = round(lat::numeric, 3)::double precision,
       lng = round(lng::numeric, 3)::double precision
 where lat <> round(lat::numeric, 3)::double precision
    or lng <> round(lng::numeric, 3)::double precision;
