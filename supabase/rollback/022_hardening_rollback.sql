-- 022_hardening_rollback.sql — NOT part of the normal order; do not run by default.
-- Undoes the behaviour of 022 (final hardening, part A): puts back the function / policy versions
-- of 006 – 021. Safe to re-run. It keeps what is harmless to keep:
--   * the new foreign-key indexes (only faster deletes);
--   * RLS on private.settings / private.storage_trash (no one but the owner's functions uses them);
--   * EXECUTE stays revoked on the three trigger functions (triggers don't need it);
--   * rate-limit rows already written (they expire after a day).
-- Try the kill switches first — they need no rollback:
--   update private.settings set value = 'false' where key = 'upload_limit_by_hits';  -- uploads (L2)
-- After a rollback the Edge Function of 022 keeps working (it skips account_signup_username when
-- the function is missing and still sets the sign-up mark). The frontend of 022 needs
-- username-check in the Edge Function, not username_available, so it keeps working too.

-- ---- 3. photo fields: 018 version (accepts the legacy true again) ---------------------------
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

-- ---- 4. handle_new_user: 006 version; no safety net -------------------------------------------
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
drop function if exists public.account_signup_username(uuid, text);

-- ---- 5. username_available for the browser again (006) --------------------------------------
grant execute on function public.username_available(text) to anon, authenticated;

-- ---- 6. reports: 015 / 016 / 017 versions ------------------------------------------------------
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
  insert into public.comment_reports (comment_id, reporter_id, reason) values (p_id, v_me, p_reason);

  select count(*) into v_open from public.comment_reports where comment_id = p_id and resolved_at is null;
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
drop function if exists private.report_pair_take(uuid, uuid);
drop function if exists private.report_counts(uuid);

-- ---- 7. comment delete / edit: 015 versions -------------------------------------------------
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
drop function if exists private.comment_under_review(uuid);

-- ---- 8. avatar_moderate: 017 version ------------------------------------------------------------
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

-- ---- 9. upload policies: 016 / 017 checks ---------------------------------------------------
drop policy if exists "measurement photos: upload" on storage.objects;
create policy "measurement photos: upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'measurement-photos' and public.photo_upload_ok(name));

drop policy if exists "avatars: upload" on storage.objects;
create policy "avatars: upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.avatar_upload_ok(name));

drop function if exists public.upload_quota(text);
drop function if exists public.photo_upload_take(text);
drop function if exists public.avatar_upload_take(text);
drop function if exists private.upload_check(text, text, boolean);
delete from private.settings where key = 'upload_limit_by_hits';
drop function if exists private.setting_on(text, boolean);

-- ---- 10. lab revisions: 012 versions ----------------------------------------------------------
create or replace function public.lab_revision_open(p_me public.profiles, p_rev bigint, p_edit_no integer)
returns public.lab_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.lab_revisions;
  c public.campaigns;
begin
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
begin
  if p_verdict is null or p_verdict not in ('approve', 'changes') then
    raise exception 'bad_state' using detail = 'verdict must be approve or changes';
  end if;
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

-- ---- 11. privacy cleanup: 021 version -------------------------------------------------------
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

-- ---- 13. admin profiles: 010 policy --------------------------------------------------------
drop policy if exists "own or admins read admin profiles" on public.admin_profiles;
create policy "own or admins read admin profiles"
  on public.admin_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
