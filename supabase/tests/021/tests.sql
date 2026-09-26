-- 021 tests (audit H6) — run AFTER migration 021 (applied twice) — see run.sh.
-- Every check writes a row to t21_res; the last query prints PASS / FAIL per check.
--   * the guard on auth.users: a new password / pending email needs a ticket; without one the
--     password is kept (no error) and the pending email is refused (42501);
--   * what it must NOT block (GoTrue writes these as supabase_auth_admin): sign-up, Google sign-in
--     (new and returning user), username sign-in (incl. re-writing the same password), identity
--     email updates, confirming a pending email, removing a password, account deletion, and the
--     Edge Function's admin update with a ticket;
--   * tickets: never hold a password (columns), used once, expire, cleaned by privacy_cleanup;
--   * privileges: only service_role may create tickets (not anon / authenticated);
--   * kill switch.

create table public.t21_res (n serial, name text, ok boolean, got text);
create function public.t21(p_name text, p_ok boolean, p_got text default null) returns void language sql as $$
  insert into public.t21_res (name, ok, got) values (p_name, coalesce(p_ok, false), p_got) $$;

-- Run p_sql as p_role → 'ok' or 'ERR <sqlstate> <message>'.
create table public.t21_log (n serial, sql text, result text);
create function public.t21_as(p_role text, p_sql text) returns text language plpgsql as $$
declare msg text; st text;
begin
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics msg = message_text, st = returned_sqlstate;
    execute 'reset role';
    insert into public.t21_log (sql, result) values (left(p_sql, 120), 'ERR ' || st || ' ' || msg);
    return 'ERR ' || st || ' ' || msg;
  end;
  execute 'reset role';
  return 'ok';
end $$;
-- GoTrue (Supabase Auth) and the Edge Function (secret key).
create function public.t21_auth(p_sql text) returns text language sql as $$ select public.t21_as('supabase_auth_admin', p_sql) $$;
create function public.t21_edge(p_sql text) returns text language sql as $$ select public.t21_as('service_role', p_sql) $$;
create function public.t21_pw(p_user uuid) returns text language sql as $$ select encrypted_password from auth.users where id = p_user $$;
-- Reads with a new snapshot (a plain subquery in the same statement would not see the write).
create function public.t21_q(p_sql text) returns text language plpgsql as $$
declare r text; begin execute p_sql into r; return r; end $$;
create function public.t21_tickets(p_user uuid) returns bigint language sql as $$
  select count(*) from private.auth_change_tickets where user_id = p_user $$;

\set U  '''21000000-0000-4000-8000-000000000001'''
\set G  '''21000000-0000-4000-8000-000000000002'''
\set D  '''21000000-0000-4000-8000-000000000003'''

-- ---- 1. what the guard must not block ---------------------------------------------------------
-- Sign-up (Edge Function createUser → insert with a password).
select public.t21('sign-up: insert with a password works (username account)',
  public.t21_auth($q$insert into auth.users (id, email, email_confirmed_at, encrypted_password, raw_user_meta_data)
    values ('21000000-0000-4000-8000-000000000001', 'u1@noemail.mitzpe.invalid', now(), '$2a$10$first',
            '{"mitzpe_username":"pwtest21"}')$q$) = 'ok'
  and public.t21_q($q$select username from public.profiles where id = '21000000-0000-4000-8000-000000000001'$q$) = 'pwtest21');

-- Username sign-in: last_sign_in_at, and (key rotation / cost change) the SAME password re-written.
select public.t21('username sign-in: last_sign_in_at update works',
  public.t21_auth($q$update auth.users set last_sign_in_at = now() where id = '21000000-0000-4000-8000-000000000001'$q$) = 'ok');
select public.t21('username sign-in: re-writing encrypted_password does not fail (value kept)',
  public.t21_auth($q$update auth.users set encrypted_password = '$2a$10$rehashed', last_sign_in_at = now()
                    where id = '21000000-0000-4000-8000-000000000001'$q$) = 'ok'
  and public.t21_pw(:U) = '$2a$10$first');
