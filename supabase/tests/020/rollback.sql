-- 020 rollback check — runs LAST (see run.sh): supabase/rollback/020_hide_identities_rollback.sql
-- must bring back exactly the 019 state, and 020 re-applied afterwards must hide identities again.
-- Prints PASS / FAIL lines like tests.sql (uses its helpers t20 / t20_anon).
truncate public.t20_res;

\ir ../../rollback/020_hide_identities_rollback.sql

select public.t20('rollback: anon reads user_id again',
  public.t20_anon('select count(user_id)::text from public.measurements') = (select count(*)::text from public.measurements));
select public.t20('rollback: anon reads profiles again',
  public.t20_anon('select count(username)::text from public.profiles') !~ '^ERR');
select public.t20('rollback: participant counts SECURITY INVOKER again',
  (select not prosecdef from pg_proc where oid = 'public.measurement_participant_counts()'::regprocedure));
select public.t20('rollback: home numbers still work for anon',
  public.t20_anon('select public.measurement_summary()->>''total''') !~ '^ERR');

\ir ../../migrations/020_hide_identities.sql

select public.t20('020 again: anon user_id refused',
  public.t20_anon('select user_id from public.measurements limit 1') like 'ERR permission denied%');
select public.t20('020 again: anon profiles refused',
  public.t20_anon('select username from public.profiles limit 1') like 'ERR permission denied%');
select public.t20('020 again: participant counts SECURITY DEFINER',
  (select prosecdef from pg_proc where oid = 'public.measurement_participant_counts()'::regprocedure));

select (case when ok then 'PASS ' else 'FAIL ' end) || name || coalesce('  [' || left(got, 160) || ']', '')
from public.t20_res order by n;
