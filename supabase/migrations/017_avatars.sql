-- 017_avatars.sql
-- Profile pictures in Supabase Storage (PR 2 of "images"): every user may have one; admins must
-- use a photo of their own face, confirmed by the person who appointed them.
-- Run once in the Supabase SQL Editor, AFTER 016. Safe to re-run.
-- Compatible with the production frontend: it adds a bucket, tables and functions; lab_begin,
-- lab_credits and the three account-deletion functions keep their arguments (credits and the
-- deletion results only get extra keys). The admin-photo requirement is behind a switch that starts
-- OFF (private.settings.require_admin_photo), so labs keep working until the owner turns it on.
-- No Edge Function change: `delete` already removes every file a user owns (any bucket) and
-- `sweep` already empties the trash of every bucket (016).
--
-- Rules:
--   * Bucket `avatars`: private (no public URLs), JPEG only, ≤ 100 KB per file (the browser sends a
--     256 px square). Names <uuid v4>.jpg, never overwritten. Upload: logged in with a username,
--     ≤ 10 per user per 24 h, under the 900 MB cap shared with measurement photos.
--   * One picture per user (public.avatars). kind follows the role at upload time:
--       student — any image (a drawing or an avatar is suggested); status active | hidden.
--       admin   — a photo of their own face with consent (consent_at); status pending → confirmed,
--                 or hidden. A new photo always starts pending.
--   * Who sees a picture (signed URLs through the read policy; avatar_paths for the UI): logged-in
--     users only. Student: when active. Admin: when confirmed. Always: its owner; main admins and
--     the owner (moderators); the confirmer of a pending admin photo.
--   * Confirmer of an admin photo (avatar_confirmer): the admin who appointed them
--     (profiles.role_granted_by) while that person is still an admin / main admin / owner; else
--     the owner. The owner's own photo is confirmed automatically (logged 'auto_confirm'). The owner
--     may also confirm any pending photo. Reject deletes the photo (optional reason, shown to the
--     admin). The confirmer does not need a confirmed photo of their own.
--   * Reports (reason code only, one per user per picture, 20 per day): 3 open reports hide a
--     student picture; admin photos are never hidden automatically — main admins / the owner
--     decide. Moderators of pictures: main admins and the owner (hide / show again / delete).
--   * Role changes (trigger on profiles): admin → student deletes the admin photo; student → admin
--     deletes the student picture (the face photo starts clean). admin ↔ main admin keeps it.
--   * With require_admin_photo on, every lab function (lab_begin) answers admin_photo_required
--     for an admin without a confirmed photo.
--   * Log avatar_events: ids, codes and reasons only, never the image; readable by admins.
--   * Retention (pg_cron, daily): hidden pictures are deleted 90 days after hiding; resolved
--     reports after 90 days; uploads never used as a picture are queued for deletion after 24 h.
--   * Account deletion: the picture is always deleted (the file with all the user's files).
--
-- Errors (message): not_logged_in, no_username, not_allowed, not_found, bad_request, bad_state,
--   photo_missing, consent_required, reason_too_long, already_reported, rate_limited,
--   admin_photo_required (lab functions).

create extension if not exists pg_cron with schema pg_catalog;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- =====================================================================
-- 1. Bucket and settings
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 102400, array['image/jpeg'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Switches the owner flips in the SQL Editor. require_admin_photo: 'true' | 'false'.
create table if not exists private.settings (
  key    text primary key,
  value  text not null
);
revoke all on private.settings from public, anon, authenticated;
insert into private.settings (key, value) values ('require_admin_photo', 'false')
on conflict (key) do nothing;

create or replace function public.admin_photo_required_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value = 'true' from private.settings where key = 'require_admin_photo'), false)
$$;

-- =====================================================================
-- 2. Tables
-- =====================================================================

