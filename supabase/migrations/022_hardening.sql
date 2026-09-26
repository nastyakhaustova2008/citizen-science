-- 022_hardening.sql
-- Final hardening before the pilot (audit Medium / Low findings, part A — database).
--
-- Run once in the Supabase SQL Editor, AFTER:
--   1. the Edge Function `account` of this change is deployed (it sets the sign-up flag that
--      handle_new_user now requires, and answers username checks for the browser), and
--   2. the frontend of this change is deployed to production (it asks the Edge Function, not
--      username_available, whether a name is free).
-- Old frontend after 022: the "name is free / taken" hint while typing disappears (sign-up itself
-- still works and still says "taken"). Old Edge Function after 022: sign-up still works, but the
-- new account has no username and the app asks for one (like after Google sign-in).
-- Before running: supabase/checks/022_signup_cleanup_preview.sql (read-only) — if it lists any
-- real account, stop.
-- Safe to re-run. Nothing here deletes data when it runs; the daily cleanup (pg_cron, 008) gets
-- two more steps (see 11). Rollback (only if needed): supabase/rollback/022_hardening_rollback.sql.
--
--  1. Trigger functions: not callable through the API (EXECUTE revoked; triggers still fire).
--  2. Indexes on the foreign keys the Performance Advisor lists (checked against pg_catalog).
--  3. Photo fields: the legacy value true (no file, 016) is refused like any other wrong type.
--  4. M9  handle_new_user takes the username only from accounts the Edge Function created
--         (app_metadata.mitzpe_signup = true, which nobody can set through the public sign-up
--         API); account_signup_username is the Edge Function's safety net.
--  5. H2-residual  username_available: Edge Function only (it rate-limits per IP).
--  6. M4  reports: only reporters whose account is older than 48 hours count towards the
--         automatic hiding (still 3); one reporter → one author: at most 5 reports per 24 h
--         (comments, photos and profile pictures together).
--  7. M6  a comment that is hidden or has open reports can't be deleted or edited by its author
--         (comment_under_review) — the moderators keep the evidence.
--  8. L1  profile pictures: main admins moderate only people below them; the owner anyone.
--  9. L2  upload limits (30 photos / 10 profile pictures per 24 h) count uploads, not the files
--         that are still there. Kill switch private.settings.upload_limit_by_hits (see 9).
--         upload_quota(bucket) tells the browser WHY an upload was refused ('storage_full' …).
-- 10. L4  lab revisions: the lab row is locked before the revision (no deadlock with lab_save).
-- 11. Daily privacy cleanup: + sign-in sessions not used for 30 days (M10.5), + accounts that
--         never confirmed an email, have no username, no data and are older than 7 days (M9).
-- 12. L5  RLS on private.settings and private.storage_trash (defence in depth; no policies —
--         only the owner's security-definer functions touch them).
-- 13. M10.1  admins read the admin profile (full name, workplace) only of current admins; a
--         demoted admin's profile is shown only in the credits / review history of the labs they
--         created or approved.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.settings (
  key    text primary key,
  value  text not null
);
revoke all on private.settings from public, anon, authenticated;
insert into private.settings (key, value) values ('upload_limit_by_hits', 'true')
on conflict (key) do nothing;

-- 'true' / 'false' switch in private.settings; missing → p_default.
create or replace function private.setting_on(p_key text, p_default boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value = 'true' from private.settings where key = p_key), p_default)
$$;
revoke all on function private.setting_on(text, boolean) from public, anon, authenticated;

-- =====================================================================
-- 1. Trigger functions are not API functions
-- =====================================================================
-- Triggers run without EXECUTE on their function, so this changes nothing for sign-up, the role
-- log or account deletion. (is_admin, my_role, *_can_read, *_can_delete, *_upload_ok are used by
-- policies and stay executable.)
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.profiles_log_sql_change() from public, anon, authenticated;
revoke execute on function public.profiles_scrub_log() from public, anon, authenticated;

