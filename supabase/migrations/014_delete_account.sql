-- 014_delete_account.sql
-- "Delete my account" (NEXT_GOALS item 2).
-- Run once in the Supabase SQL Editor, AFTER 012 (independent of 013). Safe to re-run.
-- Compatible with the production frontend: it only adds functions, two role-log actions and one
-- role-log column (admin_role_log returns two more columns, the old UI ignores them; an
-- "account deleted" row shows as a raw text key there until the new frontend is deployed).
--
-- The deletion itself runs in the Edge Function `account` (action `delete`), because deleting an
-- auth user needs the secret key:
--   1. account_delete_prepare(user, username, delete_measurements) — secret key only, one
--      transaction under the role lock:
--        * checks: the profile exists, has a username, the typed username matches, not the owner;
--        * the admins this user appointed move one level up (role_granted_by := the user's own
--          granter; their own chains stay below them) — logged as 'chain_moved', and the
--          deletion itself as 'account_deleted' (no names; ids become null when the profile goes);
--        * measurements: deleted, or kept with user_id replaced by one new random id per account
--          (the "same observer" grouping stays, nothing links it to the account any more);
--        * open revisions they proposed are discarded (their drafts / labs stay: created_by → null
--          by FK, credits show "former staff member");
--        * the username rate-limit buckets (they contain the username) are deleted.
--      Running it again is harmless (the Edge Function retries if the auth deletion failed).
--   2. auth.admin.deleteUser → auth.users, identities, sessions; profiles and admin_profiles by
--      cascade; ids in role_events / lab_events / lab_reviews / lab_revisions become null (FKs).
--   3. account_delete_finish(user, anon_id, delete_measurements) — secret key only: measurements
--      added between 1 and 2 get the same treatment, the delete rate-limit bucket and the user's
--      rows in auth.audit_log_entries (login log with IP / email) are deleted.
--
-- account_delete_preview() — for the logged-in user: what will happen (numbers only, own data).
--
-- Errors (message): not_logged_in, not_found, no_username, username_mismatch, owner_cannot_delete.

-- =====================================================================
-- 1. Role log: two new actions + "moved under"
-- =====================================================================

alter table public.role_events
  add column if not exists moved_under uuid references public.profiles (id) on delete set null;

alter table public.role_events drop constraint if exists role_events_action_check;
alter table public.role_events add constraint role_events_action_check
  check (action in (
    'grant_admin', 'revoke_admin', 'cascade_revoke', 'make_main_admin',
    'main_to_admin', 'main_to_student', 'rename', 'sql_change',
    'account_deleted',   -- actor = target = the deleted user (null afterwards), old_role, moved_under
    'chain_moved'));     -- target = an admin they appointed, moved_under = the new granter, cause_id

create index if not exists role_events_moved_under_idx on public.role_events (moved_under);

-- New return columns → drop first (same body as 010 + moved_under).
drop function if exists public.admin_role_log(integer, bigint);
create or replace function public.admin_role_log(p_limit integer default 50, p_before bigint default null)
returns table (
  id bigint, at timestamptz, action text, actor_id uuid, actor_username text,
  target_id uuid, target_username text, old_role text, new_role text,
  old_username text, new_username text, cause_id bigint, confirmed_staff boolean,
  moved_under uuid, moved_under_username text)
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
         e.old_role, e.new_role, e.old_username, e.new_username, e.cause_id, e.confirmed_staff,
         e.moved_under, m.username
  from public.role_events e
  left join public.profiles a on a.id = e.actor_id
  left join public.profiles t on t.id = e.target_id
  left join public.profiles m on m.id = e.moved_under
  where p_before is null or e.id < p_before
  order by e.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.admin_role_log(integer, bigint) from public, anon;
grant execute on function public.admin_role_log(integer, bigint) to authenticated;

-- =====================================================================
-- 2. Preview (the logged-in user, own data only)
-- =====================================================================
-- {role, can_delete, measurements, admins_moved, moved_under: {id, username} | null,
--  labs_created, drafts, open_revisions}

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
                       where r.proposed_by = v_me.id and r.status in ('draft', 'in_review')));
end;
$$;

revoke all on function public.account_delete_preview() from public, anon;
grant execute on function public.account_delete_preview() to authenticated;

-- =====================================================================
-- 3. Prepare / finish (Edge Function only, secret key)
-- =====================================================================

-- Measurements of a deleted account: delete, or hand them to the anonymous id.
create or replace function public.account_delete_measurements(p_user uuid, p_anon text, p_delete boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_delete then
    delete from public.measurements where user_id = p_user::text;
  else
    update public.measurements set user_id = p_anon where user_id = p_user::text;
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.account_delete_measurements(uuid, text, boolean) from public, anon, authenticated;

-- Returns {anon_id, measurements, admins_moved, revisions_discarded}.
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
  n_moved  integer;
  n_meas   integer;
  n_rev    integer := 0;
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

  -- Rate-limit buckets that contain the username (Edge Function: login / recover per username).
  delete from private.rate_limit_hits
  where bucket in ('login:user:' || v_me.username_key, 'recover:user:' || v_me.username_key);

  return jsonb_build_object('anon_id', v_anon, 'measurements', n_meas,
                            'admins_moved', n_moved, 'revisions_discarded', n_rev);
end;
$$;

revoke all on function public.account_delete_prepare(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.account_delete_prepare(uuid, text, boolean) to service_role;

-- After the auth user is gone. Returns {measurements, audit_log}.
create or replace function public.account_delete_finish(p_user uuid, p_anon text, p_delete_measurements boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_meas  integer;
  n_audit integer := 0;
begin
  if exists (select 1 from public.profiles where id = p_user) then
    raise exception 'not_deleted';
  end if;
  if p_anon is null or p_anon !~ '^[0-9a-f-]{36}$' then
    raise exception 'bad_request';
  end if;

  n_meas := public.account_delete_measurements(p_user, p_anon, coalesce(p_delete_measurements, false));

  delete from private.rate_limit_hits where bucket = 'delete:user:' || p_user::text;

  -- Supabase Auth's login log (IP, email). The "user deleted" row names the user in traits.
  begin
    delete from auth.audit_log_entries
    where payload ->> 'actor_id' = p_user::text
       or payload -> 'traits' ->> 'user_id' = p_user::text;
    get diagnostics n_audit = row_count;
  exception when insufficient_privilege then
    raise warning 'account_delete_finish: no access to auth.audit_log_entries (the 30-day cleanup removes them)';
  end;

  return jsonb_build_object('measurements', n_meas, 'audit_log', n_audit);
end;
$$;

revoke all on function public.account_delete_finish(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.account_delete_finish(uuid, text, boolean) to service_role;
