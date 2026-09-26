-- 015_comments.sql
-- Comments on measurements (NEXT_GOALS item 6), reports, moderation, allowed link domains.
-- Run once in the Supabase SQL Editor, AFTER 014 (and 008: the cleanup job uses pg_cron).
-- Safe to re-run. Compatible with the production frontend: it only adds tables and functions and
-- replaces the three account-deletion functions from 014 with the same arguments (their results
-- get extra keys the old code ignores).
--
-- Rules (all checked here; src/lib/comments.js mirrors the text checks for instant feedback,
-- same error codes):
--   * Only measurements are commented on. kind = 'comment' | 'issue' ("report a problem with this
--     data" — shown red, marks the point as flagged for logged-in users).
--   * Reading: logged-in users only (comment_list). Hidden comments: moderators + their author.
--   * Writing: logged-in users with a username, through the RPCs only (no table grants).
--     Text: NFC, control / invisible formatting characters removed, 1–1000 characters,
--     no email addresses, no phone numbers, links only to allowed domains (subdomains match),
--     never user:pass@host, IP addresses, punycode (xn--), non-ASCII host names, ports,
--     non-http(s) schemes or URL shorteners.
--     Rate limit per user: 5 / minute, 30 / hour, 100 / day (comments + edits); reports 20 / day.
--   * lang = the UI language when written (for machine translation later).
--   * Edit: own comment, within 15 minutes, not while hidden; edited_at is shown ("edited").
--   * Delete: own comment (no log). Moderators — main admins / owner on every lab, an admin on
--     labs they created (= lab_may_edit) — hide, unhide or delete; logged in comment_events
--     (ids only, never the text; readable by admins).
--   * Report: one per user per comment (reason code only). 3 unresolved reports from different
--     users hide the comment ('reports') until a moderator decides; the reported list
--     (comment_report_queue) is the admins' badge.
--   * Allowed link domains: main admins / owner add and remove; any admin proposes one with a
--     reason; main admins / owner approve or reject (optional comment). Everything is logged in
--     link_domain_events. Start list: youtube.com, youtu.be, wikipedia.org, gov.il, ac.il.
--   * Retention (pg_cron, daily): hidden comments are deleted 90 days after they were hidden,
--     resolved reports 90 days after they were resolved.
--   * Account deletion: the user's comments and reports are always deleted (prepare + FK cascade);
--     comments on measurements that are deleted go with them.
--
-- Errors (message; detail = JSON where noted):
--   not_logged_in, no_username, not_allowed, not_found, bad_request, rate_limited,
--   empty, too_long, email_not_allowed, phone_not_allowed, link_not_allowed, link_shortener,
--   link_domain_not_allowed (detail {"host": …, "domains": [...]}),
--   edit_window_closed, comment_hidden, already_reported,
--   invalid_domain, domain_shortener, domain_exists, proposal_pending, already_decided,
--   reason_required, reason_too_long, comment_too_long.

create extension if not exists pg_cron with schema pg_catalog;

-- =====================================================================
-- 1. Text checks (mirrored in src/lib/comments.js — keep identical)
-- =====================================================================

-- Stored form of a comment: NFC, CR/LF → LF, no control characters, no invisible formatting
-- characters that can hide or reorder text (soft hyphen, zero-width space, bidi overrides and
-- isolates, word joiner, BOM; ZWNJ / ZWJ / LRM / RLM stay), at most 2 empty lines in a row, trimmed.
create or replace function public.comment_clean(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(
          pg_catalog.regexp_replace(
            normalize(coalesce(p_text, ''), NFC),
            '[\u00AD\u200B\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]', '', 'g'),
          '\r\n?', pg_catalog.chr(10), 'g'),
        '[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]', '', 'g'),
      '\n{4,}', pg_catalog.repeat(pg_catalog.chr(10), 3), 'g'),
    '^[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+|[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$',
    '', 'g')
$$;

-- What the link / email / phone checks look at: no invisible characters at all, NFKC (full-width
-- letters and digits → ASCII), lower case, ideographic full stop → '.'.
create or replace function public.comment_detect_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.replace(
    pg_catalog.lower(normalize(
      pg_catalog.regexp_replace(coalesce(p_text, ''),
        '[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]', '', 'g'),
      NFKC)),
    '。', '.')
$$;

