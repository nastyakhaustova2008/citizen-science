-- 010_lab_editor.sql
-- Roadmap step 5a: lab (campaign) editor for admins — admin profile, "teacher / staff"
-- confirmation when granting admin, draft labs visible only to admins, all lab writes through
-- security-definer RPCs, cosmetic-only edits of published labs, a lab change log.
-- Run once in the Supabase SQL Editor, AFTER 009. Safe to re-run.
--
-- NOT fully backward compatible: admin_grant_admin / owner_make_main_admin get a new required
-- argument (the "teacher or staff member" confirmation), so granting admin from the OLD frontend
-- fails until the new code is deployed. Everything else keeps working for old code (it only
-- reads campaigns; the old `equipment` column is kept in sync). Deploy order: 010 → preview →
-- merge → production deploy (no follow-up migration needed).
--
-- What it does:
--   1. admin_profiles: full name, workplace (school / organization), position — for admins.
--      Visible to all admins; public only on labs (credits come in 5b). Kept when the admin
--      role is revoked (labs they created / approved keep showing it); deleted with the account.
--   2. Granting admin requires p_confirm_staff = true ("teacher or staff member"), logged in
--      role_events.confirmed_staff.
--   3. campaigns: publication (draft | in_review | published; old labs → published), edit_no
--      (optimistic locking), equipment_he/en/ru (old equipment → he), protocol_he/en/ru.
--      Drafts may be incomplete (titles, center, field labels); published labs may not.
--   4. Drafts / labs in review are visible only to admins (campaigns, fields, options).
--      Measurements only for published labs.
--   5. No direct writes on campaigns / fields / options any more: lab_save, lab_delete.
--      Editing: the lab's author, main admins, the owner. Every lab function requires a complete
--      admin profile (full name + workplace).
--   6. Published labs: only cosmetic changes (texts, labels, help, order, icon, region,
--      difficulty, map, colour preset, status). Structural changes (fields added / archived,
--      required, min / max / decimals, text length, primary field, options added / archived,
--      protocol) are rejected with `structural_change` until step 5c (revisions with review).
--      Enforced by triggers too, so the SQL Editor is covered; an intentional structural change
--      from SQL: run `select set_config('mitzpe.lab_apply', txid_current()::text, true);` first
--      in the same transaction.
--   7. lab_events: lab change log (who, what, when), readable by admins (lab_log).
--
-- Errors (message): not_logged_in, not_allowed, admin_profile_required, not_found,
-- edited_elsewhere, invalid_lab (detail = JSON {path: code}), structural_change (detail = JSON
-- [path]), has_measurements, staff_not_confirmed, invalid_admin_profile (detail = JSON
-- {field: code}), lab_not_published (measurement insert). Codes mirrored in src/lib/labs.js.

-- =====================================================================
-- 1. Admin profile
-- =====================================================================

create table if not exists public.admin_profiles (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  full_name   text not null check (pg_catalog.char_length(full_name) between 2 and 80),
  workplace   text not null check (pg_catalog.char_length(workplace) between 2 and 120),
  position    text check (position is null or pg_catalog.char_length(position) between 1 and 80),
  updated_at  timestamptz not null default now()
);

alter table public.admin_profiles enable row level security;
revoke all on public.admin_profiles from anon, authenticated;
grant select (user_id, full_name, workplace, position, updated_at) on public.admin_profiles to authenticated;

-- Own row, or any row for admins (reviewers see who they work with). Public credits on labs
-- come through a function in 5b, not through this table.
drop policy if exists "own or admins read admin profiles" on public.admin_profiles;
create policy "own or admins read admin profiles"
  on public.admin_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- One line of text: NFC, trimmed, runs of whitespace → one space; '' → null.