create table if not exists public.avatars (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  path           text not null unique
                 check (path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'),
  kind           text not null check (kind in ('student', 'admin')),
  status         text not null check (status in ('active', 'pending', 'confirmed', 'hidden')),
  created_at     timestamptz not null default now(),
  consent_at     timestamptz,
  confirmed_by   uuid references public.profiles (id) on delete set null,
  confirmed_at   timestamptz,
  hidden_at      timestamptz,
  hidden_reason  text check (hidden_reason in ('moderator', 'reports')),
  check (kind = 'admin' or status in ('active', 'hidden')),
  check (kind = 'student' or status in ('pending', 'confirmed', 'hidden')),
  check (kind = 'student' or consent_at is not null),
  check ((status = 'hidden') = (hidden_at is not null)),
  check ((hidden_at is null) = (hidden_reason is null))
);
create index if not exists avatars_status_idx on public.avatars (status);

create table if not exists public.avatar_reports (
  path         text not null references public.avatars (path) on delete cascade,
  reporter_id  uuid not null references public.profiles (id) on delete cascade,
  reason       text not null check (reason in ('bullying', 'personal_info', 'spam', 'other')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  primary key (path, reporter_id)
);
create index if not exists avatar_reports_open_idx on public.avatar_reports (path) where resolved_at is null;
create index if not exists avatar_reports_reporter_idx on public.avatar_reports (reporter_id);

-- Log. No images: ids, codes, the optional reject reason. actor_id null = the system
-- ('auto_confirm', 'auto_hide', 'expire', 'role_removed').
create table if not exists public.avatar_events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  action     text not null check (action in ('upload', 'remove', 'confirm', 'auto_confirm', 'reject',
                                              'hide', 'unhide', 'dismiss', 'delete', 'auto_hide',
                                              'expire', 'role_removed')),
  user_id    uuid references public.profiles (id) on delete set null,
  actor_id   uuid references public.profiles (id) on delete set null,
  kind       text,
  reports    integer not null default 0,
  reason     text
);
create index if not exists avatar_events_at_idx on public.avatar_events (id desc);
create index if not exists avatar_events_user_idx on public.avatar_events (user_id, id desc);

alter table public.avatars enable row level security;
alter table public.avatar_reports enable row level security;
alter table public.avatar_events enable row level security;
revoke all on public.avatars, public.avatar_reports, public.avatar_events from public, anon, authenticated;

-- =====================================================================
-- 3. Helpers
-- =====================================================================

-- Who confirms this user's admin photo: their appointer while still an admin, else the owner.
create or replace function public.avatar_confirmer(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select g.id from public.profiles t
     join public.profiles g on g.id = t.role_granted_by
     where t.id = p_user and public.role_rank(g.role) >= 1 and g.id <> p_user),
    (select o.id from public.profiles o where o.role = 'owner' and o.id <> p_user limit 1))
$$;

-- Moderators of pictures: main admins and the owner.
create or replace function public.avatar_is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.my_role() in ('main_admin', 'owner')
$$;

-- May the caller see this picture?
create or replace function public.avatar_visible(a public.avatars)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    a.user_id = auth.uid()
    or (a.kind = 'student' and a.status = 'active')
    or (a.kind = 'admin' and a.status = 'confirmed')
    or public.avatar_is_moderator()
    or (a.kind = 'admin' and a.status = 'pending' and public.avatar_confirmer(a.user_id) = auth.uid()))
$$;

-- The path to show next to a name in lists (credits, comments …): shown pictures only (+ own).
create or replace function public.avatar_shown_path(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.path from public.avatars a
  where a.user_id = p_user and auth.uid() is not null
    and ((a.kind = 'student' and a.status = 'active')
         or (a.kind = 'admin' and a.status = 'confirmed')
         or (a.user_id = auth.uid() and a.status <> 'hidden'))
$$;

-- Upload policy: logged in with a username, a random name, ≤ 10 per 24 h, under the 900 MB cap.
create or replace function public.avatar_upload_ok(p_name text)
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
         where o.bucket_id = 'avatars' and o.owner_id = auth.uid()::text
           and o.created_at > now() - interval '24 hours') < 10
    and public.storage_total_bytes() < 900::bigint * 1024 * 1024
$$;

