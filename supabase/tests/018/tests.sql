-- 018 tests, part 2 — runs AFTER migration 018 (see run.sh). Every check writes a row to t_res;
-- the last query prints PASS / FAIL per check. Helpers: t_ins (insert as a logged-in user, like
-- PostgREST), t_insf (the same with an empty rate-limit bucket), t_sql (run SQL as the SQL Editor).

create table public.t_res (n serial, name text, ok boolean, got text);
create function public.t_check(p_name text, p_got text, p_want text) returns void language sql as $$
  insert into public.t_res (name, ok, got) values (p_name, p_got like p_want, p_got) $$;

-- Insert as a user (like PostgREST: role authenticated + JWT sub). → 'ok <id>' or 'message detail'.
create function public.t_ins(u uuid, p_place text, p_vals jsonb, p_at timestamptz default now(), p_id text default null)
returns text language plpgsql as $$
declare r text; msg text; det text;
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  begin
    execute 'set local role authenticated';
    insert into public.measurements (id, observation_id, user_id, place_label, lat, lng, measured_at, field_values)
    values (coalesce(p_id, gen_random_uuid()::text), 'obs-schoolyard-heat', u::text, p_place, 32.1, 34.8, p_at, p_vals)
    returning id into r;
    execute 'reset role';
    return 'ok ' || r;
  exception when others then
    get stacked diagnostics msg = message_text, det = pg_exception_detail;
    return msg || coalesce(' ' || det, '');
  end;
end $$;

-- Same, with an empty rate-limit bucket first (for the validation tests).
create function public.t_insf(u uuid, p_place text, p_vals jsonb, p_at timestamptz default now(), p_id text default null)
returns text language plpgsql as $$
begin
  delete from private.rate_limit_hits where bucket = 'measure:user:' || u::text;
  return public.t_ins(u, p_place, p_vals, p_at, p_id);
end $$;

-- Run SQL as postgres (SQL Editor). → 'ok' or 'message detail'.
create function public.t_sql(p text) returns text language plpgsql as $$
declare msg text; det text;
begin
  begin
    execute p;
    return 'ok';
  exception when others then
    get stacked diagnostics msg = message_text, det = pg_exception_detail;
    return msg || coalesce(' ' || det, '');
  end;
end $$;

\set K1 '''11111111-1111-4111-8111-111111111111'''
\set K2 '''22222222-2222-4222-8222-222222222222'''
\set A  '''33333333-3333-4333-8333-333333333333'''

-- ---- valid inserts, as the current production wizard sends them -------------------------
select t_check('valid: old-code-style insert', t_insf(:K2, null, '{"temperature": 21.5, "instrument": "TFA 30.1"}'), 'ok %');
select t_check('valid: place + notes with numbers/dates', t_insf(:K2, 'Park, bench 3 — 26.09.2026 14:30',
  '{"temperature": 21.5, "instrument": "SQM-L 21.35 mag/arcsec²", "notes": "pH 6.5-7.0, 1013.25 hPa, e.g. a.m. photo.jpg"}'), 'ok %');
select t_check('valid: Hebrew / Russian text', t_insf(:K2, 'חצר בית הספר, עמדה 2',
  '{"temperature": 22, "instrument": "מדחום 30.1", "notes": "Измерили 18,7 °C в 07:30, т.е. в тени"}'), 'ok %');
select t_check('valid: allowed link', t_insf(:K2, null, '{"temperature": 22, "instrument": "x", "notes": "https://he.wikipedia.org/wiki/Ozone"}'), 'ok %');

-- ---- stored cleaned ------------------------------------------------------------------
select t_check('clean: place insert', t_insf(:K2, E'  Park \n  near\t school \u200B ', '{"temperature": 1, "instrument": "x"}', now(), 'clean-1'), 'ok %');
select t_check('clean: place one line, trimmed', (select place_label from public.measurements where id = 'clean-1'), 'Park near school');
select t_check('clean: invisible-only text = not filled → required',
  t_insf(:K2, null, jsonb_build_object('temperature', 1, 'instrument', E'​​')), 'invalid_values {"instrument": "required"}');
select t_check('clean: empty place insert', t_insf(:K2, '   ', '{"temperature": 1, "instrument": "x"}', now(), 'clean-2'), 'ok %');
select t_check('clean: empty place → null', coalesce((select place_label from public.measurements where id = 'clean-2'), 'NULL'), 'NULL');

