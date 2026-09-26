-- 022 rollback check (see run.sh): supabase/rollback/022_hardening_rollback.sql brings back the
-- 021-era behaviour, then 022 re-applied hardens again. Uses the helpers of 022/tests.sql.
truncate public.t22_res;

\ir ../../rollback/022_hardening_rollback.sql

select public.t22('rollback: photo = true accepted again (018 rule)',
  position('v = ''true''::jsonb' in (select prosrc from pg_proc where oid = 'public.measurements_validate_values()'::regprocedure)) > 0);
select public.t22('rollback: username_available callable by anon again',
  has_function_privilege('anon', 'public.username_available(text)', 'execute'));
select public.t22('rollback: public sign-up with a username in user_metadata sets it again (006)',
  public.t22_as('supabase_auth_admin', $q$insert into auth.users (id, email, raw_user_meta_data)
    values ('22000000-0000-4000-8000-00000000b0b0', 'rb@example.com', '{"mitzpe_username":"Rollback Name"}')$q$) = 'ok'
  and public.t22_q($q$select username from public.profiles where id = '22000000-0000-4000-8000-00000000b0b0'$q$) = 'Rollback Name');
select public.t22('rollback: new functions gone, upload policies back on *_upload_ok',
  to_regprocedure('public.account_signup_username(uuid,text)') is null
  and to_regprocedure('public.upload_quota(text)') is null
  and to_regprocedure('private.report_counts(uuid)') is null
  and (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'INSERT'
         and (with_check like '%photo_upload_ok(name)%' or with_check like '%avatar_upload_ok(name)%')) = 2);
select public.t22('rollback: privacy_cleanup is the 021 version (no sessions key)',
  not (private.privacy_cleanup() ? 'sessions') and (private.privacy_cleanup() ? 'change_tickets'));
select public.t22('rollback: admins read every admin profile again',
  public.t22_user('22000000-0000-4000-8000-0000000000d1',
    $q$select count(*)::text from public.admin_profiles where user_id = '22000000-0000-4000-8000-0000000000d4'$q$) = '1');
select public.t22('rollback: kept on purpose — indexes, RLS on private tables',
  to_regclass('public.role_events_cause_id_idx') is not null
  and (select relrowsecurity from pg_class where oid = 'private.settings'::regclass));

\ir ../../migrations/022_hardening.sql

select public.t22('022 again: photo = true refused, username_available closed, cleanup has sessions',
  position('v = ''true''::jsonb' in (select prosrc from pg_proc where oid = 'public.measurements_validate_values()'::regprocedure)) = 0
  and not has_function_privilege('anon', 'public.username_available(text)', 'execute')
  and (private.privacy_cleanup() ? 'sessions'));
select public.t22('022 again: kill switch value kept (not reset by re-running)',
  (select value from private.settings where key = 'upload_limit_by_hits') = 'true');

select (case when ok then 'PASS ' else 'FAIL ' end) || name || coalesce('  [' || left(got, 200) || ']', '')
from public.t22_res order by n;
