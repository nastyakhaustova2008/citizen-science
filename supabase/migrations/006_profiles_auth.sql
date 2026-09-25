-- 006_profiles_auth.sql
-- Roadmap step 4a: user accounts (username + password, optional email, Google).
-- Run once in the Supabase SQL Editor, AFTER 005. Safe to re-run.
--
-- Backward compatible: the old frontend keeps working (the TEMPORARY insert rule on
-- measurements stays until 007). Deploy order: 006 → preview → merge → production deploy → 007.
--
-- What it does:
--   1. Username rules (normalize / validate / case-insensitive key) — mirrored in
--      src/lib/username.js and supabase/functions/account/index.ts (same error codes).
--   2. profiles: one row per auth user (username, role + fields for step 4b).
--      Nobody can change role fields through the API; the owner is set only here, in SQL.
--   3. A trigger on auth.users that creates the profile (username from the sign-up
--      Edge Function, or empty for Google users — they choose it on first sign-in).
--   4. RPCs: username_available, set_my_username (browser); account_lookup,
--      rate_limit_take (Edge Function only, secret key).
--   5. measurements: new insert rule "logged-in users, only as themselves".
--
-- Login design (see CLAUDE.md → «Аккаунты»): Supabase Auth logs in by email, so the
-- Edge Function `account` resolves username → auth email on the server and never returns it.
-- Accounts without a real email get an internal placeholder address
-- (<uuid>@noemail.mitzpe.invalid) that never receives mail.

-- =====================================================================
-- 1. Username rules
-- =====================================================================
-- After normalization (NFC, trim, runs of whitespace → one space):
--   * 3–24 characters: Hebrew א–ת, Latin A–Z a–z, Russian А–я Ёё, digits, space, dot
--   * starts with a letter or digit; a dot must follow a letter or digit ("Noa L." ok, "a..b" not)
--   * at least one letter; Latin and Cyrillic letters are not mixed (look-alike names)
--   * not a reserved name
-- Unique case-insensitively: username_key (explicit Latin + Cyrillic lower-casing, so it does
-- not depend on the database locale; Hebrew has no case).

