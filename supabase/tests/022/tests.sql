-- 022 tests (final hardening, part A) — run AFTER migration 022 (applied twice) — see run.sh.
-- Every check writes a row to t22_res; the last query prints PASS / FAIL per check.
-- Sections follow the migration: 1 trigger functions, 2 FK indexes, 3 photo true, 4 M9 sign-up
-- mark + safety net + cleanup, 5 username_available, 6 M4 reports, 7 M6 comments under review,
-- 8 L1 avatar moderation, 9 L2 upload limits + kill switch + upload_quota, 10 L4 lock order,
-- 11 sessions cleanup, 12 L5 RLS, 13 M10.1 admin profiles.

create table public.t22_res (n serial, name text, ok boolean, got text);
create function public.t22(p_name text, p_ok boolean, p_got text default null) returns void language sql as $$
  insert into public.t22_res (name, ok, got) values (p_name, coalesce(p_ok, false), p_got) $$;

-- Run p_sql as a role → first column as text (or 'ok'), or 'ERR <sqlstate> <message> <detail>'.
create function public.t22_as(p_role text, p_sql text) returns text language plpgsql as $$
declare r text; msg text; st text; det text;
begin
  execute format('set local role %I', p_role);
  begin
    if p_sql ~* '^\s*(insert|update|delete)' and p_sql !~* 'returning' then
      execute p_sql;
    else
      execute p_sql into r;
    end if;
  exception when others then
    get stacked diagnostics msg = message_text, st = returned_sqlstate, det = pg_exception_detail;
    execute 'reset role';
    return 'ERR ' || st || ' ' || msg || coalesce(' ' || det, '');
  end;
  execute 'reset role';
  return coalesce(r, 'ok');
end $$;
-- The same as a logged-in user (like PostgREST: JWT claims + role authenticated).
create function public.t22_user(u uuid, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  return public.t22_as('authenticated', p_sql);
end $$;
create function public.t22_q(p_sql text) returns text language plpgsql as $$
declare r text; begin execute p_sql into r; return r; end $$;


-- Test helpers are not part of the API (PostgREST would list them for anon: 020/api.js).
do $$
declare r record;
begin
  for r in select oid::regprocedure::text as f from pg_proc
           where pronamespace = 'public'::regnamespace and proname ~ '^t22(_|$)' loop
    execute 'revoke all on function ' || r.f || ' from public, anon, authenticated';
  end loop;
  for r in select oid::regclass::text as t from pg_class
           where relnamespace = 'public'::regnamespace and relkind = 'r' and relname ~ '^t22_' loop
    execute 'revoke all on ' || r.t || ' from public, anon, authenticated';
  end loop;
end $$;

-- ---- test people ------------------------------------------------------------------------------
-- Created like the Edge Function does (sign-up mark in app_metadata). "old" = account older than
-- 48 h (created_at is fixed by profiles_guard, so it is moved back with triggers off).
\set A   '''22000000-0000-4000-8000-0000000000a1'''
\set R1  '''22000000-0000-4000-8000-0000000000b1'''
\set R2  '''22000000-0000-4000-8000-0000000000b2'''
\set R3  '''22000000-0000-4000-8000-0000000000b3'''
\set R4  '''22000000-0000-4000-8000-0000000000b4'''
\set N1  '''22000000-0000-4000-8000-0000000000c1'''
\set N2  '''22000000-0000-4000-8000-0000000000c2'''
\set N3  '''22000000-0000-4000-8000-0000000000c3'''
\set MA  '''22000000-0000-4000-8000-0000000000d1'''
\set MA2 '''22000000-0000-4000-8000-0000000000d2'''
\set AD1 '''22000000-0000-4000-8000-0000000000d3'''
\set AD2 '''22000000-0000-4000-8000-0000000000d4'''
\set OWN '''44444444-4444-4444-8444-444444444444'''

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
select id::uuid, id || '@noemail.mitzpe.invalid', now(), jsonb_build_object('mitzpe_username', name),
       '{"provider":"email","mitzpe_signup":true}'
from (values (:A, 'Author A22'), (:R1, 'Rep One'), (:R2, 'Rep Two'), (:R3, 'Rep Three'), (:R4, 'Rep Four'),
             (:N1, 'New One'), (:N2, 'New Two'), (:N3, 'New Three'), (:MA, 'Main A22'), (:MA2, 'Main B22'),
             (:AD1, 'Admin C22'), (:AD2, 'Admin D22')) v(id, name);
set session_replication_role = replica;
update public.profiles set created_at = now() - interval '3 days'
where id in (:A, :R1, :R2, :R3, :R4, :MA, :MA2, :AD1, :AD2);
update public.profiles set role = 'main_admin', role_granted_by = :OWN, role_granted_at = now() where id in (:MA, :MA2);
update public.profiles set role = 'admin', role_granted_by = :OWN, role_granted_at = now() where id = :AD1;
set session_replication_role = origin;

-- =====================================================================
-- 1. trigger functions
-- =====================================================================
select public.t22('trigger functions: not executable by anon / authenticated / PUBLIC',
  not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid in ('public.handle_new_user()'::regprocedure, 'public.profiles_log_sql_change()'::regprocedure,
                              'public.profiles_scrub_log()'::regprocedure)
                and a.privilege_type = 'EXECUTE' and a.grantee not in (p.proowner, 'service_role'::regrole)));
