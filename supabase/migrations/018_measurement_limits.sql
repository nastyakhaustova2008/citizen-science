-- 018_measurement_limits.sql
-- Audit H3 + H4: limits on what a measurement may contain, and how often one may be added.
-- Run once in the Supabase SQL Editor, AFTER 017. Safe to re-run.
--
-- Compatible with the production frontend: every valid measurement is accepted exactly as before;
-- only new violations are refused (the old wizard shows its generic "could not save" line for them).
-- Existing rows are never changed or deleted. To list existing rows that break the new rules:
-- supabase/checks/018_existing_violations.sql (read-only).
--
-- Rules (all mirrored in src/lib/fields.js + src/lib/comments.js — same error codes):
--   * Text is cleaned like comments (comment_clean: NFC, no control / invisible formatting
--     characters, trimmed) and stored cleaned. The place name is also collapsed to one line.
--   * Lengths (characters, after cleaning): place name ≤ 120; short text field ≤ 200; long ≤ 2000.
--   * The same safety check as comments (private.text_safety_error, now shared with
--     comment_body_error): no phone numbers, no email addresses, links only to the allowed
--     domains. Codes: phone_not_allowed, email_not_allowed, link_not_allowed, link_shortener,
--     link_domain_not_allowed.
--   * id (the client may send one): 1–64 characters of [A-Za-z0-9_-]. measured_at: from
--     2000-01-01 up to now + 1 day.
--   * Errors keep the 004 format: message invalid_values, detail {key: code}. Field keys start
--     with a letter, so the built-in columns use keys starting with "_": _place (too_long | a
--     safety code), _date (date_range), _id (format).
--   * Checked on INSERT (all of it) and on UPDATE only for a column that changed (for field_values:
--     only the text values that changed), so moderation, photo removal and account deletion keep
--     working on old rows.
--   * Rate limit, INSERT only, counted only for otherwise valid rows, per user: 10 / minute,
--     60 / hour, 200 / day; admins, main admins and the owner 3× that. Error message
--     rate_limited, detail = the window hit (minute | hour | day). Inserts without a logged-in
--     user (SQL Editor, seeds) are not limited. Bucket measure:user:<id> in
--     private.rate_limit_hits (removed by the daily cleanup after a day, and on account deletion).
--
-- The helpers live in schema private (not reachable through the API). The two measurement
-- trigger functions are SECURITY DEFINER so they can call them; nobody may call the trigger
-- functions directly (execute revoked — triggers still fire).

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- =====================================================================
-- 1. The shared text safety check (comments + measurements)
-- =====================================================================