-- URL shorteners: never allowed (they hide where a link goes), cannot be added to the list.
create or replace function public.comment_shorteners()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'v.gd',
               'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'shorturl.com', 'rb.gy', 'tiny.cc',
               't.ly', 's.id', 'bl.ink', 'lnkd.in', 'short.io', 'y2u.be', 'tr.im', 'soo.gd',
               'clck.ru', 'vk.cc', 'u.to', 'surl.li', 'qr.ae', 'shorte.st', 'adf.ly', 'tiny.one']
$$;

-- Top-level domains that make a bare word.word a link even without "/" after it
-- ("bit.ly", "t.me"). Everyday typos like "hot.The" are not links.
create or replace function public.comment_bare_tlds()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['com', 'net', 'org', 'info', 'biz', 'io', 'co', 'me', 'ly', 'gl', 'gd', 'tk', 'ml',
               'ga', 'cf', 'gq', 'xyz', 'top', 'site', 'online', 'app', 'dev', 'link', 'click',
               'live', 'store', 'shop', 'blog', 'news', 'tv', 'cc', 'ws', 'su', 'ru', 'ua', 'il',
               'uk', 'de', 'fr', 'es', 'eu', 'ca', 'ai', 'gg', 'page']
$$;

-- host is one of the domains or a subdomain of one.
create or replace function public.comment_domain_match(p_host text, p_domains text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1 from pg_catalog.unnest(coalesce(p_domains, '{}'::text[])) d
    where p_host = d or pg_catalog.right(p_host, pg_catalog.length(d) + 1) = '.' || d)
$$;

-- First bad link in the text: null, or {code, host}. p_text = comment_detect_text(...).
create or replace function public.comment_link_error(p_text text, p_domains text[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  tok    text;
  rest   text;
  host   text;
  scheme text;
begin
  for tok in
    select t from pg_catalog.regexp_split_to_table(p_text, '[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+') t
  loop
    tok := pg_catalog.regexp_replace(tok, '^[(\[{<"''«„“‘]+', '');
    tok := pg_catalog.regexp_replace(tok, '[)\]}>"''»”’.,;:!?]+$', '');
    continue when tok = '';

    if tok ~ '^(javascript|vbscript):' then
      return jsonb_build_object('code', 'link_not_allowed');
    end if;
    if tok ~ '^[a-z][a-z0-9+.-]*:[/\\]' then
      scheme := substring(tok from '^([a-z][a-z0-9+.-]*):');
      if scheme not in ('http', 'https') then
        return jsonb_build_object('code', 'link_not_allowed');
      end if;
      rest := pg_catalog.regexp_replace(tok, '^[a-z][a-z0-9+.-]*:[/\\]*', '');
    elsif tok ~ '^www\.'
       or tok ~ '^[^/?#\\@:]+\.([a-z]{2,24}|xn--[a-z0-9-]+)[/?#:\\]'
       or (tok ~ '^[^/?#\\@:]+\.([a-z]{2,24}|xn--[a-z0-9-]+)$'
           and (substring(tok from '\.([a-z0-9-]+)$') = any (public.comment_bare_tlds())
                or tok ~ '\.xn--[a-z0-9-]+$')) then
      rest := tok;
    else
      continue;
    end if;

    host := substring(rest from '^[^/?#\\]*');
    if host ~ '[@:]' then
      return jsonb_build_object('code', 'link_not_allowed');          -- user:pass@host, port
    end if;
    host := pg_catalog.regexp_replace(host, '\.$', '');
    if host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
       or host ~ '(^|\.)xn--'
       or host !~ '\.[a-z]{2,}$' then
      return jsonb_build_object('code', 'link_not_allowed');          -- non-ASCII, punycode, IP
    end if;
    if public.comment_domain_match(host, public.comment_shorteners()) then
      return jsonb_build_object('code', 'link_shortener', 'host', host);
    end if;
    if not public.comment_domain_match(host, p_domains) then
      return jsonb_build_object('code', 'link_domain_not_allowed', 'host', host);
    end if;
  end loop;
  return null;
end;
$$;

-- Everything wrong with a (cleaned) comment text: null or {code, ...}.
create or replace function public.comment_body_error(p_body text, p_domains text[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  d   text;
  err jsonb;
begin
  if coalesce(p_body, '') = '' then
    return jsonb_build_object('code', 'empty');
  end if;
  if pg_catalog.char_length(p_body) > 1000 then
    return jsonb_build_object('code', 'too_long');
  end if;
  d := public.comment_detect_text(p_body);
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

-- Domain typed by an admin → stored form: lower case, no scheme / path / "www." / trailing dot.
create or replace function public.link_domain_normalize(p_domain text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(coalesce(p_domain, ''))),
          '^[a-z][a-z0-9+.-]*://', ''),
        '[/?#].*$', ''),
      '^www\.', ''),
    '\.$', '')