-- GoTrue sometimes writes the whole row: guarded columns unchanged → nothing happens.
select public.t21('full-row update with unchanged values works',
  public.t21_auth($q$update auth.users set encrypted_password = encrypted_password, email_change = email_change,
                    email = email, raw_user_meta_data = raw_user_meta_data where id = '21000000-0000-4000-8000-000000000001'$q$) = 'ok');

-- Google: first sign-in (insert, no password), returning sign-in (metadata + email from Google).
select public.t21('Google, new user: insert without a password works',
  public.t21_auth($q$insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
    values ('21000000-0000-4000-8000-000000000002', 'kid@gmail.test', now(), '{"full_name":"x"}',
            '{"provider":"google","providers":["google"]}')$q$) = 'ok'
  and public.t21_q($q$select count(*) from public.profiles where id = '21000000-0000-4000-8000-000000000002'$q$) = '1');
select public.t21('Google, returning user: metadata + last_sign_in_at update works',
  public.t21_auth($q$update auth.users set raw_user_meta_data = '{"full_name":"y"}', last_sign_in_at = now()
                    where id = '21000000-0000-4000-8000-000000000002'$q$) = 'ok');
select public.t21('Google / identities: the email column itself is not guarded',
  public.t21_auth($q$update auth.users set email = 'kid.new@gmail.test' where id = '21000000-0000-4000-8000-000000000002'$q$) = 'ok'
  and public.t21_q($q$select email from auth.users where id = '21000000-0000-4000-8000-000000000002'$q$) = 'kid.new@gmail.test');
select public.t21('OAuth on an unconfirmed account: removing a password (null) is allowed',
  public.t21_auth($q$update auth.users set encrypted_password = null where id = '21000000-0000-4000-8000-000000000002'$q$) = 'ok');

-- ---- 2. password: blocked without a ticket, works with one ----------------------------------
select public.t21('direct PUT /user {password} (no ticket): no error, password unchanged',
  public.t21_auth($q$update auth.users set encrypted_password = '$2a$10$attacker' where id = '21000000-0000-4000-8000-000000000001'$q$) = 'ok'
  and public.t21_pw(:U) = '$2a$10$first');
select public.t21('Google-only user: setting a first password without a ticket is ignored too',
  public.t21_auth($q$update auth.users set encrypted_password = '$2a$10$x' where id = '21000000-0000-4000-8000-000000000002'$q$) = 'ok'
  and public.t21_pw(:G) is null);

select public.t21('Edge Function: account_change_ticket (password) as service_role works',
  public.t21_edge($q$select public.account_change_ticket('21000000-0000-4000-8000-000000000001', 'password')$q$) = 'ok'
  and public.t21_tickets(:U) = 1);
select public.t21('password ticket holds no hash (email_hash null)',
  (select email_hash is null from private.auth_change_tickets where user_id = :U));
select public.t21('Edge Function admin updateUserById with a ticket: password changed',
  public.t21_auth($q$update auth.users set encrypted_password = '$2a$10$second' where id = '21000000-0000-4000-8000-000000000001'$q$) = 'ok'
  and public.t21_pw(:U) = '$2a$10$second');
select public.t21('the ticket is deleted on use',
  public.t21_tickets(:U) = 0);
select public.t21('a used ticket can not be used again',
  public.t21_auth($q$update auth.users set encrypted_password = '$2a$10$third' where id = '21000000-0000-4000-8000-000000000001'$q$) = 'ok'
  and public.t21_pw(:U) = '$2a$10$second');

select public.account_change_ticket(:G, 'password');
select public.t21('a ticket belongs to one user only',
  public.t21_auth($q$update auth.users set encrypted_password = '$2a$10$other' where id = '21000000-0000-4000-8000-000000000001'$q$) = 'ok'
  and public.t21_pw(:U) = '$2a$10$second' and public.t21_tickets(:G) = 1);
