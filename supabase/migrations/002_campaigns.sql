-- 002_campaigns.sql
-- Roadmap step 2: move campaigns (OBSERVATIONS) from src/data/mockData.js into Supabase.
-- Run once in the Supabase SQL Editor, AFTER 001_measurements.sql.
-- Then run seed/002_campaigns_seed.sql, then migrations/003_measurements_campaign_fk.sql.
--
-- Mirrors the Observation shape in mockData.js (camelCase in JS → snake_case here):
--   id, slug, metric, icon, titleHe/En/Ru, descHe/En/Ru, status, region, difficulty,
--   equipment[], protocolUrl, center:[lat,lng] → center_lat/center_lng, zoom
--
-- Translations are separate columns (title_he / title_en / title_ru), not jsonb:
-- the app has exactly three fixed languages, the DB can enforce that each one is filled,
-- and rows map 1:1 onto the titleHe/En/Ru shape the UI already uses.
--
-- Future steps (not built here):
--   step 3 — per-campaign measurement fields: add a new `fields jsonb` column or a
--            `campaign_fields` table in a new migration; `metric` stays as the default.
--   step 5 — admins create campaigns: ids are free-form text (slug or uuid both fine).

create table if not exists public.campaigns (
  id            text primary key default gen_random_uuid()::text,
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  metric        text not null,  -- key in src/data/metrics.js (metrics live in code, so no FK)
  icon          text not null default 'Activity',  -- icon name from components/ObsIcon.jsx (unknown → Activity)
  title_he      text not null check (length(trim(title_he)) > 0),
  title_en      text not null check (length(trim(title_en)) > 0),
  title_ru      text not null check (length(trim(title_ru)) > 0),
  desc_he       text not null default '',
  desc_en       text not null default '',
  desc_ru       text not null default '',
  status        text not null default 'collecting'
                check (status in ('collecting', 'completed')),
  region        text not null,  -- key for regions.* in src/i18n/strings.js
  difficulty    text not null default 'easy'
                check (difficulty in ('easy', 'medium', 'hard')),
  equipment     text[] not null default '{}',
  protocol_url  text,
  center_lat    double precision not null check (center_lat between -90 and 90),
  center_lng    double precision not null check (center_lng between -180 and 180),
  zoom          smallint not null default 8 check (zoom between 1 and 18),
  sort_order    integer not null default 0,  -- display order on the home page
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists campaigns_sort_order_idx
  on public.campaigns (sort_order, id);

-- Keep updated_at current (admins will edit campaigns in step 5).
create or replace function public.campaigns_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.campaigns_set_updated_at();

alter table public.campaigns enable row level security;

-- =====================================================================
-- TEMPORARY ACCESS RULES — no login yet.
-- Anyone (anon key) may READ campaigns. No INSERT, no UPDATE, no DELETE.
-- TO BE REPLACED in roadmap step 4 (login + roles: admins will edit campaigns).
-- =====================================================================

revoke all on public.campaigns from anon, authenticated;
grant select on public.campaigns to anon, authenticated;

-- TEMPORARY (replace in roadmap step 4): public read.
drop policy if exists "TEMPORARY anyone can read campaigns" on public.campaigns;
create policy "TEMPORARY anyone can read campaigns"
  on public.campaigns
  for select
  to anon, authenticated
  using (true);

-- No insert / update / delete policies on purpose: with RLS enabled, all are denied.
-- Campaigns are changed only from the SQL Editor until step 4.
