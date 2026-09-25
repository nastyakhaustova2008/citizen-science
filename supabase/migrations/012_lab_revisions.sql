-- 012_lab_revisions.sql
-- Roadmap step 5c: structural changes to published labs as a reviewed revision.
-- Run once in the Supabase SQL Editor, AFTER 011. Safe to re-run.
-- Backward compatible with the 5b frontend (it keeps working; it just cannot propose revisions).
--
-- A published lab's texts, labels, help, order, icon, map… still change at once (lab_save,
-- cosmetic only). Structural changes — new fields, archive / unarchive, required, min / max /
-- decimals, text length, primary field, new options, archive / unarchive options — and the
-- PROTOCOL (it defines the method) are proposed as a revision:
--
--   * lab_revisions: one open revision (draft | in_review) per lab. It stores the proposed
--     structure (fields in the lab_save payload format, in form order) + protocol_he/en/ru.
--     Fields / options are never removed from a published lab: the revision must contain every
--     live field and option (archive instead: must_archive).
--   * Editing: the lab's editors (author, main admins, owner). Submit → in review (a new round);
--     saving a revision in review starts a new round (approvals reset). Withdraw → draft;
--     discard → closed. A save that leaves no structural difference closes it too.
--   * Approving: 3 different admins with a complete admin profile, NOT the lab's author, NOT the
--     revision's proposer, and not whoever edited / submitted it in the round; one verdict per
--     admin per round; approvals stay valid if the reviewer loses the admin role.
--     "Request changes" (comment required) → back to draft.
--   * The 3rd approval applies it in one transaction: structure from the revision, texts of
--     existing fields / options from the live lab (cosmetic edits made meanwhile are kept), new
--     fields / options with the revision's texts, appended after the live ones; the protocol.
--     form_version goes up (the 004 triggers). Until then students use the live form.
--   * lab_credits also returns the latest applied revision ("updated on …, approved by …").
--
-- Errors (message): as in 010 / 011, plus: must_archive (inside invalid_lab details).

-- =====================================================================
-- 1. Tables
-- =====================================================================

create table if not exists public.lab_revisions (
  id            bigint generated always as identity primary key,
  campaign_id   text not null references public.campaigns (id) on update cascade on delete cascade,
  proposed_by   uuid references public.profiles (id) on delete set null,
  status        text not null default 'draft' check (status in ('draft', 'in_review', 'applied', 'discarded')),
  round         integer not null default 0,
  edit_no       integer not null default 1,
  fields        jsonb not null check (jsonb_typeof(fields) = 'array'),
  protocol_he   text not null default '',
  protocol_en   text not null default '',
  protocol_ru   text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  applied_at    timestamptz
);

-- At most one open revision per lab.
create unique index if not exists lab_revisions_one_open_idx
  on public.lab_revisions (campaign_id) where status in ('draft', 'in_review');
create index if not exists lab_revisions_campaign_idx on public.lab_revisions (campaign_id, id desc);
create index if not exists lab_revisions_proposed_by_idx on public.lab_revisions (proposed_by);

alter table public.lab_revisions enable row level security;
revoke all on public.lab_revisions from anon, authenticated;  -- only through the functions below

