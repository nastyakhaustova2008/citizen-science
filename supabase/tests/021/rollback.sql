-- 021 rollback check (see run.sh): supabase/rollback/021_session_security_rollback.sql removes the
-- guard (a direct password change goes through again), then 021 re-applied guards again.
-- Uses the helpers of 021/tests.sql.
truncate public.t21_res;

\ir ../../rollback/021_session_security_rollback.sql

select public.t21('rollback: no guard trigger, no ticket table, no ticket function',
  not exists (select 1 from pg_trigger where tgname = 'mitzpe_auth_users_change_guard')
  and to_regclass('private.auth_change_tickets') is null
  and to_regprocedure('public.account_change_ticket(uuid,text,text)') is null);
select public.t21('rollback: a direct password change goes through again',
  public.t21_auth($q$update auth.users set encrypted_password = '$2a$10$rb' where id = '21000000-0000-4000-8000-000000000001'$q$) = 'ok'
  and public.t21_pw('21000000-0000-4000-8000-000000000001') = '$2a$10$rb');
select public.t21('rollback: privacy_cleanup is the 008 version (no change_tickets key)',
  not (private.privacy_cleanup() ? 'change_tickets'));

\ir ../../migrations/021_session_security.sql

select public.t21('021 again: a direct password change is ignored',
  public.t21_auth($q$update auth.users set encrypted_password = '$2a$10$rb2' where id = '21000000-0000-4000-8000-000000000001'$q$) = 'ok'
  and public.t21_pw('21000000-0000-4000-8000-000000000001') = '$2a$10$rb');
select public.t21('021 again: kill switch is on',
  (select value from private.settings where key = 'require_change_ticket') = 'true');

select (case when ok then 'PASS ' else 'FAIL ' end) || name || coalesce('  [' || left(got, 160) || ']', '')
from public.t21_res order by n;
