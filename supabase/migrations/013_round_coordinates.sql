-- 013_round_coordinates.sql
-- Privacy: measurement coordinates are stored rounded to 3 decimal places (a grid of about
-- 110 m north–south × 95 m east–west in Israel). Students often measure near home, so the
-- exact point is never stored — for anyone, the author and admins included.
--
-- SAFE. Run once in the Supabase SQL Editor, any time after 001. Safe to re-run.
-- Changes only rows inserted/edited from now on; existing rows are rounded by 013b
-- (destructive, separate file). Compatible with old and new frontend code: old code sends
-- 5 decimals, the trigger rounds them and the insert reads back the rounded row.
--
-- Rounding = Postgres round(numeric, 3): halves away from zero. The frontend mirrors it
-- (roundCoord() in src/lib/location.js) so the wizard shows exactly what will be saved.
--
-- Check after running:
--   select tgname from pg_trigger where tgrelid = 'public.measurements'::regclass;
--     -- includes 'measurements_round_location'

create or replace function public.measurements_round_location()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.lat := round(new.lat::numeric, 3)::double precision;
  new.lng := round(new.lng::numeric, 3)::double precision;
  return new;
end;
$$;

-- Fires on every insert (API, SQL Editor, seeds) and on any change of lat/lng.
drop trigger if exists measurements_round_location on public.measurements;
create trigger measurements_round_location
  before insert or update of lat, lng on public.measurements
  for each row execute function public.measurements_round_location();