select public.t21('Google user with a ticket (after Google re-sign-in): first password set',
  public.t21_auth($q$update auth.users set encrypted_password = '$2a$10$google' where id = '21000000-0000-4000-8000-000000000002'$q$) = 'ok'
  and public.t21_pw(:G) = '$2a$10$google');

select public.account_change_ticket(:U, 'password');
update private.auth_change_tickets set expires_at = now() - interval '1 second' where user_id = :U;
select public.t21('an expired ticket does not work',
  public.t21_auth($q$update auth.users set encrypted_password = '$2a$10$late' where id = '21000000-0000-4000-8000-000000000001'$q$) = 'ok'
  and public.t21_pw(:U) = '$2a$10$second');
select public.t21('privacy_cleanup removes expired tickets',
  (private.privacy_cleanup() ->> 'change_tickets')::int >= 1 and public.t21_tickets(:U) = 0);

-- ---- 3. pending email: refused without a ticket for that address ----------------------------
select public.t21('direct PUT /user {email} (no ticket) → 42501 email_change_not_allowed',
  public.t21_auth($q$update auth.users set email_change = 'thief@example.com' where id = '21000000-0000-4000-8000-000000000001'$q$)
  = 'ERR 42501 email_change_not_allowed');
select public.account_change_ticket(:U, 'email', ' Kid@Example.com ');
select public.t21('email ticket: stores only a sha256 of the normalised address',
  (select email_hash = encode(sha256(convert_to('kid@example.com', 'UTF8')), 'hex') from private.auth_change_tickets where user_id = :U));
select public.t21('email ticket for another address does not work',
  public.t21_auth($q$update auth.users set email_change = 'thief@example.com' where id = '21000000-0000-4000-8000-000000000001'$q$)
  like 'ERR 42501%' and public.t21_tickets(:U) = 1);
select public.t21('Edge Function change-email with a ticket: pending address set (case-insensitive)',
  public.t21_auth($q$update auth.users set email_change = 'kid@EXAMPLE.com' where id = '21000000-0000-4000-8000-000000000001'$q$) = 'ok'
  and public.t21_tickets(:U) = 0);
select public.t21('confirming the pending email (email_change → email) works without a ticket',
  public.t21_auth($q$update auth.users set email = email_change, email_change = '' where id = '21000000-0000-4000-8000-000000000001'$q$) = 'ok'
  and public.t21_q($q$select email from auth.users where id = '21000000-0000-4000-8000-000000000001'$q$) = 'kid@EXAMPLE.com');
select public.t21('clearing a pending email works without a ticket',
  public.t21_auth($q$update auth.users set email_change = '' where id = '21000000-0000-4000-8000-000000000001'$q$) = 'ok');

-- ---- 4. tickets: shape and privileges ---------------------------------------------------------
select public.t21('ticket table: exactly id, user_id, kind, email_hash, expires_at (no password)',
  (select array_agg(attname::text order by attnum) from pg_attribute
   where attrelid = 'private.auth_change_tickets'::regclass and attnum > 0 and not attisdropped)
  = array['id', 'user_id', 'kind', 'email_hash', 'expires_at']);
select public.t21('ticket: bad kind / password with an address / email without one → bad_request',
  public.t21_edge($q$select public.account_change_ticket('21000000-0000-4000-8000-000000000001', 'role')$q$) like 'ERR % bad_request'
  and public.t21_edge($q$select public.account_change_ticket('21000000-0000-4000-8000-000000000001', 'password', 'a@b.c')$q$) like 'ERR % bad_request'
  and public.t21_edge($q$select public.account_change_ticket('21000000-0000-4000-8000-000000000001', 'email')$q$) like 'ERR % bad_request');
select public.t21('anon can not execute account_change_ticket',
  not has_function_privilege('anon', 'public.account_change_ticket(uuid,text,text)', 'execute')
  and public.t21_as('anon', $q$select public.account_change_ticket('21000000-0000-4000-8000-000000000001', 'password')$q$) like 'ERR 42501%');