select public.t22('trigger functions: authenticated can not call handle_new_user directly',
  public.t22_user(:A, 'select public.handle_new_user()') like 'ERR 42501%');
select public.t22('policy helpers stay executable (is_admin, my_role, photo_can_read, avatar_upload_ok …)',
  has_function_privilege('authenticated', 'public.is_admin()', 'execute')
  and has_function_privilege('anon', 'public.my_role()', 'execute')
  and has_function_privilege('authenticated', 'public.photo_can_read(text)', 'execute')
  and has_function_privilege('authenticated', 'public.photo_can_delete(text)', 'execute')
  and has_function_privilege('authenticated', 'public.avatar_upload_ok(text)', 'execute'));
select public.t22('sign-up still creates the profile through the trigger',
  (select username from public.profiles where id = :A) = 'Author A22');
update public.profiles set role = 'admin', role_granted_by = :OWN, role_granted_at = now() where id = :AD2;
update public.profiles set role = 'student', role_granted_by = null, role_granted_at = null where id = :AD2;
select public.t22('role log trigger still fires (SQL Editor role change is logged)',
  (select count(*) from public.role_events where target_id = :AD2 and action = 'sql_change') = 2);

-- =====================================================================
-- 2. foreign-key indexes
-- =====================================================================
select public.t22('no foreign key in public / private without an index',
  not exists (
    select 1 from pg_constraint c
    where c.contype = 'f' and c.connamespace in ('public'::regnamespace, 'private'::regnamespace)
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
                      and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)),
  (select string_agg(c.conrelid::regclass || '.' || c.conname, ', ') from pg_constraint c
   where c.contype = 'f' and c.connamespace in ('public'::regnamespace, 'private'::regnamespace)
     and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
                     and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)));

-- =====================================================================
-- 3. photo fields: true refused, a file still accepted
-- =====================================================================
delete from private.rate_limit_hits where bucket like 'measure:user:%';
select public.t22('photo = true (legacy) → invalid_values {photo: type}',
  public.t22_user(:A, $q$insert into public.measurements (observation_id, user_id, lat, lng, measured_at, field_values)
    values ('obs-schoolyard-heat', '22000000-0000-4000-8000-0000000000a1', 32.1, 34.8, now(),
            '{"temperature": 21, "instrument": "x", "photo": true}') returning id$q$) like 'ERR 22023 invalid_values %"photo": "type"%',
  public.t22_user(:A, $q$insert into public.measurements (observation_id, user_id, lat, lng, measured_at, field_values)
    values ('obs-schoolyard-heat', '22000000-0000-4000-8000-0000000000a1', 32.1, 34.8, now(),
            '{"temperature": 21, "instrument": "x", "photo": true}') returning id$q$));
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('measurement-photos', 'a2200000-0000-4000-8000-000000000001.jpg', :A, '{"size":1000}');
select public.t22('photo = uploaded file → accepted (with the measurement id kept for later)',
  public.t22_user(:A, $q$insert into public.measurements (id, observation_id, user_id, lat, lng, measured_at, field_values)
    values ('m22-a', 'obs-schoolyard-heat', '22000000-0000-4000-8000-0000000000a1', 32.1, 34.8, now(),
            '{"temperature": 21, "instrument": "x", "photo": "a2200000-0000-4000-8000-000000000001.jpg"}') returning id$q$) = 'm22-a');
select public.t22('legacy-true check query runs (read-only)',
  public.t22_q($q$select count(*)::text from (
    select m.observation_id from public.measurements m
    join public.campaign_fields f on f.campaign_id = m.observation_id and f.type = 'photo'
    where m.field_values -> f.key = 'true'::jsonb) x$q$) ~ '^\d+$');

