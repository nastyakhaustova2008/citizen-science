-- 018 tests, part 1 — runs BEFORE migration 018 (see run.sh): test users, and a measurement that
-- 018 would reject, saved under the 017 rules (to test that old rows keep working).
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
 ('11111111-1111-4111-8111-111111111111','a@noemail.mitzpe.invalid',now(),'{"mitzpe_username":"Kid One"}'),
 ('22222222-2222-4222-8222-222222222222','b@noemail.mitzpe.invalid',now(),'{"mitzpe_username":"Kid Two"}'),
 ('33333333-3333-4333-8333-333333333333','c@noemail.mitzpe.invalid',now(),'{"mitzpe_username":"Teacher A"}'),
 ('44444444-4444-4444-8444-444444444444','d@noemail.mitzpe.invalid',now(),'{"mitzpe_username":"The Owner"}');
update public.profiles set role='owner' where id='44444444-4444-4444-8444-444444444444';
update public.profiles set role='admin', role_granted_by='44444444-4444-4444-8444-444444444444', role_granted_at=now()
 where id='33333333-3333-4333-8333-333333333333';
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('measurement-photos','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg','11111111-1111-4111-8111-111111111111','{"size":1000}');

-- The old (017) rules accept a phone number and a 300-character place name.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true),
       set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true) \g /dev/null
insert into public.measurements (id, observation_id, user_id, place_label, lat, lng, measured_at, field_values)
values ('old-bad-row', 'obs-schoolyard-heat', '11111111-1111-4111-8111-111111111111', repeat('x', 300) || ' call 050-1234567',
        32.1, 34.8, now() - interval '2 days',
        '{"temperature": 25, "instrument": "call me 050-1234567", "notes": "mail noa@gmail.com", "photo": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg"}');
commit;

-- Comment check results before 018 (must be identical after it).
create table public.t_before as
select s, public.comment_body_error(public.comment_clean(s), public.comment_domains()) as r
from jsonb_array_elements_text(:'strings'::jsonb) s;
