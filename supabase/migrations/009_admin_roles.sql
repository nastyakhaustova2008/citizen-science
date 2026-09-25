-- 009_admin_roles.sql
-- Roadmap step 4b: admin roles (owner / main admin / admin), grant + cascading revoke,
-- renames by admins, a change log, and admin-only writes on campaigns and form fields.
-- Run once in the Supabase SQL Editor, AFTER 006 (independent of 007 / 008). Safe to re-run.
--
-- Backward compatible: old frontends only read campaigns / fields / profiles, which stays public.
--
-- Roles (profiles.role, see 006):
--   owner       exactly one, set ONLY in the SQL Editor (see the end of 006). Makes any user a
--               main admin, turns a main admin back into a regular admin or a student,
--               revokes any admin, renames anyone including themselves (username only).
--   main_admin  appointed only by the owner. Grants admin to students, revokes ANY regular admin
--               (with cascade), renames students and regular admins. Cannot touch main admins.
--   admin       grants admin to students, revokes ONLY admins they granted directly
--               (profiles.role_granted_by = them), renames students.
--   Nobody revokes themselves (stepping down goes through someone above).
--
-- Cascade: revoking an admin turns them AND every admin below them in the grant chain
-- (role_granted_by, recursively) into students; role_granted_by is cleared, so granting
-- someone again later does not bring their old chain back.
--
-- Everything is enforced here: role / username changes happen only inside the security-definer
-- functions below (the profiles guard rejects anything else coming through the API), and every
-- function checks the caller's role itself. The UI only hides buttons (src/lib/roles.js).
--
-- Errors (message): not_logged_in, not_allowed, bad_target, no_username, chain_changed,
-- unchanged, username_taken, invalid_username (detail = username rule code).

-- =====================================================================
-- 1. Helpers
-- =====================================================================

-- Role of the logged-in user ('student' when logged out or without a profile).
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'student')
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.my_role() in ('admin', 'main_admin', 'owner')
$$;

revoke all on function public.my_role() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.my_role() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