-- =====================================================================
-- 4. M9: sign-up mark, safety net, cleanup
-- =====================================================================
select public.t22('public sign-up API (no mark): username in user_metadata is ignored',
  public.t22_as('supabase_auth_admin', $q$insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
    values ('22000000-0000-4000-8000-0000000000e1', 'squat@example.com', '{"mitzpe_username":"Squatted Name"}',
            '{"provider":"email","providers":["email"]}')$q$) = 'ok'
  and public.t22_q($q$select (username is null)::text from public.profiles where id = '22000000-0000-4000-8000-0000000000e1'$q$) = 'true');
select public.t22('Edge Function sign-up (mark): username taken from user_metadata',
  public.t22_as('supabase_auth_admin', $q$insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
    values ('22000000-0000-4000-8000-0000000000e2', 'e2@noemail.mitzpe.invalid', now(), '{"mitzpe_username":"Squatted Name"}',
            '{"provider":"email","mitzpe_signup":true}')$q$) = 'ok'
  and public.t22_q($q$select username from public.profiles where id = '22000000-0000-4000-8000-0000000000e2'$q$) = 'Squatted Name');
select public.t22('Edge Function sign-up with a taken name → username_taken (no account)',
  public.t22_as('supabase_auth_admin', $q$insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
    values ('22000000-0000-4000-8000-0000000000e3', 'e3@noemail.mitzpe.invalid', now(), '{"mitzpe_username":"squatted name"}',
            '{"provider":"email","mitzpe_signup":true}')$q$) like 'ERR % username_taken%'
  and not exists (select 1 from auth.users where id = '22000000-0000-4000-8000-0000000000e3'));
select public.t22('Google sign-up: profile without username (chooses one later)',
  public.t22_as('supabase_auth_admin', $q$insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
    values ('22000000-0000-4000-8000-0000000000e4', 'g22@gmail.test', now(), '{"full_name":"G"}',
            '{"provider":"google","providers":["google"]}')$q$) = 'ok'
  and public.t22_q($q$select (username is null)::text from public.profiles where id = '22000000-0000-4000-8000-0000000000e4'$q$) = 'true');

-- Safety net: the mark arrives only after the insert (as if Supabase Auth wrote app_metadata later).
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) values
 ('22000000-0000-4000-8000-0000000000f1', 'f1@noemail.mitzpe.invalid', now(), '{"mitzpe_username":"Late Name"}', '{}'),
 ('22000000-0000-4000-8000-0000000000f2', 'f2@noemail.mitzpe.invalid', now(), '{"mitzpe_username":"Author A22"}', '{}'),
 ('22000000-0000-4000-8000-0000000000f3', 'f3@noemail.mitzpe.invalid', now(), '{"mitzpe_username":"Author A22"}', '{}'),
 ('22000000-0000-4000-8000-0000000000f4', 'f4@noemail.mitzpe.invalid', now(), '{"mitzpe_username":"Free Name"}', '{}'),
 ('22000000-0000-4000-8000-0000000000f5', 'f5@noemail.mitzpe.invalid', now(), '{"mitzpe_username":"Other Free"}', '{}');
update auth.users set raw_app_meta_data = '{"provider":"email","mitzpe_signup":true}'
where id in ('22000000-0000-4000-8000-0000000000f1', '22000000-0000-4000-8000-0000000000f2',
             '22000000-0000-4000-8000-0000000000f3', '22000000-0000-4000-8000-0000000000f5');
update auth.users set created_at = now() - interval '20 minutes' where id = '22000000-0000-4000-8000-0000000000f5';
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('avatars', 'a2200000-0000-4000-8000-0000000000f3.jpg', '22000000-0000-4000-8000-0000000000f3', '{"size":10}');

select public.t22('safety net: fresh marked account without name → ok, name set',
  public.t22_as('service_role', $q$select public.account_signup_username('22000000-0000-4000-8000-0000000000f1', 'Late  Name')$q$) = 'ok'
  and public.t22_q($q$select username from public.profiles where id = '22000000-0000-4000-8000-0000000000f1'$q$) = 'Late Name');
select public.t22('safety net: same call again → ok (idempotent)',
  public.t22_as('service_role', $q$select public.account_signup_username('22000000-0000-4000-8000-0000000000f1', 'late name')$q$) = 'ok');
