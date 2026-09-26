-- 019 tests — run AFTER migration 019 and 019/bulk.sql (see run.sh). Every check writes a row to
-- t19_res; the last query prints PASS / FAIL per check. The aggregate functions are compared with
-- the same numbers computed directly in SQL (as postgres), and called as anon like the Data API.

create table public.t19_res (n serial, name text, ok boolean, got text);
grant all on public.t19_res to anon, authenticated;
grant usage on sequence public.t19_res_n_seq to anon, authenticated;
create function public.t19(p_name text, p_ok boolean, p_got text default null) returns void language sql as $$
  insert into public.t19_res (name, ok, got) values (p_name, coalesce(p_ok, false), p_got) $$;

-- Call as anon (Data API without login). → the result, or 'ERR <message>'.
create function public.t19_anon(p_sql text) returns text language plpgsql as $$
declare r text; msg text;
begin
  execute 'set local role anon';
  begin
    execute p_sql into r;
  exception when others then
    get stacked diagnostics msg = message_text;
    r := 'ERR ' || msg;
  end;
  execute 'reset role';
  return r;
end $$;

-- A draft lab (visible to admins only) for the visibility checks.
insert into public.campaigns (id, slug, publication, region)
values ('lab-draft-019', 'lab-draft-019', 'draft', 'center');

-- ---- functions are SECURITY INVOKER ---------------------------------------------------------
select public.t19('invoker: all three functions',
  (select bool_and(not p.prosecdef) and count(*) = 3 from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('measurement_summary', 'measurement_lab_stats', 'measurement_participant_counts')));

-- ---- measurement_summary --------------------------------------------------------------------
create temp table t19_sum as select public.t19_anon('select public.measurement_summary()::text')::jsonb as j;

select public.t19('summary: total = all measurements',
  (select (j->>'total')::int from t19_sum) = (select count(*) from public.measurements),
  (select j->>'total' from t19_sum));

select public.t19('summary: n per lab = count(*)',
  (select bool_and((s.j->'labs'->c.id->>'n')::int = (select count(*) from public.measurements m where m.observation_id = c.id))
   from t19_sum s, public.campaigns c
   where exists (select 1 from public.measurements m where m.observation_id = c.id)));

select public.t19('summary: participants = distinct user_id',
  (select (j->'labs'->'obs-schoolyard-heat'->>'participants')::int from t19_sum)
  = (select count(distinct user_id) from public.measurements where observation_id = 'obs-schoolyard-heat'),
  (select j->'labs'->'obs-schoolyard-heat'->>'participants' from t19_sum));

select public.t19('summary: min/max of the primary field',
  (select (j->'labs'->'obs-roadside-air'->>'min')::float8 = (select min((field_values->>'pm25')::float8) from public.measurements where observation_id = 'obs-roadside-air')
      and (j->'labs'->'obs-roadside-air'->>'max')::float8 = (select max((field_values->>'pm25')::float8) from public.measurements where observation_id = 'obs-roadside-air')
   from t19_sum));

select public.t19('summary: cells capped at 300, cells_total = distinct ~1 km cells',
  (select jsonb_array_length(j->'labs'->'obs-schoolyard-heat'->'cells') = 300
      and (j->'labs'->'obs-schoolyard-heat'->>'cells_total')::int
          = (select count(distinct (round(lat::numeric, 2), round(lng::numeric, 2))) from public.measurements where observation_id = 'obs-schoolyard-heat')
   from t19_sum),
  (select j->'labs'->'obs-schoolyard-heat'->>'cells_total' from t19_sum));

select public.t19('summary: uncapped cells add up to n',
  (select sum((c->>3)::int) = (j->'labs'->'obs-dark-skies'->>'n')::int
          or (j->'labs'->'obs-dark-skies'->>'cells_total')::int > 300
   from t19_sum, jsonb_array_elements(j->'labs'->'obs-dark-skies'->'cells') c group by j));

select public.t19('summary: no user ids or names in the output',
  (select j::text !~ '00000000-0000-4000' and j::text !~ 'tester' from t19_sum));

select public.t19('summary: anon does not see the draft lab',
  (select not (j->'labs' ? 'lab-draft-019') from t19_sum));

-- ---- measurement_lab_stats ------------------------------------------------------------------
create temp table t19_st as
  select public.t19_anon($q$select public.measurement_lab_stats('obs-stream-water', 1)::text$q$)::jsonb as j;
create temp table t19_v as
  select measured_at, case when jsonb_typeof(field_values->'water_temp') = 'number' then (field_values->>'water_temp')::float8 end as v
  from public.measurements where observation_id = 'obs-stream-water';

select public.t19('stats: n / value_n',
  (select (j->>'n')::int = (select count(*) from t19_v) and (j->>'value_n')::int = (select count(v) from t19_v) from t19_st),
  (select j->>'n' || ' / ' || (j->>'value_n') from t19_st));
select public.t19('stats: some rows have no primary value (test data)',
  (select (j->>'value_n')::int < (j->>'n')::int from t19_st));
select public.t19('stats: mean, stddev, min, max',
  (select abs((j->>'mean')::float8 - (select avg(v) from t19_v)) < 1e-9
      and abs((j->>'stddev')::float8 - (select stddev_samp(v) from t19_v)) < 1e-9
      and (j->>'min')::float8 = (select min(v) from t19_v) and (j->>'max')::float8 = (select max(v) from t19_v)
   from t19_st));
select public.t19('stats: days = distinct UTC days of all rows',
  (select (j->>'days')::int = (select count(distinct (measured_at at time zone 'UTC')::date) from t19_v) from t19_st));