select public.t21('authenticated can not execute account_change_ticket',
  not has_function_privilege('authenticated', 'public.account_change_ticket(uuid,text,text)', 'execute')
  and public.t21_as('authenticated', $q$select public.account_change_ticket('21000000-0000-4000-8000-000000000001', 'password')$q$) like 'ERR 42501%');
select public.t21('PUBLIC can not execute account_change_ticket (only service_role is granted)',
  not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid = 'public.account_change_ticket(uuid,text,text)'::regprocedure
                and a.privilege_type = 'EXECUTE' and a.grantee not in ('service_role'::regrole, p.proowner)));
select public.t21('anon / authenticated: no access to the tickets table or the private schema',
  not has_schema_privilege('anon', 'private', 'usage') and not has_schema_privilege('authenticated', 'private', 'usage')
  and public.t21_as('authenticated', 'select 1 from private.auth_change_tickets') like 'ERR 42501%');
select public.t21('guard functions: not executable by anon / authenticated',
  not has_function_privilege('anon', 'private.auth_users_change_guard()', 'execute')
  and not has_function_privilege('authenticated', 'private.auth_users_change_guard()', 'execute')
  and not has_function_privilege('authenticated', 'private.change_ticket_required()', 'execute'));
select public.t21('guard: SECURITY DEFINER with empty search_path',
  (select bool_and(p.prosecdef and p.proconfig = array['search_path=""']) from pg_proc p
   where p.oid in ('private.auth_users_change_guard()'::regprocedure, 'public.account_change_ticket(uuid,text,text)'::regprocedure)));

-- ---- 5. account deletion still works ----------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at, encrypted_password, raw_user_meta_data)
values (:D, 'd@noemail.mitzpe.invalid', now(), '$2a$10$d', '{"mitzpe_username":"deltest21"}');
select public.account_change_ticket(:D, 'password');
create temp table t21_prep as select public.account_delete_prepare(:D, 'deltest21', false) as p;
select public.t21('deletion: prepare ok, auth user deleted (as Supabase Auth), pending ticket cascades',
  public.t21_auth($q$delete from auth.users where id = '21000000-0000-4000-8000-000000000003'$q$) = 'ok'
  and public.t21_tickets(:D) = 0);
select public.t21('deletion: finish ok',
  public.t21_edge(format($q$select public.account_delete_finish('21000000-0000-4000-8000-000000000003', %L, false)$q$,
                        (select p ->> 'anon_id' from t21_prep))) = 'ok'
  and public.t21_q($q$select count(*) from public.profiles where id = '21000000-0000-4000-8000-000000000003'$q$) = '0');

-- ---- 6. kill switch -----------------------------------------------------------------------------
update private.settings set value = 'false' where key = 'require_change_ticket';
select public.t21('kill switch off: changes go through without a ticket',
  public.t21_auth($q$update auth.users set encrypted_password = '$2a$10$free', email_change = 'x@y.zz'
                    where id = '21000000-0000-4000-8000-000000000001'$q$) = 'ok'
  and public.t21_pw(:U) = '$2a$10$free');
update private.settings set value = 'true' where key = 'require_change_ticket';
select public.t21('kill switch back on: guarded again',
  public.t21_auth($q$update auth.users set encrypted_password = '$2a$10$again' where id = '21000000-0000-4000-8000-000000000001'$q$) = 'ok'
  and public.t21_pw(:U) = '$2a$10$free');

select (case when ok then 'PASS ' else 'FAIL ' end) || name || coalesce('  [' || left(got, 160) || ']', '')
from public.t21_res order by n;
-- Errors from statements run by the checks (expected ones included), to explain a FAIL.
select 'LOG ' || result || '  <- ' || regexp_replace(sql, '\s+', ' ', 'g') from public.t21_log order by n;
