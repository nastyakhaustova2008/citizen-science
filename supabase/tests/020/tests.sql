-- 020 tests (audit H2) — run AFTER migration 020 (applied twice) on the 019 test data (see run.sh).
-- Every check writes a row to t20_res; the last query prints PASS / FAIL per check.
--   * privileges: what anon may read / execute is exactly an allow-list (a new column, table or
--     function reachable by anon fails here until it is reviewed and added);
--   * anon can't read, filter, sort or embed measurements.user_id / created_at, nor profiles;
--   * logged-in users (students, admins) read everything as before;
--   * home counts: participants per lab (now SECURITY DEFINER) = the same numbers computed
--     directly; drafts only for admins;
--   * public admin credits (lab_credits) still work logged out and carry no ids / usernames;
--   * account deletion (keep anonymised / delete) still works and stays unlinkable for anon.

create table public.t20_res (n serial, name text, ok boolean, got text);
grant all on public.t20_res to anon, authenticated;
grant usage on sequence public.t20_res_n_seq to anon, authenticated;
create function public.t20(p_name text, p_ok boolean, p_got text default null) returns void language sql as $$
  insert into public.t20_res (name, ok, got) values (p_name, coalesce(p_ok, false), p_got) $$;

-- Run p_sql as p_role ('anon' | 'authenticated'), with JWT sub p_sub (null = logged out), like
-- the Data API does. → the first value as text, or 'ERR <message>'.
create function public.t20_as(p_role text, p_sub uuid, p_sql text) returns text language plpgsql as $$
declare r text; msg text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  perform set_config('request.jwt.claims', case when p_sub is null then '{"role":"anon"}'
                     else json_build_object('sub', p_sub, 'role', 'authenticated')::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into r;
  exception when others then
    get stacked diagnostics msg = message_text;
    r := 'ERR ' || msg;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;
create function public.t20_anon(p_sql text) returns text language sql as $$ select public.t20_as('anon', null, p_sql) $$;

\set STUDENT '''00000000-0000-4000-8000-000000000003'''
\set ADMIN   '''33333333-3333-4333-8333-333333333333'''
\set OWNER   '''44444444-4444-4444-8444-444444444444'''

-- ---- 1. privileges: allow-lists -------------------------------------------------------------
-- Every (relation, column) anon may SELECT, in every schema the API exposes (public) and the
-- Supabase schemas anon can use (auth, storage). Test tables are ignored.
create temp table t20_cols as
select n.nspname || '.' || c.relname || '.' || a.attname as col
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
where n.nspname in ('public', 'auth', 'storage', 'graphql_public')
  and c.relkind in ('r', 'v', 'm', 'p', 'f')
  and c.relname !~ '^t(19|20)?_'
  and has_column_privilege('anon', c.oid, a.attnum, 'select');

create temp table t20_allowed (col text primary key);
insert into t20_allowed
select 'public.measurements.' || x from unnest(array['id', 'observation_id', 'place_label', 'lat', 'lng',
  'measured_at', 'verification', 'photo_seed', 'field_values', 'form_version']) x
union all
select 'public.campaigns.' || x from unnest(array['id', 'slug', 'metric', 'icon', 'title_he', 'title_en', 'title_ru',
  'desc_he', 'desc_en', 'desc_ru', 'status', 'region', 'difficulty', 'equipment', 'protocol_url', 'center_lat',
  'center_lng', 'zoom', 'sort_order', 'created_at', 'updated_at', 'form_version', 'publication', 'edit_no',
  'equipment_he', 'equipment_en', 'equipment_ru', 'protocol_he', 'protocol_en', 'protocol_ru', 'review_round',
  'submitted_at', 'published_at']) x
union all
select 'public.campaign_fields.' || x from unnest(array['campaign_id', 'key', 'type', 'label_he', 'label_en',
  'label_ru', 'help_he', 'help_en', 'help_ru', 'required', 'sort_order', 'archived', 'is_primary', 'unit',
  'min_value', 'max_value', 'decimals', 'text_long', 'created_at']) x
union all
select 'public.campaign_field_options.' || x from unnest(array['campaign_id', 'field_key', 'key', 'label_he',
  'label_en', 'label_ru', 'sort_order', 'archived', 'created_at']) x
union all
-- Storage: the table is granted by Supabase, but no policy lets anon see a row (checked below).
select 'storage.objects.' || x from unnest(array['id', 'bucket_id', 'name', 'owner_id', 'metadata', 'created_at']) x
union all
select 'storage.buckets.' || x from unnest(array['id', 'name', 'public', 'file_size_limit', 'allowed_mime_types']) x;

select public.t20('allow-list: anon reads no column outside the list',
  not exists (select 1 from t20_cols where col not in (select col from t20_allowed)),
  (select string_agg(col, ', ') from t20_cols where col not in (select col from t20_allowed)));

select public.t20('allow-list: no anon column looks like a person (user/actor/author/owner/reviewer/…)',
  not exists (select 1 from t20_cols
              where col ~ '\.(user_id|username|username_key|actor_id|author_id|reviewer_id|created_by|role|role_granted_by|full_name|email)$'
                and col not like 'storage.%'),
  (select string_agg(col, ', ') from t20_cols
   where col ~ '\.(user_id|username|username_key|actor_id|author_id|reviewer_id|created_by|role|role_granted_by|full_name|email)$'));

select public.t20('measurements: anon columns = exactly the public list (no user_id, no created_at)',
  (select array_agg(col order by col) from t20_cols where col like 'public.measurements.%')
  = (select array_agg(col order by col) from t20_allowed where col like 'public.measurements.%'));

select public.t20('measurements: no table-level SELECT for anon',
  not has_table_privilege('anon', 'public.measurements', 'select'));

select public.t20('profiles: anon has no privilege on any column',
  not exists (select 1 from pg_attribute a where a.attrelid = 'public.profiles'::regclass and a.attnum > 0
              and not a.attisdropped
              and (has_column_privilege('anon', 'public.profiles'::regclass, a.attnum, 'select')
                   or has_column_privilege('anon', 'public.profiles'::regclass, a.attnum, 'insert')
                   or has_column_privilege('anon', 'public.profiles'::regclass, a.attnum, 'update'))));

select public.t20('profiles: the only read policy is for authenticated',
  (select array_agg(policyname || ':' || array_to_string(roles, ',') order by policyname)
   from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT')
  = array['logged-in users read profiles:authenticated'],
  (select string_agg(policyname || ':' || array_to_string(roles, ','), '; ')
   from pg_policies where schemaname = 'public' and tablename = 'profiles'));

-- Every function anon may execute (public schema; trigger functions and test helpers ignored).
create temp table t20_fns as
select p.oid::regprocedure::text as fn
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and has_function_privilege('anon', p.oid, 'execute')
  and p.prorettype <> 'trigger'::regtype
  and p.proname !~ '^t(19|20)?_' and p.proname not in ('t19', 't20');

select public.t20('allow-list: anon executes no function outside the list',
  not exists (select 1 from t20_fns where fn not in (
    'bump_form_version(text)', 'is_admin()', 'lab_apply_mode()', 'lab_block(text)',
    'lab_check_info(jsonb,boolean)', 'lab_credits(text)', 'lab_credits_all()', 'lab_diff(jsonb,jsonb)',
    'lab_line(text)', 'lab_may_delete(text,uuid,uuid)', 'lab_may_edit(text,uuid,uuid)',
    'lab_revision_missing(jsonb)', 'measurement_lab_stats(text,double precision)',
    'measurement_participant_counts()', 'measurement_summary()', 'my_role()', 'role_rank(text)',
    -- username_available: Edge Function only since 022 (it rate-limits per IP).
    'username_error(text)', 'username_key(text)', 'username_normalize(text)')),
  (select string_agg(fn, ', ') from t20_fns));

select public.t20('storage: anon sees no object row (policies are for authenticated)',
  public.t20_anon('select count(*)::text from storage.objects') = '0');

select public.t20('auth.users: no anon privilege',
  not has_table_privilege('anon', 'auth.users', 'select'));

-- ---- 2. functions ---------------------------------------------------------------------------
select public.t20('participant counts: SECURITY DEFINER with empty search_path',
  (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p
   where p.oid = 'public.measurement_participant_counts()'::regprocedure),
  (select p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '-') from pg_proc p
   where p.oid = 'public.measurement_participant_counts()'::regprocedure));

select public.t20('summary + lab stats: still SECURITY INVOKER',
  (select bool_and(not p.prosecdef) and count(*) = 2 from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('measurement_summary', 'measurement_lab_stats')));

select public.t20('summary + lab stats: never reference user_id or created_at',
  (select bool_and(p.prosrc !~ '(user_id|created_at)') from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('measurement_summary', 'measurement_lab_stats')));

-- ---- 3. anon: what fails, what works --------------------------------------------------------
select public.t20('anon: select user_id → permission denied',
  public.t20_anon('select user_id from public.measurements limit 1') like 'ERR permission denied%');
select public.t20('anon: select created_at → permission denied',
  public.t20_anon('select created_at::text from public.measurements limit 1') like 'ERR permission denied%');
select public.t20('anon: filter by user_id → permission denied',
  public.t20_anon($q$select count(*)::text from public.measurements where user_id = '00000000-0000-4000-8000-000000000003'$q$)
  like 'ERR permission denied%');
select public.t20('anon: order by user_id → permission denied',
  public.t20_anon('select id from public.measurements order by user_id limit 1') like 'ERR permission denied%');
select public.t20('anon: order by created_at → permission denied',
  public.t20_anon('select id from public.measurements order by created_at limit 1') like 'ERR permission denied%');
select public.t20('anon: select * → permission denied',
  public.t20_anon('select id from (select * from public.measurements limit 1) x') like 'ERR permission denied%');
select public.t20('anon: embedding user_id via campaigns → permission denied',
  public.t20_anon($q$select (select m.user_id from public.measurements m where m.observation_id = c.id limit 1)
                     from public.campaigns c limit 1$q$) like 'ERR permission denied%');
select public.t20('anon: count(*) works (PostgREST exact count)',
  public.t20_anon('select count(*)::text from public.measurements') = (select count(*)::text from public.measurements));
select public.t20('anon: the public columns work',
  public.t20_anon($q$select count(*)::text from (select id, observation_id, place_label, lat, lng, measured_at,
                     verification, photo_seed, field_values, form_version from public.measurements) x$q$)
  = (select count(*)::text from public.measurements));
-- The client's anon queries, as SQL (the API test runs the real src functions): map, table
-- (every sort), point panel.
select public.t20('anon: map query (lean columns, measured_at desc, id desc)',
  public.t20_anon($q$select count(*)::text from (select id, lat, lng, measured_at, verification, field_values->'temperature'
                     from public.measurements where observation_id = 'obs-schoolyard-heat'
                     order by measured_at desc, id desc offset 1000 limit 1000) x$q$)
  = (select (count(*) - 1000)::text from public.measurements where observation_id = 'obs-schoolyard-heat'));
select public.t20('anon: table sorts (place, status, jsonb field) + search',
  public.t20_anon($q$select count(*)::text from (select id from public.measurements where observation_id = 'obs-stream-water'
                     and (place_label ilike '%a%' or field_values->>'clarity' in ('clear'))
                     order by place_label, verification, field_values->'water_temp' nulls last, measured_at desc, id desc) x$q$)
  !~ '^ERR');
select public.t20('anon: point panel (one full public row by id)',
  public.t20_anon($q$select id from public.measurements where id = 'b-obs-stream-water-7'$q$) = 'b-obs-stream-water-7');
select public.t20('anon: profiles → permission denied',
  public.t20_anon('select username from public.profiles limit 1') like 'ERR permission denied%');
select public.t20('anon: profiles id only → permission denied',
  public.t20_anon('select count(*)::text from public.profiles') like 'ERR permission denied%');

-- ---- 4. logged in: unchanged ---------------------------------------------------------------
select public.t20('student: reads user_id',
  public.t20_as('authenticated', :STUDENT, $q$select user_id from public.measurements where id = 'b-obs-stream-water-7'$q$)
  = (select user_id from public.measurements where id = 'b-obs-stream-water-7'));
select public.t20('student: filters by user_id (profile page)',
  public.t20_as('authenticated', :STUDENT, $q$select count(*)::text from public.measurements where user_id = '00000000-0000-4000-8000-000000000003'$q$)
  = (select count(*)::text from public.measurements where user_id = '00000000-0000-4000-8000-000000000003'));
select public.t20('student: reads profiles (username)',
  public.t20_as('authenticated', :STUDENT, $q$select username from public.profiles where id = '00000000-0000-4000-8000-000000000003'$q$)
  = 'tester03');
select public.t20('student: reads all profile rows',
  public.t20_as('authenticated', :STUDENT, 'select count(*)::text from public.profiles')
  = (select count(*)::text from public.profiles));
select public.t20('admin: reads user_id and profiles',
  public.t20_as('authenticated', :ADMIN, 'select count(user_id)::text from public.measurements')
  = (select count(*)::text from public.measurements)
  and public.t20_as('authenticated', :ADMIN, 'select count(*)::text from public.profiles') = (select count(*)::text from public.profiles));
select public.t20('student: insert + returning user_id still works',
  public.t20_as('authenticated', :STUDENT, $q$insert into public.measurements (observation_id, user_id, lat, lng, measured_at, field_values)
     values ('obs-schoolyard-heat', '00000000-0000-4000-8000-000000000003', 32.1, 34.8, now() - interval '1 hour', '{"temperature": 22, "instrument": "TFA 30.1"}')
     returning user_id$q$) = '00000000-0000-4000-8000-000000000003');

-- ---- 5. home counts -------------------------------------------------------------------------
-- A draft lab with measurements (triggers skipped for the setup): only admins may count it.
insert into public.campaigns (id, slug, publication, region) values ('lab-draft-020', 'lab-draft-020', 'draft', 'center');
set session_replication_role = replica;
insert into public.measurements (id, observation_id, user_id, lat, lng, measured_at, field_values, form_version)
select 'd20-' || i, 'lab-draft-020', '00000000-0000-4000-8000-00000000000' || (1 + i % 3), 32, 35, now() - interval '1 day', '{}', 1
from generate_series(1, 5) i;
set session_replication_role = origin;

create temp table t20_direct as
select m.observation_id as cid, count(distinct m.user_id) as p, count(*) as n
from public.measurements m join public.campaigns c on c.id = m.observation_id
group by 1;

create temp table t20_pc_anon as
select public.t20_anon($q$select coalesce(jsonb_object_agg(campaign_id, participants), '{}')::text
                          from public.measurement_participant_counts()$q$)::jsonb as j;
select public.t20('participants (anon) = distinct user_id per published lab',
  (select bool_and((j->>d.cid)::bigint = d.p) from t20_pc_anon, t20_direct d
   join public.campaigns c on c.id = d.cid where c.publication = 'published')
  and (select count(*) from t20_pc_anon, jsonb_object_keys(j)) =
      (select count(*) from t20_direct d join public.campaigns c on c.id = d.cid where c.publication = 'published'),
  (select j::text from t20_pc_anon));
select public.t20('participants (anon): the draft lab is not counted',
  (select not (j ? 'lab-draft-020') from t20_pc_anon));
select public.t20('participants (admin): the draft lab is counted',
  public.t20_as('authenticated', :ADMIN, $q$select participants::text from public.measurement_participant_counts()
                                            where campaign_id = 'lab-draft-020'$q$) = '3');
select public.t20('participants (student): the draft lab is not counted',
  public.t20_as('authenticated', :STUDENT, $q$select count(*)::text from public.measurement_participant_counts()
                                              where campaign_id = 'lab-draft-020'$q$) = '0');

create temp table t20_sum as select public.t20_anon('select public.measurement_summary()::text')::jsonb as j;
select public.t20('summary (anon): total = published measurements',
  (select (j->>'total')::bigint from t20_sum)
  = (select sum(n) from t20_direct d join public.campaigns c on c.id = d.cid where c.publication = 'published'),
  (select j->>'total' from t20_sum));
select public.t20('summary (anon): participants per lab = direct counts',
  (select bool_and((s.j->'labs'->d.cid->>'participants')::bigint = d.p) from t20_sum s, t20_direct d
   join public.campaigns c on c.id = d.cid where c.publication = 'published'));
select public.t20('summary (anon): no draft, no user ids, no usernames',
  (select not (j->'labs' ? 'lab-draft-020') and j::text !~ '00000000-0000-4000' and j::text !~ 'tester' from t20_sum));
select public.t20('lab stats (anon): works, no user ids',
  public.t20_anon($q$select public.measurement_lab_stats('obs-schoolyard-heat', 1)::text$q$) !~ '(^ERR|00000000-0000-4000|tester)');

-- ---- 6. public admin credits ----------------------------------------------------------------
-- A published lab created by the admin, approved by three admins (setup as postgres, triggers
-- skipped): anon gets full names / workplaces, no ids and no usernames.
insert into auth.users (id, email, raw_user_meta_data) values
  ('55555555-5555-4555-8555-555555555555', 'r1@noemail.mitzpe.invalid', '{"mitzpe_username":"Reviewer One"}'),
  ('66666666-6666-4666-8666-666666666666', 'r2@noemail.mitzpe.invalid', '{"mitzpe_username":"Reviewer Two"}')
on conflict do nothing;
update public.profiles set role = 'admin', role_granted_by = '44444444-4444-4444-8444-444444444444', role_granted_at = now()
where id in ('55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666');
insert into public.admin_profiles (user_id, full_name, workplace, position) values
  ('33333333-3333-4333-8333-333333333333', 'Dana Creator', 'Mechina School', 'Teacher'),
  ('44444444-4444-4444-8444-444444444444', 'Owner Person', 'Mechina', null),
  ('55555555-5555-4555-8555-555555555555', 'Rina Reviewer', 'School B', null),
  ('66666666-6666-4666-8666-666666666666', 'Tom Reviewer', 'School C', null)
on conflict (user_id) do nothing;
set session_replication_role = replica;
update public.campaigns set created_by = '33333333-3333-4333-8333-333333333333', published_at = now(), review_round = 1
where id = 'obs-stream-water';
insert into public.lab_reviews (campaign_id, round, reviewer_id, verdict)
select 'obs-stream-water', 1, r::uuid, 'approve'
from unnest(array['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555',
                  '66666666-6666-4666-8666-666666666666']) r;
set session_replication_role = origin;

create temp table t20_cr as
select public.t20_anon($q$select public.lab_credits('obs-stream-water')::text$q$) as t;
select public.t20('credits (anon): creator full name + workplace',
  (select t::jsonb->'creator'->>'full_name' = 'Dana Creator' and t::jsonb->'creator'->>'workplace' = 'Mechina School' from t20_cr),
  (select left(t, 200) from t20_cr));
select public.t20('credits (anon): three approvers with names',
  (select jsonb_array_length(t::jsonb->'approvers') = 3 from t20_cr));
select public.t20('credits (anon): no user ids, no usernames, no photos',
  (select t !~ '[0-9a-f]{8}-[0-9a-f]{4}-' and t !~ '(Teacher A|The Owner|Reviewer One|Reviewer Two)'
          and t::jsonb->'creator'->'avatar' = 'null'::jsonb from t20_cr));
select public.t20('credits_all (anon): the card line',
  public.t20_anon($q$select creator_full_name || ' · ' || creator_workplace from public.lab_credits_all()
                     where campaign_id = 'obs-stream-water'$q$) = 'Dana Creator · Mechina School');
select public.t20('admin usernames are not public either',
  public.t20_anon($q$select username from public.profiles where role <> 'student' limit 1$q$) like 'ERR permission denied%');

-- ---- 7. account deletion --------------------------------------------------------------------
-- Keep (anonymised): tester05. Delete: tester06.
create temp table t20_del as
select (select count(*) from public.measurements where user_id = '00000000-0000-4000-8000-000000000005') as kept_n,
       (select count(*) from public.measurements where user_id = '00000000-0000-4000-8000-000000000006') as del_n,
       (select count(*) from public.measurements) as total_before;

create temp table t20_prep as
select public.account_delete_prepare('00000000-0000-4000-8000-000000000005', 'tester05', false) as keep,
       public.account_delete_prepare('00000000-0000-4000-8000-000000000006', 'tester06', true) as del;
delete from auth.users where id in ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006');
select public.t20('deletion: finish (keep) ok',
  public.t_sql(format($q$select public.account_delete_finish('00000000-0000-4000-8000-000000000005', %L, false)$q$,
                      (select keep->>'anon_id' from t20_prep))) = 'ok');
select public.t20('deletion: finish (delete) ok',
  public.t_sql(format($q$select public.account_delete_finish('00000000-0000-4000-8000-000000000006', %L, true)$q$,
                      (select del->>'anon_id' from t20_prep))) = 'ok');
select public.t20('deletion (keep): rows kept under the new random id, none under the old one',
  (select count(*) from public.measurements where user_id = (select keep->>'anon_id' from t20_prep)) = (select kept_n from t20_del)
  and not exists (select 1 from public.measurements where user_id = '00000000-0000-4000-8000-000000000005')
  and (select kept_n from t20_del) > 0);
select public.t20('deletion (delete): rows gone',
  (select count(*) from public.measurements) = (select total_before - del_n from t20_del)
  and (select del_n from t20_del) > 0);
select public.t20('deletion: anon still cannot read the anonymised id',
  public.t20_anon(format($q$select count(*)::text from public.measurements where user_id = %L$q$,
                         (select keep->>'anon_id' from t20_prep))) like 'ERR permission denied%');
select public.t20('deletion: no profile left for either id',
  not exists (select 1 from public.profiles where id in ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006')));
select public.t20('deletion: participants (anon) still = direct counts',
  (select bool_and(x.p = d.p) from
     (select campaign_id as cid, participants as p from jsonb_to_recordset(
        public.t20_anon($q$select coalesce(jsonb_agg(to_jsonb(x)), '[]')::text from public.measurement_participant_counts() x$q$)::jsonb)
        as r(campaign_id text, participants bigint)) x
   join (select m.observation_id as cid, count(distinct m.user_id) as p from public.measurements m
         join public.campaigns c on c.id = m.observation_id where c.publication = 'published' group by 1) d on d.cid = x.cid));

select (case when ok then 'PASS ' else 'FAIL ' end) || name || coalesce('  [' || left(got, 160) || ']', '')
from public.t20_res order by n;
