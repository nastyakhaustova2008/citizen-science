-- 019_row_limits.sql
-- Audit H5: the Supabase Data API returns at most 1000 rows per request ("Max rows") and cuts
-- the rest silently. The app no longer reads all measurements at once: lists are read page by
-- page (src/lib/paging.js), and the numbers that need every row come from the two aggregate
-- functions below. Each returns ONE jsonb value, so Max rows never cuts it.
-- Run once in the Supabase SQL Editor, AFTER 018, BEFORE the frontend that uses it is deployed
-- (preview and production share the database). Safe to re-run.
--
-- Compatible with the production frontend: nothing is dropped or changed, no RLS or grant on a
-- table changes; this only adds an index and three read-only functions.
--
-- Visibility: all three functions are SECURITY INVOKER, so they read only what the caller may
-- read through RLS (measurements: everyone; campaigns / field definitions: published for
-- everyone, drafts only for admins). They return aggregates of rows the caller can already
-- download in full, never a user id or a username.
--
-- H2 prerequisite: the only place that needs measurements.user_id is
-- measurement_participant_counts() (number of distinct participants per lab). If H2 removes
-- anon's access to measurements.user_id, that function (and so measurement_summary()) fails
-- loudly with "permission denied" — it can't silently return 0. H2 then recreates just that
-- function as SECURITY DEFINER (same signature, same output: counts only); nothing else changes.

-- Profile page: one user's measurements, newest first (the lab queries use the existing
-- measurements_observation_measured_at_idx).
create index if not exists measurements_user_measured_at_idx
  on public.measurements (user_id, measured_at desc);

