-- 023 tests (home page participants, audit M7) — run AFTER migration 023 (applied twice).
-- Prints PASS / FAIL per check.
create table public.t23_res (n serial, name text, ok boolean, got text);
create function public.t23(p_name text, p_ok boolean, p_got text default null) returns void language sql as $$
  insert into public.t23_res (name, ok, got) values (p_name, coalesce(p_ok, false), p_got) $$;
-- Run a query as a role (JWT sub = p_sub for authenticated) → text, or 'ERR <sqlstate> <message>'.
create function public.t23_as(p_role text, p_sql text, p_sub uuid default null) returns text language plpgsql as $$
declare r text; msg text; st text;
begin
  if p_sub is not null then
    perform set_config('request.jwt.claim.sub', p_sub::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role)::text, true);
  end if;
  execute format('set local role %I', p_role);
  begin
    execute p_sql into r;
  exception when others then
    get stacked diagnostics msg = message_text, st = returned_sqlstate;
    execute 'reset role';
    return 'ERR ' || st || ' ' || msg;
  end;
  execute 'reset role';
  return r;
end $$;
revoke all on function public.t23(text, boolean, text), public.t23_as(text, text, uuid) from public, anon, authenticated;
revoke all on public.t23_res from public, anon, authenticated;

-- Expected numbers straight from the tables.
create temp table t23_want as
select (select count(distinct m.user_id) from public.measurements m join public.campaigns c on c.id = m.observation_id
        where c.publication = 'published') as published,
       (select count(distinct m.user_id) from public.measurements m) as everything;

select public.t23('anon: total = distinct authors in published labs',
  public.t23_as('anon', 'select public.measurement_participants_total()::text') = (select published::text from t23_want),
  public.t23_as('anon', 'select public.measurement_participants_total()::text') || ' vs ' || (select published::text from t23_want));
select public.t23('the answer is one number (no id, no name)',
  public.t23_as('anon', 'select public.measurement_participants_total()::text') ~ '^\d+$');
select public.t23('logged-in student: same number as anon',
  public.t23_as('authenticated', 'select public.measurement_participants_total()::text', '11111111-1111-4111-8111-111111111111')
  = (select published::text from t23_want));

-- A draft lab with measurements of a new user: admins count them, anon / students don't.
set session_replication_role = replica;
update public.campaigns set publication = 'draft' where id = 'obs-stream-water';
set session_replication_role = origin;
select public.t23('draft lab: anon doesn''t count its participants',
  public.t23_as('anon', 'select public.measurement_participants_total()::text')
  = (select count(distinct m.user_id)::text from public.measurements m join public.campaigns c on c.id = m.observation_id
     where c.publication = 'published'));
select public.t23('draft lab: admins count every lab',
  public.t23_as('authenticated', 'select public.measurement_participants_total()::text', '33333333-3333-4333-8333-333333333333')
  = (select everything::text from t23_want));
set session_replication_role = replica;
update public.campaigns set publication = 'published' where id = 'obs-stream-water';
set session_replication_role = origin;

select public.t23('SECURITY DEFINER with empty search_path, executable by anon / authenticated only',
  (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p
   where p.oid = 'public.measurement_participants_total()'::regprocedure)
  and has_function_privilege('anon', 'public.measurement_participants_total()', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                  where p.oid = 'public.measurement_participants_total()'::regprocedure and a.privilege_type = 'EXECUTE'
                    and a.grantee = 0));

-- ---- L3 (client, AppDataContext.addMeasurement): a retry with the same id -------------------------
-- The wizard makes one id per measurement. A lost answer + "save" again → the second insert fails
-- (23505) and the app finds the row by id + its own user_id → success, no duplicate.
delete from private.rate_limit_hits where bucket like 'measure:user:%';
create function public.t23_ins(p_id text) returns text language sql as $f$
  select public.t23_as('authenticated', format($q$insert into public.measurements (id, observation_id, user_id, lat, lng, measured_at, field_values)
    values (%L, 'obs-schoolyard-heat', '22222222-2222-4222-8222-222222222222', 32.1, 34.8, now(),
            '{"temperature": 20, "instrument": "x"}') returning id$q$, p_id), '22222222-2222-4222-8222-222222222222') $f$;
revoke all on function public.t23_ins(text) from public, anon, authenticated;
select public.t23('L3: first save with the wizard''s id works',
  public.t23_ins('5a1e7c1e-0000-4000-8000-00000000l3aa') = '5a1e7c1e-0000-4000-8000-00000000l3aa');
select public.t23('L3: the same id again → 23505 (no second row)',
  public.t23_ins('5a1e7c1e-0000-4000-8000-00000000l3aa') like 'ERR 23505%'
  and (select count(*) from public.measurements where id = '5a1e7c1e-0000-4000-8000-00000000l3aa') = 1);
select public.t23('L3: the author finds it by id + own user_id (what the app checks)',
  public.t23_as('authenticated', $q$select count(*)::text from public.measurements
    where id = '5a1e7c1e-0000-4000-8000-00000000l3aa' and user_id = '22222222-2222-4222-8222-222222222222'$q$,
    '22222222-2222-4222-8222-222222222222') = '1');
select public.t23('L3: someone else''s id is not "mine" (another user gets 0 → a real error)',
  public.t23_as('authenticated', $q$select count(*)::text from public.measurements
    where id = '5a1e7c1e-0000-4000-8000-00000000l3aa' and user_id = '11111111-1111-4111-8111-111111111111'$q$,
    '11111111-1111-4111-8111-111111111111') = '0');

-- Rollback file, then 023 again.
\ir ../../rollback/023_home_participants_rollback.sql
select public.t23('rollback: the function is gone',
  to_regprocedure('public.measurement_participants_total()') is null);
\ir ../../migrations/023_home_participants.sql
select public.t23('023 again: back',
  public.t23_as('anon', 'select public.measurement_participants_total()::text') ~ '^\d+$');

select (case when ok then 'PASS ' else 'FAIL ' end) || name || coalesce('  [' || left(got, 200) || ']', '')
from public.t23_res order by n;
