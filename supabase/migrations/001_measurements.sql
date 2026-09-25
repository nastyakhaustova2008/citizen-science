-- 001_measurements.sql
-- Roadmap step 1: move measurements from src/data/mockData.js into Supabase.
-- Run once in the Supabase SQL Editor.
--
-- Mirrors the Measurement shape in mockData.js (camelCase in JS → snake_case here):
--   id, observationId, userId, placeLabel, lat, lng, value, timestamp,
--   instrument, conditions, notes, verification, photoSeed
-- Not stored: comments[] (in-memory for now), photoDataUri (user photos stay in memory).
-- Campaigns and users still live in code, so observation_id / user_id are plain text, no FKs.

create table if not exists public.measurements (
  id              text primary key default gen_random_uuid()::text,
  observation_id  text not null,
  user_id         text not null,
  place_label     text,
  lat             double precision not null check (lat between -90 and 90),
  lng             double precision not null check (lng between -180 and 180),
  value           double precision not null,
  measured_at     timestamptz not null,
  instrument      text,
  conditions      text,
  notes           text not null default '',
  verification    text not null default 'pending'
                  check (verification in ('verified', 'pending', 'flagged')),
  photo_seed      text,  -- seed for a generated SVG placeholder (demo data only), not a real photo
  created_at      timestamptz not null default now()
);

create index if not exists measurements_observation_measured_at_idx
  on public.measurements (observation_id, measured_at desc);

alter table public.measurements enable row level security;

-- =====================================================================
-- TEMPORARY ACCESS RULES — no login yet.
-- Anyone (anon key) may READ and INSERT measurements. No UPDATE, no DELETE.
-- TO BE REPLACED in roadmap step 4 (login + student/admin roles).
-- =====================================================================

revoke all on public.measurements from anon, authenticated;
grant select, insert on public.measurements to anon, authenticated;

-- TEMPORARY (replace in roadmap step 4): public read.
drop policy if exists "TEMPORARY anyone can read measurements" on public.measurements;
create policy "TEMPORARY anyone can read measurements"
  on public.measurements
  for select
  to anon, authenticated
  using (true);

-- TEMPORARY (replace in roadmap step 4): public insert.
-- New rows must be unverified and cannot carry a demo placeholder seed.
drop policy if exists "TEMPORARY anyone can insert measurements" on public.measurements;
create policy "TEMPORARY anyone can insert measurements"
  on public.measurements
  for insert
  to anon, authenticated
  with check (verification = 'pending' and photo_seed is null);

-- No update / delete policies on purpose: with RLS enabled, both are denied.