-- Reviews of a revision carry its id (null = the lab's own review, 011).
alter table public.lab_reviews add column if not exists revision_id bigint
  references public.lab_revisions (id) on delete cascade;
drop index if exists public.lab_reviews_one_per_round_idx;
create unique index if not exists lab_reviews_one_per_round2_idx
  on public.lab_reviews (campaign_id, coalesce(revision_id, 0), round, reviewer_id);
create index if not exists lab_reviews_revision_idx on public.lab_reviews (revision_id);

-- Revision events: details.revision = the revision id.
alter table public.lab_events drop constraint if exists lab_events_action_check;
alter table public.lab_events add constraint lab_events_action_check
  check (action in ('create', 'edit', 'edit_published', 'delete',
                    'submit', 'withdraw', 'approve', 'request_changes', 'publish',
                    'revision_save', 'revision_submit', 'revision_withdraw', 'revision_discard',
                    'revision_approve', 'revision_request_changes', 'revision_apply'));

-- =====================================================================
-- 2. Checks
-- =====================================================================

-- Validation of a proposed structure: {path: code} (paths as in lab_check_fields; the editor
-- sends the whole form, so fields.<i> is the position in the editor).
create or replace function public.lab_check_revision(p_campaign text, p_fields jsonb, p_protocol jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  errs jsonb := public.lab_check_fields(p_campaign, p_fields, false);
  l    text;
  f    record;
  o    record;
begin
  foreach l in array array['he', 'en', 'ru'] loop
    if pg_catalog.char_length(public.lab_block(p_protocol ->> l)) > 8000 then
      errs := errs || jsonb_build_object('info.protocol_' || l, 'too_long');
    end if;
  end loop;
  -- Nothing of the published form disappears: archive instead.
  for f in select key from public.campaign_fields where campaign_id = p_campaign loop
    if not exists (select 1 from jsonb_array_elements(p_fields) x where x ->> 'key' = f.key) then
      errs := errs || jsonb_build_object('removed.' || f.key, 'must_archive');
    end if;
  end loop;
  for o in select field_key, key from public.campaign_field_options where campaign_id = p_campaign loop
    if not exists (select 1 from jsonb_array_elements(p_fields) x
                   cross join jsonb_array_elements(coalesce(x -> 'options', '[]')) y
                   where x ->> 'key' = o.field_key and y ->> 'key' = o.key) then
      errs := errs || jsonb_build_object('removed.' || o.field_key || '.' || o.key, 'must_archive');
    end if;
  end loop;
  return errs;
end;
$$;

revoke all on function public.lab_check_revision(text, jsonb, jsonb) from public, anon, authenticated;

-- Structural differences between the live lab and a proposal: [path]. Empty = nothing to review.
create or replace function public.lab_revision_diff(p_campaign text, p_fields jsonb, p_protocol jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c    public.campaigns;
  out  jsonb := '[]'::jsonb;
  x    jsonb;
  y    jsonb;
  f    public.campaign_fields;
  o    public.campaign_field_options;
begin
  select * into c from public.campaigns where id = p_campaign;
  if (public.lab_block(p_protocol ->> 'he'), public.lab_block(p_protocol ->> 'en'), public.lab_block(p_protocol ->> 'ru'))
     is distinct from (c.protocol_he, c.protocol_en, c.protocol_ru) then
    out := out || '["protocol"]';
  end if;
  for x in select * from jsonb_array_elements(p_fields) loop
    select * into f from public.campaign_fields where campaign_id = p_campaign and key = x ->> 'key';
    if not found then
      out := out || jsonb_build_array('field.' || (x ->> 'key'));
      continue;
    end if;
    if ((x ->> 'required')::boolean, (x ->> 'archived')::boolean, (x ->> 'is_primary')::boolean,
        case when f.type = 'number' then (x ->> 'min_value')::numeric end,
        case when f.type = 'number' then (x ->> 'max_value')::numeric end,
        case when f.type = 'number' then (x ->> 'decimals')::smallint end,
        f.type = 'text' and (x ->> 'text_long')::boolean)
       is distinct from
       (f.required, f.archived, f.is_primary, f.min_value, f.max_value, f.decimals, f.text_long) then
      out := out || jsonb_build_array('field.' || f.key);
    end if;
    for y in select * from jsonb_array_elements(coalesce(x -> 'options', '[]')) loop
      select * into o from public.campaign_field_options
      where campaign_id = p_campaign and field_key = f.key and key = y ->> 'key';
      if not found or o.archived is distinct from (y ->> 'archived')::boolean then
        out := out || jsonb_build_array('field.' || f.key || '.option.' || (y ->> 'key'));
      end if;
    end loop;
  end loop;
  return out;
end;
$$;

revoke all on function public.lab_revision_diff(text, jsonb, jsonb) from public, anon, authenticated;

-- What is missing before a revision can go to review (same paths / codes as lab_missing, over
-- the proposed fields): every label in he/en/ru, an active field, exactly one active primary
-- number field, an active option on active choice fields.
create or replace function public.lab_revision_missing(p_fields jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  errs jsonb := '{}'::jsonb;
  x    jsonb;
  y    jsonb;
  i    integer := 0;
  j    integer;
  l    text;
  n    integer := 0;
  act  integer := 0;
begin
  for x in select * from jsonb_array_elements(p_fields) loop
    if not (x ->> 'archived')::boolean then
      act := act + 1;
      if (x ->> 'is_primary')::boolean and x ->> 'type' = 'number' then n := n + 1; end if;
    end if;
    foreach l in array array['he', 'en', 'ru'] loop
      if public.lab_line(x ->> ('label_' || l)) is null then
        errs := errs || jsonb_build_object('fields.' || i || '.label_' || l, 'required');
      end if;
    end loop;
    if x ->> 'type' in ('choice', 'multi_choice') then
      if not (x ->> 'archived')::boolean and not exists (
           select 1 from jsonb_array_elements(coalesce(x -> 'options', '[]')) z where not (z ->> 'archived')::boolean) then
        errs := errs || jsonb_build_object('fields.' || i || '.options', 'none');
      end if;
      j := 0;
      for y in select * from jsonb_array_elements(coalesce(x -> 'options', '[]')) loop
        foreach l in array array['he', 'en', 'ru'] loop
          if public.lab_line(y ->> ('label_' || l)) is null then
            errs := errs || jsonb_build_object('fields.' || i || '.options.' || j || '.label_' || l, 'required');
          end if;
        end loop;
        j := j + 1;
      end loop;
    end if;
    i := i + 1;
  end loop;
  if act = 0 then errs := errs || '{"fields":"none"}'; end if;
  if n <> 1 then errs := errs || '{"primary":"none"}'; end if;
  return errs;
end;
$$;

-- What of a proposal matters for review: the structure of every field / option, and the texts
-- only of NEW fields / options (texts of existing ones come from the live lab when applied, and
-- change there at once). Sorted by key, so reordering (cosmetic) does not count.
-- Mirrored in src/lib/labs.js → revisionShape().
create or replace function public.lab_revision_shape(p_campaign text, p_fields jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'key', x ->> 'key', 'type', x ->> 'type', 'unit', public.lab_line(x ->> 'unit'),
      'required', (x ->> 'required')::boolean, 'archived', (x ->> 'archived')::boolean,
      'is_primary', (x ->> 'is_primary')::boolean,
      'min', case when x ->> 'type' = 'number' then (x ->> 'min_value')::numeric end,
      'max', case when x ->> 'type' = 'number' then (x ->> 'max_value')::numeric end,
      'decimals', case when x ->> 'type' = 'number' then (x ->> 'decimals')::integer end,
      'text_long', x ->> 'type' = 'text' and (x ->> 'text_long')::boolean,
      'texts', case when f.key is null then jsonb_build_array(
                 public.lab_line(x ->> 'label_he'), public.lab_line(x ->> 'label_en'), public.lab_line(x ->> 'label_ru'),
                 public.lab_line(x ->> 'help_he'), public.lab_line(x ->> 'help_en'), public.lab_line(x ->> 'help_ru')) end,
      'options', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'key', y ->> 'key', 'archived', (y ->> 'archived')::boolean,
                 'texts', case when o.key is null then jsonb_build_array(
                            public.lab_line(y ->> 'label_he'), public.lab_line(y ->> 'label_en'),
                            public.lab_line(y ->> 'label_ru')) end)
               order by y ->> 'key'), '[]'::jsonb)
        from jsonb_array_elements(coalesce(x -> 'options', '[]')) y
        left join public.campaign_field_options o
          on o.campaign_id = p_campaign and o.field_key = x ->> 'key' and o.key = y ->> 'key'))
    order by x ->> 'key'), '[]'::jsonb)
  from jsonb_array_elements(p_fields) x
  left join public.campaign_fields f on f.campaign_id = p_campaign and f.key = x ->> 'key'