select public.t19('stats: daily n adds up to value_n',
  (select sum((d->>2)::int) = (j->>'value_n')::int from t19_st, jsonb_array_elements(j->'daily') d group by j));
select public.t19('stats: histogram counts add up to value_n',
  (select sum((h->>1)::int) = (j->>'value_n')::int from t19_st, jsonb_array_elements(j->'hist') h group by j));
select public.t19('stats: keys = field keys with data',
  (select j->'keys' = '["clarity", "notes", "ph", "pollution", "smell", "water_temp"]'::jsonb from t19_st),
  (select j->>'keys' from t19_st));
select public.t19('stats: lab with 1205 rows (> Max rows) counted in full',
  public.t19_anon($q$select public.measurement_lab_stats('obs-schoolyard-heat', 1)->>'n'$q$)
  = (select count(*)::text from public.measurements where observation_id = 'obs-schoolyard-heat'));

-- step validation and clamping
select public.t19('step 0 → bad_step', public.t19_anon($q$select public.measurement_lab_stats('obs-stream-water', 0)::text$q$) = 'ERR bad_step');
select public.t19('step -1 → bad_step', public.t19_anon($q$select public.measurement_lab_stats('obs-stream-water', -1)::text$q$) = 'ERR bad_step');
select public.t19('step NaN → bad_step', public.t19_anon($q$select public.measurement_lab_stats('obs-stream-water', 'NaN')::text$q$) = 'ERR bad_step');
select public.t19('step Infinity → bad_step', public.t19_anon($q$select public.measurement_lab_stats('obs-stream-water', 'Infinity')::text$q$) = 'ERR bad_step');
select public.t19('step null → bad_step', public.t19_anon($q$select public.measurement_lab_stats('obs-stream-water', null)::text$q$) = 'ERR bad_step');
select public.t19('campaign null → bad_campaign', public.t19_anon($q$select public.measurement_lab_stats(null, 1)::text$q$) = 'ERR bad_campaign');
select public.t19('campaign 300 chars → bad_campaign', public.t19_anon($q$select public.measurement_lab_stats(repeat('x', 300), 1)::text$q$) = 'ERR bad_campaign');
select public.t19('unknown lab → null', public.t19_anon($q$select public.measurement_lab_stats('no-such-lab', 1)::text$q$) is null);
select public.t19('draft lab → null for anon', public.t19_anon($q$select public.measurement_lab_stats('lab-draft-019', 1)::text$q$) is null);

create temp table t19_tiny as
  select public.t19_anon($q$select public.measurement_lab_stats('obs-roadside-air', 1e-300)::text$q$)::jsonb as j;
select public.t19('tiny step: widened, ≤ 200 bins, all rows counted',
  (select (j->>'step')::float8 > 1e-300
      and (select max((h->>0)::bigint) - min((h->>0)::bigint) + 1 from jsonb_array_elements(j->'hist') h) <= 200
      and (select sum((h->>1)::int) from jsonb_array_elements(j->'hist') h) = (j->>'value_n')::int
   from t19_tiny),
  (select j->>'step' from t19_tiny));
select public.t19('tiny step: widened to 1, 2 or 5 × 10^k',
  (select (j->>'step')::numeric / power(10::numeric, floor(log((j->>'step')::numeric))) in (1, 2, 5) from t19_tiny));
select public.t19('huge step: one bin',
  public.t19_anon($q$select jsonb_array_length(public.measurement_lab_stats('obs-roadside-air', 1e300)->'hist')::text$q$) = '1');
select public.t19('the wished step is kept when it fits',
  public.t19_anon($q$select public.measurement_lab_stats('obs-roadside-air', 10)->>'step'$q$) = '10');

-- ---- H2: participants must not fail silently ------------------------------------------------
-- Simulate H2 (anon loses measurements.user_id): the summary errors; after switching only
-- measurement_participant_counts() to SECURITY DEFINER it works again with the same numbers.
-- Everything is rolled back (inner block + exception).
do $$
declare v_before text; v_err text; v_after text;
begin
  v_before := public.t19_anon($q$select public.measurement_summary()->'labs'->'obs-schoolyard-heat'->>'participants'$q$);
  begin
    revoke select on public.measurements from anon;
    execute (select 'grant select (' || string_agg(quote_ident(attname), ', ') || ') on public.measurements to anon'
             from pg_attribute where attrelid = 'public.measurements'::regclass and attnum > 0
               and not attisdropped and attname <> 'user_id');
    v_err := public.t19_anon('select public.measurement_summary()::text');
    alter function public.measurement_participant_counts() security definer;
    v_after := public.t19_anon($q$select public.measurement_summary()->'labs'->'obs-schoolyard-heat'->>'participants'$q$);
    raise exception 'rollback';
  exception when others then
    if sqlerrm <> 'rollback' then raise; end if;
  end;
  perform public.t19('H2 sim: without user_id the summary fails loudly', v_err like 'ERR permission denied%', v_err);
  perform public.t19('H2 sim: DEFINER participant counts → same numbers', v_after = v_before, v_before || ' → ' || v_after);
end $$;
select public.t19('H2 sim: rolled back (anon reads user_id again)',
  public.t19_anon('select count(user_id)::text from public.measurements') is not null
  and public.t19_anon('select count(user_id)::text from public.measurements') !~ '^ERR');

-- ---- index ----------------------------------------------------------------------------------
select public.t19('index measurements_user_measured_at_idx exists',
  exists (select 1 from pg_indexes where indexname = 'measurements_user_measured_at_idx'));

select (case when ok then 'PASS ' else 'FAIL ' end) || name || coalesce('  [' || left(got, 120) || ']', '')
from public.t19_res order by n;
