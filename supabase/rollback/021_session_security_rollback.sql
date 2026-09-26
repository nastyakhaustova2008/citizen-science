-- 021_session_security_rollback.sql — NOT part of the normal order; do not run by default.
-- Undoes 021 (audit H6): removes the guard on auth.users, the change tickets and
-- account_change_ticket, and puts back the privacy cleanup of 008. Afterwards a session token can
-- again change the password / pending email by calling Supabase Auth directly (the frontend and
-- the Edge Function keep working: the function skips the ticket when account_change_ticket is
-- missing). Only for an emergency — first try the kill switch, which needs no rollback:
--   update private.settings set value = 'false' where key = 'require_change_ticket';
-- Safe to re-run.

drop trigger if exists mitzpe_auth_users_change_guard on auth.users;
drop function if exists private.auth_users_change_guard();
drop function if exists public.account_change_ticket(uuid, text, text);
drop function if exists private.email_hash(text);
drop function if exists private.change_ticket_required();
drop table if exists private.auth_change_tickets;
delete from private.settings where key = 'require_change_ticket';

-- private.privacy_cleanup exactly as in 008.
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
