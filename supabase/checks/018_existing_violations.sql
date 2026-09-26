-- 018_existing_violations.sql — READ-ONLY (a single SELECT; nothing is changed).
-- Run in the Supabase SQL Editor AFTER migration 018. Lists measurements saved before 018 that
-- break its rules (the rules apply to new rows only; old rows stay as they are).
-- The text itself is NOT shown: open a row in Table Editor → measurements (filter by id) to see it.
--
-- key:   _id (the id), _date (measured_at), _place (the place name), or a text field's key
-- code:  format | date_range | too_long | phone_not_allowed | email_not_allowed |
--        link_not_allowed | link_shortener | link_domain_not_allowed

select m.id,
       m.observation_id as lab,
       m.created_at::date as added,
       p.key,
       p.value as code
from public.measurements m
cross join lateral jsonb_each_text(private.measurement_problems(m)) p
order by m.created_at, m.id, p.key;