-- ---- rejections -----------------------------------------------------------------------
select t_check('place too long (121)', t_insf(:K2, repeat('a', 121), '{"temperature": 1, "instrument": "x"}'), 'invalid_values {"_place": "too_long"}');
select t_check('place 120 ok', t_insf(:K2, repeat('a', 120), '{"temperature": 1, "instrument": "x"}'), 'ok %');
select t_check('place phone', t_insf(:K2, 'call 050-1234567', '{"temperature": 1, "instrument": "x"}'), 'invalid_values {"_place": "phone_not_allowed"}');
select t_check('short text 201', t_insf(:K2, null, jsonb_build_object('temperature', 1, 'instrument', repeat('b', 201))), 'invalid_values {"instrument": "too_long"}');
select t_check('short text 200 emoji ok', t_insf(:K2, null, jsonb_build_object('temperature', 1, 'instrument', repeat('😀', 200))), 'ok %');
select t_check('long text 2001', t_insf(:K2, null, jsonb_build_object('temperature', 1, 'instrument', 'x', 'notes', repeat('c', 2001))), 'invalid_values {"notes": "too_long"}');
select t_check('email in text', t_insf(:K2, null, '{"temperature": 1, "instrument": "x", "notes": "noa@gmail.com"}'), 'invalid_values {"notes": "email_not_allowed"}');
select t_check('link not allowed', t_insf(:K2, null, '{"temperature": 1, "instrument": "https://evil.com/x"}'), 'invalid_values {"instrument": "link_domain_not_allowed"}');
select t_check('shortener', t_insf(:K2, null, '{"temperature": 1, "instrument": "bit.ly/x"}'), 'invalid_values {"instrument": "link_shortener"}');
select t_check('several errors at once', t_insf(:K2, 'bit.ly/x', '{"temperature": 999, "instrument": "054 123 45 67"}'),
  'invalid_values {"_place": "link_shortener", "instrument": "phone_not_allowed", "temperature": "max"}');
select t_check('date in the future (+2 days)', t_insf(:K2, null, '{"temperature": 1, "instrument": "x"}', now() + interval '2 days'), 'invalid_values {"_date": "date_range"}');
select t_check('date +20 h ok', t_insf(:K2, null, '{"temperature": 1, "instrument": "x"}', now() + interval '20 hours'), 'ok %');
select t_check('date 1999', t_insf(:K2, null, '{"temperature": 1, "instrument": "x"}', '1999-12-31'), 'invalid_values {"_date": "date_range"}');
select t_check('id too long', t_insf(:K2, null, '{"temperature": 1, "instrument": "x"}', now(), repeat('a', 65)), 'invalid_values {"_id": "format"}');
select t_check('id bad chars', t_insf(:K2, null, '{"temperature": 1, "instrument": "x"}', now(), 'a b'), 'invalid_values {"_id": "format"}');
select t_check('id 64 ok', t_insf(:K2, null, '{"temperature": 1, "instrument": "x"}', now(), repeat('a', 64)), 'ok %');

-- ---- rate limit (student 10 / 60 / 200; admin ×3). Invalid rows don't count. -------------
delete from private.rate_limit_hits;
select t_ins(:K2, null, '{"temperature": 999, "instrument": "x"}') from generate_series(1, 5);   -- invalid ×5
select t_check('student: 10 valid in a minute ok',
  (select string_agg(distinct left(t_ins(:K2, null, '{"temperature": 1, "instrument": "x"}'), 2), ',') from generate_series(1, 10)), 'ok');
select t_check('student: 11th → minute', t_ins(:K2, null, '{"temperature": 1, "instrument": "x"}'), 'rate_limited minute');
select t_check('rejected by the limit is not counted',
  (select count(*)::text from private.rate_limit_hits where bucket = 'measure:user:22222222-2222-4222-8222-222222222222'), '10');
update private.rate_limit_hits set at = at - interval '5 minutes' where bucket like 'measure:user:2%';
insert into private.rate_limit_hits (bucket, at)
select 'measure:user:22222222-2222-4222-8222-222222222222', now() - interval '10 minutes' from generate_series(1, 50);
select t_check('student: 61st in an hour → hour', t_ins(:K2, null, '{"temperature": 1, "instrument": "x"}'), 'rate_limited hour');
update private.rate_limit_hits set at = now() - interval '2 hours' where bucket like 'measure:user:2%';
insert into private.rate_limit_hits (bucket, at)
select 'measure:user:22222222-2222-4222-8222-222222222222', now() - interval '3 hours' from generate_series(1, 139);
select t_check('student: 200th today ok', t_ins(:K2, null, '{"temperature": 1, "instrument": "x"}'), 'ok %');
select t_check('student: 201st → day', t_ins(:K2, null, '{"temperature": 1, "instrument": "x"}'), 'rate_limited day');
select t_check('admin: 30 in a minute ok',
  (select string_agg(distinct left(t_ins(:A, null, '{"temperature": 1, "instrument": "x"}'), 2), ',') from generate_series(1, 30)), 'ok');
select t_check('admin: 31st → minute', t_ins(:A, null, '{"temperature": 1, "instrument": "x"}'), 'rate_limited minute');
select t_check('SQL Editor insert: not limited, still validated',
  t_sql($q$insert into public.measurements (observation_id, user_id, lat, lng, measured_at, field_values)
           select 'obs-schoolyard-heat', 'u-noa', 32, 34, now(), '{"temperature": 1, "instrument": "x"}' from generate_series(1, 30)$q$), 'ok');
