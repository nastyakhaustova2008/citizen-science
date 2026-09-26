-- 019 test data: far more than the API's 1000-row limit. Deterministic (no random()).
--   30 real users (auth.users → profiles by the 006 trigger), 3000 measurements over 4 labs,
--   plus rows with tricky place names / notes for the search tests (search.mjs).
-- Optional psql variable big (default 0): that many extra rows in obs-urban-heat-island
-- (the UI tests use 21000 to hit the export cap of 20,000).
\if :{?big}
\else
  \set big 0
\endif

insert into auth.users (id, email, raw_user_meta_data)
select ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
       'user' || i || '@noemail.mitzpe.invalid',
       jsonb_build_object('mitzpe_username', 'tester' || lpad(i::text, 2, '0'))
from generate_series(1, 30) i
on conflict do nothing;

-- labs: rows, primary key, value range
create temp table bulk_labs (lab text, n int, key text, lo numeric, span numeric, dec int);
insert into bulk_labs values
  ('obs-schoolyard-heat', 1200, 'temperature', 10, 30, 1),
  ('obs-dark-skies',       900, 'sky_brightness', 15, 7, 2),
  ('obs-roadside-air',     600, 'pm25', 0, 180, 0),
  ('obs-stream-water',     300, 'water_temp', 5, 25, 1);

insert into public.measurements (id, observation_id, user_id, place_label, lat, lng, measured_at, field_values)
select 'b-' || b.lab || '-' || i,
       b.lab,
       '00000000-0000-4000-8000-' || lpad((1 + (i * 7) % 30)::text, 12, '0'),
       'Bulk place ' || (i % 50),
       31.0 + ((i * 37) % 900) / 1000.0,
       34.5 + ((i * 53) % 900) / 1000.0,
       timestamptz '2026-01-01 06:00+00' + (i * interval '97 minutes'),
       case when b.lab = 'obs-stream-water' then
         jsonb_strip_nulls(jsonb_build_object(
           'water_temp', round(b.lo + ((i * 131) % 1000) / 1000.0 * b.span, b.dec),
           'ph', 7,
           'clarity', (array['clear', 'cloudy', 'murky'])[1 + i % 3],
           'pollution', case when i % 4 = 0 then '["foam", "litter"]'::jsonb when i % 4 = 1 then '["oil"]'::jsonb end,
           'smell', i % 2 = 0))
       else
         jsonb_build_object(b.key, round(b.lo + ((i * 131) % 1000) / 1000.0 * b.span, b.dec),
                            'instrument', 'Sensor ' || (i % 5))
       end
from bulk_labs b, generate_series(1, b.n) i;

-- Every 10th stream row has no primary value (value_n < n).
update public.measurements set field_values = field_values - 'water_temp'
where observation_id = 'obs-stream-water' and id like 'b-%' and split_part(id, '-', 5)::int % 10 = 0;

-- Search rows (stream lab): each needle must match only its own row(s), literally.
insert into public.measurements (id, observation_id, user_id, place_label, lat, lng, measured_at, field_values)
select 's-' || n, 'obs-stream-water', '00000000-0000-4000-8000-000000000001', p, 31.5, 35.0,
       timestamptz '2026-05-01 10:00+00' + n * interval '1 minute',
       jsonb_build_object('water_temp', 20, 'ph', 7, 'clarity', 'clear', 'smell', false, 'notes', 'note ' || p)
from (values (1, 'a,b'), (2, 'a)b'), (3, '"x"'), (4, '50%'), (5, 'a_b'), (6, 'back\slash'),
             (7, '.or(id.neq.0)'), (8, 'ליד הנחל'), (9, 'У ручья'), (10, 'a*b'),
             -- decoys: would match if a character were treated as a wildcard / separator
             (20, 'ab'), (21, 'a b'), (22, 'axb'), (23, '500'), (24, 'x'), (25, 'backslash'),
             (26, 'or id neq 0'), (27, 'a(b')) v(n, p);

insert into public.measurements (id, observation_id, user_id, lat, lng, measured_at, field_values)
select 'big-' || i, 'obs-urban-heat-island',
       '00000000-0000-4000-8000-' || lpad((1 + i % 30)::text, 12, '0'),
       32.0 + ((i * 37) % 900) / 1000.0, 34.8 + ((i * 53) % 900) / 1000.0,
       timestamptz '2025-06-01 06:00+00' + (i * interval '11 minutes'),
       jsonb_build_object('temperature', round(15 + ((i * 131) % 1000) / 50.0, 1), 'instrument', 'Big')
from generate_series(1, :big) i;

analyze public.measurements;