$$;

revoke all on function public.lab_revision_shape(text, jsonb) from public, anon, authenticated;

-- Admins barred from approving a revision round: its editors / submitters in that round.
create or replace function public.lab_revision_round_editors(p_rev bigint, p_round integer)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct e.actor_id) filter (where e.actor_id is not null), '{}')
  from public.lab_events e
  where e.action in ('revision_save', 'revision_submit')
    and (e.details ->> 'revision')::bigint = p_rev and e.round = p_round
$$;

revoke all on function public.lab_revision_round_editors(bigint, integer) from public, anon, authenticated;

-- Why p_me cannot approve the current round of a revision (null = can).
create or replace function public.lab_revision_block(p_r public.lab_revisions, p_me uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select created_by from public.campaigns where id = p_r.campaign_id) = p_me then 'own_lab'
    when p_r.proposed_by = p_me then 'own_revision'
    when p_me = any (public.lab_revision_round_editors(p_r.id, p_r.round)) then 'edited_this_round'
    when exists (select 1 from public.lab_reviews v
                 where v.revision_id = p_r.id and v.round = p_r.round and v.reviewer_id = p_me)
      then 'already_reviewed'
  end
$$;

revoke all on function public.lab_revision_block(public.lab_revisions, uuid) from public, anon, authenticated;