select public.t22('safety net: another name for a named account → already_set',
  public.t22_as('service_role', $q$select public.account_signup_username('22000000-0000-4000-8000-0000000000f1', 'Something')$q$) = 'already_set');
select public.t22('safety net: name taken meanwhile → taken (caller deletes the new account), profile unchanged',
  public.t22_as('service_role', $q$select public.account_signup_username('22000000-0000-4000-8000-0000000000f2', 'Author A22')$q$) = 'taken'
  and (select username is null from public.profiles where id = '22000000-0000-4000-8000-0000000000f2'));
select public.t22('safety net: taken, but the account has a file → not_allowed (never "delete it")',
  public.t22_as('service_role', $q$select public.account_signup_username('22000000-0000-4000-8000-0000000000f3', 'Author A22')$q$) = 'not_allowed');
select public.t22('safety net: account without the mark → not_allowed',
  public.t22_as('service_role', $q$select public.account_signup_username('22000000-0000-4000-8000-0000000000f4', 'Free Name')$q$) = 'not_allowed'
  and (select username is null from public.profiles where id = '22000000-0000-4000-8000-0000000000f4'));
select public.t22('safety net: account older than 10 minutes → not_allowed',
  public.t22_as('service_role', $q$select public.account_signup_username('22000000-0000-4000-8000-0000000000f5', 'Other Free')$q$) = 'not_allowed');
select public.t22('safety net: a different name than the one in user_metadata → not_allowed',
  public.t22_as('service_role', $q$select public.account_signup_username('22000000-0000-4000-8000-0000000000f2', 'Whatever Else')$q$) = 'not_allowed');
select public.t22('safety net: invalid name → invalid; unknown user → not_found',
  public.t22_as('service_role', $q$select public.account_signup_username('22000000-0000-4000-8000-0000000000f2', 'x')$q$) = 'invalid'
  and public.t22_as('service_role', $q$select public.account_signup_username('22000000-0000-4000-8000-00000000ffff', 'Free Name')$q$) = 'not_found');
select public.t22('safety net: only service_role may call it',
  public.t22_as('anon', $q$select public.account_signup_username('22000000-0000-4000-8000-0000000000f2', 'Author A22')$q$) like 'ERR 42501%'
  and public.t22_user(:A, $q$select public.account_signup_username('22000000-0000-4000-8000-0000000000f2', 'Author A22')$q$) like 'ERR 42501%');

-- Cleanup of never-confirmed accounts without a username.
insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data, raw_app_meta_data) values
 ('22000000-0000-4000-8000-0000000000a9', 'old-unconf@example.com', null, now() - interval '8 days', '{}', '{"provider":"email"}'),
 ('22000000-0000-4000-8000-0000000000aa', 'new-unconf@example.com', null, now() - interval '3 days', '{}', '{"provider":"email"}'),
 ('22000000-0000-4000-8000-0000000000ab', 'old-google@gmail.test', now(), now() - interval '8 days', '{}', '{"provider":"google"}'),
 ('22000000-0000-4000-8000-0000000000ac', 'old-unconf-file@example.com', null, now() - interval '8 days', '{}', '{"provider":"email"}'),
 ('22000000-0000-4000-8000-0000000000ad', 'old-unconf-named@example.com', null, now() - interval '8 days', '{"mitzpe_username":"Named Unconf"}',
  '{"provider":"email","mitzpe_signup":true}');
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('measurement-photos', 'a2200000-0000-4000-8000-0000000000ac.jpg', '22000000-0000-4000-8000-0000000000ac', '{"size":10}');
create temp table t22_clean as select private.privacy_cleanup() as r;
select public.t22('cleanup: unconfirmed, no username, no data, 8 days → deleted (profile too)',
  not exists (select 1 from auth.users where id = '22000000-0000-4000-8000-0000000000a9')
  and not exists (select 1 from public.profiles where id = '22000000-0000-4000-8000-0000000000a9'),
  (select r::text from t22_clean));
select public.t22('cleanup keeps: unconfirmed but 3 days old; Google (confirmed) without a name; unconfirmed with a file; unconfirmed with a username',
  (select count(*) from auth.users where id in ('22000000-0000-4000-8000-0000000000aa', '22000000-0000-4000-8000-0000000000ab',
                                                 '22000000-0000-4000-8000-0000000000ac', '22000000-0000-4000-8000-0000000000ad')) = 4);