-- Delete policy: a queued file — by its owner or a moderator; or an own file never used.
create or replace function public.avatar_can_delete(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (select 1 from private.storage_trash t
            where t.bucket_id = 'avatars' and t.path = p_name
              and (t.owner_id = auth.uid() or public.avatar_is_moderator()))
    or (not exists (select 1 from public.avatars a where a.path = p_name)
        and exists (select 1 from storage.objects o
                    where o.bucket_id = 'avatars' and o.name = p_name
                      and o.owner_id = auth.uid()::text)))
$$;

-- Read policy (signed URLs). A queued file stays readable to whoever may delete it (Postgres
-- applies the read policy to the Storage API's delete query too).
create or replace function public.avatar_can_read(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.avatars a where a.path = p_name and public.avatar_visible(a))
    or public.avatar_can_delete(p_name))
$$;

-- An admin with a confirmed photo (the lab functions' check when the switch is on).
create or replace function public.admin_photo_ok(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.avatars a
                 where a.user_id = p_user and a.kind = 'admin' and a.status = 'confirmed')
$$;

create or replace function public.avatar_json(a public.avatars, p_mod boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', a.user_id,
    'path', a.path,
    'kind', a.kind,
    'status', a.status,
    'created_at', a.created_at,
    'confirmed_at', a.confirmed_at,
    'hidden_reason', a.hidden_reason,
    'mine', a.user_id = auth.uid(),
    'reported', exists (select 1 from public.avatar_reports r
                        where r.path = a.path and r.reporter_id = auth.uid()),
    'reports', case when p_mod then (select count(*) from public.avatar_reports r
                                     where r.path = a.path and r.resolved_at is null) end)
$$;

-- Picture file of this user, queued for deletion when the row goes.
create or replace function public.avatars_trash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.storage_trash_add('avatars', old.path, old.user_id, null);
  return old;
end;
$$;

drop trigger if exists avatars_trash on public.avatars;
create trigger avatars_trash
  after delete on public.avatars
  for each row execute function public.avatars_trash();

revoke all on function public.admin_photo_required_on() from public, anon, authenticated;
revoke all on function public.avatar_confirmer(uuid) from public, anon, authenticated;
revoke all on function public.avatar_is_moderator() from public, anon, authenticated;
revoke all on function public.avatar_visible(public.avatars) from public, anon, authenticated;
revoke all on function public.avatar_shown_path(uuid) from public, anon, authenticated;
revoke all on function public.admin_photo_ok(uuid) from public, anon, authenticated;
revoke all on function public.avatar_json(public.avatars, boolean) from public, anon, authenticated;
revoke all on function public.avatars_trash() from public, anon, authenticated;
-- Called by the Storage policies as the logged-in user.
revoke all on function public.avatar_upload_ok(text) from public, anon;
revoke all on function public.avatar_can_delete(text) from public, anon;
revoke all on function public.avatar_can_read(text) from public, anon;
grant execute on function public.avatar_upload_ok(text) to authenticated;
grant execute on function public.avatar_can_delete(text) to authenticated;
grant execute on function public.avatar_can_read(text) to authenticated;

-- =====================================================================
-- 4. Storage policies (bucket avatars; no update policy = no overwriting)
-- =====================================================================

drop policy if exists "avatars: upload" on storage.objects;
create policy "avatars: upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.avatar_upload_ok(name));

drop policy if exists "avatars: read" on storage.objects;
create policy "avatars: read"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.avatar_can_read(name));

drop policy if exists "avatars: delete" on storage.objects;
create policy "avatars: delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.avatar_can_delete(name));

-- =====================================================================
-- 5. Role changes: the picture never crosses the student / admin line
-- =====================================================================

create or replace function public.profiles_avatar_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.avatars;
begin
  if (public.role_rank(old.role) >= 1) = (public.role_rank(new.role) >= 1) then
    return null;
  end if;
  delete from public.avatars where user_id = new.id returning * into v_old;
  if v_old.user_id is not null then
    insert into public.avatar_events (action, user_id, actor_id, kind)
    values ('role_removed', new.id, null, v_old.kind);
  end if;
  return null;
end;
$$;

