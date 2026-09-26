-- 022_legacy_photo_true.sql — READ-ONLY. Measurements whose photo field still holds the legacy
-- value true (016: "photo attached, but not stored"). 022 refuses new ones; old rows are kept as
-- they are (the panel shows "attached, not saved"). Expected on production: no rows.
select m.observation_id as lab, f.key as field, count(*) as measurements,
       min(m.measured_at)::date as oldest, max(m.measured_at)::date as newest
from public.measurements m
join public.campaign_fields f on f.campaign_id = m.observation_id and f.type = 'photo'
where m.field_values -> f.key = 'true'::jsonb
group by 1, 2
order by 1, 2;