select public.t22('cleanup keeps every normal account (all confirmed test users still there)',
  (select count(*) from auth.users where id in (:A, :R1, :MA, :OWN, '22000000-0000-4000-8000-0000000000e4')) = 5);
select public.t22('cleanup result: counts for the new steps',
  (select (r ->> 'unconfirmed_signups') = '1' and r ? 'sessions' and r ? 'change_tickets' from t22_clean),
  (select r::text from t22_clean));

-- =====================================================================
-- 5. username_available: Edge Function only
-- =====================================================================
select public.t22('username_available: anon and authenticated can not call it',
  not has_function_privilege('anon', 'public.username_available(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.username_available(text)', 'execute')
  and public.t22_as('anon', $q$select public.username_available('Rep One')$q$) like 'ERR 42501%');
select public.t22('username_available: service_role (Edge Function) still can',
  public.t22_as('service_role', $q$select public.username_available('Rep One')$q$) = 'taken'
  and public.t22_as('service_role', $q$select public.username_available('Totally Free22')$q$) = 'available');

-- =====================================================================
-- 6. M4: reporters older than 48 h; 5 per reporter → author per day
-- =====================================================================
set session_replication_role = replica;
insert into public.comments (id, measurement_id, campaign_id, author_id, body, lang)
select ('c2200000-0000-4000-8000-00000000000' || i)::uuid, 'm22-a', 'obs-schoolyard-heat', :A, 'comment ' || i, 'en'
from generate_series(1, 9) i;
insert into public.measurement_photos (path, measurement_id, field_key, campaign_id, owner_id, status, decided_at)
values ('a2200000-0000-4000-8000-000000000001.jpg', 'm22-a', 'photo', 'obs-schoolyard-heat', :A, 'approved', now())
on conflict (path) do update set status = 'approved', hidden_at = null, hidden_reason = null;
insert into public.avatars (user_id, path, kind, status) values (:A, 'a2200000-0000-4000-8000-0000000000a1.jpg', 'student', 'active');
set session_replication_role = origin;

create function public.t22_rep_c(u uuid, i int) returns text language sql as $$
  select public.t22_user(u, format($q$select public.comment_report('c2200000-0000-4000-8000-00000000000%s', 'spam')::text$q$, i)) $$;
create function public.t22_rep_p(u uuid) returns text language sql as $$
  select public.t22_user(u, $q$select public.photo_report('a2200000-0000-4000-8000-000000000001.jpg', 'spam')::text$q$) $$;
create function public.t22_rep_a(u uuid) returns text language sql as $$
  select public.t22_user(u, $q$select public.avatar_report('22000000-0000-4000-8000-0000000000a1', 'spam')::text$q$) $$;

select public.t22('comment: 3 reports from accounts younger than 48 h → not hidden',
  public.t22_rep_c(:N1, 1) like '%false%' and public.t22_rep_c(:N2, 1) like '%false%' and public.t22_rep_c(:N3, 1) like '%false%'
  and (select hidden_at is null from public.comments where id = 'c2200000-0000-4000-8000-000000000001'));
select public.t22('comment: new accounts'' reports are stored (moderators see them)',
  (select count(*) from public.comment_reports where comment_id = 'c2200000-0000-4000-8000-000000000001' and resolved_at is null) = 3);
select public.t22('comment: 2 old reporters → still visible, 3rd old reporter → hidden (auto_hide counts 3)',
  public.t22_rep_c(:R1, 1) like '%false%' and public.t22_rep_c(:R2, 1) like '%false%'
  and public.t22_rep_c(:R3, 1) like '%true%'
  and public.t22_q($q$select hidden_reason from public.comments where id = 'c2200000-0000-4000-8000-000000000001'$q$) = 'reports'
  and public.t22_q($q$select reports::text from public.comment_events where comment_id = 'c2200000-0000-4000-8000-000000000001' and action = 'auto_hide'$q$) = '3');

select public.t22('photo: 3 new accounts → not hidden; 3 old → hidden',
  public.t22_rep_p(:N1) like '%false%' and public.t22_rep_p(:N2) like '%false%' and public.t22_rep_p(:N3) like '%false%'
  and public.t22_rep_p(:R2) like '%false%' and public.t22_rep_p(:R3) like '%false%' and public.t22_rep_p(:R4) like '%true%'
  and public.t22_q($q$select status from public.measurement_photos where path = 'a2200000-0000-4000-8000-000000000001.jpg'$q$) = 'hidden');
