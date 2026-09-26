-- 022_signup_cleanup_preview.sql — READ-ONLY. Run in the Supabase SQL Editor BEFORE migration 022.
-- Shows what the daily cleanup of 022 (private.privacy_cleanup) would delete. No emails, no
-- usernames, no ids in the output.
--
-- Part 1 — accounts. After 022 the cleanup deletes an account only if ALL of these hold:
--   email not confirmed, phone not confirmed, older than 7 days, profile without a username,
--   no measurements, no comments, no profile picture, no uploaded files.
-- Username accounts (Edge Function) and Google accounts are confirmed, so they never qualify.
-- marked_by_edge_function: false for every account created before the Edge Function of 022 was
-- deployed — expected (the mark is new); it doesn't affect the cleanup.
-- Every row here is one kind of account. If a row with would_delete = true looks like a REAL
-- person (e.g. provider 'google', or has_data = true — impossible by the rule, but check), STOP
-- and don't run 022.
select
  coalesce(u.raw_app_meta_data ->> 'provider', '?')                  as provider,
  coalesce((u.raw_app_meta_data ->> 'mitzpe_signup') = 'true', false) as marked_by_edge_function,
  u.email_confirmed_at is not null                                   as email_confirmed,
  p.username is not null                                             as has_username,
  (exists (select 1 from public.measurements m where m.user_id = u.id::text)
   or exists (select 1 from public.comments c where c.author_id = u.id)
   or exists (select 1 from public.avatars a where a.user_id = u.id)
   or exists (select 1 from storage.objects o where o.owner_id = u.id::text)) as has_data,
  u.created_at < now() - interval '7 days'                          as older_than_7_days,
  (u.email_confirmed_at is null and u.phone_confirmed_at is null
   and u.created_at < now() - interval '7 days' and p.username is null
   and not exists (select 1 from public.measurements m where m.user_id = u.id::text)
   and not exists (select 1 from public.comments c where c.author_id = u.id)
   and not exists (select 1 from public.avatars a where a.user_id = u.id)
   and not exists (select 1 from storage.objects o where o.owner_id = u.id::text)) as would_delete,
  count(*)                                                           as accounts,
  min(u.created_at)::date                                            as first_created,
  max(u.created_at)::date                                            as last_created
from auth.users u
left join public.profiles p on p.id = u.id
group by 1, 2, 3, 4, 5, 6, 7
order by would_delete desc, accounts desc;

-- Part 2 — the accounts that would be deleted, one row each (still no email / name / id).
select u.created_at, coalesce(u.raw_app_meta_data ->> 'provider', '?') as provider,
       u.email_confirmed_at is not null as email_confirmed, p.username is not null as has_username,
       u.last_sign_in_at is not null as ever_signed_in
from auth.users u
join public.profiles p on p.id = u.id
where u.email_confirmed_at is null and u.phone_confirmed_at is null
  and u.created_at < now() - interval '7 days' and p.username is null
  and not exists (select 1 from public.measurements m where m.user_id = u.id::text)
  and not exists (select 1 from public.comments c where c.author_id = u.id)
  and not exists (select 1 from public.avatars a where a.user_id = u.id)
  and not exists (select 1 from storage.objects o where o.owner_id = u.id::text)
order by u.created_at;

-- Part 3 — sign-in sessions that the cleanup would end (not used for 30 days). Those devices will
-- have to sign in again; nothing else happens to the account.
select count(*) filter (where coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at)
                              < now() - interval '30 days') as sessions_to_end,
       count(*) as sessions_total
from auth.sessions s;