create or replace function public.lab_log_revision(p_r public.lab_revisions, p_actor uuid, p_action text, p_round integer,
                                                   p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.lab_events (campaign_id, title_he, title_en, title_ru, actor_id, action, round, details)
  select c.id, c.title_he, c.title_en, c.title_ru, p_actor, p_action, p_round,
         p_details || jsonb_build_object('revision', p_r.id)
  from public.campaigns c where c.id = p_r.campaign_id
$$;

revoke all on function public.lab_log_revision(public.lab_revisions, uuid, text, integer, jsonb) from public, anon, authenticated;


-- =====================================================================
-- 3. The lab's own review (011), now ignoring revision reviews
-- =====================================================================
-- Same functions as in 011; only the lab's own reviews (revision_id is null) count.

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
    and not (e.details ? 'revision')
$$;

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
                 where r.campaign_id = p_c.id and r.revision_id is null and r.round = p_c.review_round and r.reviewer_id = p_me)
      then 'already_reviewed'
  end
$$;

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
  where campaign_id = p_id and revision_id is null and round = v_c.review_round and verdict = 'approve';
  if v_n >= 3 then
    update public.campaigns
    set publication = 'published', published_at = now(), status = 'collecting', edit_no = edit_no + 1
    where id = p_id returning * into v_c;
    perform public.lab_log_event(v_c, null, 'publish', v_c.review_round);
  end if;
  return jsonb_build_object('publication', v_c.publication, 'approvals', v_n);
end;
$$;