-- First safety problem in a (cleaned) text: null or {code, host?, domains?}. No length check.
-- The link / email / phone part of 015's comment_body_error, unchanged.
create or replace function private.text_safety_error(p_text text, p_domains text[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  d   text;
  err jsonb;
begin
  if coalesce(p_text, '') = '' then
    return null;
  end if;
  d := public.comment_detect_text(p_text);
  err := public.comment_link_error(d, p_domains);
  if err is not null then
    if err ->> 'code' = 'link_domain_not_allowed' then
      err := err || jsonb_build_object('domains', to_jsonb(coalesce(p_domains, '{}'::text[])));
    end if;
    return err;
  end if;
  if d ~ '[^\s@]+@[^\s@]+\.[a-z]{2,}' then
    return jsonb_build_object('code', 'email_not_allowed');
  end if;
  if d ~ '(^|[^0-9.+])0[0-9]{1,2}[- ]?[0-9]{3}[- ]?[0-9]{2}[- ]?[0-9]{2}([^0-9]|$)'
     or d ~ '(^|[^0-9.])\+?972[- ]?0?[0-9]{1,2}[- ]?[0-9]{3}[- ]?[0-9]{2}[- ]?[0-9]{2}([^0-9]|$)'
     or d ~ '(^|[^0-9.])(\+7|8|\+380)[- ]?\(?[0-9]{2,3}\)?[- ]?[0-9]{3}[- ]?[0-9]{2}[- ]?[0-9]{2}([^0-9]|$)'
     or d ~ '\+[0-9]{1,3}[- ]?\(?[0-9]{1,4}\)?([- ]?[0-9]){6,10}([^0-9]|$)' then
    return jsonb_build_object('code', 'phone_not_allowed');
  end if;
  return null;
end;
$$;

revoke all on function private.text_safety_error(text, text[]) from public, anon, authenticated;

-- Comments: same checks, same order, same results as 015 (the safety part now lives above).
create or replace function public.comment_body_error(p_body text, p_domains text[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if coalesce(p_body, '') = '' then
    return jsonb_build_object('code', 'empty');
  end if;
  if pg_catalog.char_length(p_body) > 1000 then
    return jsonb_build_object('code', 'too_long');
  end if;
  return private.text_safety_error(p_body, p_domains);
end;
$$;

revoke all on function public.comment_body_error(text, text[]) from public, anon, authenticated;

-- =====================================================================
-- 2. Measurement text helpers (private)
-- =====================================================================

-- Stored form of a text value: comment_clean; single line: runs of whitespace → one space. '' → null.
create or replace function private.measurement_clean(p_text text, p_single_line boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(case when p_single_line
                     then pg_catalog.regexp_replace(public.comment_clean(p_text),
                            '[\s   -     　]+', ' ', 'g')
                     else public.comment_clean(p_text) end, '')
$$;

-- Code for a cleaned text: too_long, a safety code, or null.
create or replace function private.measurement_text_error(p_text text, p_max integer, p_domains text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_text is null then null
    when pg_catalog.char_length(p_text) > p_max then 'too_long'
    else private.text_safety_error(p_text, p_domains) ->> 'code'
  end
$$;

create or replace function private.measurement_id_ok(p_id text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_id ~ '^[A-Za-z0-9_-]{1,64}$'
$$;

create or replace function private.measurement_date_ok(p_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_at >= '2000-01-01T00:00:00Z'::timestamptz and p_at <= now() + interval '1 day'
$$;

-- 10 / 60 / 200 per minute / hour / day (admins 3×). → null (counted) or the window hit.
-- Counts the caller only (auth.uid()); null user (SQL Editor, seeds) → not limited.
create or replace function private.measurement_rate_take()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_mult integer;
  v_b    text;
begin
  if v_uid is null then
    return null;
  end if;
  v_mult := case when public.role_rank((select role from public.profiles where id = v_uid)) >= 1 then 3 else 1 end;
  v_b := 'measure:user:' || v_uid::text;
  if not public.rate_limit_take(v_b, 10 * v_mult, 60, false) then return 'minute'; end if;
  if not public.rate_limit_take(v_b, 60 * v_mult, 3600, false) then return 'hour'; end if;
  if not public.rate_limit_take(v_b, 200 * v_mult, 86400, false) then return 'day'; end if;
  perform public.rate_limit_take(v_b, 2147483647, 60, true);
  return null;
end;
$$;

revoke all on function private.measurement_clean(text, boolean) from public, anon, authenticated;
revoke all on function private.measurement_text_error(text, integer, text[]) from public, anon, authenticated;
revoke all on function private.measurement_id_ok(text) from public, anon, authenticated;
revoke all on function private.measurement_date_ok(timestamptz) from public, anon, authenticated;
revoke all on function private.measurement_rate_take() from public, anon, authenticated;

-- What an existing row breaks under the rules above ({key: code}, '{}' = nothing). Read-only;
-- for supabase/checks/018_existing_violations.sql. Text is checked in its cleaned form, as a new
-- insert would be. Archived text fields are included.
create or replace function private.measurement_problems(m public.measurements)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  errs jsonb := '{}'::jsonb;
  doms text[] := public.comment_domains();
  f    record;
  e    text;
begin
  if not private.measurement_id_ok(m.id) then
    errs := errs || '{"_id":"format"}';
  end if;
  if not private.measurement_date_ok(m.measured_at) then
    errs := errs || '{"_date":"date_range"}';
  end if;
  e := private.measurement_text_error(private.measurement_clean(m.place_label, true), 120, doms);
  if e is not null then
    errs := errs || jsonb_build_object('_place', e);
  end if;
  for f in
    select cf.key, cf.text_long from public.campaign_fields cf
    where cf.campaign_id = m.observation_id and cf.type = 'text'
      and jsonb_typeof(m.field_values -> cf.key) = 'string'
  loop
    e := private.measurement_text_error(private.measurement_clean(m.field_values ->> f.key, false),
                                        case when f.text_long then 2000 else 200 end, doms);
    if e is not null then
      errs := errs || jsonb_build_object(f.key, e);
    end if;
  end loop;
  return errs;
end;
$$;

revoke all on function private.measurement_problems(public.measurements) from public, anon, authenticated;

-- =====================================================================
-- 3. INSERT: validation (016 + text cleaning / safety, _place, _date, _id) + rate limit
-- =====================================================================
-- Same as 016 except: SECURITY DEFINER (to reach the private helpers; the publication check
-- below was always explicit), text values cleaned and checked, the three built-in columns,
-- and the rate limit after everything else passed.

create or replace function public.measurements_validate_values()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur_version integer;
  cur_publication text;
  errs  jsonb := '{}'::jsonb;
  vals  jsonb;
  f     record;
  v     jsonb;
  k     text;
  s     text;
  n     numeric;
  e     text;
  item  jsonb;
  seen  text[];
  max_len integer;
  photos text[] := '{}';
  doms  text[];
  doms_loaded boolean := false;
  win   text;
begin
  select form_version, publication into cur_version, cur_publication
  from public.campaigns where id = new.observation_id;
  if not found then
    raise exception 'unknown campaign "%"', new.observation_id;
  end if;
  if cur_publication <> 'published' then
    raise exception using message = 'lab_not_published', errcode = '22023';
  end if;

  vals := coalesce(new.field_values, '{}'::jsonb);
  if jsonb_typeof(vals) <> 'object' then
    raise exception using message = 'invalid_values', detail = '{"_":"type"}', errcode = '22023';
  end if;
  vals := jsonb_strip_nulls(vals);

  -- Built-in columns (018).
  if new.id is not null and not private.measurement_id_ok(new.id) then
    errs := errs || '{"_id":"format"}';
  end if;
  if new.measured_at is not null and not private.measurement_date_ok(new.measured_at) then
    errs := errs || '{"_date":"date_range"}';
  end if;
  new.place_label := private.measurement_clean(new.place_label, true);
  if new.place_label is not null then
    doms := public.comment_domains();
    doms_loaded := true;
    e := private.measurement_text_error(new.place_label, 120, doms);
    if e is not null then
      errs := errs || jsonb_build_object('_place', e);
    end if;
  end if;

  -- Keys must be active (not archived) fields of this campaign.
  for k in select jsonb_object_keys(vals) loop
    if not exists (select 1 from public.campaign_fields
                   where campaign_id = new.observation_id and key = k and not archived) then
      errs := errs || jsonb_build_object(k, 'unknown_field');
    end if;
  end loop;

  for f in
    select * from public.campaign_fields
    where campaign_id = new.observation_id and not archived
  loop
    v := vals -> f.key;
    e := null;

    -- Text is stored cleaned (018); cleaning may leave it empty.
    if f.type = 'text' and v is not null and jsonb_typeof(v) = 'string' then
      s := private.measurement_clean(v #>> '{}', false);
      if s is null then
        vals := vals - f.key;
        v := null;
      else
        v := to_jsonb(s);
        vals := jsonb_set(vals, array[f.key], v);
      end if;
    end if;

    -- Empty text / empty list = not filled.
    if v is not null
       and ((jsonb_typeof(v) = 'string' and length(trim(v #>> '{}')) = 0)
            or (jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 0)) then
      vals := vals - f.key;
      v := null;
    end if;

    if v is null then
      if f.required then
        errs := errs || jsonb_build_object(f.key, 'required');
      end if;
      continue;
    end if;

    case f.type
      when 'number' then
        if jsonb_typeof(v) <> 'number' then
          e := 'type';
        else
          n := (v #>> '{}')::numeric;
          if f.min_value is not null and n < f.min_value then e := 'min';
          elsif f.max_value is not null and n > f.max_value then e := 'max';
          elsif n <> round(n, f.decimals) then e := 'decimals';
          end if;
        end if;

      when 'text' then
        max_len := case when f.text_long then 2000 else 200 end;
        if jsonb_typeof(v) <> 'string' then
          e := 'type';
        else
          if not doms_loaded then
            doms := public.comment_domains();
            doms_loaded := true;
          end if;
          e := private.measurement_text_error(v #>> '{}', max_len, doms);
        end if;

      when 'boolean' then
        if jsonb_typeof(v) <> 'boolean' then e := 'type'; end if;

      when 'choice' then
        if jsonb_typeof(v) <> 'string' then
          e := 'type';
        elsif not exists (select 1 from public.campaign_field_options o
                          where o.campaign_id = f.campaign_id and o.field_key = f.key
                            and o.key = v #>> '{}' and not o.archived) then
          e := 'option';
        end if;

      when 'multi_choice' then
        if jsonb_typeof(v) <> 'array' then
          e := 'type';
        else
          seen := '{}';
          for item in select * from jsonb_array_elements(v) loop
            if jsonb_typeof(item) <> 'string' then e := 'type'; exit; end if;
            s := item #>> '{}';
            if s = any (seen) then e := 'duplicate'; exit; end if;
            seen := seen || s;
            if not exists (select 1 from public.campaign_field_options o
                           where o.campaign_id = f.campaign_id and o.field_key = f.key
                             and o.key = s and not o.archived) then
              e := 'option'; exit;
            end if;
          end loop;
        end if;

      when 'datetime' then
        if jsonb_typeof(v) <> 'string' then
          e := 'type';
        else
          s := v #>> '{}';
          -- ISO only (rejects words like 'now' that Postgres would also accept).
          if s !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then
            e := 'type';
          else
            begin
              perform s::timestamptz;
            exception when others then
              e := 'type';
            end;
          end if;
        end if;

      when 'photo' then
        -- true: the old frontend (no file). A string: a file in the measurement-photos bucket,
        -- uploaded by this user and not used by any measurement yet (016).
        if v = 'true'::jsonb then
          null;
        elsif jsonb_typeof(v) <> 'string' then
          e := 'type';
        else
          s := v #>> '{}';
          if s = any (photos) then
            e := 'photo_taken';
          else
            e := public.photo_path_error(s, new.user_id);
            photos := photos || s;
          end if;
        end if;

      else
        e := 'type';
    end case;

    if e is not null then
      errs := errs || jsonb_build_object(f.key, e);
    end if;
  end loop;

  if errs <> '{}'::jsonb then
    raise exception using
      message = 'invalid_values',
      detail  = errs::text,
      hint    = 'field_values do not match the campaign''s current field definitions',
      errcode = '22023';
  end if;

  -- Rate limit (018): only rows that are valid otherwise. The count rolls back with the insert.
  win := private.measurement_rate_take();
  if win is not null then
    raise exception using message = 'rate_limited', detail = win, errcode = '22023';
  end if;

  new.field_values := vals;
  new.form_version := cur_version;
  return new;
end;
$$;

revoke all on function public.measurements_validate_values() from public, anon, authenticated;

drop trigger if exists measurements_validate_values on public.measurements;
create trigger measurements_validate_values
  before insert on public.measurements
  for each row execute function public.measurements_validate_values();

-- =====================================================================
-- 4. UPDATE: only what changed
-- =====================================================================
-- Nobody updates measurements through the API (no grant); updates come from the security-definer
-- functions (photo removal, account deletion) and the SQL Editor. A changed id / place name /
-- date / text value must follow the rules; untouched old values are never re-checked.

create or replace function public.measurements_check_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  errs jsonb := '{}'::jsonb;
  doms text[] := public.comment_domains();
  f    record;
  s    text;
  e    text;
begin
  if new.id is distinct from old.id and not private.measurement_id_ok(new.id) then
    errs := errs || '{"_id":"format"}';
  end if;
  if new.measured_at is distinct from old.measured_at and not private.measurement_date_ok(new.measured_at) then
    errs := errs || '{"_date":"date_range"}';
  end if;
  if new.place_label is distinct from old.place_label then
    new.place_label := private.measurement_clean(new.place_label, true);
    e := private.measurement_text_error(new.place_label, 120, doms);
    if e is not null then
      errs := errs || jsonb_build_object('_place', e);
    end if;
  end if;
  if new.field_values is distinct from old.field_values then
    for f in
      select cf.key, cf.text_long from public.campaign_fields cf
      where cf.campaign_id = new.observation_id and cf.type = 'text'
        and jsonb_typeof(new.field_values -> cf.key) = 'string'
        and (new.field_values -> cf.key) is distinct from (old.field_values -> cf.key)
    loop
      s := private.measurement_clean(new.field_values ->> f.key, false);
      new.field_values := case when s is null then new.field_values - f.key
                               else jsonb_set(new.field_values, array[f.key], to_jsonb(s)) end;
      e := private.measurement_text_error(s, case when f.text_long then 2000 else 200 end, doms);
      if e is not null then
        errs := errs || jsonb_build_object(f.key, e);
      end if;
    end loop;
  end if;
  if errs <> '{}'::jsonb then
    raise exception using message = 'invalid_values', detail = errs::text, errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.measurements_check_update() from public, anon, authenticated;

drop trigger if exists measurements_check_update on public.measurements;
create trigger measurements_check_update
  before update of id, place_label, measured_at, field_values on public.measurements
  for each row execute function public.measurements_check_update();

-- =====================================================================
-- 5. Account deletion: also the measurement rate-limit rows (017 + measure:user:)
-- =====================================================================

create or replace function public.account_delete_finish(p_user uuid, p_anon text, p_delete_measurements boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_meas  integer;
  n_audit integer := 0;
  n_files integer;
begin
  if exists (select 1 from public.profiles where id = p_user) then
    raise exception 'not_deleted';
  end if;
  if p_anon is null or p_anon !~ '^[0-9a-f-]{36}$' then
    raise exception 'bad_request';
  end if;

  n_meas := public.account_delete_measurements(p_user, p_anon, coalesce(p_delete_measurements, false));

  insert into private.storage_trash (bucket_id, path, owner_id)
  select o.bucket_id, o.name, p_user from storage.objects o where o.owner_id = p_user::text
  on conflict (bucket_id, path) do nothing;
  get diagnostics n_files = row_count;

  delete from private.rate_limit_hits
  where bucket in ('delete:user:' || p_user::text, 'comment:user:' || p_user::text,
                   'report:user:' || p_user::text, 'photo_report:user:' || p_user::text,
                   'avatar_report:user:' || p_user::text, 'measure:user:' || p_user::text);

  -- Supabase Auth's login log (IP, email). The "user deleted" row names the user in traits.
  begin
    delete from auth.audit_log_entries
    where payload ->> 'actor_id' = p_user::text
       or payload -> 'traits' ->> 'user_id' = p_user::text;
    get diagnostics n_audit = row_count;
  exception when insufficient_privilege then
    raise warning 'account_delete_finish: no access to auth.audit_log_entries (the 30-day cleanup removes them)';
  end;

  return jsonb_build_object('measurements', n_meas, 'audit_log', n_audit, 'files_queued', n_files);
end;
$$;

revoke all on function public.account_delete_finish(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.account_delete_finish(uuid, text, boolean) to service_role;

notify pgrst, 'reload schema';