$$;

-- null, or invalid_domain / domain_shortener.
create or replace function public.link_domain_error(p_domain text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
      or p_domain ~ '(^|\.)xn--'
      or p_domain !~ '\.[a-z]{2,}$'
      or pg_catalog.length(p_domain) > 253 then 'invalid_domain'
    when public.comment_domain_match(p_domain, public.comment_shorteners()) then 'domain_shortener'
  end
$$;

-- =====================================================================
-- 2. Tables (no direct access: RLS on, no policies, no grants — RPCs only)
-- =====================================================================

create table if not exists public.comments (
  id              uuid primary key default gen_random_uuid(),
  measurement_id  text not null references public.measurements (id) on delete cascade,
  campaign_id     text not null references public.campaigns (id) on delete cascade,
  author_id       uuid not null references public.profiles (id) on delete cascade,
  kind            text not null default 'comment' check (kind in ('comment', 'issue')),
  body            text not null check (pg_catalog.char_length(body) between 1 and 1000),
  lang            text not null check (lang ~ '^[a-z]{2}$'),
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  hidden_at       timestamptz,
  hidden_reason   text check (hidden_reason in ('moderator', 'reports')),
  check ((hidden_at is null) = (hidden_reason is null))
);
create index if not exists comments_measurement_idx on public.comments (measurement_id, created_at);
create index if not exists comments_author_idx on public.comments (author_id);
create index if not exists comments_campaign_idx on public.comments (campaign_id);
create index if not exists comments_hidden_idx on public.comments (hidden_at) where hidden_at is not null;

create table if not exists public.comment_reports (
  comment_id   uuid not null references public.comments (id) on delete cascade,
  reporter_id  uuid not null references public.profiles (id) on delete cascade,
  reason       text not null check (reason in ('bullying', 'personal_info', 'spam', 'other')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  primary key (comment_id, reporter_id)
);
create index if not exists comment_reports_open_idx on public.comment_reports (comment_id) where resolved_at is null;
create index if not exists comment_reports_reporter_idx on public.comment_reports (reporter_id);

-- Moderation log. No text, no names: ids only (null once that account is deleted).
-- actor_id null + action 'auto_hide' = hidden by 3 reports.
create table if not exists public.comment_events (
  id              bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  action          text not null check (action in ('hide', 'unhide', 'dismiss', 'delete', 'auto_hide')),
  comment_id      uuid,
  measurement_id  text,
  campaign_id     text,
  kind            text,
  actor_id        uuid references public.profiles (id) on delete set null,
  author_id       uuid references public.profiles (id) on delete set null,
  reports         integer not null default 0
);
create index if not exists comment_events_at_idx on public.comment_events (id desc);

create table if not exists public.allowed_link_domains (
  domain       text primary key check (public.link_domain_error(domain) is null),
  added_by     uuid references public.profiles (id) on delete set null,
  added_at     timestamptz not null default now(),
  proposal_id  bigint
);

create table if not exists public.link_domain_proposals (
  id                bigint generated always as identity primary key,
  domain            text not null check (public.link_domain_error(domain) is null),
  reason            text not null check (pg_catalog.char_length(reason) between 1 and 500),
  proposed_by       uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by        uuid references public.profiles (id) on delete set null,
  decided_at        timestamptz,
  decision_comment  text check (pg_catalog.char_length(decision_comment) <= 500)
);
create unique index if not exists link_domain_proposals_pending_idx
  on public.link_domain_proposals (domain) where status = 'pending';

-- Who changed the list / decided a proposal, what, when. note = the reason (propose) or the
-- decision comment (approve / reject).
create table if not exists public.link_domain_events (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  action       text not null check (action in ('add', 'remove', 'propose', 'approve', 'reject')),
  domain       text not null,
  actor_id     uuid references public.profiles (id) on delete set null,
  proposal_id  bigint,
  note         text
);

alter table public.comments enable row level security;
alter table public.comment_reports enable row level security;
alter table public.comment_events enable row level security;
alter table public.allowed_link_domains enable row level security;
alter table public.link_domain_proposals enable row level security;
alter table public.link_domain_events enable row level security;
revoke all on public.comments, public.comment_reports, public.comment_events,
  public.allowed_link_domains, public.link_domain_proposals, public.link_domain_events
  from public, anon, authenticated;

insert into public.allowed_link_domains (domain)
values ('youtube.com'), ('youtu.be'), ('wikipedia.org'), ('gov.il'), ('ac.il')
on conflict (domain) do nothing;

-- =====================================================================
-- 3. Comment helpers
-- =====================================================================

create or replace function public.comment_domains()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(domain order by domain), '{}'::text[]) from public.allowed_link_domains
$$;

-- Main admins / owner on every lab, an admin on the labs they created.
create or replace function public.comment_can_moderate(p_campaign text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.lab_may_edit(public.my_role(), auth.uid(), c.created_by)
    from public.campaigns c where c.id = p_campaign), false)