create or replace function public.lab_line(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(pg_catalog.btrim(pg_catalog.regexp_replace(
           pg_catalog.normalize(coalesce(p, ''), 'NFC'), '\s+', ' ', 'g')), '')
$$;

-- Multi-line text: NFC, CRLF → LF, trimmed ('' stays '').
create or replace function public.lab_block(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.btrim(pg_catalog.replace(pg_catalog.normalize(coalesce(p, ''), 'NFC'), E'\r\n', E'\n'))
$$;

create or replace function public.admin_profile_complete(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admin_profiles where user_id = p_user)
$$;

revoke all on function public.admin_profile_complete(uuid) from public, anon, authenticated;

-- Save my admin profile (admins only). Returns the stored row.
-- Errors: not_logged_in, not_allowed, invalid_admin_profile (detail {field: required|too_short|too_long}).
create or replace function public.admin_profile_save(p_full_name text, p_workplace text, p_position text)
returns table (full_name text, workplace text, "position" text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name  text := public.lab_line(p_full_name);
  v_work  text := public.lab_line(p_workplace);
  v_pos   text := public.lab_line(p_position);
  errs    jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  if not public.is_admin() then
    raise exception 'not_allowed';
  end if;
  if v_name is null then errs := errs || '{"full_name":"required"}';
  elsif pg_catalog.char_length(v_name) < 2 then errs := errs || '{"full_name":"too_short"}';
  elsif pg_catalog.char_length(v_name) > 80 then errs := errs || '{"full_name":"too_long"}';
  end if;
  if v_work is null then errs := errs || '{"workplace":"required"}';
  elsif pg_catalog.char_length(v_work) < 2 then errs := errs || '{"workplace":"too_short"}';
  elsif pg_catalog.char_length(v_work) > 120 then errs := errs || '{"workplace":"too_long"}';
  end if;
  if v_pos is not null and pg_catalog.char_length(v_pos) > 80 then
    errs := errs || '{"position":"too_long"}';
  end if;
  if errs <> '{}'::jsonb then
    raise exception 'invalid_admin_profile' using detail = errs::text;
  end if;

  insert into public.admin_profiles as a (user_id, full_name, workplace, position, updated_at)
  values (auth.uid(), v_name, v_work, v_pos, now())
  on conflict (user_id) do update
    set full_name = excluded.full_name, workplace = excluded.workplace,
        position = excluded.position, updated_at = now();

  return query
  select a.full_name, a.workplace, a.position, a.updated_at
  from public.admin_profiles a where a.user_id = auth.uid();
end;
$$;

revoke all on function public.admin_profile_save(text, text, text) from public, anon;
grant execute on function public.admin_profile_save(text, text, text) to authenticated;

-- =====================================================================
-- 2. "Teacher or staff member" confirmation when granting admin
-- =====================================================================

alter table public.role_events add column if not exists confirmed_staff boolean;

drop function if exists public.admin_grant_admin(uuid);
drop function if exists public.owner_make_main_admin(uuid);

-- Grant admin to a student (any admin). p_confirm_staff must be true: the granting admin
-- confirms the person is a teacher or staff member (stored in the log).
create or replace function public.admin_grant_admin(p_target uuid, p_confirm_staff boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := public.admin_begin();
  v_t  public.profiles;
begin
  if p_confirm_staff is not true then
    raise exception 'staff_not_confirmed';
  end if;
  select * into v_t from public.profiles where id = p_target for update;
  if not found or v_t.id = v_me.id or v_t.role <> 'student' then
    raise exception 'bad_target';
  end if;
  if v_t.username is null then
    raise exception 'no_username';
  end if;
  update public.profiles
  set role = 'admin', role_granted_by = v_me.id, role_granted_at = now()
  where id = p_target;
  insert into public.role_events (actor_id, target_id, action, old_role, new_role, confirmed_staff)
  values (v_me.id, p_target, 'grant_admin', 'student', 'admin', true);
end;
$$;

-- Owner: make a student or a regular admin a main admin. A student needs the confirmation
-- (an admin was already confirmed when they were granted admin).
create or replace function public.owner_make_main_admin(p_target uuid, p_confirm_staff boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := public.admin_begin();
  v_t  public.profiles;
begin
  if v_me.role <> 'owner' then
    raise exception 'not_allowed';
  end if;
  select * into v_t from public.profiles where id = p_target for update;
  if not found or v_t.id = v_me.id or v_t.role not in ('student', 'admin') then
    raise exception 'bad_target';
  end if;
  if v_t.username is null then
    raise exception 'no_username';
  end if;
  if v_t.role = 'student' and p_confirm_staff is not true then
    raise exception 'staff_not_confirmed';
  end if;
  update public.profiles
  set role = 'main_admin', role_granted_by = v_me.id, role_granted_at = now()
  where id = p_target;
  insert into public.role_events (actor_id, target_id, action, old_role, new_role, confirmed_staff)
  values (v_me.id, p_target, 'make_main_admin', v_t.role, 'main_admin',
          case when v_t.role = 'student' then true end);
end;
$$;

-- The role log now also returns confirmed_staff (new return type → drop first).
drop function if exists public.admin_role_log(integer, bigint);
create or replace function public.admin_role_log(p_limit integer default 50, p_before bigint default null)
returns table (
  id bigint, at timestamptz, action text, actor_id uuid, actor_username text,
  target_id uuid, target_username text, old_role text, new_role text,
  old_username text, new_username text, cause_id bigint, confirmed_staff boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_allowed';
  end if;
  return query
  select e.id, e.at, e.action, e.actor_id, a.username, e.target_id, t.username,
         e.old_role, e.new_role, e.old_username, e.new_username, e.cause_id, e.confirmed_staff
  from public.role_events e
  left join public.profiles a on a.id = e.actor_id
  left join public.profiles t on t.id = e.target_id
  where p_before is null or e.id < p_before
  order by e.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.admin_grant_admin(uuid, boolean)',
    'public.owner_make_main_admin(uuid, boolean)',
    'public.admin_role_log(integer, bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;

-- =====================================================================
-- 3. campaigns: publication, edit_no, equipment / protocol in three languages
-- =====================================================================

-- Existing labs are published (they were live before review existed); new ones start as drafts.
alter table public.campaigns add column if not exists publication text not null default 'published';
alter table public.campaigns alter column publication set default 'draft';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_publication_check'
                 and conrelid = 'public.campaigns'::regclass) then
    alter table public.campaigns
      add constraint campaigns_publication_check check (publication in ('draft', 'in_review', 'published'));
  end if;
end
$$;

-- +1 on every saved change; lab_save refuses a save based on an older edit_no (two editors).
alter table public.campaigns add column if not exists edit_no integer not null default 0;

alter table public.campaigns add column if not exists equipment_he text[] not null default '{}';
alter table public.campaigns add column if not exists equipment_en text[] not null default '{}';
alter table public.campaigns add column if not exists equipment_ru text[] not null default '{}';
-- Old equipment was Hebrew only → equipment_he. en / ru stay empty (the UI falls back to Hebrew;
-- seed/004_equipment_translations.sql fills them for the demo labs). `equipment` stays for old
-- frontends and is kept equal to equipment_he by lab_save.
update public.campaigns
set equipment_he = equipment
where equipment_he = '{}' and equipment <> '{}';

-- Per-lab protocol (short Markdown). Empty → the generic steps from strings.js.
alter table public.campaigns add column if not exists protocol_he text not null default '';
alter table public.campaigns add column if not exists protocol_en text not null default '';
alter table public.campaigns add column if not exists protocol_ru text not null default '';

-- Drafts may be incomplete: titles and map center are required only outside drafts.
alter table public.campaigns drop constraint if exists campaigns_title_he_check;
alter table public.campaigns drop constraint if exists campaigns_title_en_check;
alter table public.campaigns drop constraint if exists campaigns_title_ru_check;
alter table public.campaigns alter column title_he set default '';
alter table public.campaigns alter column title_en set default '';
alter table public.campaigns alter column title_ru set default '';
alter table public.campaigns alter column center_lat drop not null;
alter table public.campaigns alter column center_lng drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_publishable'
                 and conrelid = 'public.campaigns'::regclass) then
    -- NOT VALID first, so an old incomplete row does not block the migration; every new write
    -- is checked anyway. Then try to validate the existing rows.
    alter table public.campaigns add constraint campaigns_publishable check (
      publication = 'draft'
      or (pg_catalog.btrim(title_he) <> '' and pg_catalog.btrim(title_en) <> '' and pg_catalog.btrim(title_ru) <> ''
          and pg_catalog.btrim(desc_he) <> '' and pg_catalog.btrim(desc_en) <> '' and pg_catalog.btrim(desc_ru) <> ''
          and center_lat is not null and center_lng is not null)) not valid;
  end if;
  begin
    alter table public.campaigns validate constraint campaigns_publishable;
  exception when check_violation then
    raise notice 'campaigns_publishable: some existing published labs miss a title, description or map center — fix them in the editor';
  end;
end
$$;

-- Field and option labels may be empty in drafts (checked for published labs by the guards below).
alter table public.campaign_fields drop constraint if exists campaign_fields_label_he_check;
alter table public.campaign_fields drop constraint if exists campaign_fields_label_en_check;
alter table public.campaign_fields drop constraint if exists campaign_fields_label_ru_check;
alter table public.campaign_fields alter column label_he set default '';
alter table public.campaign_fields alter column label_en set default '';
alter table public.campaign_fields alter column label_ru set default '';
alter table public.campaign_field_options drop constraint if exists campaign_field_options_label_he_check;
alter table public.campaign_field_options drop constraint if exists campaign_field_options_label_en_check;
alter table public.campaign_field_options drop constraint if exists campaign_field_options_label_ru_check;
alter table public.campaign_field_options alter column label_he set default '';
alter table public.campaign_field_options alter column label_en set default '';
alter table public.campaign_field_options alter column label_ru set default '';

-- =====================================================================
-- 4. Visibility: drafts / in review → admins only. Direct writes → none (RPC only).
-- =====================================================================

revoke all on public.campaigns from anon, authenticated;
grant select (id, slug, metric, icon, title_he, title_en, title_ru, desc_he, desc_en, desc_ru,
              status, region, difficulty, equipment, protocol_url, center_lat, center_lng, zoom,
              sort_order, form_version, created_at, updated_at)
  on public.campaigns to anon, authenticated;
-- New columns (CLAUDE.md: every new campaigns column needs its own grant).
grant select (publication) on public.campaigns to anon, authenticated;
grant select (edit_no) on public.campaigns to anon, authenticated;
grant select (equipment_he, equipment_en, equipment_ru) on public.campaigns to anon, authenticated;
grant select (protocol_he, protocol_en, protocol_ru) on public.campaigns to anon, authenticated;

drop policy if exists "anyone can read campaigns" on public.campaigns;
drop policy if exists "anyone reads published campaigns, admins all" on public.campaigns;
create policy "anyone reads published campaigns, admins all"
  on public.campaigns for select to anon, authenticated
  using (publication = 'published' or (select public.is_admin()));

drop policy if exists "admins add campaigns" on public.campaigns;
drop policy if exists "admins edit campaigns" on public.campaigns;
drop policy if exists "admins delete campaigns" on public.campaigns;

revoke all on public.campaign_fields, public.campaign_field_options from anon, authenticated;
grant select on public.campaign_fields, public.campaign_field_options to anon, authenticated;

-- A field / option is visible when its campaign is (the subquery runs under the campaigns policy).
drop policy if exists "anyone can read campaign fields" on public.campaign_fields;
drop policy if exists "read fields of visible campaigns" on public.campaign_fields;
create policy "read fields of visible campaigns"
  on public.campaign_fields for select to anon, authenticated
  using (exists (select 1 from public.campaigns c where c.id = campaign_id));

drop policy if exists "anyone can read campaign field options" on public.campaign_field_options;
drop policy if exists "read options of visible campaigns" on public.campaign_field_options;
create policy "read options of visible campaigns"
  on public.campaign_field_options for select to anon, authenticated
  using (exists (select 1 from public.campaigns c where c.id = campaign_id));

drop policy if exists "admins write campaign fields" on public.campaign_fields;
drop policy if exists "admins write campaign field options" on public.campaign_field_options;

-- =====================================================================
-- 5. Published labs: structure is locked (until 5c revisions), labels stay filled
-- =====================================================================
-- Skipped inside a transaction marked mitzpe.lab_apply (5c applies approved revisions that way;
-- from the SQL Editor the same set_config call allows an intentional change).

create or replace function public.lab_apply_mode()
returns boolean
language sql
stable
set search_path = ''
as $$
  select pg_catalog.current_setting('mitzpe.lab_apply', true) = pg_catalog.txid_current()::text
$$;

create or replace function public.lab_is_published(p_campaign text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select publication = 'published' from public.campaigns where id = p_campaign), false)
$$;

revoke all on function public.lab_is_published(text) from public, anon, authenticated;

create or replace function public.campaigns_structure_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.publication <> 'published' or public.lab_apply_mode() then
    return new;
  end if;
  if (new.protocol_he, new.protocol_en, new.protocol_ru)
     is distinct from (old.protocol_he, old.protocol_en, old.protocol_ru) then
    raise exception 'structural_change' using detail = '["info.protocol"]';
  end if;
  if new.slug is distinct from old.slug then
    raise exception 'invalid_lab' using detail = '{"info.slug":"locked"}';
  end if;
  return new;
end;
$$;

drop trigger if exists campaigns_structure_guard on public.campaigns;
create trigger campaigns_structure_guard
  before update on public.campaigns
  for each row execute function public.campaigns_structure_guard();

create or replace function public.campaign_fields_structure_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cid text := case when tg_op = 'DELETE' then old.campaign_id else new.campaign_id end;
begin
  -- Not published (or the campaign itself is being deleted → gone) → nothing to guard.
  if public.lab_apply_mode() or not public.lab_is_published(v_cid) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'structural_change' using detail = pg_catalog.jsonb_build_array('field.' || new.key)::text;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'structural_change' using detail = pg_catalog.jsonb_build_array('field.' || old.key)::text;
  end if;
  if (new.required, new.archived, new.is_primary, new.min_value, new.max_value, new.decimals, new.text_long)
     is distinct from
     (old.required, old.archived, old.is_primary, old.min_value, old.max_value, old.decimals, old.text_long) then
    raise exception 'structural_change' using detail = pg_catalog.jsonb_build_array('field.' || old.key)::text;
  end if;
  if pg_catalog.btrim(new.label_he) = '' or pg_catalog.btrim(new.label_en) = '' or pg_catalog.btrim(new.label_ru) = '' then
    raise exception 'invalid_lab' using detail = pg_catalog.jsonb_build_object('field.' || old.key || '.label', 'required')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists campaign_fields_structure_guard on public.campaign_fields;
create trigger campaign_fields_structure_guard
  before insert or update or delete on public.campaign_fields
  for each row execute function public.campaign_fields_structure_guard();

create or replace function public.campaign_field_options_structure_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cid text := case when tg_op = 'DELETE' then old.campaign_id else new.campaign_id end;
  v_path text := case when tg_op = 'DELETE' then 'field.' || old.field_key || '.option.' || old.key
                      else 'field.' || new.field_key || '.option.' || new.key end;
begin
  if public.lab_apply_mode() or not public.lab_is_published(v_cid) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op in ('INSERT', 'DELETE') or new.archived is distinct from old.archived then
    raise exception 'structural_change' using detail = pg_catalog.jsonb_build_array(v_path)::text;
  end if;
  if pg_catalog.btrim(new.label_he) = '' or pg_catalog.btrim(new.label_en) = '' or pg_catalog.btrim(new.label_ru) = '' then
    raise exception 'invalid_lab' using detail = pg_catalog.jsonb_build_object(v_path || '.label', 'required')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists campaign_field_options_structure_guard on public.campaign_field_options;
create trigger campaign_field_options_structure_guard
  before insert or update or delete on public.campaign_field_options
  for each row execute function public.campaign_field_options_structure_guard();

-- =====================================================================
-- 6. Measurements only for published labs
-- =====================================================================
-- Same function as in 004 (validation unchanged) plus the publication check. A draft never has
-- measurements, so its fields can still be deleted freely.

create or replace function public.measurements_validate_values()
returns trigger
language plpgsql
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
        elsif length(v #>> '{}') > max_len then
          e := 'too_long';
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
        -- Photos are not stored yet (no Storage until login): the value only records
        -- that a photo was attached. Later this becomes a Storage path.
        if v <> 'true'::jsonb then e := 'type'; end if;

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

  new.field_values := vals;
  new.form_version := cur_version;
  return new;
end;
$$;

drop trigger if exists measurements_validate_values on public.measurements;
create trigger measurements_validate_values
  before insert on public.measurements
  for each row execute function public.measurements_validate_values();

-- =====================================================================
-- 7. Lab change log
-- =====================================================================
-- Who did what to which lab, when. The title is copied so the entry still reads after the lab
-- is deleted. No usernames are stored (actor_id only; null after the account is deleted).
-- `details` = what changed: {"info": [column…], "fields_added": [key…], "fields_changed": […],
-- "fields_removed": […]}. Readable by admins through lab_log(); written only by the functions.

create table if not exists public.lab_events (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  campaign_id  text references public.campaigns (id) on update cascade on delete set null,
  title_he     text,
  title_en     text,
  title_ru     text,
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null,
  details      jsonb not null default '{}'::jsonb
);

-- The action list grows in 5b / 5c (drop + add the constraint there).
alter table public.lab_events drop constraint if exists lab_events_action_check;
alter table public.lab_events add constraint lab_events_action_check
  check (action in ('create', 'edit', 'edit_published', 'delete'));

create index if not exists lab_events_campaign_idx on public.lab_events (campaign_id, id desc);
create index if not exists lab_events_actor_idx on public.lab_events (actor_id);

alter table public.lab_events enable row level security;
revoke all on public.lab_events from anon, authenticated;

-- =====================================================================
-- 8. Lab functions (RPC)
-- =====================================================================

-- Start of every lab function: logged in, admin, complete admin profile. Returns the profile.
create or replace function public.lab_begin()
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  select * into v_me from public.profiles where id = auth.uid();
  if not found or public.role_rank(v_me.role) < 1 then
    raise exception 'not_allowed';
  end if;
  if not public.admin_profile_complete(v_me.id) then
    raise exception 'admin_profile_required';
  end if;
  return v_me;
end;
$$;

revoke all on function public.lab_begin() from public, anon, authenticated;

-- Who may edit a lab: its author, main admins, the owner. (Deleting: see lab_delete.)
create or replace function public.lab_may_edit(p_role text, p_me uuid, p_created_by uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_role in ('main_admin', 'owner') or (p_role = 'admin' and p_created_by = p_me)
$$;

create or replace function public.lab_may_delete(p_role text, p_me uuid, p_created_by uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_role in ('main_admin', 'owner') or (p_role = 'admin' and p_created_by = p_me)
$$;

-- For the "Edit" button (the editor itself re-checks everything in lab_save).
create or replace function public.lab_can_edit(p_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.lab_may_edit(public.my_role(), auth.uid(), c.created_by)
    from public.campaigns c where c.id = p_id), false)
$$;

-- ---- Validation ---------------------------------------------------------------------------
-- Both return {path: code}; paths: info.<column>, fields.<i>.<prop>, fields.<i>.options.<j>.<prop>
-- (i, j = position in the editor, 0-based). p_strict = the lab is not a draft: texts required.
-- Mirrored in src/lib/labs.js (same paths and codes).

create or replace function public.lab_check_info(p_info jsonb, p_strict boolean)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  errs jsonb := '{}'::jsonb;
  l    text;
  k    text;
  v    jsonb;
  s    text;
  item jsonb;
  n    integer;
begin
  s := p_info ->> 'slug';
  if s is null or s = '' then errs := errs || '{"info.slug":"required"}';
  elsif pg_catalog.char_length(s) > 60 or s !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then errs := errs || '{"info.slug":"format"}';
  end if;

  s := p_info ->> 'icon';
  if s is not null and s !~ '^[A-Za-z0-9]{1,40}$' then errs := errs || '{"info.icon":"invalid"}'; end if;
  if coalesce(p_info ->> 'region', '') not in ('center', 'north', 'south', 'jerusalem', 'lowlands', 'haifa') then
    errs := errs || '{"info.region":"invalid"}';
  end if;
  if coalesce(p_info ->> 'difficulty', '') not in ('easy', 'medium', 'hard') then
    errs := errs || '{"info.difficulty":"invalid"}';
  end if;
  if coalesce(p_info ->> 'status', '') not in ('collecting', 'completed') then
    errs := errs || '{"info.status":"invalid"}';
  end if;
  if p_info ->> 'metric' is not null
     and p_info ->> 'metric' not in ('temperature', 'humidity', 'skyBrightness', 'airQuality') then
    errs := errs || '{"info.metric":"invalid"}';
  end if;

  -- Map center: both or none; required outside drafts.
  if jsonb_typeof(p_info -> 'center_lat') is distinct from 'number'
     or jsonb_typeof(p_info -> 'center_lng') is distinct from 'number' then
    if (p_info -> 'center_lat') is not null and jsonb_typeof(p_info -> 'center_lat') <> 'null'
       or (p_info -> 'center_lng') is not null and jsonb_typeof(p_info -> 'center_lng') <> 'null' then
      errs := errs || '{"info.center":"invalid"}';
    elsif p_strict then
      errs := errs || '{"info.center":"required"}';
    end if;
  elsif (p_info ->> 'center_lat')::numeric not between -90 and 90
        or (p_info ->> 'center_lng')::numeric not between -180 and 180 then
    errs := errs || '{"info.center":"invalid"}';
  end if;
  if jsonb_typeof(p_info -> 'zoom') is distinct from 'number'
     or (p_info ->> 'zoom')::numeric not in (select generate_series(1, 18)) then
    errs := errs || '{"info.zoom":"invalid"}';
  end if;

  foreach l in array array['he', 'en', 'ru'] loop
    k := 'title_' || l;
    s := public.lab_line(p_info ->> k);
    if s is null then
      if p_strict then errs := errs || jsonb_build_object('info.' || k, 'required'); end if;
    elsif pg_catalog.char_length(s) > 120 then errs := errs || jsonb_build_object('info.' || k, 'too_long');
    end if;

    k := 'desc_' || l;
    s := public.lab_block(p_info ->> k);
    if s = '' then
      if p_strict then errs := errs || jsonb_build_object('info.' || k, 'required'); end if;
    elsif pg_catalog.char_length(s) > 1000 then errs := errs || jsonb_build_object('info.' || k, 'too_long');
    end if;

    k := 'protocol_' || l;
    if pg_catalog.char_length(public.lab_block(p_info ->> k)) > 8000 then
      errs := errs || jsonb_build_object('info.' || k, 'too_long');
    end if;

    k := 'equipment_' || l;
    v := p_info -> k;
    if v is not null and jsonb_typeof(v) <> 'null' then
      if jsonb_typeof(v) <> 'array' then
        errs := errs || jsonb_build_object('info.' || k, 'invalid');
      else
        n := 0;
        for item in select * from jsonb_array_elements(v) loop
          if jsonb_typeof(item) <> 'string' then
            errs := errs || jsonb_build_object('info.' || k, 'invalid');
            exit;
          end if;
          if public.lab_line(item #>> '{}') is not null then n := n + 1; end if;
          if pg_catalog.char_length(public.lab_line(item #>> '{}')) > 80 then
            errs := errs || jsonb_build_object('info.' || k, 'too_long');
            exit;
          end if;
        end loop;
        if n > 20 then errs := errs || jsonb_build_object('info.' || k, 'too_many'); end if;
      end if;
    end if;
  end loop;
  return errs;
end;
$$;

create or replace function public.lab_check_fields(p_campaign text, p_fields jsonb, p_strict boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  errs     jsonb := '{}'::jsonb;
  f        jsonb;
  o        jsonb;
  i        integer := 0;
  j        integer;
  p        text;
  k        text;
  t        text;
  l        text;
  s        text;
  keys     text[] := '{}';
  okeys    text[];
  primaries integer := 0;
  cur      public.campaign_fields;
begin
  if jsonb_typeof(p_fields) is distinct from 'array' then
    return '{"fields":"invalid"}'::jsonb;
  end if;
  if jsonb_array_length(p_fields) > 60 then
    return '{"fields":"too_many"}'::jsonb;
  end if;

  for f in select * from jsonb_array_elements(p_fields) loop
    p := 'fields.' || i || '.';
    k := f ->> 'key';
    t := f ->> 'type';

    if k is null or k !~ '^[a-z][a-z0-9_]{0,39}$' or k ~ '_unit$' then
      errs := errs || jsonb_build_object(p || 'key', 'format');
    elsif k in ('id', 'campaign', 'metric', 'date', 'time', 'timestamp', 'place', 'school', 'lat', 'lng',
                'verification', 'form_version', 'value', 'unit', 'user', 'observation_id') then
      errs := errs || jsonb_build_object(p || 'key', 'reserved');
    elsif k = any (keys) then
      errs := errs || jsonb_build_object(p || 'key', 'duplicate');
    end if;
    keys := keys || k;

    if t is null or t not in ('number', 'choice', 'multi_choice', 'text', 'boolean', 'datetime', 'photo') then
      errs := errs || jsonb_build_object(p || 'type', 'invalid');
    end if;

    -- Saved fields: key (= identity), type and unit are permanent.
    select * into cur from public.campaign_fields where campaign_id = p_campaign and key = k;
    if found then
      if t is distinct from cur.type then errs := errs || jsonb_build_object(p || 'type', 'locked'); end if;
      if public.lab_line(f ->> 'unit') is distinct from cur.unit then
        errs := errs || jsonb_build_object(p || 'unit', 'locked');
      end if;
    end if;

    foreach l in array array['he', 'en', 'ru'] loop
      s := public.lab_line(f ->> ('label_' || l));
      if s is null then
        if p_strict then errs := errs || jsonb_build_object(p || 'label_' || l, 'required'); end if;
      elsif pg_catalog.char_length(s) > 120 then
        errs := errs || jsonb_build_object(p || 'label_' || l, 'too_long');
      end if;
      if pg_catalog.char_length(public.lab_line(f ->> ('help_' || l))) > 500 then
        errs := errs || jsonb_build_object(p || 'help_' || l, 'too_long');
      end if;
    end loop;

    if jsonb_typeof(f -> 'required') is distinct from 'boolean'
       or jsonb_typeof(f -> 'archived') is distinct from 'boolean'
       or jsonb_typeof(f -> 'is_primary') is distinct from 'boolean'
       or jsonb_typeof(f -> 'text_long') is distinct from 'boolean' then
      errs := errs || jsonb_build_object(p || 'flags', 'invalid');
    end if;

    if t = 'number' then
      if jsonb_typeof(f -> 'decimals') is distinct from 'number'
         or (f ->> 'decimals')::numeric not in (0, 1, 2, 3, 4, 5, 6) then
        errs := errs || jsonb_build_object(p || 'decimals', 'invalid');
      end if;
      if (f -> 'min_value') is not null and jsonb_typeof(f -> 'min_value') not in ('number', 'null') then
        errs := errs || jsonb_build_object(p || 'min_value', 'invalid');
      elsif (f -> 'max_value') is not null and jsonb_typeof(f -> 'max_value') not in ('number', 'null') then
        errs := errs || jsonb_build_object(p || 'max_value', 'invalid');
      elsif jsonb_typeof(f -> 'min_value') = 'number' and jsonb_typeof(f -> 'max_value') = 'number'
            and (f ->> 'min_value')::numeric > (f ->> 'max_value')::numeric then
        errs := errs || jsonb_build_object(p || 'max_value', 'min_max');
      end if;
      if pg_catalog.char_length(public.lab_line(f ->> 'unit')) > 20 then
        errs := errs || jsonb_build_object(p || 'unit', 'too_long');
      end if;
    end if;

    if (f ->> 'is_primary')::boolean is true then
      primaries := primaries + 1;
      if t is distinct from 'number' or (f ->> 'archived')::boolean is true then
        errs := errs || jsonb_build_object(p || 'is_primary', 'invalid');
      elsif primaries > 1 then
        errs := errs || jsonb_build_object(p || 'is_primary', 'multiple');
      end if;
    end if;

    -- Options: only for choice / multi_choice.
    if jsonb_typeof(f -> 'options') = 'array' and jsonb_array_length(f -> 'options') > 0 then
      if t not in ('choice', 'multi_choice') then
        errs := errs || jsonb_build_object(p || 'options', 'invalid');
      elsif jsonb_array_length(f -> 'options') > 50 then
        errs := errs || jsonb_build_object(p || 'options', 'too_many');
      else
        j := 0;
        okeys := '{}';
        for o in select * from jsonb_array_elements(f -> 'options') loop
          s := o ->> 'key';
          if s is null or s !~ '^[a-z0-9][a-z0-9_]{0,39}$' then
            errs := errs || jsonb_build_object(p || 'options.' || j || '.key', 'format');
          elsif s = any (okeys) then
            errs := errs || jsonb_build_object(p || 'options.' || j || '.key', 'duplicate');
          end if;
          okeys := okeys || s;
          if jsonb_typeof(o -> 'archived') is distinct from 'boolean' then
            errs := errs || jsonb_build_object(p || 'options.' || j || '.archived', 'invalid');
          end if;
          foreach l in array array['he', 'en', 'ru'] loop
            s := public.lab_line(o ->> ('label_' || l));
            if s is null then
              if p_strict then errs := errs || jsonb_build_object(p || 'options.' || j || '.label_' || l, 'required'); end if;
            elsif pg_catalog.char_length(s) > 80 then
              errs := errs || jsonb_build_object(p || 'options.' || j || '.label_' || l, 'too_long');
            end if;
          end loop;
          j := j + 1;
        end loop;
      end if;
    elsif (f -> 'options') is not null and jsonb_typeof(f -> 'options') not in ('array', 'null') then
      errs := errs || jsonb_build_object(p || 'options', 'invalid');
    end if;

    i := i + 1;
  end loop;
  return errs;
end;
$$;

revoke all on function public.lab_check_fields(text, jsonb, boolean) from public, anon, authenticated;

-- Everything the editor edits, as one JSON (for "what changed" in the log; 5c diffs revisions).
create or replace function public.lab_snapshot(p_campaign text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'info', to_jsonb(c) - array['id', 'created_at', 'updated_at', 'edit_no', 'form_version', 'created_by',
                                'sort_order', 'publication', 'equipment', 'protocol_url'],
    'fields', coalesce((
      select jsonb_object_agg(f.key,
               (to_jsonb(f) - array['campaign_id', 'created_at'])
               || jsonb_build_object('options', coalesce((
                    select jsonb_object_agg(o.key, to_jsonb(o) - array['campaign_id', 'field_key', 'created_at'])
                    from public.campaign_field_options o
                    where o.campaign_id = f.campaign_id and o.field_key = f.key), '{}'::jsonb)))
      from public.campaign_fields f where f.campaign_id = c.id), '{}'::jsonb))
  from public.campaigns c where c.id = p_campaign
$$;

revoke all on function public.lab_snapshot(text) from public, anon, authenticated;

create or replace function public.lab_diff(a jsonb, b jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'info', (select jsonb_agg(k order by k) from jsonb_object_keys(coalesce(b -> 'info', '{}')) k
             where (a -> 'info' -> k) is distinct from (b -> 'info' -> k)),
    'fields_added', (select jsonb_agg(k order by k) from jsonb_object_keys(coalesce(b -> 'fields', '{}')) k
                     where not coalesce(a -> 'fields', '{}') ? k),
    'fields_removed', (select jsonb_agg(k order by k) from jsonb_object_keys(coalesce(a -> 'fields', '{}')) k
                       where not coalesce(b -> 'fields', '{}') ? k),
    'fields_changed', (select jsonb_agg(k order by k) from jsonb_object_keys(coalesce(b -> 'fields', '{}')) k
                       where coalesce(a -> 'fields', '{}') ? k
                         and (a -> 'fields' -> k) is distinct from (b -> 'fields' -> k))))
$$;

-- ---- Save the whole editor state ------------------------------------------------------------
-- p_id null → new draft (created_by = the caller). Otherwise the lab must be editable by the
-- caller and p_edit_no must match (else edited_elsewhere: someone saved in between).
-- p_info: {slug, icon, region, difficulty, status, metric, center_lat, center_lng, zoom,
--          title_he/en/ru, desc_he/en/ru, equipment_he/en/ru (arrays), protocol_he/en/ru}
-- p_fields: [{key, type, label_he/en/ru, help_he/en/ru, required, archived, is_primary, unit,
--             min_value, max_value, decimals, text_long, options: [{key, label_he/en/ru, archived}]}]
--           in form order. Draft: fields / options missing from the list are deleted.
-- Published lab: only cosmetic changes pass (the structure guards raise structural_change).
-- Returns {id, slug, edit_no, changed}.
create or replace function public.lab_save(p_id text, p_edit_no integer, p_info jsonb, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      public.profiles := public.lab_begin();
  v_c       public.campaigns;
  v_new     boolean := p_id is null;
  v_strict  boolean := false;
  v_id      text := p_id;
  v_before  jsonb := null;
  v_after   jsonb;
  v_diff    jsonb;
  v_primary text;
  errs      jsonb;
  f         jsonb;
  o         jsonb;
  i         integer;
  j         integer;
  v_keys    text[];
begin
  if jsonb_typeof(p_info) is distinct from 'object' or jsonb_typeof(p_fields) is distinct from 'array' then
    raise exception 'invalid_lab' using detail = '{"_":"invalid"}';
  end if;

  if not v_new then
    select * into v_c from public.campaigns where id = p_id for update;
    if not found then
      raise exception 'not_found';
    end if;
    if not public.lab_may_edit(v_me.role, v_me.id, v_c.created_by) then
      raise exception 'not_allowed';
    end if;
    if p_edit_no is distinct from v_c.edit_no then
      raise exception 'edited_elsewhere';
    end if;
    v_strict := v_c.publication <> 'draft';
    v_before := public.lab_snapshot(p_id);
  end if;

  errs := public.lab_check_info(p_info, v_strict) || public.lab_check_fields(v_id, p_fields, v_strict);
  if not (errs ? 'info.slug') and exists (
       select 1 from public.campaigns where slug = p_info ->> 'slug' and id is distinct from v_id) then
    errs := errs || '{"info.slug":"taken"}';
  end if;
  -- Fields with data are never deleted (archive instead). Drafts have no data, so this only
  -- matters for labs that went back to draft in the SQL Editor.
  if not v_new and exists (select 1 from public.measurements where observation_id = v_id) then
    select errs || coalesce(jsonb_object_agg('removed.' || cf.key, 'has_data'), '{}'::jsonb) into errs
    from public.campaign_fields cf
    where cf.campaign_id = v_id
      and not exists (select 1 from jsonb_array_elements(p_fields) x where x ->> 'key' = cf.key);
  end if;
  if errs <> '{}'::jsonb then
    raise exception 'invalid_lab' using detail = errs::text;
  end if;

  -- ---- campaign row
  if v_new then
    insert into public.campaigns (slug, region, publication, sort_order)
    values (p_info ->> 'slug', p_info ->> 'region', 'draft',
            coalesce((select max(sort_order) from public.campaigns), 0) + 1)
    returning id into v_id;
  end if;

  update public.campaigns set
    slug         = p_info ->> 'slug',
    icon         = coalesce(nullif(p_info ->> 'icon', ''), 'Activity'),
    region       = p_info ->> 'region',
    difficulty   = p_info ->> 'difficulty',
    status       = p_info ->> 'status',
    metric       = nullif(p_info ->> 'metric', ''),
    center_lat   = (p_info ->> 'center_lat')::double precision,
    center_lng   = (p_info ->> 'center_lng')::double precision,
    zoom         = (p_info ->> 'zoom')::smallint,
    title_he     = coalesce(public.lab_line(p_info ->> 'title_he'), ''),
    title_en     = coalesce(public.lab_line(p_info ->> 'title_en'), ''),
    title_ru     = coalesce(public.lab_line(p_info ->> 'title_ru'), ''),
    desc_he      = public.lab_block(p_info ->> 'desc_he'),
    desc_en      = public.lab_block(p_info ->> 'desc_en'),
    desc_ru      = public.lab_block(p_info ->> 'desc_ru'),
    protocol_he  = public.lab_block(p_info ->> 'protocol_he'),
    protocol_en  = public.lab_block(p_info ->> 'protocol_en'),
    protocol_ru  = public.lab_block(p_info ->> 'protocol_ru'),
    equipment_he = array(select public.lab_line(x) from jsonb_array_elements_text(coalesce(p_info -> 'equipment_he', '[]')) with ordinality e(x, n)
                         where public.lab_line(x) is not null order by n),
    equipment_en = array(select public.lab_line(x) from jsonb_array_elements_text(coalesce(p_info -> 'equipment_en', '[]')) with ordinality e(x, n)
                         where public.lab_line(x) is not null order by n),
    equipment_ru = array(select public.lab_line(x) from jsonb_array_elements_text(coalesce(p_info -> 'equipment_ru', '[]')) with ordinality e(x, n)
                         where public.lab_line(x) is not null order by n)
  where id = v_id;
  -- Old frontends read `equipment` (Hebrew).
  update public.campaigns set equipment = equipment_he where id = v_id and equipment is distinct from equipment_he;

  -- ---- fields: delete what is gone (draft; on a published lab the guard refuses), then upsert
  select coalesce(array_agg(x ->> 'key'), '{}') into v_keys from jsonb_array_elements(p_fields) x;
  select x ->> 'key' into v_primary from jsonb_array_elements(p_fields) x
  where (x ->> 'is_primary')::boolean limit 1;

  delete from public.campaign_field_options o
  where o.campaign_id = v_id
    and not exists (select 1 from jsonb_array_elements(p_fields) x
                    cross join jsonb_array_elements(coalesce(x -> 'options', '[]')) y
                    where x ->> 'key' = o.field_key and y ->> 'key' = o.key);
  delete from public.campaign_fields where campaign_id = v_id and not (key = any (v_keys));
  -- One primary field at a time (unique index): clear the old one first.
  update public.campaign_fields set is_primary = false
  where campaign_id = v_id and is_primary and key is distinct from v_primary;

  i := 0;
  for f in select * from jsonb_array_elements(p_fields) loop
    i := i + 1;
    if exists (select 1 from public.campaign_fields where campaign_id = v_id and key = f ->> 'key') then
      update public.campaign_fields set
        label_he   = coalesce(public.lab_line(f ->> 'label_he'), ''),
        label_en   = coalesce(public.lab_line(f ->> 'label_en'), ''),
        label_ru   = coalesce(public.lab_line(f ->> 'label_ru'), ''),
        help_he    = coalesce(public.lab_line(f ->> 'help_he'), ''),
        help_en    = coalesce(public.lab_line(f ->> 'help_en'), ''),
        help_ru    = coalesce(public.lab_line(f ->> 'help_ru'), ''),
        required   = (f ->> 'required')::boolean,
        sort_order = i,
        archived   = (f ->> 'archived')::boolean,
        is_primary = (f ->> 'is_primary')::boolean,
        min_value  = case when type = 'number' then (f ->> 'min_value')::numeric end,
        max_value  = case when type = 'number' then (f ->> 'max_value')::numeric end,
        decimals   = case when type = 'number' then (f ->> 'decimals')::smallint end,
        text_long  = type = 'text' and (f ->> 'text_long')::boolean
      where campaign_id = v_id and key = f ->> 'key';
    else
      insert into public.campaign_fields
        (campaign_id, key, type, label_he, label_en, label_ru, help_he, help_en, help_ru,
         required, sort_order, archived, is_primary, unit, min_value, max_value, decimals, text_long)
      values (v_id, f ->> 'key', f ->> 'type',
        coalesce(public.lab_line(f ->> 'label_he'), ''),
        coalesce(public.lab_line(f ->> 'label_en'), ''),
        coalesce(public.lab_line(f ->> 'label_ru'), ''),
        coalesce(public.lab_line(f ->> 'help_he'), ''),
        coalesce(public.lab_line(f ->> 'help_en'), ''),
        coalesce(public.lab_line(f ->> 'help_ru'), ''),
        (f ->> 'required')::boolean, i, (f ->> 'archived')::boolean, (f ->> 'is_primary')::boolean,
        case when f ->> 'type' = 'number' then public.lab_line(f ->> 'unit') end,
        case when f ->> 'type' = 'number' then (f ->> 'min_value')::numeric end,
        case when f ->> 'type' = 'number' then (f ->> 'max_value')::numeric end,
        case when f ->> 'type' = 'number' then (f ->> 'decimals')::smallint end,
        f ->> 'type' = 'text' and (f ->> 'text_long')::boolean);
    end if;

    j := 0;
    for o in select * from jsonb_array_elements(coalesce(f -> 'options', '[]')) loop
      j := j + 1;
      if exists (select 1 from public.campaign_field_options
                 where campaign_id = v_id and field_key = f ->> 'key' and key = o ->> 'key') then
        update public.campaign_field_options set
          label_he   = coalesce(public.lab_line(o ->> 'label_he'), ''),
          label_en   = coalesce(public.lab_line(o ->> 'label_en'), ''),
          label_ru   = coalesce(public.lab_line(o ->> 'label_ru'), ''),
          sort_order = j,
          archived   = (o ->> 'archived')::boolean
        where campaign_id = v_id and field_key = f ->> 'key' and key = o ->> 'key';
      else
        insert into public.campaign_field_options
          (campaign_id, field_key, key, label_he, label_en, label_ru, sort_order, archived)
        values (v_id, f ->> 'key', o ->> 'key',
          coalesce(public.lab_line(o ->> 'label_he'), ''),
          coalesce(public.lab_line(o ->> 'label_en'), ''),
          coalesce(public.lab_line(o ->> 'label_ru'), ''),
          j, (o ->> 'archived')::boolean);
      end if;
    end loop;
  end loop;

  -- ---- log + edit_no (only when something really changed)
  v_after := public.lab_snapshot(v_id);
  v_diff := public.lab_diff(coalesce(v_before, '{}'::jsonb), v_after);
  if v_new or v_diff <> '{}'::jsonb then
    update public.campaigns set edit_no = edit_no + 1 where id = v_id returning * into v_c;
    insert into public.lab_events (campaign_id, title_he, title_en, title_ru, actor_id, action, details)
    values (v_id, v_c.title_he, v_c.title_en, v_c.title_ru, v_me.id,
            case when v_new then 'create' when v_c.publication = 'published' then 'edit_published' else 'edit' end,
            case when v_new then '{}'::jsonb else v_diff end);
  else
    select * into v_c from public.campaigns where id = v_id;
  end if;

  return jsonb_build_object('id', v_c.id, 'slug', v_c.slug, 'edit_no', v_c.edit_no,
                            'changed', v_new or v_diff <> '{}'::jsonb);
end;
$$;

-- ---- Delete a lab: main admins / owner any, admins their own; never with measurements. -------
create or replace function public.lab_delete(p_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := public.lab_begin();
  v_c  public.campaigns;
begin
  select * into v_c from public.campaigns where id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if not public.lab_may_delete(v_me.role, v_me.id, v_c.created_by) then
    raise exception 'not_allowed';
  end if;
  if exists (select 1 from public.measurements where observation_id = p_id) then
    raise exception 'has_measurements';
  end if;
  insert into public.lab_events (campaign_id, title_he, title_en, title_ru, actor_id, action)
  values (p_id, v_c.title_he, v_c.title_en, v_c.title_ru, v_me.id, 'delete');
  delete from public.campaigns where id = p_id;
end;
$$;

-- ---- All labs for the admin panel (drafts included), with who created them. ------------------
create or replace function public.lab_admin_list()
returns table (
  id text, slug text, title_he text, title_en text, title_ru text, icon text,
  publication text, status text, created_by uuid, creator_username text, creator_full_name text,
  can_edit boolean, can_delete boolean, measurement_count bigint, updated_at timestamptz, edit_no integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.my_role();
begin
  if public.role_rank(v_role) < 1 then
    raise exception 'not_allowed';
  end if;
  return query
  select c.id, c.slug, c.title_he, c.title_en, c.title_ru, c.icon, c.publication, c.status,
         c.created_by, p.username, a.full_name,
         public.lab_may_edit(v_role, auth.uid(), c.created_by),
         public.lab_may_delete(v_role, auth.uid(), c.created_by) and m.n = 0,
         m.n, c.updated_at, c.edit_no
  from public.campaigns c
  left join public.profiles p on p.id = c.created_by
  left join public.admin_profiles a on a.user_id = c.created_by
  cross join lateral (select count(*) as n from public.measurements x where x.observation_id = c.id) m
  order by c.updated_at desc, c.id;
end;
$$;

-- ---- Lab log, newest first (admins). p_campaign = one lab, or null for all. ------------------
create or replace function public.lab_log(p_campaign text default null, p_limit integer default 50, p_before bigint default null)
returns table (
  id bigint, at timestamptz, action text, campaign_id text, slug text,
  title_he text, title_en text, title_ru text, actor_id uuid, actor_username text, details jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_allowed';
  end if;
  return query
  select e.id, e.at, e.action, e.campaign_id, c.slug,
         coalesce(c.title_he, e.title_he), coalesce(c.title_en, e.title_en), coalesce(c.title_ru, e.title_ru),
         e.actor_id, p.username, e.details
  from public.lab_events e
  left join public.campaigns c on c.id = e.campaign_id
  left join public.profiles p on p.id = e.actor_id
  where (p_campaign is null or e.campaign_id = p_campaign)
    and (p_before is null or e.id < p_before)
  order by e.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.lab_save(text, integer, jsonb, jsonb)',
    'public.lab_delete(text)',
    'public.lab_admin_list()',
    'public.lab_log(text, integer, bigint)',
    'public.lab_can_edit(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;

notify pgrst, 'reload schema';
