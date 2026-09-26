-- Minimal stand-ins for what a Supabase project already has, so the migrations can run on a plain
-- local PostgreSQL: the API roles (anon, authenticated, service_role, authenticator) with Supabase's
-- default grants in public, auth.users / auth.uid() (reads the JWT "sub" like Supabase does),
-- storage.buckets / storage.objects, cron.schedule and vault.secrets.
-- Only for supabase/tests/run.sh — never run this on a real project.

create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create role authenticator login noinherit; grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema auth; grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email varchar, email_confirmed_at timestamptz,
  raw_user_meta_data jsonb default '{}', is_anonymous boolean default false, created_at timestamptz default now(), last_sign_in_at timestamptz);
create table auth.audit_log_entries (id uuid default gen_random_uuid(), payload json, created_at timestamptz default now());
create table auth.sessions (id uuid default gen_random_uuid(), user_id uuid, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create schema storage; grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text, owner_id text, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to anon, authenticated;
create schema cron; create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text, active boolean default true);
create table cron.job_run_details (runid serial, jobid int, status text, return_message text, start_time timestamptz, end_time timestamptz);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create schema vault; create table vault.secrets (id uuid default gen_random_uuid(), name text, secret text, created_at timestamptz default now());