$$;

create or replace function public.comment_json(c public.comments, p_mod boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'measurement_id', c.measurement_id,
    'author_id', c.author_id,
    'kind', c.kind,
    'body', c.body,
    'lang', c.lang,
    'created_at', c.created_at,
    'edited_at', c.edited_at,
    'hidden', c.hidden_at is not null,
    'hidden_reason', c.hidden_reason,
    'mine', c.author_id = auth.uid(),
    'can_edit', c.author_id = auth.uid() and c.hidden_at is null
                and c.created_at > now() - interval '15 minutes',
    'reported', exists (select 1 from public.comment_reports r
                        where r.comment_id = c.id and r.reporter_id = auth.uid()),
    'reports', case when p_mod then (select count(*) from public.comment_reports r
                                     where r.comment_id = c.id and r.resolved_at is null) end)
$$;

-- Raises the right error for a cleaned text (detail = JSON).
create or replace function public.comment_assert_body(p_body text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  err jsonb := public.comment_body_error(p_body, public.comment_domains());
begin
  if err is not null then
    raise exception using message = err ->> 'code', detail = err::text;
  end if;
end;
$$;

-- 5 / minute, 30 / hour, 100 / day per user (new comments and edits).
create or replace function public.comment_rate_take(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  b text := 'comment:user:' || p_user::text;
begin
  if not public.rate_limit_take(b, 5, 60, false)
     or not public.rate_limit_take(b, 30, 3600, false)
     or not public.rate_limit_take(b, 100, 86400, false) then
    return false;
  end if;
  perform public.rate_limit_take(b, 2147483647, 60, true);
  return true;
end;
$$;

-- Logged in with a username → my id.
create or replace function public.comment_me()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  select username into v_name from public.profiles where id = auth.uid();
  if not found then
    raise exception 'not_logged_in';
  end if;
  if v_name is null then
    raise exception 'no_username';
  end if;
  return auth.uid();
end;
$$;

revoke all on function public.comment_clean(text) from public, anon, authenticated;
revoke all on function public.comment_detect_text(text) from public, anon, authenticated;
revoke all on function public.comment_shorteners() from public, anon, authenticated;
revoke all on function public.comment_bare_tlds() from public, anon, authenticated;
revoke all on function public.comment_domain_match(text, text[]) from public, anon, authenticated;
revoke all on function public.comment_link_error(text, text[]) from public, anon, authenticated;
revoke all on function public.comment_body_error(text, text[]) from public, anon, authenticated;
revoke all on function public.link_domain_normalize(text) from public, anon, authenticated;
revoke all on function public.link_domain_error(text) from public, anon, authenticated;
revoke all on function public.comment_domains() from public, anon, authenticated;
revoke all on function public.comment_can_moderate(text) from public, anon, authenticated;
revoke all on function public.comment_json(public.comments, boolean) from public, anon, authenticated;
revoke all on function public.comment_assert_body(text) from public, anon, authenticated;
revoke all on function public.comment_rate_take(uuid) from public, anon, authenticated;
revoke all on function public.comment_me() from public, anon, authenticated;

-- =====================================================================
-- 4. Comment RPCs (logged-in users)
-- =====================================================================

-- {can_moderate, comments: [...]} oldest first. Hidden ones: moderators and their author only.
create or replace function public.comment_list(p_measurement text)
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
    return jsonb_build_object('can_moderate', false, 'comments', '[]'::jsonb);
  end if;
  v_mod := public.comment_can_moderate(v_campaign);
  return jsonb_build_object(
    'can_moderate', v_mod,
    'comments', coalesce((
      select jsonb_agg(public.comment_json(c, v_mod) order by c.created_at, c.id)
      from public.comments c
      where c.measurement_id = p_measurement
        and (c.hidden_at is null or v_mod or c.author_id = auth.uid())), '[]'::jsonb));
end;
$$;

-- Measurements with a visible "problem" report (the flagged mark on the map / table).
create or replace function public.comment_issue_measurements()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  return coalesce((select array_agg(distinct c.measurement_id) from public.comments c
                   where c.kind = 'issue' and c.hidden_at is null), '{}'::text[]);
end;
$$;

-- The allowed link domains (instant check in the comment form, the error message, the admin list).
create or replace function public.comment_link_domains()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  return public.comment_domains();
end;
$$;

create or replace function public.comment_add(p_measurement text, p_body text, p_lang text, p_kind text default 'comment')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := public.comment_me();
  v_campaign text;
  v_body     text := public.comment_clean(p_body);
  v_row      public.comments;
begin
  if coalesce(p_kind, '') not in ('comment', 'issue') or coalesce(p_lang, '') !~ '^[a-z]{2}$' then
    raise exception 'bad_request';
  end if;
  select observation_id into v_campaign from public.measurements where id = p_measurement;
  if not found then
    raise exception 'not_found';
  end if;
  perform public.comment_assert_body(v_body);
  if not public.comment_rate_take(v_me) then
    raise exception 'rate_limited';
  end if;
  insert into public.comments (measurement_id, campaign_id, author_id, kind, body, lang)
  values (p_measurement, v_campaign, v_me, p_kind, v_body, p_lang)
  returning * into v_row;
  return public.comment_json(v_row, public.comment_can_moderate(v_campaign));
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

-- Own comment only (moderators use comment_moderate, which is logged).
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

-- p_action: 'hide' | 'unhide' (also "keep": dismisses open reports) | 'delete'.
-- → the comment JSON, or null after delete.
create or replace function public.comment_moderate(p_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.comments;
  v_reports integer;
  v_action  text;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  if coalesce(p_action, '') not in ('hide', 'unhide', 'delete') then
    raise exception 'bad_request';
  end if;
  select * into v_row from public.comments where id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if not public.comment_can_moderate(v_row.campaign_id) then
    raise exception 'not_allowed';
  end if;
  select count(*) into v_reports from public.comment_reports
  where comment_id = p_id and resolved_at is null;

  if p_action = 'delete' then
    insert into public.comment_events (action, comment_id, measurement_id, campaign_id, kind, actor_id, author_id, reports)
    values ('delete', v_row.id, v_row.measurement_id, v_row.campaign_id, v_row.kind, auth.uid(), v_row.author_id, v_reports);
    delete from public.comments where id = p_id;
    return null;
  end if;

  if p_action = 'hide' then
    v_action := case when v_row.hidden_reason = 'moderator' then null else 'hide' end;
    update public.comments
    set hidden_at = coalesce(hidden_at, now()), hidden_reason = 'moderator'
    where id = p_id returning * into v_row;
  else
    v_action := case when v_row.hidden_at is not null then 'unhide'
                     when v_reports > 0 then 'dismiss' end;
    update public.comments set hidden_at = null, hidden_reason = null
    where id = p_id returning * into v_row;
  end if;
  update public.comment_reports set resolved_at = now()
  where comment_id = p_id and resolved_at is null;
  if v_action is not null then
    insert into public.comment_events (action, comment_id, measurement_id, campaign_id, kind, actor_id, author_id, reports)
    values (v_action, v_row.id, v_row.measurement_id, v_row.campaign_id, v_row.kind, auth.uid(), v_row.author_id, v_reports);
  end if;
  return public.comment_json(v_row, true);
end;
$$;

-- → {hidden}: true when this report was the 3rd and the comment is now hidden.
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

-- Comments with open reports that I may moderate (admins; the badge). Reporters are not shown.
create or replace function public.comment_report_queue()
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
      select r.comment_id, r.reason, count(*) as n, max(r.created_at) as last_at
      from public.comment_reports r
      where r.resolved_at is null
      group by r.comment_id, r.reason
    ), per_comment as (
      select comment_id, jsonb_object_agg(reason, n) as reasons, max(last_at) as last_at
      from per_reason
      group by comment_id
    )
    select jsonb_agg(
             public.comment_json(c, true) || jsonb_build_object(
               'campaign_id', c.campaign_id,
               'slug', k.slug,
               'title_he', k.title_he, 'title_en', k.title_en, 'title_ru', k.title_ru,
               'last_report_at', p.last_at,
               'reasons', p.reasons)
             order by (c.hidden_at is not null) desc, p.last_at desc)
    from per_comment p
    join public.comments c on c.id = p.comment_id
    join public.campaigns k on k.id = c.campaign_id
    where public.lab_may_edit(v_role, auth.uid(), k.created_by)), '[]'::jsonb);