revoke all on function public.profiles_avatar_role() from public, anon, authenticated;

drop trigger if exists profiles_avatar_role on public.profiles;
create trigger profiles_avatar_role
  after update of role on public.profiles
  for each row execute function public.profiles_avatar_role();

-- =====================================================================
-- 6. Own picture (logged-in users)
-- =====================================================================

-- {avatar: {...} | null, rejected: {reason, at} | null (after my last upload), confirmer_username,
--  required: the admin-photo switch}
create or replace function public.avatar_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_row   public.avatars;
  v_last  public.avatar_events;
begin
  if v_me is null then
    raise exception 'not_logged_in';
  end if;
  select * into v_row from public.avatars where user_id = v_me;
  -- A rejection is shown until the next upload / removal.
  select * into v_last from public.avatar_events e
  where e.user_id = v_me and e.action in ('upload', 'remove', 'reject', 'delete', 'expire', 'role_removed')
  order by e.id desc limit 1;
  return jsonb_build_object(
    'avatar', case when v_row.user_id is not null then public.avatar_json(v_row, false) end,
    'rejected', case when v_row.user_id is null and v_last.action = 'reject'
                  then jsonb_build_object('reason', v_last.reason, 'at', v_last.at) end,
    'confirmer_username', (select username from public.profiles
                           where id = public.avatar_confirmer(v_me)),
    'required', public.admin_photo_required_on());
end;
$$;

