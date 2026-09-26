-- 021_session_security.sql
-- Audit H6: a stolen or left-behind session must not be able to change the password or the email
-- by calling Supabase Auth directly (PUT /auth/v1/user). Password and email changes go through
-- the Edge Function `account` (actions change-password / change-email), which checks that THIS
-- session signed in within REAUTH_MAX_AGE_MINUTES (15) and then asks this database for a one-time
-- "ticket" right before it asks Supabase Auth to make the change. A trigger on auth.users lets the
-- change through only with such a ticket.
--
-- Run once in the Supabase SQL Editor, AFTER the Edge Function `account` with change-password /
-- change-email is deployed AND AFTER the frontend that uses it is deployed to production. Safe to
-- re-run. Rollback (only if needed, not run by default):
-- supabase/rollback/021_session_security_rollback.sql.
--
-- What is guarded (only these two columns of auth.users):
--   * encrypted_password: a NEW non-empty value without a ticket is NOT saved — the trigger keeps
--     the old value (and logs a warning). It does not raise: Supabase Auth also rewrites this
--     column during an ordinary password sign-in (re-encryption / re-hashing of the SAME
--     password), and an error there would block sign-ins. Removing a password (null / empty,
--     done by Supabase Auth to unconfirmed accounts on OAuth sign-in) is allowed.
--   * email_change (the pending NEW address, before its confirmation link is used): a new
--     non-empty value without a ticket for exactly that address → error 42501
--     "email_change_not_allowed". No sign-in path writes a non-empty email_change.
-- NOT guarded: the email column itself (Supabase Auth may set it during Google sign-in and
-- identity linking), confirming a pending address (email_change → email), inserts (sign-up,
-- first Google sign-in), deletes (account deletion), every other column.
--
-- Tickets (private.auth_change_tickets): user id + kind + expiry (60 s). For kind = 'email' also
-- the SHA-256 of the normalised new address (lower-case, trimmed). Never the password or any hash
-- of it. A ticket is deleted when used; expired ones are deleted by the daily privacy cleanup
-- (008, private.privacy_cleanup — replaced below with one more step). Only the Edge Function
-- (secret key → service_role) can create tickets: account_change_ticket is not executable by
-- anon / authenticated.
--
-- Kill switch (owner, SQL Editor only): private.settings.require_change_ticket = 'false' turns
-- the guard off at once (the trigger then lets every change through, as before 021):
--   update private.settings set value = 'false' where key = 'require_change_ticket';
--
-- Compatibility: the production frontend from before this change calls
-- supabase.auth.updateUser({ password }) directly — after 021 that call "succeeds" but the
-- password stays the same. Hence: Edge Function → frontend in production → then 021.
-- The new frontend works both before and after 021 (the Edge Function skips the ticket while
-- account_change_ticket does not exist yet).

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 1. Kill switch (private.settings exists since 017; created here too so 021 stands alone)
create table if not exists private.settings (
  key    text primary key,
  value  text not null
);
revoke all on private.settings from public, anon, authenticated;
insert into private.settings (key, value) values ('require_change_ticket', 'true')
on conflict (key) do nothing;

create or replace function private.change_ticket_required()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value <> 'false' from private.settings where key = 'require_change_ticket'), true)
$$;
revoke all on function private.change_ticket_required() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Tickets
create table if not exists private.auth_change_tickets (
  id          bigserial primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('password', 'email')),
  -- SHA-256 (hex) of the normalised new address; only for kind = 'email'.
  email_hash  text check (email_hash is null or email_hash ~ '^[0-9a-f]{64}$'),
  expires_at  timestamptz not null default now() + interval '60 seconds',
  check ((kind = 'email') = (email_hash is not null))
);
create index if not exists auth_change_tickets_user_idx on private.auth_change_tickets (user_id, kind);
revoke all on private.auth_change_tickets from public, anon, authenticated;
revoke all on sequence private.auth_change_tickets_id_seq from public, anon, authenticated;

create or replace function private.email_hash(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(p_email)), 'UTF8')), 'hex')
$$;
revoke all on function private.email_hash(text) from public, anon, authenticated;

-- Edge Function only (secret key). One open ticket per user and kind: a new one replaces the old.
create or replace function public.account_change_ticket(p_user uuid, p_kind text, p_email text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null or p_kind is null or p_kind not in ('password', 'email') then
    raise exception 'bad_request';
  end if;
  if (p_kind = 'email') <> (coalesce(pg_catalog.btrim(p_email), '') <> '') then
    raise exception 'bad_request';
  end if;
  delete from private.auth_change_tickets
  where (user_id = p_user and kind = p_kind) or expires_at < now();
  insert into private.auth_change_tickets (user_id, kind, email_hash)
  values (p_user, p_kind, case when p_kind = 'email' then private.email_hash(p_email) end);
end;
$$;
revoke all on function public.account_change_ticket(uuid, text, text) from public, anon, authenticated;
grant execute on function public.account_change_ticket(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. The guard on auth.users
create or replace function private.auth_users_change_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.change_ticket_required() then
    return new;
  end if;

  -- A new password (not: removing one, not: unchanged).
  if new.encrypted_password is distinct from old.encrypted_password
     and coalesce(new.encrypted_password, '') <> '' then
    delete from private.auth_change_tickets
    where user_id = new.id and kind = 'password' and expires_at > now();
    if not found then
      -- Keep the old password: a direct API call can't change it, and a sign-in that re-writes
      -- the same password is not blocked (see the header).
      raise warning 'mitzpe: password change without a ticket ignored';
      new.encrypted_password := old.encrypted_password;
    end if;
  end if;

  -- A new pending email address.
  if coalesce(new.email_change, '') <> ''
     and new.email_change is distinct from old.email_change then
    delete from private.auth_change_tickets
    where user_id = new.id and kind = 'email' and expires_at > now()
      and email_hash = private.email_hash(new.email_change);
    if not found then
      raise exception 'email_change_not_allowed' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
revoke all on function private.auth_users_change_guard() from public, anon, authenticated;

drop trigger if exists mitzpe_auth_users_change_guard on auth.users;
create trigger mitzpe_auth_users_change_guard
  before update of encrypted_password, email_change on auth.users
  for each row execute function private.auth_users_change_guard();

-- ---------------------------------------------------------------------------------------------
-- 4. Daily privacy cleanup (008) + expired tickets
create or replace function private.privacy_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_audit   integer;
  n_rate    integer;
  n_cron    integer;
  n_tickets integer;
begin
  delete from auth.audit_log_entries where created_at < now() - interval '30 days';
  get diagnostics n_audit = row_count;

  delete from private.rate_limit_hits where at < now() - interval '1 day';
  get diagnostics n_rate = row_count;

  delete from cron.job_run_details where end_time < now() - interval '7 days';
  get diagnostics n_cron = row_count;

  delete from private.auth_change_tickets where expires_at < now();
  get diagnostics n_tickets = row_count;

  return jsonb_build_object('audit_log', n_audit, 'rate_limit_hits', n_rate, 'cron_history', n_cron,
                            'change_tickets', n_tickets);
end;
$$;
revoke all on function private.privacy_cleanup() from public, anon, authenticated;