select t_check('SQL Editor insert with a phone: refused',
  t_sql($q$insert into public.measurements (observation_id, user_id, lat, lng, measured_at, field_values)
           values ('obs-schoolyard-heat', 'u-noa', 32, 34, now(), '{"temperature": 1, "instrument": "050-1234567"}')$q$),
  'invalid_values {"instrument": "phone_not_allowed"}');

-- ---- UPDATE: only what changed ---------------------------------------------------------
select t_check('update: other text key changed → only it is checked (old bad values untouched)',
  t_sql($q$update public.measurements set field_values = field_values || '{"conditions": "sunny"}' where id = 'old-bad-row'$q$), 'ok');
select t_check('update: new bad text refused',
  t_sql($q$update public.measurements set field_values = field_values || '{"conditions": "call 050-1234567"}' where id = 'old-bad-row'$q$),
  'invalid_values {"conditions": "phone_not_allowed"}');
select t_check('update: bad place refused',
  t_sql($q$update public.measurements set place_label = 'noa@gmail.com' where id = 'old-bad-row'$q$), 'invalid_values {"_place": "email_not_allowed"}');
select t_check('update: good place accepted',
  t_sql($q$update public.measurements set place_label = E'  a \n b ' where id = 'old-bad-row'$q$), 'ok');
select t_check('update: good place stored cleaned', (select place_label from public.measurements where id = 'old-bad-row'), 'a b');
update public.measurements set place_label = repeat('x', 300) || ' call 050-1234567' where false;  -- (no-op)
select t_check('update: bad date refused',
  t_sql($q$update public.measurements set measured_at = '1990-01-01' where id = 'old-bad-row'$q$), 'invalid_values {"_date": "date_range"}');
select t_check('update: lat/lng only (013 rounding) ok on an old bad row',
  t_sql($q$update public.measurements set lat = 32.12345 where id = 'old-bad-row'$q$), 'ok');
select t_check('students still cannot update', (select has_table_privilege('authenticated', 'public.measurements', 'UPDATE')::text), 'false');

-- ---- account deletion, keeping anonymised measurements, with a pre-018 bad row + photo -----
select t_check('prepare (keep) on a user with a pre-018 bad row',
  t_sql($q$select public.account_delete_prepare('11111111-1111-4111-8111-111111111111', 'Kid One', false)$q$), 'ok');
select t_check('photo value → removed on the bad row',
  (select field_values ->> 'photo' from public.measurements where id = 'old-bad-row'), 'removed');
select t_check('bad row text untouched',
  (select field_values ->> 'instrument' from public.measurements where id = 'old-bad-row'), 'call me 050-1234567');
insert into private.rate_limit_hits (bucket) values ('measure:user:11111111-1111-4111-8111-111111111111');
delete from auth.users where id = '11111111-1111-4111-8111-111111111111';
select t_check('finish after the auth user is gone',
  t_sql($q$select public.account_delete_finish('11111111-1111-4111-8111-111111111111', gen_random_uuid()::text, false)$q$), 'ok');
select t_check('row kept, anonymised',
  (select (user_id <> '11111111-1111-4111-8111-111111111111')::text from public.measurements where id = 'old-bad-row'), 'true');
select t_check('measure rate-limit rows deleted',
  (select count(*)::text from private.rate_limit_hits where bucket = 'measure:user:11111111-1111-4111-8111-111111111111'), '0');

-- ---- existing-violations query -----------------------------------------------------------
select t_check('violations query lists the old bad row',
  (select string_agg(key || '=' || code, ',' order by key) from (
     select p.key, p.value as code from public.measurements m
     cross join lateral jsonb_each_text(private.measurement_problems(m)) p where m.id = 'old-bad-row') x),
  'instrument=phone_not_allowed,notes=email_not_allowed');

-- ---- comments unchanged ------------------------------------------------------------------
select t_check('comment_body_error identical before/after 018',
  (select count(*)::text from public.t_before b
   where b.r is distinct from public.comment_body_error(public.comment_clean(b.s), public.comment_domains())), '0');
select t_check('comment still refused: phone', (select public.comment_body_error('call 050-1234567', public.comment_domains()) ->> 'code'), 'phone_not_allowed');

-- ---- access ---------------------------------------------------------------------------------
select t_check('anon: no usage on private', has_schema_privilege('anon', 'private', 'USAGE')::text, 'false');
select t_check('authenticated: no usage on private', has_schema_privilege('authenticated', 'private', 'USAGE')::text, 'false');
select t_check('trigger fns not executable by authenticated',
  (has_function_privilege('authenticated', 'public.measurements_validate_values()', 'EXECUTE')
   or has_function_privilege('authenticated', 'public.measurements_check_update()', 'EXECUTE'))::text, 'false');
select t_check('comment_body_error still closed to API roles',
  has_function_privilege('authenticated', 'public.comment_body_error(text, text[])', 'EXECUTE')::text, 'false');

select case when coalesce(ok, false) then 'PASS' else 'FAIL' end || '  ' || name
       || case when coalesce(ok, false) then '' else '   got: ' || coalesce(got, 'NULL') end
from public.t_res order by n;