-- Use an uploaded file as my picture (replaces the old one). Admins must pass p_consent = true.
create or replace function public.avatar_set(p_path text, p_consent boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    public.profiles;
  v_kind  text;
  v_row   public.avatars;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  select * into v_me from public.profiles where id = auth.uid() for update;
  if not found then
    raise exception 'not_logged_in';
  end if;
  if v_me.username is null then
    raise exception 'no_username';
  end if;
  if p_path is null
     or p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
     or not exists (select 1 from storage.objects o
                    where o.bucket_id = 'avatars' and o.name = p_path and o.owner_id = v_me.id::text)
     or exists (select 1 from private.storage_trash t where t.bucket_id = 'avatars' and t.path = p_path)
     or exists (select 1 from public.avatars a where a.path = p_path) then
    raise exception 'photo_missing';
  end if;
  v_kind := case when public.role_rank(v_me.role) >= 1 then 'admin' else 'student' end;
  if v_kind = 'admin' and p_consent is not true then
    raise exception 'consent_required';
  end if;

  delete from public.avatars where user_id = v_me.id;   -- old file → trash (trigger)
  insert into public.avatars (user_id, path, kind, status, consent_at, confirmed_by, confirmed_at)
  values (v_me.id, p_path, v_kind,
          case when v_kind = 'student' then 'active'
               when v_me.role = 'owner' then 'confirmed' else 'pending' end,
          case when v_kind = 'admin' then now() end,
          null,
          case when v_kind = 'admin' and v_me.role = 'owner' then now() end)
  returning * into v_row;
  insert into public.avatar_events (action, user_id, actor_id, kind)
  values ('upload', v_me.id, v_me.id, v_kind);
  if v_kind = 'admin' and v_me.role = 'owner' then
    insert into public.avatar_events (action, user_id, actor_id, kind)
    values ('auto_confirm', v_me.id, null, v_kind);
  end if;
  return public.avatar_me();
end;
$$;

-- Remove my picture.
create or replace function public.avatar_remove()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.avatars;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  delete from public.avatars where user_id = auth.uid() returning * into v_old;
  if v_old.user_id is not null then
    insert into public.avatar_events (action, user_id, actor_id, kind)
    values ('remove', auth.uid(), auth.uid(), v_old.kind);
  end if;
  return public.avatar_me();
end;
$$;

-- {user id: path} for the pictures I may see next to names (logged-in users; others get {}).
create or replace function public.avatar_paths(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(a.user_id, a.path), '{}'::jsonb)
  from public.avatars a
  where a.user_id = any (coalesce(p_ids, '{}'::uuid[]))
    and a.path = public.avatar_shown_path(a.user_id)
$$;

-- One user's picture with what I may do (profile page): {avatar, can_moderate, can_confirm} | null.
create or replace function public.avatar_get(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.avatars;
  v_mod boolean := public.avatar_is_moderator();
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  select * into v_row from public.avatars where user_id = p_user;
  if not found or not public.avatar_visible(v_row) then
    return null;
  end if;
  return jsonb_build_object(
    'avatar', public.avatar_json(v_row, v_mod),
    'can_moderate', v_mod,
    'can_confirm', v_row.status = 'pending'
                   and (public.avatar_confirmer(p_user) = auth.uid() or public.my_role() = 'owner'));
end;
$$;

-- → {hidden}: true when this report hid a student picture (3 open reports). Admin photos are
-- never hidden by reports.
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
  insert into public.avatar_reports (path, reporter_id, reason) values (v_row.path, v_me, p_reason);

  select count(*) into v_open from public.avatar_reports where path = v_row.path and resolved_at is null;
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
-- 7. Confirmation and moderation (admins)
-- =====================================================================

-- Confirmer (or the owner): p_approve → confirmed; else rejected — the photo is deleted and the
-- optional reason (≤ 500) is shown to the admin.
create or replace function public.avatar_confirm(p_user uuid, p_approve boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    public.avatars;
  v_reason text := public.lab_line(p_reason);
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  if p_approve is null then
    raise exception 'bad_request';
  end if;
  if pg_catalog.char_length(coalesce(v_reason, '')) > 500 then
    raise exception 'reason_too_long';
  end if;
  select * into v_row from public.avatars where user_id = p_user for update;
  if not found then
    raise exception 'not_found';
  end if;
  if not (public.avatar_confirmer(p_user) = auth.uid() or public.my_role() = 'owner')
     or p_user = auth.uid() then
    raise exception 'not_allowed';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'bad_state';
  end if;
  if p_approve then
    update public.avatars set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
    where user_id = p_user returning * into v_row;
    insert into public.avatar_events (action, user_id, actor_id, kind)
    values ('confirm', p_user, auth.uid(), v_row.kind);
    return public.avatar_json(v_row, true);
  end if;
  delete from public.avatars where user_id = p_user;
  insert into public.avatar_events (action, user_id, actor_id, kind, reason)
  values ('reject', p_user, auth.uid(), v_row.kind, v_reason);
  return null;
end;
$$;

-- Main admins / owner. p_action: 'hide' | 'unhide' (also "keep": dismisses open reports) | 'delete'.
-- → the picture JSON, or null after delete.
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

-- What waits for me (admins; the badge): admin photos I confirm; for main admins / the owner also
-- pictures with open reports or hidden by reports. Reporters are not shown.
-- [{..avatar, username, full_name, workplace, queue: 'confirm' | 'reported', reasons, last_report_at}]
create or replace function public.avatar_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mod boolean := public.avatar_is_moderator();
begin
  if not public.is_admin() then
    raise exception 'not_allowed';
  end if;
  return coalesce((
    with per_reason as (
      select r.path, r.reason, count(*) as n, max(r.created_at) as last_at
      from public.avatar_reports r
      where r.resolved_at is null
      group by r.path, r.reason
    ), per_pic as (
      select path, jsonb_object_agg(reason, n) as reasons, max(last_at) as last_at
      from per_reason
      group by path
    )
    select jsonb_agg(
             public.avatar_json(a, v_mod) || jsonb_build_object(
               'username', p.username,
               'full_name', ap.full_name,
               'workplace', ap.workplace,
               'queue', case when a.status = 'pending' then 'confirm' else 'reported' end,
               'reasons', coalesce(pp.reasons, '{}'::jsonb),
               'last_report_at', pp.last_at)
             order by (a.status = 'pending') desc, coalesce(pp.last_at, a.created_at))
    from public.avatars a
    join public.profiles p on p.id = a.user_id
    left join public.admin_profiles ap on ap.user_id = a.user_id
    left join per_pic pp on pp.path = a.path
    where a.user_id <> auth.uid()
      and ((a.status = 'pending'
            and (public.avatar_confirmer(a.user_id) = auth.uid() or public.my_role() = 'owner'))
           or (v_mod and (pp.path is not null or (a.status = 'hidden' and a.hidden_reason = 'reports'))))),
    '[]'::jsonb);
end;
$$;

-- Log (admins), newest first. Usernames are looked up now (none once deleted).
create or replace function public.avatar_log(p_limit integer default 50, p_before bigint default null)
returns table (
  id bigint, at timestamptz, action text, user_id uuid, username text,
  actor_id uuid, actor_username text, kind text, reports integer, reason text)
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
  select e.id, e.at, e.action, e.user_id, pu.username, e.actor_id, pa.username, e.kind, e.reports, e.reason
  from public.avatar_events e
  left join public.profiles pu on pu.id = e.user_id
  left join public.profiles pa on pa.id = e.actor_id
  where p_before is null or e.id < p_before
  order by e.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.avatar_me() from public, anon;
revoke all on function public.avatar_set(text, boolean) from public, anon;
revoke all on function public.avatar_remove() from public, anon;
revoke all on function public.avatar_paths(uuid[]) from public, anon;
revoke all on function public.avatar_get(uuid) from public, anon;
revoke all on function public.avatar_report(uuid, text) from public, anon;
revoke all on function public.avatar_confirm(uuid, boolean, text) from public, anon;
revoke all on function public.avatar_moderate(uuid, text) from public, anon;
revoke all on function public.avatar_queue() from public, anon;
revoke all on function public.avatar_log(integer, bigint) from public, anon;
grant execute on function public.avatar_me() to authenticated;
grant execute on function public.avatar_set(text, boolean) to authenticated;
grant execute on function public.avatar_remove() to authenticated;
grant execute on function public.avatar_paths(uuid[]) to authenticated;
grant execute on function public.avatar_get(uuid) to authenticated;
grant execute on function public.avatar_report(uuid, text) to authenticated;
grant execute on function public.avatar_confirm(uuid, boolean, text) to authenticated;
grant execute on function public.avatar_moderate(uuid, text) to authenticated;
grant execute on function public.avatar_queue() to authenticated;
grant execute on function public.avatar_log(integer, bigint) to authenticated;

-- =====================================================================
-- 8. Lab functions: the admin-photo requirement (switch) and photos in the credits
-- =====================================================================

-- 010 + with require_admin_photo on: a confirmed admin photo.
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
  if public.admin_photo_required_on() and not public.admin_photo_ok(v_me.id) then
    raise exception 'admin_photo_required';
  end if;
  return v_me;
end;
$$;

revoke all on function public.lab_begin() from public, anon, authenticated;

-- 012 + 'avatar' (path of a confirmed admin photo; logged-in callers only) for every person.
create or replace function public.lab_credits(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
      'legacy', c.published_at is null,
      'published_at', c.published_at,
      'creator', case when c.published_at is not null then
                   (select jsonb_build_object('full_name', a.full_name, 'position', a.position, 'workplace', a.workplace,
                                              'avatar', public.avatar_shown_path(c.created_by))
                    from (select 1) x left join public.admin_profiles a on a.user_id = c.created_by) end,
      'approvers', case when c.published_at is not null then coalesce((
                     select jsonb_agg(jsonb_build_object('full_name', a.full_name, 'position', a.position,
                                                         'workplace', a.workplace, 'at', r.at,
                                                         'avatar', public.avatar_shown_path(r.reviewer_id))
                                      order by r.at)
                     from public.lab_reviews r
                     left join public.admin_profiles a on a.user_id = r.reviewer_id
                     where r.campaign_id = c.id and r.revision_id is null and r.round = c.review_round
                       and r.verdict = 'approve'), '[]'::jsonb) end,
      'update', (
        select jsonb_build_object(
          'applied_at', v.applied_at,
          'approvers', coalesce((
            select jsonb_agg(jsonb_build_object('full_name', a.full_name, 'position', a.position,
                                                'workplace', a.workplace, 'at', r.at,
                                                'avatar', public.avatar_shown_path(r.reviewer_id))
                             order by r.at)
            from public.lab_reviews r
            left join public.admin_profiles a on a.user_id = r.reviewer_id
            where r.revision_id = v.id and r.round = v.round and r.verdict = 'approve'), '[]'::jsonb))
        from public.lab_revisions v
        where v.campaign_id = c.id and v.status = 'applied'
        order by v.applied_at desc limit 1))
  from public.campaigns c
  where c.id = p_id and c.publication = 'published'
$$;

revoke all on function public.lab_credits(text) from public;
grant execute on function public.lab_credits(text) to anon, authenticated;

-- =====================================================================
-- 9. Account deletion (new versions of the 016 functions, same arguments)
-- =====================================================================

-- 016 + avatar: whether I have a profile picture (always deleted).
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
               where mp.owner_id = v_me.id and public.photo_is_live(mp.status)),
    'avatar', exists (select 1 from public.avatars a where a.user_id = v_me.id));
end;
$$;

revoke all on function public.account_delete_preview() from public, anon;
grant execute on function public.account_delete_preview() to authenticated;

-- 016 + the profile picture (017) is always deleted (file queued; the Edge Function removes all the
-- user's files before deleting the auth user); their picture reports and rate-limit row too.
-- Returns {anon_id, measurements, admins_moved, revisions_discarded, comments, photos, avatar}.
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
  n_avatar integer;
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
  -- The profile picture (017), and the user's reports on pictures.
  delete from public.avatars where user_id = p_user;
  get diagnostics n_avatar = row_count;
  delete from public.avatar_reports where reporter_id = p_user;
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
                   'photo_report:user:' || p_user::text, 'avatar_report:user:' || p_user::text);

  return jsonb_build_object('anon_id', v_anon, 'measurements', n_meas,
                            'admins_moved', n_moved, 'revisions_discarded', n_rev,
                            'comments', n_comm, 'photos', n_photo, 'avatar', n_avatar > 0);
end;
$$;

revoke all on function public.account_delete_prepare(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.account_delete_prepare(uuid, text, boolean) to service_role;

-- 016 + the picture-report rate-limit row (017).
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
                   'report:user:' || p_user::text, 'photo_report:user:' || p_user::text,
                   'avatar_report:user:' || p_user::text);

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
-- 10. Retention: daily cleanup (pg_cron). File removal itself: the Edge Function's `sweep` (016).
-- =====================================================================

create or replace function private.avatars_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row      public.avatars;
  n_expired  integer := 0;
  n_reports  integer;
  n_orphans  integer;
begin
  -- Hidden for 90 days → deleted (file to the trash).
  for v_row in
    select * from public.avatars where status = 'hidden' and hidden_at < now() - interval '90 days'
    for update
  loop
    delete from public.avatars where user_id = v_row.user_id;
    insert into public.avatar_events (action, user_id, actor_id, kind)
    values ('expire', v_row.user_id, null, v_row.kind);
    n_expired := n_expired + 1;
  end loop;

  delete from public.avatar_reports where resolved_at < now() - interval '90 days';
  get diagnostics n_reports = row_count;

  -- Uploaded but never used as a picture, older than 24 hours.
  insert into private.storage_trash (bucket_id, path, owner_id)
  select o.bucket_id, o.name, case when o.owner_id ~ '^[0-9a-f-]{36}$' then o.owner_id::uuid end
  from storage.objects o
  where o.bucket_id = 'avatars'
    and o.created_at < now() - interval '24 hours'
    and not exists (select 1 from public.avatars a where a.path = o.name)
  on conflict (bucket_id, path) do nothing;
  get diagnostics n_orphans = row_count;

  return jsonb_build_object('expired', n_expired, 'resolved_reports', n_reports, 'orphans_queued', n_orphans);
end;
$$;

revoke all on function private.avatars_cleanup() from public, anon, authenticated;

select cron.schedule('mitzpe-avatars-cleanup', '39 3 * * *', 'select private.avatars_cleanup()');

notify pgrst, 'reload schema';