create or replace function public.username_normalize(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(pg_catalog.btrim(pg_catalog.regexp_replace(
           pg_catalog.normalize(coalesce(p, ''), 'NFC'), '\s+', ' ', 'g')), '')
$$;

create or replace function public.username_key(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.translate(p,
    'ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
    'abcdefghijklmnopqrstuvwxyzабвгдеёжзийклмнопрстуфхцчшщъыьэюя')
$$;

-- Error code for an already-normalized username, null when valid.
create or replace function public.username_error(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null or p = '' then 'required'
    when pg_catalog.char_length(p) < 3 then 'too_short'
    when pg_catalog.char_length(p) > 24 then 'too_long'
    when p !~ '^[0-9A-Za-zА-Яа-яЁёא-ת .]+$' then 'invalid_chars'
    when p !~ '^[0-9A-Za-zА-Яа-яЁёא-ת]' then 'bad_start'
    when p ~ '[ .]\.' then 'bad_dots'
    when p !~ '[A-Za-zА-Яа-яЁёא-ת]' then 'no_letter'
    when p ~ '[A-Za-z]' and p ~ '[А-Яа-яЁё]' then 'mixed_scripts'
    when public.username_key(p) in (
      'admin', 'administrator', 'owner', 'root', 'system', 'support', 'moderator', 'mitzpe',
      'מנהל', 'מנהלת', 'מנהל מערכת', 'מערכת', 'מצפה',
      'админ', 'администратор', 'модератор', 'владелец', 'система'
    ) then 'reserved'
    else null
  end
$$;

-- =====================================================================
-- 2. profiles
-- =====================================================================

create table if not exists public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  -- null until chosen (Google sign-in); set once, then only changeable from SQL.
  username         text,
  username_key     text generated always as (public.username_key(username)) stored,
  -- Step 4b: one owner (set here, in SQL only), main admins (appointed by the owner),
  -- regular admins. role_granted_by = who appointed them, for cascading revokes.
  -- Deleting a user who granted roles is blocked (FK) until 4b revokes their grants first.
  role             text not null default 'student'
                   check (role in ('student', 'admin', 'main_admin', 'owner')),
  role_granted_by  uuid references public.profiles (id),
  role_granted_at  timestamptz,
  created_at       timestamptz not null default now(),
  constraint profiles_username_valid
    check (username is null or (username = public.username_normalize(username)
                                and public.username_error(username) is null)),
  constraint profiles_role_grant
    check ((role in ('student', 'owner') and role_granted_by is null)
           or (role in ('admin', 'main_admin') and role_granted_by is not null)),
  constraint profiles_no_self_grant check (role_granted_by is distinct from id)
);

create unique index if not exists profiles_username_key_idx on public.profiles (username_key);
create unique index if not exists profiles_one_owner_idx on public.profiles ((true)) where role = 'owner';
create index if not exists profiles_role_granted_by_idx on public.profiles (role_granted_by);

alter table public.profiles enable row level security;

-- Public: id, username, role, created_at (authors on the map / in tables). Nothing else.
-- No INSERT / UPDATE / DELETE for anon or authenticated at all: rows are created by the
-- trigger below, usernames are set through set_my_username(), roles by 4b functions.
revoke all on public.profiles from anon, authenticated;
grant select (id, username, role, created_at) on public.profiles to anon, authenticated;

drop policy if exists "anyone can read profiles" on public.profiles;
create policy "anyone can read profiles"
  on public.profiles
  for select
  to anon, authenticated
  using (true);

-- Guard: role fields can never be changed by the API roles directly, the owner role only
-- from the SQL Editor (no JWT in the session), and a chosen username only from SQL.
create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  via_api boolean := coalesce(pg_catalog.current_setting('request.jwt.claims', true), '') <> '';
begin
  if tg_op = 'INSERT' then
    -- Every account starts as a student.
    new.role := 'student';
    new.role_granted_by := null;
    new.role_granted_at := null;
    new.created_at := now();
    return new;
  end if;

  if new.id <> old.id or new.created_at <> old.created_at then
    raise exception 'profiles_immutable' using detail = 'id and created_at never change';
  end if;

  if (new.role, new.role_granted_by, new.role_granted_at)
     is distinct from (old.role, old.role_granted_by, old.role_granted_at) then
    if current_user in ('anon', 'authenticated') then
      raise exception 'role_readonly' using detail = 'users cannot change role fields';
    end if;
    if via_api and (old.role = 'owner' or new.role = 'owner') then
      raise exception 'owner_sql_only' using detail = 'the owner is set only in the SQL Editor';
    end if;
  end if;

  if old.username is not null and new.username is distinct from old.username and via_api then
    raise exception 'username_locked' using detail = 'a chosen username changes only in SQL';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_guard();

-- =====================================================================
-- 3. New auth user → profile
-- =====================================================================
-- The sign-up Edge Function passes the username in user_metadata.mitzpe_username.
-- Invalid or taken → the whole user creation fails (user and profile appear together).
-- Google users have no such key → username stays null → the app asks them to choose one.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := public.username_normalize(new.raw_user_meta_data ->> 'mitzpe_username');
  v_err  text;
begin
  if v_name is not null then
    v_err := public.username_error(v_name);
    if v_err is not null then
      raise exception 'invalid_username' using detail = v_err;
    end if;
    if exists (select 1 from public.profiles where username_key = public.username_key(v_name)) then
      raise exception 'username_taken';
    end if;
  end if;
  insert into public.profiles (id, username) values (new.id, v_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users that existed before this migration (e.g. created in the dashboard) get a profile too.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

-- =====================================================================
-- 4. RPCs
-- =====================================================================

-- 'available', 'taken' or a validation code. Public: usernames are public anyway.
create or replace function public.username_available(p_username text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text := public.username_normalize(p_username);
  v_err  text := public.username_error(v_name);
begin
  if v_err is not null then
    return v_err;
  end if;
  if exists (select 1 from public.profiles where username_key = public.username_key(v_name)) then
    return 'taken';
  end if;
  return 'available';
end;
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- Choose a username once (Google users). Returns the stored (normalized) name.
-- Errors (message): not_logged_in, already_set, username_taken, invalid_username (detail = code).
create or replace function public.set_my_username(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := public.username_normalize(p_username);
  v_err  text := public.username_error(v_name);
begin
  if v_uid is null then
    raise exception 'not_logged_in';
  end if;
  if v_err is not null then
    raise exception 'invalid_username' using detail = v_err;
  end if;
  begin
    update public.profiles set username = v_name where id = v_uid and username is null;
  exception when unique_violation then
    raise exception 'username_taken';
  end;
  if not found then
    raise exception 'already_set';
  end if;
  return v_name;
end;
$$;

revoke all on function public.set_my_username(text) from public, anon;
grant execute on function public.set_my_username(text) to authenticated;

-- Edge Function only (secret key): username → user id + auth email. Never exposed to browsers.
create or replace function public.account_lookup(p_username text)
returns table (user_id uuid, email text, email_confirmed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text, u.email_confirmed_at is not null
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username_key = public.username_key(public.username_normalize(p_username))
$$;

revoke all on function public.account_lookup(text) from public, anon, authenticated;
grant execute on function public.account_lookup(text) to service_role;

-- Rate limiting for the Edge Function (signup / login failures / password reset).
-- Buckets are opaque strings; IPs arrive already hashed (HMAC) — raw IPs are not stored.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.rate_limit_hits (
  bucket  text not null,
  at      timestamptz not null default now()
);
create index if not exists rate_limit_hits_bucket_at_idx on private.rate_limit_hits (bucket, at);
alter table private.rate_limit_hits enable row level security;
revoke all on private.rate_limit_hits from public, anon, authenticated;

-- true = allowed. p_record: count this request (false = only check).
create or replace function public.rate_limit_take(
  p_bucket text, p_max integer, p_window_seconds integer, p_record boolean default true)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_bucket, 0));
  if pg_catalog.random() < 0.02 then
    delete from private.rate_limit_hits where at < now() - interval '1 day';
  end if;
  select count(*) into n
  from private.rate_limit_hits
  where bucket = p_bucket and at > now() - pg_catalog.make_interval(secs => p_window_seconds);
  if n >= p_max then
    return false;
  end if;
  if p_record then
    insert into private.rate_limit_hits (bucket) values (p_bucket);
  end if;
  return true;
end;
$$;

revoke all on function public.rate_limit_take(text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.rate_limit_take(text, integer, integer, boolean) to service_role;

-- =====================================================================
-- 5. measurements: logged-in users add measurements only as themselves
-- =====================================================================
-- The TEMPORARY "anyone can insert" rule from 001 stays until 007 (old production code
-- still inserts as anon). Old seed rows keep their mock user ids ('u-noa', …).

drop policy if exists "logged-in users add their own measurements" on public.measurements;
create policy "logged-in users add their own measurements"
  on public.measurements
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())::text
    and verification = 'pending'
    and photo_seed is null
    and exists (select 1 from public.profiles p
                where p.id = (select auth.uid()) and p.username is not null)
  );

notify pgrst, 'reload schema';

-- =====================================================================
-- Owner (run by hand once the owner has signed up; only possible here, in SQL):
--   update public.profiles set role = 'owner'
--   where username_key = public.username_key(public.username_normalize('Anastasiia Khaus.tova'));
-- =====================================================================