select public.t22('avatar: 3 new accounts → not hidden; 3 old → hidden',
  public.t22_rep_a(:N1) like '%false%' and public.t22_rep_a(:N2) like '%false%' and public.t22_rep_a(:N3) like '%false%'
  and public.t22_rep_a(:R2) like '%false%' and public.t22_rep_a(:R3) like '%false%' and public.t22_rep_a(:R4) like '%true%'
  and public.t22_q($q$select status from public.avatars where user_id = '22000000-0000-4000-8000-0000000000a1'$q$) = 'hidden');

-- R1 → A: comment 1 already; comments 2–5 → 5 in total; the 6th (any kind) is refused.
select public.t22('one reporter → one author: 5 reports a day pass',
  public.t22_rep_c(:R1, 2) like '%false%' and public.t22_rep_c(:R1, 3) like '%false%'
  and public.t22_rep_c(:R1, 4) like '%false%' and public.t22_rep_c(:R1, 5) like '%false%');
select public.t22('one reporter → one author: the 6th is rate_limited and not stored',
  public.t22_rep_c(:R1, 6) like 'ERR % rate_limited%'
  and not exists (select 1 from public.comment_reports where comment_id = 'c2200000-0000-4000-8000-000000000006'));
select public.t22('the per-author limit is shared by comments, photos and pictures',
  exists (select 1 from private.rate_limit_hits where bucket = 'report_pair:' || :R2 || ':' || :A
          having count(*) = 3));
select public.t22('another reporter is not affected',
  public.t22_rep_c(:R4, 6) like '%false%');

-- =====================================================================
-- 7. M6: author can't delete / edit while reported or hidden
-- =====================================================================
select public.t22('delete own hidden comment → comment_under_review',
  public.t22_user(:A, $q$select public.comment_delete('c2200000-0000-4000-8000-000000000001')::text$q$) like 'ERR % comment_under_review%'
  and exists (select 1 from public.comments where id = 'c2200000-0000-4000-8000-000000000001'));
select public.t22('delete own comment with an open report → comment_under_review',
  public.t22_user(:A, $q$select public.comment_delete('c2200000-0000-4000-8000-000000000002')::text$q$) like 'ERR % comment_under_review%');
select public.t22('edit own comment with an open report → comment_under_review',
  public.t22_user(:A, $q$select public.comment_edit('c2200000-0000-4000-8000-000000000002', 'changed')::text$q$) like 'ERR % comment_under_review%');
select public.t22('edit own hidden comment → comment_hidden (as before)',
  public.t22_user(:A, $q$select public.comment_edit('c2200000-0000-4000-8000-000000000001', 'changed')::text$q$) like 'ERR % comment_hidden%');
update public.comment_reports set resolved_at = now() where comment_id = 'c2200000-0000-4000-8000-000000000002';
select public.t22('report closed by a moderator → the author can edit and delete again',
  public.t22_user(:A, $q$select public.comment_edit('c2200000-0000-4000-8000-000000000002', 'changed')::text$q$) like '%changed%'
  and public.t22_user(:A, $q$select public.comment_delete('c2200000-0000-4000-8000-000000000002')::text$q$) = 'true');
select public.t22('comment without reports: delete works',
  public.t22_user(:A, $q$select public.comment_delete('c2200000-0000-4000-8000-000000000009')::text$q$) = 'true');

-- =====================================================================
-- 8. L1: avatar moderation only downwards
-- =====================================================================
set session_replication_role = replica;
insert into public.avatars (user_id, path, kind, status, consent_at, confirmed_by, confirmed_at) values
 (:MA2, 'a2200000-0000-4000-8000-0000000000d2.jpg', 'admin', 'confirmed', now(), :OWN, now()),
 (:OWN, 'a2200000-0000-4000-8000-000000000044.jpg', 'admin', 'confirmed', now(), :OWN, now()),
 (:AD1, 'a2200000-0000-4000-8000-0000000000d3.jpg', 'admin', 'confirmed', now(), :OWN, now())
on conflict (user_id) do nothing;
set session_replication_role = origin;
select public.t22('main admin → another main admin''s photo: not_allowed (hide and delete)',
  public.t22_user(:MA, $q$select public.avatar_moderate('22000000-0000-4000-8000-0000000000d2', 'hide')::text$q$) like 'ERR % not_allowed%'
  and public.t22_user(:MA, $q$select public.avatar_moderate('22000000-0000-4000-8000-0000000000d2', 'delete')::text$q$) like 'ERR % not_allowed%');