create or replace function public.role_rank(p_role text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role when 'owner' then 3 when 'main_admin' then 2 when 'admin' then 1 else 0 end
$$;

-- =====================================================================
-- 2. Change log
-- =====================================================================
-- One row per change: who (actor), what (action, old → new), to whom (target), when.
-- Renames keep the old and new username. Readable only by admins, written only by the
-- functions below (and the trigger for changes made in the SQL Editor, actor = null).
-- Deleting an account: actor/target become null and the usernames stored about that
-- user are erased (trigger in section 3), so nothing about them stays here.

create table if not exists public.role_events (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  actor_id      uuid references public.profiles (id) on delete set null,
  target_id     uuid references public.profiles (id) on delete set null,
  action        text not null check (action in (
                  'grant_admin', 'revoke_admin', 'cascade_revoke', 'make_main_admin',
                  'main_to_admin', 'main_to_student', 'rename', 'sql_change')),
  old_role      text,
  new_role      text,
  old_username  text,
  new_username  text,
  cause_id      bigint references public.role_events (id) on delete set null  -- cascade → its revoke
);

create index if not exists role_events_at_idx on public.role_events (id desc);
create index if not exists role_events_target_idx on public.role_events (target_id);
create index if not exists role_events_actor_idx on public.role_events (actor_id);

alter table public.role_events enable row level security;
revoke all on public.role_events from anon, authenticated;
grant select on public.role_events to authenticated;

drop policy if exists "admins read the role log" on public.role_events;
create policy "admins read the role log"
  on public.role_events
  for select
  to authenticated
  using ((select public.is_admin()));

-- =====================================================================
-- 3. profiles guard (replaces the one from 006)
-- =====================================================================
-- Through the API, role fields and a chosen username change ONLY inside the functions below:
-- they mark their transaction (mitzpe.admin_op = txid) and run as the table owner. The API
-- roles cannot set that mark or update profiles themselves. The owner role never changes
-- through the API (SQL Editor only); the owner's username may (owner renames themselves).

create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  via_api  boolean := coalesce(pg_catalog.current_setting('request.jwt.claims', true), '') <> '';
  admin_op boolean := current_user not in ('anon', 'authenticated')
                      and pg_catalog.current_setting('mitzpe.admin_op', true) = pg_catalog.txid_current()::text;
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
    if current_user in ('anon', 'authenticated') or (via_api and not admin_op) then
      raise exception 'role_readonly' using detail = 'roles change only through the admin functions';
    end if;
    if via_api and (old.role = 'owner' or new.role = 'owner') then
      raise exception 'owner_sql_only' using detail = 'the owner is set only in the SQL Editor';
    end if;
  end if;

  if old.username is not null and new.username is distinct from old.username
     and via_api and not admin_op then
    raise exception 'username_locked' using detail = 'usernames change only through admin_rename_user';
  end if;

  return new;
end;
$$;

-- Changes made in the SQL Editor (no admin function) are logged too, with actor = null.
-- The first choice of a username (set_my_username / sign-up) is not a change and is not logged.
create or replace function public.profiles_log_sql_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('mitzpe.admin_op', true) = pg_catalog.txid_current()::text then
    return null;  -- the admin function writes its own log row
  end if;
  if new.role is distinct from old.role
     or (old.username is not null and new.username is distinct from old.username) then
    insert into public.role_events (actor_id, target_id, action, old_role, new_role, old_username, new_username)
    values (null, new.id, 'sql_change', old.role, new.role,
            case when new.username is distinct from old.username then old.username end,
            case when new.username is distinct from old.username then new.username end);
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_log_sql_change on public.profiles;
create trigger profiles_log_sql_change
  after update on public.profiles
  for each row execute function public.profiles_log_sql_change();

-- Account deleted → erase the usernames stored about them in the log (ids become null by FK).
create or replace function public.profiles_scrub_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.role_events set old_username = null, new_username = null where target_id = old.id;
  return old;
end;
$$;

drop trigger if exists profiles_scrub_log on public.profiles;
create trigger profiles_scrub_log
  before delete on public.profiles
  for each row execute function public.profiles_scrub_log();

-- =====================================================================
-- 4. Admin functions (RPC)
-- =====================================================================

-- Start of every admin function: one lock for all role changes (no half-done chains when two
-- admins act at once), mark the transaction for the guard, return the caller's profile.
create or replace function public.admin_begin()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mitzpe.roles', 0));
  select * into v_me from public.profiles where id = auth.uid();
  if not found or public.role_rank(v_me.role) < 1 then
    raise exception 'not_allowed';
  end if;
  perform pg_catalog.set_config('mitzpe.admin_op', pg_catalog.txid_current()::text, true);
  return v_me;
end;
$$;

revoke all on function public.admin_begin() from public, anon, authenticated;

-- Target + every admin below them in the grant chain (depth 0 = the target).
create or replace function public.admin_chain(p_target uuid)
returns table (id uuid, depth integer)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive chain (id, depth) as (
    select p_target, 0
    union
    select p.id, c.depth + 1
    from public.profiles p
    join chain c on p.role_granted_by = c.id
    where p.role = 'admin' and c.depth < 1000
  )
  select id, min(depth) from chain group by id
$$;

revoke all on function public.admin_chain(uuid) from public, anon, authenticated;

-- Demote a whole chain to students and log it. The target's own log row is written by the
-- caller; the rest get 'cascade_revoke' pointing at it.
create or replace function public.admin_cascade(p_actor uuid, p_target uuid, p_cause bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.role_events (actor_id, target_id, action, old_role, new_role, cause_id)
  select p_actor, p.id, 'cascade_revoke', p.role, 'student', p_cause
  from public.admin_chain(p_target) c
  join public.profiles p on p.id = c.id
  where c.depth > 0;

  update public.profiles p
  set role = 'student', role_granted_by = null, role_granted_at = null
  where p.id in (select c.id from public.admin_chain(p_target) c);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.admin_cascade(uuid, uuid, bigint) from public, anon, authenticated;

-- Throws unless the chain below p_target is exactly p_confirmed (what the confirmation showed).
create or replace function public.admin_check_chain(p_target uuid, p_confirmed uuid[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    (select id from public.admin_chain(p_target)
     except select pg_catalog.unnest(coalesce(p_confirmed, '{}')))
    union all
    (select pg_catalog.unnest(coalesce(p_confirmed, '{}'))
     except select id from public.admin_chain(p_target))
  ) then
    raise exception 'chain_changed';
  end if;
end;
$$;

revoke all on function public.admin_check_chain(uuid, uuid[]) from public, anon, authenticated;

-- ---- User list (admins). Never returns emails or whether a user has one. -------------------
create or replace function public.admin_list_users(
  p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns table (
  id uuid, username text, role text, role_granted_by uuid, granted_by_username text,
  role_granted_at timestamptz, created_at timestamptz, total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text := public.username_key(public.username_normalize(p_search));
begin
  if not public.is_admin() then
    raise exception 'not_allowed';
  end if;
  return query
  select p.id, p.username, p.role, p.role_granted_by, g.username, p.role_granted_at, p.created_at,
         count(*) over ()
  from public.profiles p
  left join public.profiles g on g.id = p.role_granted_by
  where v_key is null or pg_catalog.strpos(p.username_key, v_key) > 0
  order by public.role_rank(p.role) desc, p.username_key nulls last, p.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---- Who would lose admin if p_target is revoked (for the confirmation). -------------------
-- Allowed for anyone who may revoke / demote p_target.
create or replace function public.admin_revoke_preview(p_target uuid)
returns table (id uuid, username text, role text, role_granted_by uuid, depth integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_t  public.profiles;
begin
  select * into v_me from public.profiles pr where pr.id = auth.uid();
  select * into v_t from public.profiles pr where pr.id = p_target;
  if v_me.id is null or v_t.id is null or v_t.id = v_me.id then
    raise exception 'not_allowed';
  end if;
  if not ((v_t.role = 'admin' and (v_me.role in ('owner', 'main_admin') or v_t.role_granted_by = v_me.id))
          or (v_t.role = 'main_admin' and v_me.role = 'owner')) then
    raise exception 'not_allowed';
  end if;
  return query
  select p.id, p.username, p.role, p.role_granted_by, c.depth
  from public.admin_chain(p_target) c
  join public.profiles p on p.id = c.id
  order by c.depth, p.username_key nulls last;
end;
$$;

-- ---- Grant admin to a student (any admin). -------------------------------------------------
create or replace function public.admin_grant_admin(p_target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := public.admin_begin();
  v_t  public.profiles;
begin
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
  insert into public.role_events (actor_id, target_id, action, old_role, new_role)
  values (v_me.id, p_target, 'grant_admin', 'student', 'admin');
end;
$$;

-- ---- Revoke a regular admin, with cascade. ----------------------------------------------
-- Owner / main admin: any regular admin. Admin: only admins they granted directly.
-- p_confirmed = ids from admin_revoke_preview; a different chain now → chain_changed.
-- Returns how many users lost admin.
create or replace function public.admin_revoke_admin(p_target uuid, p_confirmed uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    public.profiles := public.admin_begin();
  v_t     public.profiles;
  v_event bigint;
begin
  select * into v_t from public.profiles where id = p_target for update;
  if not found or v_t.id = v_me.id or v_t.role <> 'admin' then
    raise exception 'bad_target';
  end if;
  if not (v_me.role in ('owner', 'main_admin') or v_t.role_granted_by = v_me.id) then
    raise exception 'not_allowed';
  end if;
  perform public.admin_check_chain(p_target, p_confirmed);
  insert into public.role_events (actor_id, target_id, action, old_role, new_role)
  values (v_me.id, p_target, 'revoke_admin', 'admin', 'student')
  returning id into v_event;
  return public.admin_cascade(v_me.id, p_target, v_event);
end;
$$;

-- ---- Owner: make a student or a regular admin a main admin. --------------------------------
-- A regular admin keeps the admins they granted (their chain stays below them).
create or replace function public.owner_make_main_admin(p_target uuid)
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
  update public.profiles
  set role = 'main_admin', role_granted_by = v_me.id, role_granted_at = now()
  where id = p_target;
  insert into public.role_events (actor_id, target_id, action, old_role, new_role)
  values (v_me.id, p_target, 'make_main_admin', v_t.role, 'main_admin');
end;
$$;

-- ---- Owner: remove main-admin status. ---------------------------------------------------
-- p_mode 'admin'   → a regular admin (granted by the owner), their chain stays;
--        'student' → full cascade, like a revoke (p_confirmed required).
create or replace function public.owner_demote_main_admin(p_target uuid, p_mode text, p_confirmed uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    public.profiles := public.admin_begin();
  v_t     public.profiles;
  v_event bigint;
begin
  if v_me.role <> 'owner' then
    raise exception 'not_allowed';
  end if;
  select * into v_t from public.profiles where id = p_target for update;
  if not found or v_t.role <> 'main_admin' then
    raise exception 'bad_target';
  end if;
  if p_mode = 'admin' then
    update public.profiles
    set role = 'admin', role_granted_by = v_me.id, role_granted_at = now()
    where id = p_target;
    insert into public.role_events (actor_id, target_id, action, old_role, new_role)
    values (v_me.id, p_target, 'main_to_admin', 'main_admin', 'admin');
    return 0;
  elsif p_mode = 'student' then
    perform public.admin_check_chain(p_target, p_confirmed);
    insert into public.role_events (actor_id, target_id, action, old_role, new_role)
    values (v_me.id, p_target, 'main_to_student', 'main_admin', 'student')
    returning id into v_event;
    return public.admin_cascade(v_me.id, p_target, v_event);
  else
    raise exception 'bad_target' using detail = 'mode must be admin or student';
  end if;
end;
$$;

-- ---- Rename a user (same username rules as sign-up). ---------------------------------------
-- Owner: anyone, themselves included (username only). Main admin: students and regular admins.
-- Admin: students. Returns the stored (normalized) name.
create or replace function public.admin_rename_user(p_target uuid, p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   public.profiles := public.admin_begin();
  v_t    public.profiles;
  v_name text := public.username_normalize(p_username);
  v_err  text := public.username_error(v_name);
begin
  select * into v_t from public.profiles where id = p_target for update;
  if not found then
    raise exception 'bad_target';
  end if;
  if not (v_me.role = 'owner' or public.role_rank(v_t.role) < public.role_rank(v_me.role)) then
    raise exception 'not_allowed';
  end if;
  if v_err is not null then
    raise exception 'invalid_username' using detail = v_err;
  end if;
  if v_name is not distinct from v_t.username then
    raise exception 'unchanged';
  end if;
  begin
    update public.profiles set username = v_name where id = p_target;
  exception when unique_violation then
    raise exception 'username_taken';
  end;
  insert into public.role_events (actor_id, target_id, action, old_role, new_role, old_username, new_username)
  values (v_me.id, p_target, 'rename', v_t.role, v_t.role, v_t.username, v_name);
  return v_name;
end;
$$;

-- ---- The log, newest first, with current usernames (admins). -------------------------------
create or replace function public.admin_role_log(p_limit integer default 50, p_before bigint default null)
returns table (
  id bigint, at timestamptz, action text, actor_id uuid, actor_username text,
  target_id uuid, target_username text, old_role text, new_role text,
  old_username text, new_username text, cause_id bigint)
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
         e.old_role, e.new_role, e.old_username, e.new_username, e.cause_id
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
    'public.admin_list_users(text, integer, integer)',
    'public.admin_revoke_preview(uuid)',
    'public.admin_grant_admin(uuid)',
    'public.admin_revoke_admin(uuid, uuid[])',
    'public.owner_make_main_admin(uuid)',
    'public.owner_demote_main_admin(uuid, text, uuid[])',
    'public.admin_rename_user(uuid, text)',
    'public.admin_role_log(integer, bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;

-- =====================================================================
-- 5. Campaigns: created_by, admin-only writes (replaces the TEMPORARY rules of 002 / 004)
-- =====================================================================

alter table public.campaigns
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

-- created_by: set automatically. Through the API = the logged-in admin (whatever was sent);
-- in the SQL Editor = the given value, or the owner. Never changes through the API.
create or replace function public.campaigns_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  via_api boolean := coalesce(pg_catalog.current_setting('request.jwt.claims', true), '') <> '';
begin
  if tg_op = 'INSERT' then
    if via_api then
      new.created_by := auth.uid();
    elsif new.created_by is null then
      new.created_by := (select id from public.profiles where role = 'owner');
    end if;
  elsif via_api and new.created_by is distinct from old.created_by then
    raise exception 'created_by_readonly';
  end if;
  return new;
end;
$$;

drop trigger if exists campaigns_created_by on public.campaigns;
create trigger campaigns_created_by
  before insert or update on public.campaigns
  for each row execute function public.campaigns_created_by();

-- Existing campaigns → the owner (without touching updated_at). Re-run after setting the
-- owner if there was none yet.
alter table public.campaigns disable trigger campaigns_set_updated_at;
update public.campaigns
set created_by = (select id from public.profiles where role = 'owner')
where created_by is null;
alter table public.campaigns enable trigger campaigns_set_updated_at;

create index if not exists campaigns_created_by_idx on public.campaigns (created_by);

-- Reading stays public, but created_by (who among the admins made it) is not: column list.
-- A NEW campaigns column needs its own `grant select (col)` in its migration.
revoke all on public.campaigns from anon, authenticated;
grant select (id, slug, metric, icon, title_he, title_en, title_ru, desc_he, desc_en, desc_ru,
              status, region, difficulty, equipment, protocol_url, center_lat, center_lng, zoom,
              sort_order, form_version, created_at, updated_at)
  on public.campaigns to anon, authenticated;
grant insert, update, delete on public.campaigns to authenticated;

drop policy if exists "TEMPORARY anyone can read campaigns" on public.campaigns;
drop policy if exists "anyone can read campaigns" on public.campaigns;
create policy "anyone can read campaigns"
  on public.campaigns for select to anon, authenticated using (true);

-- Insert / update: any admin for now (step 5 refines editing rules).
drop policy if exists "admins add campaigns" on public.campaigns;
create policy "admins add campaigns"
  on public.campaigns for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists "admins edit campaigns" on public.campaigns;
create policy "admins edit campaigns"
  on public.campaigns for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Delete: main admins / owner any campaign, regular admins only their own.
-- The measurements FK (003, on delete restrict) still blocks campaigns that have measurements.
drop policy if exists "admins delete campaigns" on public.campaigns;
create policy "admins delete campaigns"
  on public.campaigns for delete to authenticated
  using ((select public.my_role()) in ('main_admin', 'owner')
         or ((select public.my_role()) = 'admin' and created_by = (select auth.uid())));

-- Fields and options: public read, admin write. The editing rules of 004 (keys/types/units
-- never change, archive instead of delete once there are measurements, form_version) still apply.
revoke all on public.campaign_fields, public.campaign_field_options from anon, authenticated;
grant select on public.campaign_fields, public.campaign_field_options to anon, authenticated;
grant insert, update, delete on public.campaign_fields, public.campaign_field_options to authenticated;

drop policy if exists "TEMPORARY anyone can read campaign fields" on public.campaign_fields;
drop policy if exists "anyone can read campaign fields" on public.campaign_fields;
create policy "anyone can read campaign fields"
  on public.campaign_fields for select to anon, authenticated using (true);

drop policy if exists "admins write campaign fields" on public.campaign_fields;
create policy "admins write campaign fields"
  on public.campaign_fields for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "TEMPORARY anyone can read campaign field options" on public.campaign_field_options;
drop policy if exists "anyone can read campaign field options" on public.campaign_field_options;
create policy "anyone can read campaign field options"
  on public.campaign_field_options for select to anon, authenticated using (true);

drop policy if exists "admins write campaign field options" on public.campaign_field_options;
create policy "admins write campaign field options"
  on public.campaign_field_options for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

notify pgrst, 'reload schema';