-- =====================================================================
-- 2. Foreign-key indexes (deletes of a profile / event no longer scan these tables)
-- =====================================================================
-- The list = foreign keys in public/private whose leading column has no index (pg_catalog,
-- supabase/checks/022_unindexed_fks.sql). No index is dropped.
create index if not exists allowed_link_domains_added_by_idx on public.allowed_link_domains (added_by);
create index if not exists avatar_events_actor_id_idx on public.avatar_events (actor_id);
create index if not exists avatars_confirmed_by_idx on public.avatars (confirmed_by);
create index if not exists comment_events_actor_id_idx on public.comment_events (actor_id);
create index if not exists comment_events_author_id_idx on public.comment_events (author_id);
create index if not exists link_domain_events_actor_id_idx on public.link_domain_events (actor_id);
create index if not exists link_domain_proposals_decided_by_idx on public.link_domain_proposals (decided_by);
create index if not exists link_domain_proposals_proposed_by_idx on public.link_domain_proposals (proposed_by);
create index if not exists photo_events_actor_id_idx on public.photo_events (actor_id);
create index if not exists photo_events_author_id_idx on public.photo_events (author_id);
create index if not exists role_events_cause_id_idx on public.role_events (cause_id);

-- =====================================================================
-- 3. Photo fields: no more legacy true
-- =====================================================================
-- The 018 function, only the photo branch changes. Existing rows are not touched (the update
-- trigger doesn't look at photo values); supabase/checks/022_legacy_photo_true.sql counts them.

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
        -- A file in the measurement-photos bucket, uploaded by this user and not used by any
        -- measurement yet (016). The old value true (no file) is no longer accepted (022).
        if jsonb_typeof(v) <> 'string' then
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

-- =====================================================================
-- 4. M9 — usernames only from accounts the Edge Function created
-- =====================================================================
-- Supabase's own sign-up API (on, because Google sign-up needs it) lets anyone put
-- {"mitzpe_username": "..."} into user_metadata — before 022 that reserved the name even for an
-- account that never confirmed its email. app_metadata can only be set with the secret key, so the
-- Edge Function marks its accounts with app_metadata.mitzpe_signup = true. Without the mark the
-- profile starts without a username; a real user then chooses one (ChooseUsername), exactly like
-- after Google sign-in.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := case when (new.raw_app_meta_data ->> 'mitzpe_signup') = 'true'
                      then public.username_normalize(new.raw_user_meta_data ->> 'mitzpe_username') end;
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
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Edge Function only (secret key), right after it created the account: gives the account its
-- username if the trigger could not (e.g. Supabase Auth wrote app_metadata after the insert).
-- 'ok' (set, or already this name) | 'taken' (someone else has it — the function then deletes the
-- account it just created) | 'already_set' | 'invalid' | 'not_found' | 'not_allowed'.
-- 'taken' only for an account that is minutes old, carries the Edge Function's mark and this very
-- name, has no username and nothing attached (no measurement, comment, picture or file) — so the
-- caller can never be told to delete anything else.
create or replace function public.account_signup_username(p_user uuid, p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := public.username_normalize(p_username);
  v_user auth.users;
  v_cur  text;
begin
  if v_name is null or public.username_error(v_name) is not null then
    return 'invalid';
  end if;
  select * into v_user from auth.users where id = p_user;
  if not found then
    return 'not_found';
  end if;
  select username into v_cur from public.profiles where id = p_user for update;
  if not found then
    return 'not_found';
  end if;
  if v_cur is not null then
    return case when public.username_key(v_cur) = public.username_key(v_name) then 'ok' else 'already_set' end;
  end if;
  if (v_user.raw_app_meta_data ->> 'mitzpe_signup') is distinct from 'true'
     or public.username_normalize(v_user.raw_user_meta_data ->> 'mitzpe_username') is distinct from v_name
     or v_user.created_at < now() - interval '10 minutes' then
    return 'not_allowed';
  end if;
  begin
    update public.profiles set username = v_name where id = p_user;
    return 'ok';
  exception when unique_violation then
    if exists (select 1 from public.measurements where user_id = p_user::text)
       or exists (select 1 from public.comments where author_id = p_user)
       or exists (select 1 from public.avatars where user_id = p_user)
       or exists (select 1 from storage.objects where owner_id = p_user::text) then
      return 'not_allowed';
    end if;
    return 'taken';
  end;
end;
$$;
revoke all on function public.account_signup_username(uuid, text) from public, anon, authenticated;
grant execute on function public.account_signup_username(uuid, text) to service_role;

-- =====================================================================
-- 5. username_available: through the Edge Function only
-- =====================================================================
-- The browser asks the Edge Function (action username-check), which limits calls per IP, so
-- nobody can test thousands of names. The function itself uses the secret key.
revoke execute on function public.username_available(text) from public, anon, authenticated;
grant execute on function public.username_available(text) to service_role;

-- =====================================================================
-- 6. M4 — who counts as a reporter
-- =====================================================================
-- Automatic hiding (3 open reports) counts only reporters whose account is older than 48 hours:
-- three fresh accounts can no longer hide someone's comment, photo or picture. Their reports are
-- still stored and shown to the moderators. And one person can report the same author at most
-- 5 times in 24 hours (all three kinds together).

create or replace function private.report_counts(p_reporter uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = p_reporter and created_at <= now() - interval '48 hours')
$$;
revoke all on function private.report_counts(uuid) from public, anon, authenticated;

-- Raises rate_limited when this reporter reported this author 5 times in the last 24 h.
create or replace function private.report_pair_take(p_reporter uuid, p_author uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_author is null then
    return;
  end if;
  if not public.rate_limit_take('report_pair:' || p_reporter::text || ':' || p_author::text, 5, 86400) then
    raise exception 'rate_limited';
  end if;
end;
$$;
revoke all on function private.report_pair_take(uuid, uuid) from public, anon, authenticated;

create or replace function public.comment_report(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.comment_me();
  v_row  public.comments;
  v_open integer;
begin
  if coalesce(p_reason, '') not in ('bullying', 'personal_info', 'spam', 'other') then
    raise exception 'bad_request';
  end if;
  select * into v_row from public.comments where id = p_id for update;
  if not found or v_row.hidden_at is not null then
    raise exception 'not_found';
  end if;
  if v_row.author_id = v_me then
    raise exception 'not_allowed';
  end if;
  if exists (select 1 from public.comment_reports where comment_id = p_id and reporter_id = v_me) then
    raise exception 'already_reported';
  end if;
  if not public.rate_limit_take('report:user:' || v_me::text, 20, 86400) then
    raise exception 'rate_limited';
  end if;
  perform private.report_pair_take(v_me, v_row.author_id);
  insert into public.comment_reports (comment_id, reporter_id, reason) values (p_id, v_me, p_reason);

  select count(*) into v_open from public.comment_reports r
  where r.comment_id = p_id and r.resolved_at is null and private.report_counts(r.reporter_id);
  if v_open >= 3 then
    update public.comments set hidden_at = now(), hidden_reason = 'reports' where id = p_id;
    insert into public.comment_events (action, comment_id, measurement_id, campaign_id, kind, actor_id, author_id, reports)
    values ('auto_hide', v_row.id, v_row.measurement_id, v_row.campaign_id, v_row.kind, null, v_row.author_id, v_open);
    return jsonb_build_object('hidden', true);
  end if;
  return jsonb_build_object('hidden', false);
end;
$$;

create or replace function public.photo_report(p_path text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.comment_me();
  v_row  public.measurement_photos;
  v_open integer;
begin
  if coalesce(p_reason, '') not in ('bullying', 'personal_info', 'spam', 'other') then
    raise exception 'bad_request';
  end if;
  select * into v_row from public.measurement_photos where path = p_path for update;
  if not found or v_row.status <> 'approved' then
    raise exception 'not_found';
  end if;
  if v_row.owner_id = v_me then
    raise exception 'not_allowed';
  end if;
  if exists (select 1 from public.photo_reports where path = p_path and reporter_id = v_me) then
    raise exception 'already_reported';
  end if;
  if not public.rate_limit_take('photo_report:user:' || v_me::text, 20, 86400) then
    raise exception 'rate_limited';
  end if;
  perform private.report_pair_take(v_me, v_row.owner_id);
  insert into public.photo_reports (path, reporter_id, reason) values (p_path, v_me, p_reason);

  select count(*) into v_open from public.photo_reports r
  where r.path = p_path and r.resolved_at is null and private.report_counts(r.reporter_id);
  if v_open >= 3 then
    update public.measurement_photos
    set status = 'hidden', hidden_at = now(), hidden_reason = 'reports'
    where path = p_path;
    insert into public.photo_events (action, path, measurement_id, campaign_id, actor_id, author_id, reports)
    values ('auto_hide', v_row.path, v_row.measurement_id, v_row.campaign_id, null, v_row.owner_id, v_open);
    return jsonb_build_object('hidden', true);
  end if;
  return jsonb_build_object('hidden', false);
end;
$$;

create or replace function public.avatar_report(p_user uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.comment_me();
  v_row  public.avatars;
  v_open integer;
begin
  if coalesce(p_reason, '') not in ('bullying', 'personal_info', 'spam', 'other') then
    raise exception 'bad_request';
  end if;
  select * into v_row from public.avatars where user_id = p_user for update;
  if not found or v_row.status not in ('active', 'confirmed') then
    raise exception 'not_found';
  end if;
  if v_row.user_id = v_me then
    raise exception 'not_allowed';
  end if;
  if exists (select 1 from public.avatar_reports where path = v_row.path and reporter_id = v_me) then
    raise exception 'already_reported';
  end if;
  if not public.rate_limit_take('avatar_report:user:' || v_me::text, 20, 86400) then
    raise exception 'rate_limited';
  end if;
  perform private.report_pair_take(v_me, v_row.user_id);
  insert into public.avatar_reports (path, reporter_id, reason) values (v_row.path, v_me, p_reason);

  select count(*) into v_open from public.avatar_reports r
  where r.path = v_row.path and r.resolved_at is null and private.report_counts(r.reporter_id);
  if v_open >= 3 and v_row.kind = 'student' then
    update public.avatars set status = 'hidden', hidden_at = now(), hidden_reason = 'reports'
    where user_id = p_user;
    insert into public.avatar_events (action, user_id, actor_id, kind, reports)
    values ('auto_hide', p_user, null, v_row.kind, v_open);
    return jsonb_build_object('hidden', true);
  end if;
  return jsonb_build_object('hidden', false);
end;
$$;

-- =====================================================================
-- 7. M6 — reported / hidden comments stay for the moderators
-- =====================================================================

-- Hidden, or someone's report is still open.
create or replace function private.comment_under_review(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.comments where id = p_id and hidden_at is not null)
      or exists (select 1 from public.comment_reports where comment_id = p_id and resolved_at is null)
$$;
revoke all on function private.comment_under_review(uuid) from public, anon, authenticated;

create or replace function public.comment_delete(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author uuid;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  select author_id into v_author from public.comments where id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_author <> auth.uid() then
    raise exception 'not_allowed';
  end if;
  if private.comment_under_review(p_id) then
    raise exception 'comment_under_review';
  end if;
  delete from public.comments where id = p_id;
  return true;
end;
$$;

create or replace function public.comment_edit(p_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.comment_me();
  v_body text := public.comment_clean(p_body);
  v_row  public.comments;
begin
  select * into v_row from public.comments where id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_row.author_id <> v_me then
    raise exception 'not_allowed';
  end if;
  if v_row.hidden_at is not null then
    raise exception 'comment_hidden';
  end if;
  if private.comment_under_review(p_id) then
    raise exception 'comment_under_review';
  end if;
  if v_row.created_at <= now() - interval '15 minutes' then
    raise exception 'edit_window_closed';
  end if;
  if v_body is distinct from v_row.body then
    perform public.comment_assert_body(v_body);
    if not public.comment_rate_take(v_me) then
      raise exception 'rate_limited';
    end if;
    update public.comments set body = v_body, edited_at = now() where id = p_id
    returning * into v_row;
  end if;
  return public.comment_json(v_row, public.comment_can_moderate(v_row.campaign_id));
end;
$$;

-- =====================================================================
-- 8. L1 — profile-picture moderation only downwards
-- =====================================================================

create or replace function public.avatar_moderate(p_user uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.avatars;
  v_reports integer;
  v_action  text;
  v_target  text;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  if coalesce(p_action, '') not in ('hide', 'unhide', 'delete') then
    raise exception 'bad_request';
  end if;
  if not public.avatar_is_moderator() then
    raise exception 'not_allowed';
  end if;
  select * into v_row from public.avatars where user_id = p_user for update;
  if not found then
    raise exception 'not_found';
  end if;
  if p_user = auth.uid() then
    raise exception 'not_allowed';
  end if;
  -- 022 (L1): only people below me; the owner may act on anyone.
  select role into v_target from public.profiles where id = p_user;
  if public.my_role() <> 'owner' and public.role_rank(v_target) >= public.role_rank(public.my_role()) then
    raise exception 'not_allowed';
  end if;
  select count(*) into v_reports from public.avatar_reports where path = v_row.path and resolved_at is null;

  if p_action = 'delete' then
    delete from public.avatars where user_id = p_user;
    insert into public.avatar_events (action, user_id, actor_id, kind, reports)
    values ('delete', p_user, auth.uid(), v_row.kind, v_reports);
    return null;
  end if;

  if p_action = 'hide' then
    if v_row.status = 'pending' then
      raise exception 'bad_state';
    end if;
    v_action := case when v_row.hidden_reason = 'moderator' then null else 'hide' end;
    update public.avatars
    set status = 'hidden', hidden_at = coalesce(hidden_at, now()), hidden_reason = 'moderator'
    where user_id = p_user returning * into v_row;
  else
    if v_row.status = 'pending' then
      raise exception 'bad_state';
    end if;
    v_action := case when v_row.status = 'hidden' then 'unhide' when v_reports > 0 then 'dismiss' end;
    -- An admin photo shown again is a confirmed one (only confirmed photos can be hidden).
    update public.avatars
    set status = case when kind = 'student' then 'active' else 'confirmed' end,
        hidden_at = null, hidden_reason = null
    where user_id = p_user returning * into v_row;
  end if;
  update public.avatar_reports set resolved_at = now() where path = v_row.path and resolved_at is null;
  if v_action is not null then
    insert into public.avatar_events (action, user_id, actor_id, kind, reports)
    values (v_action, p_user, auth.uid(), v_row.kind, v_reports);
  end if;
  return public.avatar_json(v_row, true);
end;
$$;

-- =====================================================================
-- 9. L2 — upload limits count uploads
-- =====================================================================
-- Before: "fewer than 30 (10) of my files uploaded in the last 24 h are still there" — deleting
-- files made room for more. Now every upload is recorded in private.rate_limit_hits
-- (photo_upload:user:<id> / avatar_upload:user:<id>, kept one day like the other limits) by the
-- upload policy itself; a failed upload rolls its record back with it.
-- Kill switch (owner, SQL Editor), if uploads break in production:
--   update private.settings set value = 'false' where key = 'upload_limit_by_hits';
-- → the policies use the old check (*_upload_ok) again, nothing is written during an upload.

-- 'ok' | 'not_allowed' (not logged in / no username / bad name) | 'rate_limited' | 'storage_full'.
-- p_record: count this upload (only from the upload policy).
create or replace function private.upload_check(p_bucket text, p_name text, p_record boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_max   integer := case p_bucket when 'measurement-photos' then 30 when 'avatars' then 10 end;
  v_key   text := case p_bucket when 'measurement-photos' then 'photo_upload' when 'avatars' then 'avatar_upload' end;
begin
  if v_uid is null or v_max is null
     or not exists (select 1 from public.profiles p where p.id = v_uid and p.username is not null) then
    return 'not_allowed';
  end if;
  if p_name is not null
     and p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$' then
    return 'not_allowed';
  end if;
  if public.storage_total_bytes() >= 900::bigint * 1024 * 1024 then
    return 'storage_full';
  end if;
  if not private.setting_on('upload_limit_by_hits', true) then
    -- Old rule (016 / 017): files of mine from the last 24 h that still exist.
    if (select count(*) from storage.objects o
        where o.bucket_id = p_bucket and o.owner_id = v_uid::text
          and o.created_at > now() - interval '24 hours') >= v_max then
      return 'rate_limited';
    end if;
    return 'ok';
  end if;
  if not public.rate_limit_take(v_key || ':user:' || v_uid::text, v_max, 86400, p_record) then
    return 'rate_limited';
  end if;
  return 'ok';
end;
$$;
revoke all on function private.upload_check(text, text, boolean) from public, anon, authenticated;

-- Used by the upload policies (volatile: they record the upload).
create or replace function public.photo_upload_take(p_name text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select private.upload_check('measurement-photos', p_name,
                              private.setting_on('upload_limit_by_hits', true)) = 'ok'
$$;
create or replace function public.avatar_upload_take(p_name text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select private.upload_check('avatars', p_name, private.setting_on('upload_limit_by_hits', true)) = 'ok'
$$;
revoke all on function public.photo_upload_take(text) from public, anon;
revoke all on function public.avatar_upload_take(text) from public, anon;
grant execute on function public.photo_upload_take(text) to authenticated;
grant execute on function public.avatar_upload_take(text) to authenticated;

-- For the browser after a refused upload: why? Nothing is recorded.
create or replace function public.upload_quota(p_bucket text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_bucket in ('measurement-photos', 'avatars')
              then private.upload_check(p_bucket, null, false) else 'not_allowed' end
$$;
revoke all on function public.upload_quota(text) from public, anon;
grant execute on function public.upload_quota(text) to authenticated;

drop policy if exists "measurement photos: upload" on storage.objects;
create policy "measurement photos: upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'measurement-photos' and public.photo_upload_take(name));

drop policy if exists "avatars: upload" on storage.objects;
create policy "avatars: upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.avatar_upload_take(name));

-- =====================================================================
-- 10. L4 — lock order for lab revisions
-- =====================================================================
-- lab_save / lab_revision_save lock the lab (campaigns row) first. lab_revision_review and
-- lab_revision_open (submit / withdraw / discard) locked the revision first, and the 3rd approval
-- then updates the lab — two admins at the same moment could deadlock. Now: lab, then revision.

create or replace function public.lab_revision_open(p_me public.profiles, p_rev bigint, p_edit_no integer)
returns public.lab_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.lab_revisions;
  c public.campaigns;
  v_campaign text;
begin
  -- 022 (L4): the lab first, then the revision (same order everywhere).
  select campaign_id into v_campaign from public.lab_revisions where id = p_rev;
  perform 1 from public.campaigns where id = v_campaign for update;
  select * into v from public.lab_revisions where id = p_rev for update;
  if not found then
    raise exception 'not_found';
  end if;
  select * into c from public.campaigns where id = v.campaign_id;
  if not public.lab_may_edit(p_me.role, p_me.id, c.created_by) then
    raise exception 'not_allowed';
  end if;
  if v.status not in ('draft', 'in_review') then
    raise exception 'bad_state';
  end if;
  if p_edit_no is not null and p_edit_no is distinct from v.edit_no then
    raise exception 'edited_elsewhere';
  end if;
  return v;
end;
$$;

create or replace function public.lab_revision_review(p_rev bigint, p_round integer, p_verdict text, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      public.profiles := public.lab_begin();
  v         public.lab_revisions;
  v_block   text;
  v_comment text := public.lab_block(p_comment);
  v_n       integer;
  v_campaign text;
begin
  if p_verdict is null or p_verdict not in ('approve', 'changes') then
    raise exception 'bad_state' using detail = 'verdict must be approve or changes';
  end if;
  -- 022 (L4): lock the lab first, then the revision — the same order as lab_save /
  -- lab_revision_save, so an approval that applies the revision can't deadlock with a save.
  select campaign_id into v_campaign from public.lab_revisions where id = p_rev;
  perform 1 from public.campaigns where id = v_campaign for update;
  select * into v from public.lab_revisions where id = p_rev for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v.status <> 'in_review' then
    raise exception 'bad_state';
  end if;
  if p_round is distinct from v.round then
    raise exception 'round_changed';
  end if;
  v_block := public.lab_revision_block(v, v_me.id);
  if v_block is not null then
    raise exception '%', v_block;
  end if;
  if pg_catalog.char_length(v_comment) > 2000 then
    raise exception 'comment_too_long';
  end if;
  if p_verdict = 'changes' and v_comment = '' then
    raise exception 'comment_required';
  end if;

  insert into public.lab_reviews (campaign_id, revision_id, round, reviewer_id, verdict, comment)
  values (v.campaign_id, v.id, v.round, v_me.id, p_verdict, v_comment);

  if p_verdict = 'changes' then
    update public.lab_revisions set status = 'draft', edit_no = edit_no + 1, updated_at = now()
    where id = v.id returning * into v;
    perform public.lab_log_revision(v, v_me.id, 'revision_request_changes', v.round);
    return jsonb_build_object('status', 'draft', 'approvals', 0);
  end if;

  perform public.lab_log_revision(v, v_me.id, 'revision_approve', v.round);
  select count(*) into v_n from public.lab_reviews
  where revision_id = v.id and round = v.round and verdict = 'approve';
  if v_n >= 3 then
    perform public.lab_revision_apply(v.id);
    return jsonb_build_object('status', 'applied', 'approvals', v_n);
  end if;
  return jsonb_build_object('status', 'in_review', 'approvals', v_n);
end;
$$;

-- =====================================================================
-- 11. Daily privacy cleanup (008 → 021 → 022)
-- =====================================================================
-- + sign-in sessions whose refresh token was last used more than 30 days ago (the free plan has
--   no session time-out; the device then has to sign in again);
-- + accounts created through Supabase's public sign-up API that never confirmed an email: no
--   username, no data, older than 7 days (M9). Username and Google accounts are confirmed, so they
--   are never touched. Preview: supabase/checks/022_signup_cleanup_preview.sql.
-- Each step runs on its own: if one fails (e.g. a permission on the auth schema), the others still
-- run and the result says 'error' for it.

create or replace function private.privacy_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  n_audit    integer;
  n_rate     integer;
  n_cron     integer;
  n_tickets  integer;
  n_sessions text;
  n_signups  text;
  n          integer;
begin
  delete from auth.audit_log_entries where created_at < now() - interval '30 days';
  get diagnostics n_audit = row_count;

  delete from private.rate_limit_hits where at < now() - interval '1 day';
  get diagnostics n_rate = row_count;

  delete from cron.job_run_details where end_time < now() - interval '7 days';
  get diagnostics n_cron = row_count;

  delete from private.auth_change_tickets where expires_at < now();
  get diagnostics n_tickets = row_count;

  begin
    delete from auth.sessions s
    where coalesce(s.refreshed_at::timestamptz, s.updated_at::timestamptz, s.created_at::timestamptz)
          < now() - interval '30 days';
    get diagnostics n = row_count;
    n_sessions := n::text;
  exception when others then
    n_sessions := 'error';
    raise warning 'mitzpe privacy_cleanup sessions: %', sqlerrm;
  end;

  begin
    delete from auth.users u
    where u.email_confirmed_at is null
      and u.phone_confirmed_at is null
      and u.created_at < now() - interval '7 days'
      and exists (select 1 from public.profiles p where p.id = u.id and p.username is null)
      and not exists (select 1 from public.measurements m where m.user_id = u.id::text)
      and not exists (select 1 from public.comments c where c.author_id = u.id)
      and not exists (select 1 from public.avatars a where a.user_id = u.id)
      and not exists (select 1 from storage.objects o where o.owner_id = u.id::text);
    get diagnostics n = row_count;
    n_signups := n::text;
  exception when others then
    n_signups := 'error';
    raise warning 'mitzpe privacy_cleanup signups: %', sqlerrm;
  end;

  return jsonb_build_object('audit_log', n_audit, 'rate_limit_hits', n_rate, 'cron_history', n_cron,
                            'change_tickets', n_tickets, 'sessions', n_sessions,
                            'unconfirmed_signups', n_signups);
end;
$$;
revoke all on function private.privacy_cleanup() from public, anon, authenticated;

-- =====================================================================
-- 12. L5 — RLS on the private tables that had none
-- =====================================================================
-- No policies: anon / authenticated have no privileges on schema private anyway; the
-- security-definer functions run as the table owner, which RLS does not restrict.
alter table private.settings enable row level security;
alter table private.storage_trash enable row level security;

-- =====================================================================
-- 13. M10.1 — admin profiles of demoted admins
-- =====================================================================
-- Before: every admin could read every admin_profiles row, also of people who are no longer
-- admins. Now: my own row, or the row of someone who is an admin now. The public credits and the
-- review history (security-definer functions) still show the creators / approvers of a lab.
drop policy if exists "own or admins read admin profiles" on public.admin_profiles;
create policy "own or admins read admin profiles"
  on public.admin_profiles for select to authenticated
  using (user_id = (select auth.uid())
         or ((select public.is_admin())
             and exists (select 1 from public.profiles p
                         where p.id = admin_profiles.user_id and public.role_rank(p.role) >= 1)));