select public.t22('main admin → the owner''s photo: not_allowed',
  public.t22_user(:MA, $q$select public.avatar_moderate('44444444-4444-4444-8444-444444444444', 'hide')::text$q$) like 'ERR % not_allowed%'
  and (select status from public.avatars where user_id = :OWN) = 'confirmed');
select public.t22('main admin → an admin''s photo and a student''s picture: allowed',
  public.t22_user(:MA, $q$select public.avatar_moderate('22000000-0000-4000-8000-0000000000d3', 'hide')::text$q$) not like 'ERR%'
  and public.t22_user(:MA, $q$select public.avatar_moderate('22000000-0000-4000-8000-0000000000a1', 'unhide')::text$q$) not like 'ERR%'
  and public.t22_q($q$select status from public.avatars where user_id = '22000000-0000-4000-8000-0000000000a1'$q$) = 'active');
select public.t22('owner → a main admin''s photo: allowed',
  public.t22_user(:OWN, $q$select public.avatar_moderate('22000000-0000-4000-8000-0000000000d2', 'hide')::text$q$) not like 'ERR%'
  and public.t22_q($q$select status from public.avatars where user_id = '22000000-0000-4000-8000-0000000000d2'$q$) = 'hidden');

-- =====================================================================
-- 9. L2: upload limits count uploads
-- =====================================================================
create function public.t22_upload(u uuid, p_bucket text, p_name text default null) returns text language sql as $$
  select public.t22_user(u, format($q$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values (%L, %L, %L, '{"size":1000}') returning 'ok'$q$, p_bucket, coalesce(p_name, gen_random_uuid()::text || '.jpg'), u)) $$;
create function public.t22_hits(u uuid, p_kind text) returns bigint language sql as $$
  select count(*) from private.rate_limit_hits where bucket = p_kind || ':user:' || u::text $$;

select public.t22('30 photo uploads in a day pass',
  (select bool_and(public.t22_upload(:R1, 'measurement-photos') = 'ok') from generate_series(1, 29))
  and public.t22_hits(:R1, 'photo_upload') = 29);
select public.t22('upload_quota before the limit → ok',
  public.t22_user(:R1, $q$select public.upload_quota('measurement-photos')$q$) = 'ok');
select public.t22('30th upload passes',
  public.t22_upload(:R1, 'measurement-photos') = 'ok');
delete from storage.objects where owner_id = :R1 and bucket_id = 'measurement-photos';
select public.t22('after deleting the files the 31st upload is still refused (RLS) and not counted',
  public.t22_upload(:R1, 'measurement-photos') like 'ERR 42501%' and public.t22_hits(:R1, 'photo_upload') = 30);
select public.t22('upload_quota → rate_limited',
  public.t22_user(:R1, $q$select public.upload_quota('measurement-photos')$q$) = 'rate_limited');
select public.t22('a refused upload (bad file name) does not count',
  public.t22_upload(:R2, 'measurement-photos', 'not-a-uuid.jpg') like 'ERR 42501%' and public.t22_hits(:R2, 'photo_upload') = 0);

update private.settings set value = 'false' where key = 'upload_limit_by_hits';
select public.t22('kill switch off: old rule (files still there), nothing recorded',
  public.t22_upload(:R1, 'measurement-photos') = 'ok' and public.t22_hits(:R1, 'photo_upload') = 30);
update private.settings set value = 'true' where key = 'upload_limit_by_hits';
select public.t22('kill switch back on: limited again',
  public.t22_upload(:R1, 'measurement-photos') like 'ERR 42501%');

select public.t22('avatars: 10 a day, then refused; quota says rate_limited',
  (select bool_and(public.t22_upload(:R2, 'avatars') = 'ok') from generate_series(1, 10))
  and public.t22_upload(:R2, 'avatars') like 'ERR 42501%'
  and public.t22_user(:R2, $q$select public.upload_quota('avatars')$q$) = 'rate_limited');

insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('measurement-photos', 'a2200000-0000-4000-8000-00000000ffff.jpg', null, '{"size":943718400}');
select public.t22('storage full → upload refused, upload_quota → storage_full',
  public.t22_upload(:R3, 'measurement-photos') like 'ERR 42501%'
  and public.t22_user(:R3, $q$select public.upload_quota('measurement-photos')$q$) = 'storage_full');
delete from storage.objects where name = 'a2200000-0000-4000-8000-00000000ffff.jpg';
select public.t22('upload_quota: unknown bucket → not_allowed; anon can not call it',
  public.t22_user(:R3, $q$select public.upload_quota('other')$q$) = 'not_allowed'
  and public.t22_as('anon', $q$select public.upload_quota('avatars')$q$) like 'ERR 42501%');