-- ---- Queue (replaces 011): labs AND revisions in review. -------------------------------------
-- kind: 'lab' | 'revision'; my_state: can_review | own_lab | own_revision | edited_this_round | already_reviewed
drop function if exists public.lab_review_queue();
create or replace function public.lab_review_queue()
returns table (
  kind text, revision_id bigint, id text, slug text, title_he text, title_en text, title_ru text, icon text,
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
  select * from (
    select 'lab'::text, null::bigint, c.id, c.slug, c.title_he, c.title_en, c.title_ru, c.icon, c.created_by,
           p.username, a.full_name, c.submitted_at, c.review_round,
           (select count(*) from public.lab_reviews r
            where r.campaign_id = c.id and r.revision_id is null and r.round = c.review_round and r.verdict = 'approve'),
           coalesce(public.lab_review_block(c, auth.uid()), 'can_review')
    from public.campaigns c
    left join public.profiles p on p.id = c.created_by
    left join public.admin_profiles a on a.user_id = c.created_by
    where c.publication = 'in_review'
    union all
    -- revisions: "creator" = who proposed it
    select 'revision'::text, v.id, c.id, c.slug, c.title_he, c.title_en, c.title_ru, c.icon, v.proposed_by,
           p.username, a.full_name, v.submitted_at, v.round,
           (select count(*) from public.lab_reviews r
            where r.revision_id = v.id and r.round = v.round and r.verdict = 'approve'),
           coalesce(public.lab_revision_block(v, auth.uid()), 'can_review')
    from public.lab_revisions v
    join public.campaigns c on c.id = v.campaign_id
    left join public.profiles p on p.id = v.proposed_by
    left join public.admin_profiles a on a.user_id = v.proposed_by
    where v.status = 'in_review'
  ) q
  order by 12 nulls last, 3;
end;
$$;

-- ---- History (replaces 011): + revision_id (null = the lab's own review). -------------------
drop function if exists public.lab_review_history(text);
create or replace function public.lab_review_history(p_id text)
returns table (
  id bigint, round integer, verdict text, comment text, at timestamptz,
  reviewer_id uuid, reviewer_username text, reviewer_full_name text, reviewer_workplace text,
  current_round integer, revision_id bigint)
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
         c.review_round, r.revision_id
  from public.lab_reviews r
  join public.campaigns c on c.id = r.campaign_id
  left join public.profiles p on p.id = r.reviewer_id
  left join public.admin_profiles a on a.user_id = r.reviewer_id
  where r.campaign_id = p_id
  order by r.id desc;
end;
$$;

-- ---- Public credits (replaces 011): + the latest applied revision. --------------------------
-- {legacy, published_at, creator, approvers, update: {applied_at, approvers} | null}
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
                   (select jsonb_build_object('full_name', a.full_name, 'position', a.position, 'workplace', a.workplace)
                    from (select 1) x left join public.admin_profiles a on a.user_id = c.created_by) end,
      'approvers', case when c.published_at is not null then coalesce((
                     select jsonb_agg(jsonb_build_object('full_name', a.full_name, 'position', a.position,
                                                         'workplace', a.workplace, 'at', r.at) order by r.at)
                     from public.lab_reviews r
                     left join public.admin_profiles a on a.user_id = r.reviewer_id
                     where r.campaign_id = c.id and r.revision_id is null and r.round = c.review_round
                       and r.verdict = 'approve'), '[]'::jsonb) end,
      'update', (
        select jsonb_build_object(
          'applied_at', v.applied_at,
          'approvers', coalesce((
            select jsonb_agg(jsonb_build_object('full_name', a.full_name, 'position', a.position,
                                                'workplace', a.workplace, 'at', r.at) order by r.at)
            from public.lab_reviews r
            left join public.admin_profiles a on a.user_id = r.reviewer_id
            where r.revision_id = v.id and r.round = v.round and r.verdict = 'approve'), '[]'::jsonb))
        from public.lab_revisions v
        where v.campaign_id = c.id and v.status = 'applied'
        order by v.applied_at desc limit 1))
  from public.campaigns c
  where c.id = p_id and c.publication = 'published'
$$;

-- =====================================================================
-- 4. Revisions (RPC)
-- =====================================================================

-- The open revision of a lab (admins), or null.
-- {id, status, round, edit_no, fields, protocol_he/en/ru, proposed_by, proposer_username,
--  proposer_full_name, submitted_at, updated_at, approvals, my_state}
create or replace function public.lab_revision_get(p_campaign text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.lab_revisions;
begin
  if not public.is_admin() then
    raise exception 'not_allowed';
  end if;
  select * into v from public.lab_revisions where campaign_id = p_campaign and status in ('draft', 'in_review');
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v.id, 'status', v.status, 'round', v.round, 'edit_no', v.edit_no, 'fields', v.fields,
    'protocol_he', v.protocol_he, 'protocol_en', v.protocol_en, 'protocol_ru', v.protocol_ru,
    'proposed_by', v.proposed_by,
    'proposer_username', (select username from public.profiles where id = v.proposed_by),
    'proposer_full_name', (select full_name from public.admin_profiles where user_id = v.proposed_by),
    'submitted_at', v.submitted_at, 'updated_at', v.updated_at,
    'approvals', (select count(*) from public.lab_reviews r
                  where r.revision_id = v.id and r.round = v.round and r.verdict = 'approve'),
    'my_state', coalesce(public.lab_revision_block(v, auth.uid()), 'can_review'));
end;
$$;

-- Load the open revision for update and check the caller may edit the lab. p_rev / p_edit_no
-- must match what the editor saw (else edited_elsewhere).
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

revoke all on function public.lab_revision_open(public.profiles, bigint, integer) from public, anon, authenticated;

-- Create or update the open revision of a published lab.
-- p_rev null → a new revision (none may be open). p_fields: the whole proposed form (lab_save
-- payload, form order); p_protocol: {he, en, ru}. No structural difference left → the open
-- revision is discarded. In review: a new round (approvals reset) and it must stay complete.
-- Returns {revision_id | null, edit_no, status, changed}.
create or replace function public.lab_revision_save(p_campaign text, p_rev bigint, p_edit_no integer,
                                                    p_fields jsonb, p_protocol jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   public.profiles := public.lab_begin();
  c      public.campaigns;
  v      public.lab_revisions;
  errs   jsonb;
  diff   jsonb;
  v_new  boolean := p_rev is null;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found then
    raise exception 'not_found';
  end if;
  if not public.lab_may_edit(v_me.role, v_me.id, c.created_by) then
    raise exception 'not_allowed';
  end if;
  if c.publication <> 'published' then
    raise exception 'bad_state';
  end if;
  if jsonb_typeof(p_fields) is distinct from 'array' or jsonb_typeof(p_protocol) is distinct from 'object' then
    raise exception 'invalid_lab' using detail = '{"_":"invalid"}';
  end if;

  if v_new then
    if exists (select 1 from public.lab_revisions where campaign_id = p_campaign and status in ('draft', 'in_review')) then
      raise exception 'edited_elsewhere';  -- someone opened a revision meanwhile
    end if;
  else
    v := public.lab_revision_open(v_me, p_rev, p_edit_no);
    if v.campaign_id <> p_campaign then
      raise exception 'not_found';
    end if;
  end if;

  errs := public.lab_check_revision(p_campaign, p_fields, p_protocol);
  if errs <> '{}'::jsonb then
    raise exception 'invalid_lab' using detail = errs::text;
  end if;

  diff := public.lab_revision_diff(p_campaign, p_fields, p_protocol);
  if diff = '[]'::jsonb then
    -- Back to the live structure: nothing to review.
    if not v_new then
      update public.lab_revisions set status = 'discarded', updated_at = now(), edit_no = edit_no + 1
      where id = v.id returning * into v;
      perform public.lab_log_revision(v, v_me.id, 'revision_discard', v.round);
    end if;
    return jsonb_build_object('revision_id', null, 'edit_no', null, 'status', null, 'changed', not v_new);
  end if;

  if v_new then
    insert into public.lab_revisions (campaign_id, proposed_by, fields, protocol_he, protocol_en, protocol_ru)
    values (p_campaign, v_me.id, p_fields,
            public.lab_block(p_protocol ->> 'he'), public.lab_block(p_protocol ->> 'en'), public.lab_block(p_protocol ->> 'ru'))
    returning * into v;
    perform public.lab_log_revision(v, v_me.id, 'revision_save', v.round + 1, jsonb_build_object('changes', diff));
    return jsonb_build_object('revision_id', v.id, 'edit_no', v.edit_no, 'status', v.status, 'changed', true);
  end if;

  -- Only a different shape (structure, texts of new fields / options) or protocol is a change of
  -- the revision; texts of existing fields are cosmetic (they go live through lab_save).
  if (public.lab_revision_shape(p_campaign, v.fields), v.protocol_he, v.protocol_en, v.protocol_ru)
     is not distinct from (public.lab_revision_shape(p_campaign, p_fields), public.lab_block(p_protocol ->> 'he'),
                           public.lab_block(p_protocol ->> 'en'), public.lab_block(p_protocol ->> 'ru')) then
    return jsonb_build_object('revision_id', v.id, 'edit_no', v.edit_no, 'status', v.status, 'changed', false);
  end if;

  update public.lab_revisions
  set fields = p_fields,
      protocol_he = public.lab_block(p_protocol ->> 'he'),
      protocol_en = public.lab_block(p_protocol ->> 'en'),
      protocol_ru = public.lab_block(p_protocol ->> 'ru'),
      round = round + case when status = 'in_review' then 1 else 0 end,
      edit_no = edit_no + 1,
      updated_at = now()
  where id = v.id returning * into v;
  if v.status = 'in_review' then
    errs := public.lab_revision_missing(v.fields);
    if errs <> '{}'::jsonb then
      raise exception 'not_ready' using detail = errs::text;
    end if;
  end if;
  perform public.lab_log_revision(v, v_me.id, 'revision_save',
                                  case when v.status = 'draft' then v.round + 1 else v.round end,
                                  jsonb_build_object('changes', diff));
  return jsonb_build_object('revision_id', v.id, 'edit_no', v.edit_no, 'status', v.status, 'changed', true);
end;
$$;

-- Draft → in review (a new round). → new edit_no.
create or replace function public.lab_revision_submit(p_rev bigint, p_edit_no integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := public.lab_begin();
  v    public.lab_revisions := public.lab_revision_open(v_me, p_rev, p_edit_no);
  errs jsonb;
begin
  if v.status <> 'draft' then
    raise exception 'bad_state';
  end if;
  errs := public.lab_revision_missing(v.fields);
  if errs <> '{}'::jsonb then
    raise exception 'not_ready' using detail = errs::text;
  end if;
  update public.lab_revisions
  set status = 'in_review', round = round + 1, submitted_at = now(), edit_no = edit_no + 1, updated_at = now()
  where id = v.id returning * into v;
  perform public.lab_log_revision(v, v_me.id, 'revision_submit', v.round);
  return v.edit_no;
end;
$$;

-- In review → draft. → new edit_no.
create or replace function public.lab_revision_withdraw(p_rev bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := public.lab_begin();
  v    public.lab_revisions := public.lab_revision_open(v_me, p_rev, null);
begin
  if v.status <> 'in_review' then
    raise exception 'bad_state';
  end if;
  update public.lab_revisions set status = 'draft', edit_no = edit_no + 1, updated_at = now()
  where id = v.id returning * into v;
  perform public.lab_log_revision(v, v_me.id, 'revision_withdraw', v.round);
  return v.edit_no;
end;
$$;

-- Close the open revision without applying it (the live lab stays as it is).
create or replace function public.lab_revision_discard(p_rev bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := public.lab_begin();
  v    public.lab_revisions := public.lab_revision_open(v_me, p_rev, null);
begin
  update public.lab_revisions set status = 'discarded', edit_no = edit_no + 1, updated_at = now()
  where id = v.id returning * into v;
  perform public.lab_log_revision(v, v_me.id, 'revision_discard', v.round);
end;
$$;

-- Apply an approved revision to the live lab (called by the 3rd approval).
create or replace function public.lab_revision_apply(p_rev bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v        public.lab_revisions;
  x        jsonb;
  y        jsonb;
  v_next   integer;
  v_onext  integer;
  v_prim   text;
  f        public.campaign_fields;
  c        public.campaigns;
begin
  select * into v from public.lab_revisions where id = p_rev for update;
  -- Structure changes of a published lab are allowed only inside this transaction (010 guards).
  perform pg_catalog.set_config('mitzpe.lab_apply', pg_catalog.txid_current()::text, true);

  select x0 ->> 'key' into v_prim from jsonb_array_elements(v.fields) x0
  where (x0 ->> 'is_primary')::boolean and not (x0 ->> 'archived')::boolean limit 1;
  update public.campaign_fields set is_primary = false
  where campaign_id = v.campaign_id and is_primary and key is distinct from v_prim;

  select coalesce(max(sort_order), 0) into v_next from public.campaign_fields where campaign_id = v.campaign_id;
  for x in select * from jsonb_array_elements(v.fields) loop
    select * into f from public.campaign_fields where campaign_id = v.campaign_id and key = x ->> 'key';
    if found then
      -- structure from the revision; labels, help and order stay as they are live
      update public.campaign_fields set
        required   = (x ->> 'required')::boolean,
        archived   = (x ->> 'archived')::boolean,
        is_primary = (x ->> 'is_primary')::boolean,
        min_value  = case when type = 'number' then (x ->> 'min_value')::numeric end,
        max_value  = case when type = 'number' then (x ->> 'max_value')::numeric end,
        decimals   = case when type = 'number' then (x ->> 'decimals')::smallint end,
        text_long  = type = 'text' and (x ->> 'text_long')::boolean
      where campaign_id = v.campaign_id and key = f.key;
    else
      v_next := v_next + 1;
      insert into public.campaign_fields
        (campaign_id, key, type, label_he, label_en, label_ru, help_he, help_en, help_ru,
         required, sort_order, archived, is_primary, unit, min_value, max_value, decimals, text_long)
      values (v.campaign_id, x ->> 'key', x ->> 'type',
        coalesce(public.lab_line(x ->> 'label_he'), ''), coalesce(public.lab_line(x ->> 'label_en'), ''),
        coalesce(public.lab_line(x ->> 'label_ru'), ''),
        coalesce(public.lab_line(x ->> 'help_he'), ''), coalesce(public.lab_line(x ->> 'help_en'), ''),
        coalesce(public.lab_line(x ->> 'help_ru'), ''),
        (x ->> 'required')::boolean, v_next, (x ->> 'archived')::boolean, (x ->> 'is_primary')::boolean,
        case when x ->> 'type' = 'number' then public.lab_line(x ->> 'unit') end,
        case when x ->> 'type' = 'number' then (x ->> 'min_value')::numeric end,
        case when x ->> 'type' = 'number' then (x ->> 'max_value')::numeric end,
        case when x ->> 'type' = 'number' then (x ->> 'decimals')::smallint end,
        x ->> 'type' = 'text' and (x ->> 'text_long')::boolean);
    end if;

    select coalesce(max(sort_order), 0) into v_onext from public.campaign_field_options
    where campaign_id = v.campaign_id and field_key = x ->> 'key';
    for y in select * from jsonb_array_elements(coalesce(x -> 'options', '[]')) loop
      if exists (select 1 from public.campaign_field_options
                 where campaign_id = v.campaign_id and field_key = x ->> 'key' and key = y ->> 'key') then
        update public.campaign_field_options set archived = (y ->> 'archived')::boolean
        where campaign_id = v.campaign_id and field_key = x ->> 'key' and key = y ->> 'key';
      else
        v_onext := v_onext + 1;
        insert into public.campaign_field_options
          (campaign_id, field_key, key, label_he, label_en, label_ru, sort_order, archived)
        values (v.campaign_id, x ->> 'key', y ->> 'key',
          coalesce(public.lab_line(y ->> 'label_he'), ''), coalesce(public.lab_line(y ->> 'label_en'), ''),
          coalesce(public.lab_line(y ->> 'label_ru'), ''), v_onext, (y ->> 'archived')::boolean);
      end if;
    end loop;
  end loop;

  update public.campaigns
  set protocol_he = v.protocol_he, protocol_en = v.protocol_en, protocol_ru = v.protocol_ru, edit_no = edit_no + 1
  where id = v.campaign_id returning * into c;
  update public.lab_revisions set status = 'applied', applied_at = now(), updated_at = now() where id = v.id
  returning * into v;
  perform public.lab_log_revision(v, null, 'revision_apply', v.round);
end;
$$;

revoke all on function public.lab_revision_apply(bigint) from public, anon, authenticated;

-- Approve or request changes on a revision in review. The 3rd approval applies it.
-- Returns {status, approvals}.
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

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.lab_review_queue()',
    'public.lab_review_history(text)',
    'public.lab_revision_get(text)',
    'public.lab_revision_save(text, bigint, integer, jsonb, jsonb)',
    'public.lab_revision_submit(bigint, integer)',
    'public.lab_revision_withdraw(bigint)',
    'public.lab_revision_discard(bigint)',
    'public.lab_revision_review(bigint, integer, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke all on function public.lab_credits(text) from public';
  execute 'grant execute on function public.lab_credits(text) to anon, authenticated';
end
$$;

notify pgrst, 'reload schema';