end;
$$;

-- Moderation log (admins), newest first. Usernames are looked up now (none once deleted).
create or replace function public.comment_log(p_limit integer default 50, p_before bigint default null)
returns table (
  id bigint, at timestamptz, action text, comment_id uuid, measurement_id text, campaign_id text,
  slug text, title_he text, title_en text, title_ru text, kind text,
  actor_id uuid, actor_username text, author_id uuid, author_username text, reports integer)
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
  select e.id, e.at, e.action, e.comment_id, e.measurement_id, e.campaign_id,
         k.slug, k.title_he, k.title_en, k.title_ru, e.kind,
         e.actor_id, pa.username, e.author_id, pu.username, e.reports
  from public.comment_events e
  left join public.campaigns k on k.id = e.campaign_id
  left join public.profiles pa on pa.id = e.actor_id
  left join public.profiles pu on pu.id = e.author_id
  where p_before is null or e.id < p_before
  order by e.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.comment_list(text) from public, anon;
revoke all on function public.comment_issue_measurements() from public, anon;
revoke all on function public.comment_link_domains() from public, anon;
revoke all on function public.comment_add(text, text, text, text) from public, anon;
revoke all on function public.comment_edit(uuid, text) from public, anon;
revoke all on function public.comment_delete(uuid) from public, anon;
revoke all on function public.comment_moderate(uuid, text) from public, anon;
revoke all on function public.comment_report(uuid, text) from public, anon;
revoke all on function public.comment_report_queue() from public, anon;
revoke all on function public.comment_log(integer, bigint) from public, anon;
grant execute on function public.comment_list(text) to authenticated;
grant execute on function public.comment_issue_measurements() to authenticated;
grant execute on function public.comment_link_domains() to authenticated;
grant execute on function public.comment_add(text, text, text, text) to authenticated;
grant execute on function public.comment_edit(uuid, text) to authenticated;
grant execute on function public.comment_delete(uuid) to authenticated;
grant execute on function public.comment_moderate(uuid, text) to authenticated;
grant execute on function public.comment_report(uuid, text) to authenticated;
grant execute on function public.comment_report_queue() to authenticated;
grant execute on function public.comment_log(integer, bigint) to authenticated;