select public.t22('upload policies use the new functions',
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'INSERT'
     and (with_check like '%photo_upload_take(name)%' or with_check like '%avatar_upload_take(name)%')) = 2);

-- =====================================================================
-- 10. L4: lab first, then revision
-- =====================================================================
select public.t22('lab_revision_review / lab_revision_open lock the campaign before the revision',
  (select bool_and(position('from public.campaigns where id = v_campaign for update' in prosrc) > 0
                   and position('from public.campaigns where id = v_campaign for update' in prosrc)
                       < position('from public.lab_revisions where id = p_rev for update' in prosrc))
   from pg_proc where proname in ('lab_revision_review', 'lab_revision_open') and pronamespace = 'public'::regnamespace));

-- =====================================================================
-- 11. sessions not used for 30 days
-- =====================================================================
insert into auth.sessions (id, user_id, created_at, updated_at, refreshed_at) values
 ('22000000-0000-4000-8000-000000005e01', :A, now() - interval '40 days', now() - interval '40 days', (now() - interval '31 days') at time zone 'utc'),
 ('22000000-0000-4000-8000-000000005e02', :A, now() - interval '40 days', now() - interval '40 days', (now() - interval '2 days') at time zone 'utc'),
 ('22000000-0000-4000-8000-000000005e03', :A, now() - interval '40 days', now() - interval '31 days', null),
 ('22000000-0000-4000-8000-000000005e04', :A, now(), now(), null);
select public.t22('sessions: refreshed 31 days ago / never refreshed and untouched 31 days → ended; used recently → kept',
  (private.privacy_cleanup() ->> 'sessions') = '2'
  and public.t22_q($q$select string_agg(id::text, ',' order by id) from auth.sessions
                     where user_id = '22000000-0000-4000-8000-0000000000a1'$q$)
      = '22000000-0000-4000-8000-000000005e02,22000000-0000-4000-8000-000000005e04');

-- =====================================================================
-- 12. L5: RLS on the private tables
-- =====================================================================
select public.t22('RLS on private.settings and private.storage_trash',
  (select bool_and(relrowsecurity) from pg_class where oid in ('private.settings'::regclass, 'private.storage_trash'::regclass)));
select public.t22('the kill switches and the trash still work through the functions',
  private.setting_on('upload_limit_by_hits', false)
  and public.t22_as('service_role', 'select public.storage_sweep(10)::text') not like 'ERR%');

-- =====================================================================
-- 13. M10.1: admin profiles of current admins only
-- =====================================================================
insert into public.admin_profiles (user_id, full_name, workplace) values
 (:AD1, 'Current Admin', 'School 1'), (:AD2, 'Former Admin', 'School 2')
on conflict (user_id) do nothing;
select public.t22('admin reads a current admin''s profile',
  public.t22_user(:MA, $q$select count(*)::text from public.admin_profiles where user_id = '22000000-0000-4000-8000-0000000000d3'$q$) = '1');
select public.t22('admin can not read a demoted admin''s profile',
  public.t22_user(:MA, $q$select count(*)::text from public.admin_profiles where user_id = '22000000-0000-4000-8000-0000000000d4'$q$) = '0');
select public.t22('the demoted admin still reads their own',
  public.t22_user(:AD2, $q$select count(*)::text from public.admin_profiles where user_id = '22000000-0000-4000-8000-0000000000d4'$q$) = '1');
select public.t22('students read none',
  public.t22_user(:R1, $q$select count(*)::text from public.admin_profiles$q$) = '0');

-- Test helpers are not part of the API (PostgREST would list them for anon: 020/api.js).
do $$
declare r record;
begin
  for r in select oid::regprocedure::text as f from pg_proc
           where pronamespace = 'public'::regnamespace and proname ~ '^t22(_|$)' loop
    execute 'revoke all on function ' || r.f || ' from public, anon, authenticated';
  end loop;
  for r in select oid::regclass::text as t from pg_class
           where relnamespace = 'public'::regnamespace and relkind = 'r' and relname ~ '^t22_' loop
    execute 'revoke all on ' || r.t || ' from public, anon, authenticated';
  end loop;
end $$;

select (case when ok then 'PASS ' else 'FAIL ' end) || name || coalesce('  [' || left(got, 200) || ']', '')
from public.t22_res order by n;
