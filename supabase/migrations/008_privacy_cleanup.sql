-- 008_privacy_cleanup.sql
-- Privacy policy (public/privacy.html) promises: login records with IP addresses are kept
-- for at most 30 days, hashed IPs used for rate limits for about a day.
-- Run once in the Supabase SQL Editor, AFTER 006 (independent of 007). Safe to re-run.
-- Compatible with old and new frontend code (touches no table the browser uses).
--
-- What it does: a daily pg_cron job (03:17 UTC) that deletes
--   * auth.audit_log_entries older than 30 days — Supabase Auth's login/security log;
--     each row holds the IP address and the user's id/email. Supabase never cleans it.
--   * private.rate_limit_hits older than 1 day — the Edge Function already deletes these
--     at random (2% of calls); this makes "about a day" a guarantee.
--   * cron.job_run_details older than 7 days — pg_cron's own run history (grows daily).
-- Not touched: auth.sessions (IP + browser of a login, removed at logout / expiry —
-- deleting them would log users out).
--
-- pg_cron is available on every Supabase plan, the free plan included (Dashboard →
-- Integrations → Cron shows the job). A free project that is paused runs no jobs, but then
-- nothing new is logged either; the first run after resuming catches up.
--
-- Check after running:
--   select private.privacy_cleanup();                          -- runs it now, returns counts
--   select jobname, schedule, active from cron.job;            -- 'mitzpe-privacy-cleanup'
--   select status, return_message, start_time from cron.job_run_details
--   order by start_time desc limit 5;                          -- after the first night

create extension if not exists pg_cron with schema pg_catalog;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Returns how many rows each step deleted (for the manual check above).
create or replace function private.privacy_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_audit integer;
  n_rate  integer;
  n_cron  integer;
begin
  delete from auth.audit_log_entries where created_at < now() - interval '30 days';
  get diagnostics n_audit = row_count;

  delete from private.rate_limit_hits where at < now() - interval '1 day';
  get diagnostics n_rate = row_count;

  delete from cron.job_run_details where end_time < now() - interval '7 days';
  get diagnostics n_cron = row_count;

  return jsonb_build_object('audit_log', n_audit, 'rate_limit_hits', n_rate, 'cron_history', n_cron);
end;
$$;

revoke all on function private.privacy_cleanup() from public, anon, authenticated;

-- cron.schedule with an existing job name replaces that job, so re-running is safe.
select cron.schedule('mitzpe-privacy-cleanup', '17 3 * * *', 'select private.privacy_cleanup()');