-- =====================================================================
-- 5. Allowed link domains (admins)
-- =====================================================================

create or replace function public.link_domain_can_manage()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.my_role() in ('main_admin', 'owner')
$$;
revoke all on function public.link_domain_can_manage() from public, anon, authenticated;

-- {can_manage, domains: [...], proposals: [...]}. Proposals: main admins / owner see all pending
-- and the 50 latest decided ones; an admin sees their own.
create or replace function public.link_domain_admin_view()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_manage boolean := public.link_domain_can_manage();
begin
  if not public.is_admin() then
    raise exception 'not_allowed';
  end if;
  return jsonb_build_object(
    'can_manage', v_manage,
    'domains', coalesce((
      select jsonb_agg(jsonb_build_object('domain', d.domain, 'added_at', d.added_at,
                                          'added_by', d.added_by, 'added_by_username', p.username)
                       order by d.domain)
      from public.allowed_link_domains d left join public.profiles p on p.id = d.added_by), '[]'::jsonb),
    'proposals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'domain', x.domain, 'reason', x.reason, 'status', x.status,
               'proposed_by', x.proposed_by, 'proposed_by_username', pp.username,
               'created_at', x.created_at, 'decided_by', x.decided_by,
               'decided_by_username', pd.username, 'decided_at', x.decided_at,
               'decision_comment', x.decision_comment, 'mine', x.proposed_by = auth.uid())
             order by x.status <> 'pending', coalesce(x.decided_at, x.created_at) desc)
      from (
        select * from public.link_domain_proposals l
        where (v_manage and l.status = 'pending') or l.proposed_by = auth.uid()
        union
        select * from (select * from public.link_domain_proposals l2
                       where v_manage and l2.status <> 'pending'
                       order by l2.decided_at desc limit 50) latest
      ) x
      left join public.profiles pp on pp.id = x.proposed_by
      left join public.profiles pd on pd.id = x.decided_by), '[]'::jsonb));
