-- 011_lab_review.sql
-- Roadmap step 5b: submit a lab for review, approvals by 3 different admins, publishing,
-- "request changes", public credits ("Created by" / "Approved by").
-- Run once in the Supabase SQL Editor, AFTER 010. Safe to re-run.
-- Backward compatible with the 5a frontend (it keeps working; it just cannot submit).
--
-- Rounds: campaigns.review_round counts review rounds. Submitting starts a new round
-- (review_round + 1); saving a lab that is in review also starts a new one, so approvals from the
-- earlier round no longer count (nothing is deleted — they stay in the history). Every lab_events
-- row carries the round its change belongs to: edits of a draft belong to the NEXT round (the one
-- they will be reviewed in), edits in review to the new current round.
--
-- Who may approve round R: any admin with a complete admin profile, except the lab's author
-- (created_by) and anyone who created / edited / submitted the lab in round R; one approval per
-- admin per round. Approvals are counted without looking at the reviewer's current role, so they
-- stay valid if the reviewer later loses the admin role. The 3rd approval publishes the lab.
-- "Request changes" needs a comment and returns the lab to draft (the comment is shown to the
-- author; review comments are visible to admins only).
--
-- Credits (public, also logged out) come only through lab_credits / lab_credits_all:
-- creator's and approvers' full name, position, workplace (admin_profiles stays non-public).
-- Labs published before review (published_at is null) get no credits ("published before peer
-- review"). A deleted account shows as a former staff member (null name).
--
-- Errors (message): not_logged_in, not_allowed, admin_profile_required, not_found, bad_state,
-- edited_elsewhere, not_ready (detail = JSON {path: code}, same paths as invalid_lab),
-- round_changed, own_lab, edited_this_round, already_reviewed, comment_required, comment_too_long.

-- =====================================================================
-- 1. Columns, review table, log
-- =====================================================================

alter table public.campaigns add column if not exists review_round integer not null default 0;
alter table public.campaigns add column if not exists submitted_at timestamptz;
alter table public.campaigns add column if not exists published_at timestamptz;  -- null = before peer review

grant select (review_round) on public.campaigns to anon, authenticated;
grant select (submitted_at) on public.campaigns to anon, authenticated;
grant select (published_at) on public.campaigns to anon, authenticated;

create table if not exists public.lab_reviews (
  id           bigint generated always as identity primary key,
  campaign_id  text not null references public.campaigns (id) on update cascade on delete cascade,
  round        integer not null,
  reviewer_id  uuid references public.profiles (id) on delete set null,  -- null = deleted account
  verdict      text not null check (verdict in ('approve', 'changes')),
  comment      text not null default '' check (pg_catalog.char_length(comment) <= 2000),
  at           timestamptz not null default now()
);

-- One verdict per admin per round (a deleted reviewer's row keeps counting: null ≠ null).
create unique index if not exists lab_reviews_one_per_round_idx
  on public.lab_reviews (campaign_id, round, reviewer_id);
create index if not exists lab_reviews_reviewer_idx on public.lab_reviews (reviewer_id);

alter table public.lab_reviews enable row level security;
revoke all on public.lab_reviews from anon, authenticated;  -- read through the functions below

alter table public.lab_events add column if not exists round integer;

alter table public.lab_events drop constraint if exists lab_events_action_check;
alter table public.lab_events add constraint lab_events_action_check
  check (action in ('create', 'edit', 'edit_published', 'delete',
                    'submit', 'withdraw', 'approve', 'request_changes', 'publish'));

create index if not exists lab_events_round_idx on public.lab_events (campaign_id, round);

-- =====================================================================
-- 2. What must be there before review (also re-checked at every save in review)
-- =====================================================================
-- {path: code}; paths as in lab_check_* (fields.<i> = position by sort_order).
-- Mirrored in src/lib/labs.js → submitChecklist().

create or replace function public.lab_missing(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c     public.campaigns;
  errs  jsonb := '{}'::jsonb;
  l     text;
  f     record;
  o     record;
  i     integer := 0;
  j     integer;
  n     integer;
begin
  select * into c from public.campaigns where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;
  foreach l in array array['he', 'en', 'ru'] loop
    if pg_catalog.btrim(case l when 'he' then c.title_he when 'en' then c.title_en else c.title_ru end) = '' then
      errs := errs || jsonb_build_object('info.title_' || l, 'required');
    end if;
    if pg_catalog.btrim(case l when 'he' then c.desc_he when 'en' then c.desc_en else c.desc_ru end) = '' then
      errs := errs || jsonb_build_object('info.desc_' || l, 'required');
    end if;
  end loop;
  if c.center_lat is null or c.center_lng is null then
    errs := errs || '{"info.center":"required"}';
  end if;

  if not exists (select 1 from public.campaign_fields where campaign_id = p_id and not archived) then
    errs := errs || '{"fields":"none"}';
  end if;
  if (select count(*) from public.campaign_fields
      where campaign_id = p_id and is_primary and not archived and type = 'number') <> 1 then
    errs := errs || '{"primary":"none"}';
  end if;

  for f in select * from public.campaign_fields where campaign_id = p_id order by sort_order, key loop
    foreach l in array array['he', 'en', 'ru'] loop
      if pg_catalog.btrim(case l when 'he' then f.label_he when 'en' then f.label_en else f.label_ru end) = '' then
        errs := errs || jsonb_build_object('fields.' || i || '.label_' || l, 'required');
      end if;
    end loop;
    if f.type in ('choice', 'multi_choice') then
      select count(*) into n from public.campaign_field_options
      where campaign_id = p_id and field_key = f.key and not archived;
      if n = 0 and not f.archived then
        errs := errs || jsonb_build_object('fields.' || i || '.options', 'none');
      end if;
      j := 0;
      for o in select * from public.campaign_field_options
               where campaign_id = p_id and field_key = f.key order by sort_order, key loop
        foreach l in array array['he', 'en', 'ru'] loop
          if pg_catalog.btrim(case l when 'he' then o.label_he when 'en' then o.label_en else o.label_ru end) = '' then
            errs := errs || jsonb_build_object('fields.' || i || '.options.' || j || '.label_' || l, 'required');
          end if;
        end loop;
        j := j + 1;
      end loop;
    end if;
    i := i + 1;
  end loop;
  return errs;
end;
$$;

revoke all on function public.lab_missing(text) from public, anon, authenticated;

-- For the editor's checklist (the editor also checks its unsaved state itself).
create or replace function public.lab_submit_check(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c public.campaigns;
begin
  if not public.is_admin() then
    raise exception 'not_allowed';
  end if;
  select * into v_c from public.campaigns where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;
  return public.lab_missing(p_id);
end;
$$;

-- Admins barred from approving round p_round: the author + whoever created / edited / submitted in it.
create or replace function public.lab_round_editors(p_id text, p_round integer)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct e.actor_id) filter (where e.actor_id is not null), '{}')
  from public.lab_events e
  where e.campaign_id = p_id and e.round = p_round and e.action in ('create', 'edit', 'submit')
$$;

revoke all on function public.lab_round_editors(text, integer) from public, anon, authenticated;

-- =====================================================================
-- 3. lab_save (replaces 010): rounds
-- =====================================================================
-- Same as 010, plus: a save of a lab in review starts a new round (approvals reset; the editor
-- cannot approve it) and must keep it complete (not_ready); log rows carry the round.

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
    -- In review: a new round (earlier approvals no longer count); the lab must stay complete.
    update public.campaigns
    set edit_no = edit_no + 1,
        review_round = review_round + case when publication = 'in_review' then 1 else 0 end
    where id = v_id returning * into v_c;
    if v_c.publication = 'in_review' then
      errs := public.lab_missing(v_id);
      if errs <> '{}'::jsonb then
        raise exception 'not_ready' using detail = errs::text;
      end if;
    end if;
    insert into public.lab_events (campaign_id, title_he, title_en, title_ru, actor_id, action, details, round)
    values (v_id, v_c.title_he, v_c.title_en, v_c.title_ru, v_me.id,
            case when v_new then 'create' when v_c.publication = 'published' then 'edit_published' else 'edit' end,
            case when v_new then '{}'::jsonb else v_diff end,
            -- a draft's edits belong to the round it will be reviewed in
            case v_c.publication when 'draft' then v_c.review_round + 1
                                 when 'in_review' then v_c.review_round end);
  else
    select * into v_c from public.campaigns where id = v_id;
  end if;

  return jsonb_build_object('id', v_c.id, 'slug', v_c.slug, 'edit_no', v_c.edit_no,
                            'changed', v_new or v_diff <> '{}'::jsonb);
end;
$$;


-- =====================================================================
-- 4. Submit / withdraw / review (RPC)
-- =====================================================================

create or replace function public.lab_log_event(p_c public.campaigns, p_actor uuid, p_action text, p_round integer,
                                                p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.lab_events (campaign_id, title_he, title_en, title_ru, actor_id, action, round, details)
  values (p_c.id, p_c.title_he, p_c.title_en, p_c.title_ru, p_actor, p_action, p_round, p_details)
$$;

revoke all on function public.lab_log_event(public.campaigns, uuid, text, integer, jsonb) from public, anon, authenticated;

-- Draft → in review (a new round). The author, main admins, the owner. Returns the new edit_no.
create or replace function public.lab_submit(p_id text, p_edit_no integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   public.profiles := public.lab_begin();
  v_c    public.campaigns;
  v_errs jsonb;
begin
  select * into v_c from public.campaigns where id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if not public.lab_may_edit(v_me.role, v_me.id, v_c.created_by) then
    raise exception 'not_allowed';
  end if;
  if v_c.publication <> 'draft' then
    raise exception 'bad_state';
  end if;
  if p_edit_no is distinct from v_c.edit_no then
    raise exception 'edited_elsewhere';
  end if;
  v_errs := public.lab_missing(p_id);
  if v_errs <> '{}'::jsonb then
    raise exception 'not_ready' using detail = v_errs::text;
  end if;
  update public.campaigns
  set publication = 'in_review', review_round = review_round + 1, submitted_at = now(), edit_no = edit_no + 1
  where id = p_id returning * into v_c;
  perform public.lab_log_event(v_c, v_me.id, 'submit', v_c.review_round);
  return v_c.edit_no;
end;
$$;

-- In review → draft (the author noticed something). Same people as editing. Returns the new edit_no.
create or replace function public.lab_withdraw(p_id text)
returns integer
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
  if not public.lab_may_edit(v_me.role, v_me.id, v_c.created_by) then
    raise exception 'not_allowed';
  end if;
  if v_c.publication <> 'in_review' then
    raise exception 'bad_state';
  end if;
  update public.campaigns set publication = 'draft', edit_no = edit_no + 1
  where id = p_id returning * into v_c;
  perform public.lab_log_event(v_c, v_me.id, 'withdraw', v_c.review_round);
  return v_c.edit_no;
end;
$$;

-- Why I cannot approve round p_round of this lab (null = I can).
create or replace function public.lab_review_block(p_c public.campaigns, p_me uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_c.created_by = p_me then 'own_lab'
    when p_me = any (public.lab_round_editors(p_c.id, p_c.review_round)) then 'edited_this_round'
    when exists (select 1 from public.lab_reviews r
                 where r.campaign_id = p_c.id and r.round = p_c.review_round and r.reviewer_id = p_me)
      then 'already_reviewed'
  end
$$;

revoke all on function public.lab_review_block(public.campaigns, uuid) from public, anon, authenticated;

-- Approve or request changes. p_round = the round the reviewer looked at (else round_changed).
-- The 3rd approval in the round publishes the lab. 'changes' needs a comment → back to draft.
-- Returns {publication, approvals}.
create or replace function public.lab_review(p_id text, p_round integer, p_verdict text, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      public.profiles := public.lab_begin();
  v_c       public.campaigns;
  v_block   text;
  v_comment text := public.lab_block(p_comment);
  v_n       integer;
begin
  if p_verdict is null or p_verdict not in ('approve', 'changes') then
    raise exception 'bad_state' using detail = 'verdict must be approve or changes';
  end if;
  select * into v_c from public.campaigns where id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_c.publication <> 'in_review' then
    raise exception 'bad_state';
  end if;
  if p_round is distinct from v_c.review_round then
    raise exception 'round_changed';
  end if;
  v_block := public.lab_review_block(v_c, v_me.id);
  if v_block is not null then
    raise exception '%', v_block;
  end if;
  if pg_catalog.char_length(v_comment) > 2000 then
    raise exception 'comment_too_long';
  end if;
  if p_verdict = 'changes' and v_comment = '' then
    raise exception 'comment_required';
  end if;

  insert into public.lab_reviews (campaign_id, round, reviewer_id, verdict, comment)
  values (p_id, v_c.review_round, v_me.id, p_verdict, v_comment);

  if p_verdict = 'changes' then
    update public.campaigns set publication = 'draft', edit_no = edit_no + 1
    where id = p_id returning * into v_c;
    perform public.lab_log_event(v_c, v_me.id, 'request_changes', v_c.review_round);
    return jsonb_build_object('publication', 'draft', 'approvals', 0);
  end if;

  perform public.lab_log_event(v_c, v_me.id, 'approve', v_c.review_round);
  select count(*) into v_n from public.lab_reviews
  where campaign_id = p_id and round = v_c.review_round and verdict = 'approve';
  if v_n >= 3 then
    update public.campaigns
    set publication = 'published', published_at = now(), status = 'collecting', edit_no = edit_no + 1
    where id = p_id returning * into v_c;
    perform public.lab_log_event(v_c, null, 'publish', v_c.review_round);
  end if;
  return jsonb_build_object('publication', v_c.publication, 'approvals', v_n);
end;
$$;

-- ---- Labs waiting for review (admins) — the list and the badge. ------------------------------
-- my_state: can_review | own_lab | edited_this_round | already_reviewed
create or replace function public.lab_review_queue()
returns table (
  id text, slug text, title_he text, title_en text, title_ru text, icon text,
  created_by uuid, creator_username text, creator_full_name text,
  submitted_at timestamptz, review_round integer, approvals bigint, my_state text)
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
  select c.id, c.slug, c.title_he, c.title_en, c.title_ru, c.icon, c.created_by, p.username, a.full_name,
         c.submitted_at, c.review_round,
         (select count(*) from public.lab_reviews r
          where r.campaign_id = c.id and r.round = c.review_round and r.verdict = 'approve'),
         coalesce(public.lab_review_block(c, auth.uid()), 'can_review')
  from public.campaigns c
  left join public.profiles p on p.id = c.created_by
  left join public.admin_profiles a on a.user_id = c.created_by
  where c.publication = 'in_review'
  order by c.submitted_at nulls last, c.id;
end;
$$;

-- ---- All verdicts of a lab, newest first (admins; the author reads the change requests here). --
create or replace function public.lab_review_history(p_id text)
returns table (
  id bigint, round integer, verdict text, comment text, at timestamptz,
  reviewer_id uuid, reviewer_username text, reviewer_full_name text, reviewer_workplace text,
  current_round integer)
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
  select r.id, r.round, r.verdict, r.comment, r.at, r.reviewer_id, p.username, a.full_name, a.workplace,
         c.review_round
  from public.lab_reviews r
  join public.campaigns c on c.id = r.campaign_id
  left join public.profiles p on p.id = r.reviewer_id
  left join public.admin_profiles a on a.user_id = r.reviewer_id
  where r.campaign_id = p_id
  order by r.id desc;
end;
$$;

-- =====================================================================
-- 5. Public credits
-- =====================================================================
-- Published labs only. Labs published before review (published_at is null) → {"legacy": true}.
-- creator / approver = {full_name, position, workplace}; name null = deleted account.
-- Approvers = the approvals of the round that published the lab.
create or replace function public.lab_credits(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when c.published_at is null then jsonb_build_object('legacy', true)
    else jsonb_build_object(
      'legacy', false,
      'published_at', c.published_at,
      'creator', (select jsonb_build_object('full_name', a.full_name, 'position', a.position, 'workplace', a.workplace)
                  from (select 1) x left join public.admin_profiles a on a.user_id = c.created_by),
      'approvers', coalesce((
        select jsonb_agg(jsonb_build_object('full_name', a.full_name, 'position', a.position,
                                            'workplace', a.workplace, 'at', r.at) order by r.at)
        from public.lab_reviews r
        left join public.admin_profiles a on a.user_id = r.reviewer_id
        where r.campaign_id = c.id and r.round = c.review_round and r.verdict = 'approve'), '[]'::jsonb))
  end
  from public.campaigns c
  where c.id = p_id and c.publication = 'published'
$$;

-- One line per reviewed published lab, for the home page cards.
create or replace function public.lab_credits_all()
returns table (campaign_id text, creator_full_name text, creator_workplace text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, a.full_name, a.workplace
  from public.campaigns c
  left join public.admin_profiles a on a.user_id = c.created_by
  where c.publication = 'published' and c.published_at is not null
$$;

-- ---- lab_log (replaces 010): also returns the round. ---------------------------------------
drop function if exists public.lab_log(text, integer, bigint);
create or replace function public.lab_log(p_campaign text default null, p_limit integer default 50, p_before bigint default null)
returns table (
  id bigint, at timestamptz, action text, campaign_id text, slug text,
  title_he text, title_en text, title_ru text, actor_id uuid, actor_username text, details jsonb, round integer)
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
         e.actor_id, p.username, e.details, e.round
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
    'public.lab_log(text, integer, bigint)',
    'public.lab_submit_check(text)',
    'public.lab_submit(text, integer)',
    'public.lab_withdraw(text)',
    'public.lab_review(text, integer, text, text)',
    'public.lab_review_queue()',
    'public.lab_review_history(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.lab_credits(text)', 'public.lab_credits_all()'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end
$$;

notify pgrst, 'reload schema';
