-- 016_measurement_photos.sql
-- Photos in measurements, stored in Supabase Storage (PR 1 of "images"; avatars come in 017).
-- Run once in the Supabase SQL Editor, AFTER 015. Safe to re-run.
-- Compatible with the production frontend: a photo value `true` (what the old code sends) is still
-- accepted; the three account-deletion functions keep their arguments (results get extra keys).
-- The `account` Edge Function must be redeployed after this migration (it calls
-- account_storage_objects and storage_sweep) — see supabase/SETUP_AUTH.md → 19.
--
-- Storage facts this relies on (checked in github.com/supabase/storage, migrations/tenant):
--   * storage.objects.owner_id (text) is set by the Storage server from the uploader's JWT (0018).
--   * Direct `delete from storage.objects` is refused by the trigger storage.protect_delete (0055),
--     and would leave the file behind anyway. So this migration NEVER deletes files: it queues them
--     in private.storage_trash, and they are removed through the Storage API — by their owner or a
--     moderator from the browser (delete policy below), or by the Edge Function (secret key):
--     `sweep` (daily, pg_cron + pg_net) and `delete` (account deletion).
--
-- Rules:
--   * Bucket `measurement-photos`: private (no public URLs), JPEG only, ≤ 1 MB per file (enforced by
--     Storage). File names are random: <uuid v4>.jpg, no user id. Nothing is ever overwritten
--     (no update policy, a new name per upload).
--   * Upload: logged in with a username; ≤ 30 photos per user per 24 h; refused once all stored
--     files together reach 900 MB (the free plan has 1 GB).
--   * A measurement's photo value (field_values.<key>) is one of:
--       true        — old rows / old frontend: "a photo was attached", never stored;
--       "<uuid>.jpg" — a file in the bucket, uploaded by the measurement's author, not used before;
--       "removed"   — the file was deleted (moderator, its author, expiry, account deletion).
--     New errors in invalid_values: photo_missing (no such file of this user), photo_taken
--     (already used). Mirrored in src/lib/fields.js.
--   * measurement_photos: one row per stored photo. status:
--       pending   — visible to its author and the lab's moderators only (the default);
--       approved  — visible to every logged-in user (a moderator's own photo starts approved);
--       hidden    — by a moderator or by 3 reports; author + moderators only;
--       removed   — deleted by a moderator (reason code shown to the author);
--       withdrawn — deleted by its author.
--     Moderators = comment_can_moderate (the lab's author, main admins, the owner).
--   * Signed URLs (short-lived, created by Storage) only for users the read policy allows.
--   * Reports (reason code only, one per user) on approved photos; 3 open reports hide the photo.
--     Reporters are never shown. Log photo_events: ids + reason codes only, readable by admins.
--   * Retention (pg_cron, daily): hidden photos are removed 90 days after hiding; rows of removed /
--     withdrawn photos (no file) and resolved reports are deleted after 90 days; files uploaded but
--     never attached to a measurement are queued for deletion after 24 hours.
--   * Account deletion: the user's photos are ALWAYS deleted, also when the measurements are kept
--     (their values become "removed"); their reports are deleted.
--
-- Errors (message): not_logged_in, no_username, not_allowed, not_found, bad_request,
--   bad_state, reason_required, already_reported, rate_limited.

create extension if not exists pg_cron with schema pg_catalog;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- =====================================================================
-- 1. Bucket
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('measurement-photos', 'measurement-photos', false, 1048576, array['image/jpeg'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- =====================================================================
-- 2. Tables
-- =====================================================================

create table if not exists public.measurement_photos (
  path            text primary key
                  check (path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'),
  measurement_id  text not null references public.measurements (id) on delete cascade,
  field_key       text not null,
  campaign_id     text not null references public.campaigns (id) on delete cascade,
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'hidden', 'removed', 'withdrawn')),
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  hidden_at       timestamptz,
  hidden_reason   text check (hidden_reason in ('moderator', 'reports')),
  removed_reason  text check (removed_reason in ('people', 'personal_info', 'off_topic', 'other', 'expired')),
  unique (measurement_id, field_key),
  check ((status = 'hidden') = (hidden_at is not null)),
  check ((hidden_at is null) = (hidden_reason is null))
);
create index if not exists measurement_photos_owner_idx on public.measurement_photos (owner_id);
create index if not exists measurement_photos_campaign_idx on public.measurement_photos (campaign_id, status);

create table if not exists public.photo_reports (
  path         text not null references public.measurement_photos (path) on delete cascade,
  reporter_id  uuid not null references public.profiles (id) on delete cascade,
  reason       text not null check (reason in ('bullying', 'personal_info', 'spam', 'other')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  primary key (path, reporter_id)
);
create index if not exists photo_reports_open_idx on public.photo_reports (path) where resolved_at is null;
create index if not exists photo_reports_reporter_idx on public.photo_reports (reporter_id);

-- Moderation log. No images, no names: ids and codes only (null once that account is deleted).
-- actor_id null: 'auto_hide' (3 reports) or 'expire' (90 days hidden).
create table if not exists public.photo_events (
  id              bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  action          text not null
                  check (action in ('approve', 'hide', 'unhide', 'dismiss', 'remove', 'auto_hide', 'expire')),
  path            text,
  measurement_id  text,
  campaign_id     text,
  actor_id        uuid references public.profiles (id) on delete set null,
  author_id       uuid references public.profiles (id) on delete set null,
  reports         integer not null default 0,
  reason          text
);
create index if not exists photo_events_at_idx on public.photo_events (id desc);

-- Files waiting to be deleted through the Storage API. campaign_id / owner_id say who may delete
-- them from the browser (the delete policy); the Edge Function deletes the rest.
create table if not exists private.storage_trash (
  bucket_id    text not null,
  path         text not null,
  owner_id     uuid,
  campaign_id  text,
  queued_at    timestamptz not null default now(),
  attempts     integer not null default 0,
  primary key (bucket_id, path)
);

alter table public.measurement_photos enable row level security;
alter table public.photo_reports enable row level security;
alter table public.photo_events enable row level security;
revoke all on public.measurement_photos, public.photo_reports, public.photo_events
  from public, anon, authenticated;
revoke all on private.storage_trash from public, anon, authenticated;

-- =====================================================================
-- 3. Helpers
-- =====================================================================

-- Bytes stored in all buckets (the 900 MB cap).
create or replace function public.storage_total_bytes()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0)::bigint from storage.objects o
$$;

-- Queue a file for deletion (idempotent).
create or replace function public.storage_trash_add(p_bucket text, p_path text, p_owner uuid, p_campaign text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.storage_trash (bucket_id, path, owner_id, campaign_id)
  values (p_bucket, p_path, p_owner, p_campaign)
  on conflict (bucket_id, path) do nothing
$$;

-- A photo whose file still exists (and may be shown to someone).
create or replace function public.photo_is_live(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('pending', 'approved', 'hidden')
$$;

-- Upload policy: logged in with a username, a random name, ≤ 30 per 24 h, under the 900 MB cap.
create or replace function public.photo_upload_ok(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.username is not null)
    and (select count(*) from storage.objects o
         where o.bucket_id = 'measurement-photos' and o.owner_id = auth.uid()::text
           and o.created_at > now() - interval '24 hours') < 30
    and public.storage_total_bytes() < 900::bigint * 1024 * 1024
$$;

-- Delete policy: a queued file — by its owner or a moderator of its lab; or an own file that was
-- never attached to a measurement.
create or replace function public.photo_can_delete(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (select 1 from private.storage_trash t
            where t.bucket_id = 'measurement-photos' and t.path = p_name
              and (t.owner_id = auth.uid()
                   or (t.campaign_id is not null and public.comment_can_moderate(t.campaign_id))))
    or (not exists (select 1 from public.measurement_photos mp where mp.path = p_name)
        and exists (select 1 from storage.objects o
                    where o.bucket_id = 'measurement-photos' and o.name = p_name
                      and o.owner_id = auth.uid()::text)))
$$;

-- Read policy (signed URLs): approved → any logged-in user; pending / hidden → its author and the
-- lab's moderators. A file in the trash stays readable to whoever may delete it (Postgres applies
-- the read policy to the Storage API's delete query too).
create or replace function public.photo_can_read(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.measurement_photos mp
            where mp.path = p_name
              and (mp.status = 'approved'
                   or (mp.status in ('pending', 'hidden')
                       and (mp.owner_id = auth.uid() or public.comment_can_moderate(mp.campaign_id)))))
    or public.photo_can_delete(p_name))
$$;

-- Used by the measurement trigger (runs as the inserting user): error code for a photo path.
create or replace function public.photo_path_error(p_path text, p_user text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_user is distinct from auth.uid()::text
      or p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
      or not exists (select 1 from storage.objects o
                     where o.bucket_id = 'measurement-photos' and o.name = p_path
                       and o.owner_id = p_user)
      or exists (select 1 from private.storage_trash t
                 where t.bucket_id = 'measurement-photos' and t.path = p_path)
      then 'photo_missing'
    when exists (select 1 from public.measurement_photos mp where mp.path = p_path)
      then 'photo_taken'
  end
$$;

-- Replace a photo value in a measurement by "removed" (definer: measurements have no update grant).
create or replace function public.photo_value_removed(p_measurement text, p_field text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.measurements
  set field_values = jsonb_set(field_values, array[p_field], '"removed"'::jsonb)
  where id = p_measurement and field_values ? p_field
$$;

create or replace function public.photo_json(mp public.measurement_photos, p_mod boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'path', mp.path,
    'measurement_id', mp.measurement_id,
    'field_key', mp.field_key,
    'owner_id', mp.owner_id,
    'status', mp.status,
    'created_at', mp.created_at,
    'hidden_reason', mp.hidden_reason,
    'removed_reason', mp.removed_reason,
    'mine', mp.owner_id = auth.uid(),
    'reported', exists (select 1 from public.photo_reports r
                        where r.path = mp.path and r.reporter_id = auth.uid()),
    'reports', case when p_mod then (select count(*) from public.photo_reports r
                                     where r.path = mp.path and r.resolved_at is null) end)
$$;

revoke all on function public.storage_total_bytes() from public, anon, authenticated;
revoke all on function public.storage_trash_add(text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.photo_is_live(text) from public, anon, authenticated;
revoke all on function public.photo_value_removed(text, text) from public, anon, authenticated;
revoke all on function public.photo_json(public.measurement_photos, boolean) from public, anon, authenticated;
-- Called by Storage policies and the measurement trigger as the logged-in user.
revoke all on function public.photo_upload_ok(text) from public, anon;
revoke all on function public.photo_can_read(text) from public, anon;
revoke all on function public.photo_can_delete(text) from public, anon;
revoke all on function public.photo_path_error(text, text) from public, anon;
grant execute on function public.photo_upload_ok(text) to authenticated;
grant execute on function public.photo_can_read(text) to authenticated;
grant execute on function public.photo_can_delete(text) to authenticated;
grant execute on function public.photo_path_error(text, text) to authenticated;

-- =====================================================================
-- 4. Storage policies (bucket measurement-photos; no update policy = no overwriting)
-- =====================================================================

drop policy if exists "measurement photos: upload" on storage.objects;
create policy "measurement photos: upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'measurement-photos' and public.photo_upload_ok(name));

drop policy if exists "measurement photos: read" on storage.objects;
create policy "measurement photos: read"
  on storage.objects for select to authenticated
  using (bucket_id = 'measurement-photos' and public.photo_can_read(name));

drop policy if exists "measurement photos: delete" on storage.objects;
create policy "measurement photos: delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'measurement-photos' and public.photo_can_delete(name));

-- =====================================================================
-- 5. Measurement values: photo = true | "<uuid>.jpg" (+ registration)
-- =====================================================================
-- Same function as in 010, only the photo branch changes.

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
  photos text[] := '{}';
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

  new.field_values := vals;
  new.form_version := cur_version;
  return new;
end;
$$;

drop trigger if exists measurements_validate_values on public.measurements;
create trigger measurements_validate_values
  before insert on public.measurements
  for each row execute function public.measurements_validate_values();

-- After insert: one measurement_photos row per stored photo. A moderator's own photo starts approved.
create or replace function public.measurements_register_photos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  f record;
  v_mod boolean;
begin
  for f in
    select cf.key, new.field_values ->> cf.key as path
    from public.campaign_fields cf
    where cf.campaign_id = new.observation_id and cf.type = 'photo'
      and jsonb_typeof(new.field_values -> cf.key) = 'string'
  loop
    if v_mod is null then
      v_mod := public.comment_can_moderate(new.observation_id);
    end if;
    insert into public.measurement_photos (path, measurement_id, field_key, campaign_id, owner_id, status, decided_at)
    values (f.path, new.id, f.key, new.observation_id, new.user_id::uuid,
            case when v_mod then 'approved' else 'pending' end,
            case when v_mod then now() end);
  end loop;
  return null;
end;
$$;

revoke all on function public.measurements_register_photos() from public, anon, authenticated;

drop trigger if exists measurements_register_photos on public.measurements;
create trigger measurements_register_photos
  after insert on public.measurements
  for each row execute function public.measurements_register_photos();

-- A photo leaves "live" (removed / withdrawn / row deleted) → its file goes to the trash.
create or replace function public.measurement_photos_trash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public.photo_is_live(old.status) then
      perform public.storage_trash_add('measurement-photos', old.path, old.owner_id, old.campaign_id);
    end if;
    return old;
  end if;
  if public.photo_is_live(old.status) and not public.photo_is_live(new.status) then
    perform public.storage_trash_add('measurement-photos', new.path, new.owner_id, new.campaign_id);
  end if;
  return new;
end;
$$;

revoke all on function public.measurement_photos_trash() from public, anon, authenticated;

drop trigger if exists measurement_photos_trash on public.measurement_photos;
create trigger measurement_photos_trash
  after update of status or delete on public.measurement_photos
  for each row execute function public.measurement_photos_trash();

-- =====================================================================
-- 6. Photo RPCs (logged-in users)
-- =====================================================================

-- {can_moderate, photos: [...]} for one measurement: approved ones for everyone logged in,
-- the rest for its author and moderators.
create or replace function public.photo_list(p_measurement text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_campaign text;
  v_mod      boolean;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  select observation_id into v_campaign from public.measurements where id = p_measurement;
  if not found then
    return jsonb_build_object('can_moderate', false, 'photos', '[]'::jsonb);
  end if;
  v_mod := public.comment_can_moderate(v_campaign);
  return jsonb_build_object(
    'can_moderate', v_mod,
    'photos', coalesce((
      select jsonb_agg(public.photo_json(mp, v_mod) order by mp.field_key)
      from public.measurement_photos mp
      where mp.measurement_id = p_measurement
        and (mp.status = 'approved' or v_mod or mp.owner_id = auth.uid())), '[]'::jsonb));
end;
$$;

-- The author deletes their own photo (no log). → the photo JSON.
create or replace function public.photo_withdraw(p_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.measurement_photos;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  select * into v_row from public.measurement_photos where path = p_path for update;
  if not found or v_row.owner_id <> auth.uid() then
    raise exception 'not_found';
  end if;
  if not public.photo_is_live(v_row.status) then
    raise exception 'bad_state';
  end if;
  update public.measurement_photos
  set status = 'withdrawn', decided_at = now(), hidden_at = null, hidden_reason = null
  where path = p_path returning * into v_row;
  update public.photo_reports set resolved_at = now() where path = p_path and resolved_at is null;
  perform public.photo_value_removed(v_row.measurement_id, v_row.field_key);
  return public.photo_json(v_row, false);
end;
$$;

-- Moderators. p_action: 'approve' (pending → approved; hidden → approved = unhide; approved with
-- open reports → "keep", reports dismissed) | 'hide' | 'remove' (p_reason: people | personal_info |
-- off_topic | other — shown to the author). → the photo JSON.
create or replace function public.photo_moderate(p_path text, p_action text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.measurement_photos;
  v_reports integer;
  v_action  text;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  if coalesce(p_action, '') not in ('approve', 'hide', 'remove') then
    raise exception 'bad_request';
  end if;
  if p_action = 'remove' and p_reason is null then
    raise exception 'reason_required';
  end if;
  if p_action = 'remove' and p_reason not in ('people', 'personal_info', 'off_topic', 'other') then
    raise exception 'bad_request';
  end if;
  select * into v_row from public.measurement_photos where path = p_path for update;
  if not found then
    raise exception 'not_found';
  end if;
  if not public.comment_can_moderate(v_row.campaign_id) then
    raise exception 'not_allowed';
  end if;
  if not public.photo_is_live(v_row.status) then
    raise exception 'bad_state';
  end if;
  select count(*) into v_reports from public.photo_reports where path = p_path and resolved_at is null;

  if p_action = 'approve' then
    v_action := case v_row.status when 'pending' then 'approve' when 'hidden' then 'unhide'
                  else case when v_reports > 0 then 'dismiss' end end;
    update public.measurement_photos
    set status = 'approved', decided_at = case when v_row.status = 'approved' then decided_at else now() end,
        hidden_at = null, hidden_reason = null
    where path = p_path returning * into v_row;
  elsif p_action = 'hide' then
    if v_row.status = 'pending' then
      raise exception 'bad_state';
    end if;
    v_action := case when v_row.hidden_reason = 'moderator' then null else 'hide' end;
    update public.measurement_photos
    set status = 'hidden', hidden_at = coalesce(hidden_at, now()), hidden_reason = 'moderator'
    where path = p_path returning * into v_row;
  else
    v_action := 'remove';
    update public.measurement_photos
    set status = 'removed', removed_reason = p_reason, decided_at = now(),
        hidden_at = null, hidden_reason = null
    where path = p_path returning * into v_row;
    perform public.photo_value_removed(v_row.measurement_id, v_row.field_key);
  end if;

  update public.photo_reports set resolved_at = now() where path = p_path and resolved_at is null;
  if v_action is not null then
    insert into public.photo_events (action, path, measurement_id, campaign_id, actor_id, author_id, reports, reason)
    values (v_action, v_row.path, v_row.measurement_id, v_row.campaign_id, auth.uid(), v_row.owner_id,
            v_reports, case when v_action = 'remove' then p_reason end);
  end if;
  return public.photo_json(v_row, true);
end;
$$;

-- → {hidden}: true when this report was the 3rd and the photo is now hidden.
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
  insert into public.photo_reports (path, reporter_id, reason) values (p_path, v_me, p_reason);

  select count(*) into v_open from public.photo_reports where path = p_path and resolved_at is null;
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

-- Photos waiting for me (admins; the badge): pending ones, and ones with open reports or hidden by
-- reports, on labs I moderate. Reporters are not shown.
create or replace function public.photo_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.my_role();
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  if v_role not in ('admin', 'main_admin', 'owner') then
    raise exception 'not_allowed';
  end if;
  return coalesce((
    with per_reason as (
      select r.path, r.reason, count(*) as n, max(r.created_at) as last_at
      from public.photo_reports r
      where r.resolved_at is null
      group by r.path, r.reason
    ), per_photo as (
      select path, jsonb_object_agg(reason, n) as reasons, max(last_at) as last_at
      from per_reason
      group by path
    )
    select jsonb_agg(
             public.photo_json(mp, true) || jsonb_build_object(
               'campaign_id', mp.campaign_id,
               'slug', k.slug,
               'title_he', k.title_he, 'title_en', k.title_en, 'title_ru', k.title_ru,
               'last_report_at', p.last_at,
               'reasons', coalesce(p.reasons, '{}'::jsonb))
             order by (mp.status = 'hidden') desc, (mp.status = 'pending') desc,
                      coalesce(p.last_at, mp.created_at))
    from public.measurement_photos mp
    join public.campaigns k on k.id = mp.campaign_id
    left join per_photo p on p.path = mp.path
    where (mp.status = 'pending' or p.path is not null
           or (mp.status = 'hidden' and mp.hidden_reason = 'reports'))
      and public.lab_may_edit(v_role, auth.uid(), k.created_by)), '[]'::jsonb);
end;
$$;

-- Moderation log (admins), newest first. Usernames are looked up now (none once deleted).
create or replace function public.photo_log(p_limit integer default 50, p_before bigint default null)
returns table (
  id bigint, at timestamptz, action text, path text, measurement_id text, campaign_id text,
  slug text, title_he text, title_en text, title_ru text,
  actor_id uuid, actor_username text, author_id uuid, author_username text, reports integer, reason text)
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
  select e.id, e.at, e.action, e.path, e.measurement_id, e.campaign_id,
         k.slug, k.title_he, k.title_en, k.title_ru,
         e.actor_id, pa.username, e.author_id, pu.username, e.reports, e.reason
  from public.photo_events e
  left join public.campaigns k on k.id = e.campaign_id
  left join public.profiles pa on pa.id = e.actor_id
  left join public.profiles pu on pu.id = e.author_id
  where p_before is null or e.id < p_before
  order by e.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.photo_list(text) from public, anon;
revoke all on function public.photo_withdraw(text) from public, anon;
revoke all on function public.photo_moderate(text, text, text) from public, anon;
revoke all on function public.photo_report(text, text) from public, anon;
revoke all on function public.photo_queue() from public, anon;
revoke all on function public.photo_log(integer, bigint) from public, anon;
grant execute on function public.photo_list(text) to authenticated;
grant execute on function public.photo_withdraw(text) to authenticated;
grant execute on function public.photo_moderate(text, text, text) to authenticated;
grant execute on function public.photo_report(text, text) to authenticated;
grant execute on function public.photo_queue() to authenticated;
grant execute on function public.photo_log(integer, bigint) to authenticated;

-- =====================================================================
-- 7. Edge Function only (secret key): account files, trash sweep
-- =====================================================================

-- Every file a user uploaded, in any bucket: [{bucket, path}].
create or replace function public.account_storage_objects(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name)), '[]'::jsonb)
  from storage.objects o
  where o.owner_id = p_user::text
$$;

-- Forgets queued files that no longer exist, then returns up to p_limit queued ones
-- ({done, pending: [{bucket, path}]}) and counts the attempt.
create or replace function public.storage_sweep(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_done  integer;
  v_list  jsonb;
begin
  delete from private.storage_trash t
  where not exists (select 1 from storage.objects o where o.bucket_id = t.bucket_id and o.name = t.path);
  get diagnostics n_done = row_count;

  with picked as (
    select bucket_id, path from private.storage_trash
    order by attempts, queued_at
    limit least(greatest(coalesce(p_limit, 500), 1), 1000)
  ), bumped as (
    update private.storage_trash t set attempts = t.attempts + 1
    from picked p where t.bucket_id = p.bucket_id and t.path = p.path
    returning t.bucket_id, t.path
  )
  select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket_id, 'path', path)), '[]'::jsonb)
  into v_list from bumped;

  return jsonb_build_object('done', n_done, 'pending', v_list);
end;
$$;

revoke all on function public.account_storage_objects(uuid) from public, anon, authenticated;
revoke all on function public.storage_sweep(integer) from public, anon, authenticated;
grant execute on function public.account_storage_objects(uuid) to service_role;
grant execute on function public.storage_sweep(integer) to service_role;

-- =====================================================================
-- 8. Account deletion (new versions of the 015 functions, same arguments)
-- =====================================================================

-- 015 + photos: how many of my photos will be deleted.
create or replace function public.account_delete_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_up public.profiles;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  select * into v_me from public.profiles where id = auth.uid();
  if not found then
    raise exception 'not_logged_in';
  end if;
  select * into v_up from public.profiles where id = v_me.role_granted_by;
  return jsonb_build_object(
    'role', v_me.role,
    'can_delete', v_me.role <> 'owner',
    'measurements', (select count(*) from public.measurements m where m.user_id = v_me.id::text),
    'admins_moved', (select count(*) from public.profiles p where p.role_granted_by = v_me.id),
    'moved_under', case when v_up.id is not null
                     then jsonb_build_object('id', v_up.id, 'username', v_up.username) end,
    'labs_created', (select count(*) from public.campaigns c where c.created_by = v_me.id),
    'drafts', (select count(*) from public.campaigns c
               where c.created_by = v_me.id and c.publication <> 'published'),
    'open_revisions', (select count(*) from public.lab_revisions r
                       where r.proposed_by = v_me.id and r.status in ('draft', 'in_review')),
    'comments', (select count(*) from public.comments c where c.author_id = v_me.id),
    'comments_on_measurements', (select count(*) from public.comments c
                                 join public.measurements m on m.id = c.measurement_id
                                 where m.user_id = v_me.id::text and c.author_id <> v_me.id),
    'photos', (select count(*) from public.measurement_photos mp
               where mp.owner_id = v_me.id and public.photo_is_live(mp.status)));
end;
$$;

revoke all on function public.account_delete_preview() from public, anon;
grant execute on function public.account_delete_preview() to authenticated;

-- 015 + photos: always deleted (queued for the Storage API; the Edge Function removes the files
-- before deleting the auth user), their values in kept measurements become "removed"; photo
-- reports and the photo-report rate-limit row are deleted.
-- Returns {anon_id, measurements, admins_moved, revisions_discarded, comments, photos}.
create or replace function public.account_delete_prepare(p_user uuid, p_username text, p_delete_measurements boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     public.profiles;
  v_event  bigint;
  v_anon   text := pg_catalog.gen_random_uuid()::text;
  v_rev    public.lab_revisions;
  v_photo  public.measurement_photos;
  n_moved  integer;
  n_meas   integer;
  n_rev    integer := 0;
  n_comm   integer;
  n_photo  integer := 0;
begin
  -- Same lock as every role change: the chain cannot change while it is being moved.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mitzpe.roles', 0));

  select * into v_me from public.profiles where id = p_user for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_me.role = 'owner' then
    raise exception 'owner_cannot_delete';
  end if;
  if v_me.username is null then
    raise exception 'no_username';
  end if;
  if public.username_key(public.username_normalize(p_username)) is distinct from v_me.username_key then
    raise exception 'username_mismatch';
  end if;

  -- Lets profiles_guard accept the role_granted_by change (and skips the SQL-change log row).
  perform pg_catalog.set_config('mitzpe.admin_op', pg_catalog.txid_current()::text, true);

  -- The deletion in the role log (once, even if this runs again after a failed auth deletion).
  select e.id into v_event from public.role_events e
  where e.action = 'account_deleted' and e.target_id = p_user
  order by e.id desc limit 1;
  if v_event is null then
    insert into public.role_events (actor_id, target_id, action, old_role, moved_under)
    values (p_user, p_user, 'account_deleted', v_me.role, v_me.role_granted_by)
    returning id into v_event;
  end if;

  -- Admins they appointed move one level up; everyone below them stays where they are.
  insert into public.role_events (actor_id, target_id, action, old_role, new_role, moved_under, cause_id)
  select null, p.id, 'chain_moved', p.role, p.role, v_me.role_granted_by, v_event
  from public.profiles p
  where p.role_granted_by = p_user;

  update public.profiles
  set role_granted_by = v_me.role_granted_by
  where role_granted_by = p_user;
  get diagnostics n_moved = row_count;

  -- Comments and reports are always deleted (015). Before the measurements, so the count is theirs.
  delete from public.comments where author_id = p_user;
  get diagnostics n_comm = row_count;
  delete from public.comment_reports where reporter_id = p_user;

  -- Photos are always deleted (016), also when the measurements are kept. Files → trash (trigger).
  for v_photo in select * from public.measurement_photos where owner_id = p_user for update loop
    perform public.photo_value_removed(v_photo.measurement_id, v_photo.field_key);
    if public.photo_is_live(v_photo.status) then
      n_photo := n_photo + 1;
    end if;
  end loop;
  delete from public.measurement_photos where owner_id = p_user;
  delete from public.photo_reports where reporter_id = p_user;
  -- Files uploaded but never attached.
  insert into private.storage_trash (bucket_id, path, owner_id)
  select o.bucket_id, o.name, p_user from storage.objects o where o.owner_id = p_user::text
  on conflict (bucket_id, path) do nothing;

  n_meas := public.account_delete_measurements(p_user, v_anon, coalesce(p_delete_measurements, false));

  -- Open revisions they proposed are discarded (nobody would own them).
  for v_rev in
    select * from public.lab_revisions
    where proposed_by = p_user and status in ('draft', 'in_review')
    for update
  loop
    update public.lab_revisions
    set status = 'discarded', edit_no = edit_no + 1, updated_at = now()
    where id = v_rev.id
    returning * into v_rev;
    perform public.lab_log_revision(v_rev, p_user, 'revision_discard', v_rev.round);
    n_rev := n_rev + 1;
  end loop;

  -- Rate-limit buckets that contain the username or the user id.
  delete from private.rate_limit_hits
  where bucket in ('login:user:' || v_me.username_key, 'recover:user:' || v_me.username_key,
                   'comment:user:' || p_user::text, 'report:user:' || p_user::text,
                   'photo_report:user:' || p_user::text);

  return jsonb_build_object('anon_id', v_anon, 'measurements', n_meas,
                            'admins_moved', n_moved, 'revisions_discarded', n_rev,
                            'comments', n_comm, 'photos', n_photo);
end;
$$;

revoke all on function public.account_delete_prepare(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.account_delete_prepare(uuid, text, boolean) to service_role;

-- 015 + files uploaded between prepare and the auth deletion go to the trash (the daily sweep
-- removes them); the photo-report rate-limit row.
-- Returns {measurements, audit_log, files_queued}.
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
                   'report:user:' || p_user::text, 'photo_report:user:' || p_user::text);

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

-- =====================================================================
-- 9. Retention: daily cleanup (pg_cron). File removal itself: the Edge Function's `sweep`
--    (scheduled by hand with pg_net, SETUP_AUTH.md → 19).
-- =====================================================================

create or replace function private.photos_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row      public.measurement_photos;
  n_expired  integer := 0;
  n_rows     integer;
  n_reports  integer;
  n_orphans  integer;
begin
  -- Hidden for 90 days → removed (file to the trash).
  for v_row in
    select * from public.measurement_photos
    where status = 'hidden' and hidden_at < now() - interval '90 days'
    for update
  loop
    update public.measurement_photos
    set status = 'removed', removed_reason = 'expired', decided_at = now(),
        hidden_at = null, hidden_reason = null
    where path = v_row.path;
    perform public.photo_value_removed(v_row.measurement_id, v_row.field_key);
    insert into public.photo_events (action, path, measurement_id, campaign_id, actor_id, author_id, reason)
    values ('expire', v_row.path, v_row.measurement_id, v_row.campaign_id, null, v_row.owner_id, 'expired');
    n_expired := n_expired + 1;
  end loop;

  -- Rows without a file, 90 days after the decision.
  delete from public.measurement_photos
  where status in ('removed', 'withdrawn') and decided_at < now() - interval '90 days';
  get diagnostics n_rows = row_count;

  delete from public.photo_reports where resolved_at < now() - interval '90 days';
  get diagnostics n_reports = row_count;

  -- Uploaded but never attached to a measurement, older than 24 hours.
  insert into private.storage_trash (bucket_id, path, owner_id)
  select o.bucket_id, o.name, case when o.owner_id ~ '^[0-9a-f-]{36}$' then o.owner_id::uuid end
  from storage.objects o
  where o.bucket_id = 'measurement-photos'
    and o.created_at < now() - interval '24 hours'
    and not exists (select 1 from public.measurement_photos mp where mp.path = o.name)
  on conflict (bucket_id, path) do nothing;
  get diagnostics n_orphans = row_count;

  return jsonb_build_object('expired', n_expired, 'rows', n_rows,
                            'resolved_reports', n_reports, 'orphans_queued', n_orphans);
end;
$$;

revoke all on function private.photos_cleanup() from public, anon, authenticated;

select cron.schedule('mitzpe-photos-cleanup', '37 3 * * *', 'select private.photos_cleanup()');

notify pgrst, 'reload schema';