end;
$$;

-- Pending proposals (the badge of main admins / owner; 0 for everyone else).
create or replace function public.link_domain_pending_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.link_domain_can_manage()
              then (select count(*)::integer from public.link_domain_proposals where status = 'pending')
              else 0 end
$$;

create or replace function public.link_domain_add(p_domain text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain text := public.link_domain_normalize(p_domain);
  v_err    text := public.link_domain_error(v_domain);
  v_prop   bigint;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  if not public.link_domain_can_manage() then
    raise exception 'not_allowed';
  end if;
  if v_err is not null then
    raise exception '%', v_err;
  end if;
  if exists (select 1 from public.allowed_link_domains where domain = v_domain) then
    raise exception 'domain_exists';
  end if;
  -- A pending proposal for the same domain is approved by this.
  update public.link_domain_proposals
  set status = 'approved', decided_by = auth.uid(), decided_at = now()
  where domain = v_domain and status = 'pending'
  returning id into v_prop;
  insert into public.allowed_link_domains (domain, added_by, proposal_id) values (v_domain, auth.uid(), v_prop);
  if v_prop is not null then
    insert into public.link_domain_events (action, domain, actor_id, proposal_id) values ('approve', v_domain, auth.uid(), v_prop);
  else
    insert into public.link_domain_events (action, domain, actor_id) values ('add', v_domain, auth.uid());
  end if;
  return v_domain;
end;
$$;

-- Comments that already contain the domain stay; their links are shown as plain text.
create or replace function public.link_domain_remove(p_domain text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain text := public.link_domain_normalize(p_domain);
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  if not public.link_domain_can_manage() then
    raise exception 'not_allowed';
  end if;
  delete from public.allowed_link_domains where domain = v_domain;
  if not found then
    raise exception 'not_found';
  end if;
  insert into public.link_domain_events (action, domain, actor_id) values ('remove', v_domain, auth.uid());
  return true;
end;
$$;

create or replace function public.link_domain_propose(p_domain text, p_reason text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain text := public.link_domain_normalize(p_domain);
  v_err    text := public.link_domain_error(v_domain);
  v_reason text := public.comment_clean(p_reason);
  v_id     bigint;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  if not public.is_admin() then
    raise exception 'not_allowed';
  end if;
  if v_err is not null then
    raise exception '%', v_err;
  end if;
  if v_reason = '' then
    raise exception 'reason_required';
  end if;
  if pg_catalog.char_length(v_reason) > 500 then
    raise exception 'reason_too_long';
  end if;
  if exists (select 1 from public.allowed_link_domains where domain = v_domain) then
    raise exception 'domain_exists';
  end if;
  if exists (select 1 from public.link_domain_proposals where domain = v_domain and status = 'pending') then
    raise exception 'proposal_pending';
  end if;
  insert into public.link_domain_proposals (domain, reason, proposed_by)
  values (v_domain, v_reason, auth.uid()) returning id into v_id;
  insert into public.link_domain_events (action, domain, actor_id, proposal_id, note)
  values ('propose', v_domain, auth.uid(), v_id, v_reason);
  return v_id;
end;
$$;

create or replace function public.link_domain_decide(p_id bigint, p_approve boolean, p_comment text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop    public.link_domain_proposals;
  v_comment text := nullif(public.comment_clean(p_comment), '');
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  if not public.link_domain_can_manage() then
    raise exception 'not_allowed';
  end if;
  if p_approve is null then
    raise exception 'bad_request';
  end if;
  if pg_catalog.char_length(v_comment) > 500 then
    raise exception 'comment_too_long';
  end if;
  select * into v_prop from public.link_domain_proposals where id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_prop.status <> 'pending' then
    raise exception 'already_decided';
  end if;
  update public.link_domain_proposals
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(), decided_at = now(), decision_comment = v_comment
  where id = p_id;
  if p_approve then
    insert into public.allowed_link_domains (domain, added_by, proposal_id)
    values (v_prop.domain, auth.uid(), p_id)
    on conflict (domain) do nothing;
  end if;
  insert into public.link_domain_events (action, domain, actor_id, proposal_id, note)
  values (case when p_approve then 'approve' else 'reject' end, v_prop.domain, auth.uid(), p_id, v_comment);
  return true;
end;
$$;

create or replace function public.link_domain_log(p_limit integer default 50, p_before bigint default null)
returns table (id bigint, at timestamptz, action text, domain text, actor_id uuid, actor_username text,
               proposal_id bigint, note text)
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
  select e.id, e.at, e.action, e.domain, e.actor_id, p.username, e.proposal_id, e.note
  from public.link_domain_events e
  left join public.profiles p on p.id = e.actor_id
  where p_before is null or e.id < p_before
  order by e.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.link_domain_admin_view() from public, anon;
revoke all on function public.link_domain_pending_count() from public, anon;
revoke all on function public.link_domain_add(text) from public, anon;
revoke all on function public.link_domain_remove(text) from public, anon;
revoke all on function public.link_domain_propose(text, text) from public, anon;
revoke all on function public.link_domain_decide(bigint, boolean, text) from public, anon;
revoke all on function public.link_domain_log(integer, bigint) from public, anon;
grant execute on function public.link_domain_admin_view() to authenticated;
grant execute on function public.link_domain_pending_count() to authenticated;
grant execute on function public.link_domain_add(text) to authenticated;
grant execute on function public.link_domain_remove(text) to authenticated;
grant execute on function public.link_domain_propose(text, text) to authenticated;
grant execute on function public.link_domain_decide(bigint, boolean, text) to authenticated;
grant execute on function public.link_domain_log(integer, bigint) to authenticated;

-- =====================================================================
-- 6. Account deletion (replaces the 014 versions; same arguments)
-- =====================================================================

-- 014 + comments (own) and comments_on_measurements (others' comments on my measurements:
-- deleted together with the measurements if the user chooses to delete them).
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
                                 where m.user_id = v_me.id::text and c.author_id <> v_me.id));
end;
$$;

revoke all on function public.account_delete_preview() from public, anon;
grant execute on function public.account_delete_preview() to authenticated;

-- 014 + the user's comments and reports are deleted, and their comment / report rate-limit rows.
-- Returns {anon_id, measurements, admins_moved, revisions_discarded, comments}.
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
  n_comm   integer;
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
                   'comment:user:' || p_user::text, 'report:user:' || p_user::text);

  return jsonb_build_object('anon_id', v_anon, 'measurements', n_meas,
                            'admins_moved', n_moved, 'revisions_discarded', n_rev,
                            'comments', n_comm);
end;
$$;

revoke all on function public.account_delete_prepare(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.account_delete_prepare(uuid, text, boolean) to service_role;

-- 014 + comment / report rate-limit rows written between prepare and the auth deletion.
-- (Comments and reports written in between went with the profile: FK cascade.)
-- Returns {measurements, audit_log}.
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

  delete from private.rate_limit_hits
  where bucket in ('delete:user:' || p_user::text, 'comment:user:' || p_user::text,
                   'report:user:' || p_user::text);

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

-- =====================================================================
-- 7. Retention: daily cleanup (pg_cron)
-- =====================================================================
-- Hidden comments: deleted 90 days after they were hidden. Resolved reports: 90 days after
-- they were resolved. Returns the counts (run it by hand to check).

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.comments_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_hidden  integer;
  n_reports integer;
begin
  delete from public.comments where hidden_at < now() - interval '90 days';
  get diagnostics n_hidden = row_count;
  delete from public.comment_reports where resolved_at < now() - interval '90 days';
  get diagnostics n_reports = row_count;
  return jsonb_build_object('hidden_comments', n_hidden, 'resolved_reports', n_reports);
end;
$$;

revoke all on function private.comments_cleanup() from public, anon, authenticated;

select cron.schedule('mitzpe-comments-cleanup', '27 3 * * *', 'select private.comments_cleanup()');