-- ---------------------------------------------------------------------------------------------
-- Number of distinct participants per lab (visible labs' measurements only). Counts, no ids.
-- Kept separate on purpose — see "H2 prerequisite" above.
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

-- ---------------------------------------------------------------------------------------------
-- Home page: per visible lab — number of measurements, participants, min / max of the primary
-- field (colour scale when the field has no min/max), and the mini-map as cells of 2 decimal
-- places (~1 km) with the mean primary value: at most 300 cells per lab (the most populated),
-- `cells_total` says how many there are.
-- {"total": n, "labs": {"<campaign id>": {"n", "participants", "min", "max", "cells": [[lat, lng,
--   mean | null, n], …], "cells_total"}}}
create or replace function public.measurement_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with prim as (
    select f.campaign_id, f.key
    from public.campaign_fields f
    where f.is_primary and not f.archived and f.type = 'number'
  ),
  r as (
    select m.observation_id as cid, m.lat, m.lng,
           case when jsonb_typeof(m.field_values -> p.key) = 'number'
                then (m.field_values ->> p.key)::double precision end as v
    from public.measurements m
    join public.campaigns c on c.id = m.observation_id      -- visible labs only (RLS)
    left join prim p on p.campaign_id = m.observation_id
  ),
  labs as (
    select cid, count(*) as n, min(v) as vmin, max(v) as vmax from r group by cid
  ),
  cells as (
    select cid, round(lat::numeric, 2) as la, round(lng::numeric, 2) as lo, avg(v) as v, count(*) as n,
           row_number() over (partition by cid order by count(*) desc,
                              round(lat::numeric, 2), round(lng::numeric, 2)) as rn,
           count(*) over (partition by cid) as total
    from r
    group by cid, round(lat::numeric, 2), round(lng::numeric, 2)
  )
  select jsonb_build_object(
    'total', coalesce((select sum(n) from labs), 0),
    'labs', coalesce((
      select jsonb_object_agg(l.cid, jsonb_build_object(
        'n', l.n,
        'participants', coalesce(pc.participants, 0),
        'min', l.vmin,
        'max', l.vmax,
        'cells', coalesce((select jsonb_agg(jsonb_build_array(ce.la, ce.lo, ce.v, ce.n) order by ce.rn)
                           from cells ce where ce.cid = l.cid and ce.rn <= 300), '[]'::jsonb),
        'cells_total', coalesce((select max(ce.total) from cells ce where ce.cid = l.cid), 0)))
      from labs l
      left join public.measurement_participant_counts() pc on pc.campaign_id = l.cid
    ), '{}'::jsonb))
$$;

revoke all on function public.measurement_summary() from public;
grant execute on function public.measurement_summary() to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Lab page (table header stats + charts): every measurement of one lab, aggregated.
-- p_step = the histogram bin width the client would like (preset or niceStep). It must be a
-- finite number > 0 (else error bad_step). The server widens it (to 1, 2 or 5 × 10^k) when the
-- data would need more than 200 bins, or bin numbers beyond ±10^12; the step used is returned.
-- Days are UTC calendar days (as the client's toISODate).
-- null when the lab isn't visible to the caller. Otherwise:
-- {"n", "value_n", "mean", "stddev", "min", "max", "days", "step",
--  "daily": [["YYYY-MM-DD", mean, n], …], "hist": [[bin, n], …]   (bin i = [i·step, (i+1)·step)),
--  "keys": [field keys that have data]}   ("keys": archived fields with data stay visible)
create or replace function public.measurement_lab_stats(p_campaign text, p_step double precision)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_key text;
  v_step double precision := p_step;
  v_min double precision;
  v_max double precision;
  v_need double precision;
  v_exp double precision;
  v_frac double precision;
  v_out jsonb;
begin
  if p_campaign is null or length(p_campaign) > 200 then
    raise exception 'bad_campaign' using errcode = '22023';
  end if;
  if p_step is null or p_step = 'NaN'::double precision     -- (in Postgres NaN = NaN)
     or p_step in ('Infinity'::double precision, '-Infinity'::double precision)
     or p_step <= 0 then
    raise exception 'bad_step' using errcode = '22023', detail = 'p_step must be a finite number > 0';
  end if;
  if not exists (select 1 from public.campaigns c where c.id = p_campaign) then
    return null;                                             -- missing, or a draft for non-admins
  end if;

  select f.key into v_key
  from public.campaign_fields f
  where f.campaign_id = p_campaign and f.is_primary and not f.archived and f.type = 'number'
  limit 1;

  select min(x.v), max(x.v) into v_min, v_max
  from (select case when jsonb_typeof(m.field_values -> v_key) = 'number'
                    then (m.field_values ->> v_key)::double precision end as v
        from public.measurements m where m.observation_id = p_campaign) x;

  -- Widen the step: ≤ 200 non-empty bins (floor(max/s) − floor(min/s) + 1 ≤ range/s + 2) and
  -- bin numbers within ±10^12 (keeps floor(v/s) finite and exact).
  if v_min is not null then
    v_need := greatest((v_max - v_min) / 198, greatest(abs(v_min), abs(v_max)) / 1e12);
    if v_need = 'Infinity'::double precision then
      v_step := 1e307;
    elsif v_step < v_need then
      v_exp := floor(log(v_need));
      v_frac := v_need / power(10::double precision, v_exp);
      v_step := power(10::double precision, v_exp)
                * case when v_frac <= 1 then 1 when v_frac <= 2 then 2 when v_frac <= 5 then 5 else 10 end;
      if v_step < v_need then v_step := v_step * 2; end if;  -- float rounding
    end if;
  end if;

  with r as (
    select m.measured_at, m.field_values,
           case when jsonb_typeof(m.field_values -> v_key) = 'number'
                then (m.field_values ->> v_key)::double precision end as v
    from public.measurements m
    where m.observation_id = p_campaign
  )
  select jsonb_build_object(
    'n', (select count(*) from r),
    'value_n', (select count(v) from r),
    'mean', (select avg(v) from r),
    'stddev', (select stddev_samp(v) from r),
    'min', v_min,
    'max', v_max,
    'days', (select count(distinct (measured_at at time zone 'UTC')::date) from r),
    'step', v_step,
    'daily', coalesce((
      select jsonb_agg(jsonb_build_array(d.day, d.mean, d.n) order by d.day)
      from (select to_char((measured_at at time zone 'UTC')::date, 'YYYY-MM-DD') as day,
                   avg(v) as mean, count(*) as n
            from r where v is not null group by 1) d), '[]'::jsonb),
    'hist', coalesce((
      select jsonb_agg(jsonb_build_array(h.bin, h.n) order by h.bin)
      from (select floor(v / v_step)::bigint as bin, count(*) as n
            from r where v is not null group by 1) h), '[]'::jsonb),
    'keys', coalesce((
      select jsonb_agg(k.key order by k.key)
      from (select distinct jsonb_object_keys(field_values) as key
            from r where jsonb_typeof(field_values) = 'object') k), '[]'::jsonb))
  into v_out;
  return v_out;
end
$$;

revoke all on function public.measurement_lab_stats(text, double precision) from public;
grant execute on function public.measurement_lab_stats(text, double precision) to anon, authenticated;
