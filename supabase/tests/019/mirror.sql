-- 019 mirror test, SQL side: for a few labs and steps, the raw rows (UTC time, primary value)
-- and what measurement_lab_stats returns. mirror.js recomputes the numbers from the rows in JS
-- (the algorithms the client used before 019) and compares. Output: one JSON array.
select json_agg(json_build_object(
  'lab', t.lab, 'step', t.step,
  'rows', (select json_agg(json_build_array(to_char(m.measured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                            case when jsonb_typeof(m.field_values -> t.key) = 'number'
                                                 then (m.field_values ->> t.key)::float8 end))
           from public.measurements m where m.observation_id = t.lab),
  'rpc', public.measurement_lab_stats(t.lab, t.step)))
from (values ('obs-stream-water', 'water_temp', 1::float8), ('obs-schoolyard-heat', 'temperature', 2),
             ('obs-dark-skies', 'sky_brightness', 0.5), ('obs-roadside-air', 'pm25', 10),
             ('obs-roadside-air', 'pm25', 0.001)) t(lab, key, step);
