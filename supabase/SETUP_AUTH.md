# Accounts setup (roadmap step 4a) — manual steps

Everything below is done by hand in the Brevo, Supabase and Google Cloud dashboards.
Do it in this order. Replace:

* `<ref>` — your Supabase project ref (`https://<ref>.supabase.co`)
* `<prod>` — the production site, e.g. `mitzpe.vercel.app`
* `<team>` — your Vercel team/account slug (the last part of preview URLs:
  `https://<project>-git-<branch>-<team>.vercel.app`)

---

## 1. Brevo (SMTP for auth emails)

Supabase's built-in mailer only delivers to your own project team's addresses and only a few
emails per hour, so password resets and email confirmations for students need your own SMTP.

1. Create a free account at brevo.com (300 emails/day). Finish the profile questions if Brevo
   asks — the transactional (SMTP) service may stay disabled until the account is activated.
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender.**
   Name: `Mitzpe` (or `מצפה`). Email: the address you own (e.g. your Gmail).
   Brevo emails you a code — confirm it. The sender must show as verified.
3. **SMTP & API → SMTP** tab. Note the server `smtp-relay.brevo.com`, port `587` and the
   **Login** (looks like `xxxxxx@smtp-brevo.com`). Click **Generate a new SMTP key**, name it
   `supabase`, copy the key (shown once).
4. If Brevo's transactional settings have click/link tracking turned on, turn it off —
   tracking rewrites links and can break the confirmation/reset links.

Without your own domain: Gmail/Yahoo addresses as senders have weak deliverability (no
SPF/DKIM for your address at Brevo). Brevo may warn about it or send on your behalf from
its own domain, and some emails may land in spam. Tell students to check the spam folder.
Buying a domain and authenticating it in Brevo later fixes this; nothing in the code changes.

## 2. Supabase — SMTP

**Authentication → Emails → SMTP Settings → Enable custom SMTP:**

| Field | Value |
|---|---|
| Sender email | the verified Brevo sender address |
| Sender name | `Mitzpe` |
| Host | `smtp-relay.brevo.com` |
| Port | `587` |
| Username | the Brevo SMTP **Login** |
| Password | the Brevo SMTP key |
| Minimum interval between emails | `60` seconds |

Then **Authentication → Rate Limits → "Rate limit for sending emails"**: `30` per hour is fine
(Brevo free = 300/day).

## 3. Supabase — URL configuration

**Authentication → URL Configuration:**

* **Site URL:** `https://<prod>/`
* **Redirect URLs** (Add URL, one per line) — **exactly these two, nothing else:**
  * `https://<prod>/**`
  * `http://localhost:5173/**` — local dev

Email links and Google return here. A URL not on this list silently falls back to the Site URL.

**Never add a wildcard for Vercel previews** (such as `https://*-<team>.vercel.app/**` or
`https://*.vercel.app/**`). Anyone can create a Vercel project whose preview address matches such
a pattern; a password-reset or email-confirmation link that points there would hand the one-time
code to that site. The Edge Function `account` also accepts `redirectTo` only for production and
localhost (`REDIRECT_ORIGINS`, step 25). Consequence: **Google sign-in and email links are tested
on production only** (on a preview, Google sign-in returns you to production).

## 4. Supabase — sign-in settings

**Authentication → Sign In / Providers:**

* **User Signups → Allow new users to sign up: ON** (Google sign-up needs it; username
  sign-ups go through the Edge Function anyway).
* **Email** provider:
  * Enable Email provider: **ON**
  * Confirm email: **ON** (only affects someone calling the API directly with a real email)
  * Secure email change: **OFF** — required: accounts without email have an internal
    placeholder address that can never confirm the "old address" half of a secure change.
  * Secure password change: **OFF** (default)
  * Minimum password length: **8**
  * Email OTP expiration: `3600` seconds (1 hour) or less

## 5. Supabase — email templates

**Authentication → Emails → Templates.** The app uses HashRouter, so links must go to
`…/#/auth/confirm?token_hash=…`. Replace the **whole body** of these three templates
(subjects are up to you).

**Reset Password** (subject e.g. `Mitzpe — איפוס סיסמה / Reset password / Сброс пароля`):

```html
<p dir="rtl">לאיפוס הסיסמה בחשבון מצפה לחצו על הקישור:</p>
<p>To reset your Mitzpe password, open this link:</p>
<p>Чтобы сбросить пароль в Мицпе, откройте ссылку:</p>
<p><a href="{{ .RedirectTo }}#/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">{{ .RedirectTo }}</a></p>
<p>If you did not ask for this, ignore this email. / אם לא ביקשתם, התעלמו מההודעה. / Если вы не запрашивали сброс, просто проигнорируйте письмо.</p>
```

**Change Email Address** (subject e.g. `Mitzpe — אישור אימייל / Confirm email / Подтверждение email`):

```html
<p dir="rtl">לאישור הכתובת {{ .NewEmail }} בחשבון מצפה לחצו על הקישור:</p>
<p>To confirm {{ .NewEmail }} for your Mitzpe account, open this link:</p>
<p>Чтобы подтвердить {{ .NewEmail }} для аккаунта Мицпе, откройте ссылку:</p>
<p><a href="{{ .RedirectTo }}#/auth/confirm?token_hash={{ .TokenHash }}&type=email_change">{{ .RedirectTo }}</a></p>
```

**Confirm Signup** (only used if someone signs up through the API directly with an email):

```html
<p>Confirm your email for Mitzpe / אישור אימייל / Подтверждение email:</p>
<p><a href="{{ .RedirectTo }}#/auth/confirm?token_hash={{ .TokenHash }}&type=email">{{ .RedirectTo }}</a></p>
```

The confirm page verifies the link only when the user presses its button, so mail scanners
that pre-open links do not use them up.

## 6. Supabase — API keys and IP forwarding

1. **Settings → API Keys → "Publishable and secret API keys"** tab. If there is a
   **Create new API keys** button, press it. A `default` secret key (`sb_secret_…`) must exist
   (the Edge Function reads it from `SUPABASE_SECRET_KEYS`; forwarding the client IP only works
   with a secret key).
2. **Authentication → Rate Limits → IP Address Forwarding: ON.**

## 7. Supabase — SQL

In **SQL Editor**, run `supabase/migrations/006_profiles_auth.sql`. It is compatible with the
current production code. **Do not run 007 yet** (step 11).

## 8. Supabase — Edge Function `account`

1. **Edge Functions → Functions → Deploy a new function → Via Editor.**
2. Name: `account` (exactly). Replace the sample code with the whole of
   `supabase/functions/account/index.ts`. **Deploy.**
3. Open the function → **Details/Settings** → turn **Verify JWT / Enforce JWT verification OFF**
   → Save. (Callers are not logged in yet; the publishable key is not a JWT.)
4. Optional secrets (**Edge Functions → Secrets**), defaults in brackets:
   `SIGNUP_LIMIT_PER_IP` (30/hour — a whole class behind one school NAT must fit),
   `SIGNUP_LIMIT_GLOBAL` (150/hour), `LOGIN_FAIL_LIMIT_PER_USER` (10 wrong passwords per username
   and IP per 15 min), `LOGIN_FAIL_LIMIT_PER_USER_ALL` (100 wrong passwords per username per hour,
   all IPs), `USERNAME_CHECK_LIMIT_PER_IP` (300 per 10 min), `USERNAME_CHECK_LIMIT_GLOBAL`
   (5000 per 10 min), `RECOVER_LIMIT_PER_IP` (20/hour), `RECOVER_LIMIT_PER_USER` (3/hour),
   `CLIENT_IP_HEADER` (auto), `REDIRECT_ORIGINS` (production + `http://localhost:5173`; only
   change it if the production address changes — never a wildcard).
   Changing a secret needs no redeploy.

### 8a. Check that the client IP cannot be spoofed

The function forwards the end user's IP to Supabase Auth (`Sb-Forwarded-For`) and uses it for
the per-IP signup limit. It never trusts the left-most `X-Forwarded-For` entry (the browser can
write anything there); by default (`auto`) it uses `CF-Connecting-IP`, then `X-Real-IP`.
Whether these reach the function unmodifiable must be checked on the real platform:

```sh
KEY=<publishable key>
URL=https://<ref>.supabase.co/functions/v1/account
curl -s https://api.ipify.org; echo                       # your real IP
curl -s $URL -H "apikey: $KEY" -H 'Content-Type: application/json' -d '{"action":"client-ip"}'; echo
curl -s $URL -H "apikey: $KEY" -H 'Content-Type: application/json' \
  -H 'CF-Connecting-IP: 203.0.113.7' -H 'X-Real-IP: 203.0.113.7' -H 'X-Forwarded-For: 203.0.113.7' \
  -d '{"action":"client-ip"}'; echo
```

* **Pass:** `"ip"` is your real IP in both answers, never `203.0.113.7`.
* **`"ip"` is `203.0.113.7` in the second answer** (spoofable): look at `"seen"` in the second
  answer, pick a header that still shows your real IP, and set the secret `CLIENT_IP_HEADER` to
  `cf-connecting-ip`, `x-real-ip` or `x-forwarded-for-last` accordingly; re-run the test.
  If none is safe, set `CLIENT_IP_HEADER=none`: nothing is forwarded, all sign-ups share one
  per-IP bucket (still capped by `SIGNUP_LIMIT_GLOBAL`), and logins share the Edge Function's
  IP in Supabase's own limit.
* **`"ip"` is `null`**: nothing usable was found — same situation as `none` above.

Even if an attacker could fake the IP, the global signup cap and the per-username login-failure
limit do not depend on it.

## 9. Google Cloud — OAuth client

1. console.cloud.google.com → project picker → **New project** (e.g. `mitzpe`).
2. **Google Auth Platform** (APIs & Services → OAuth consent screen) → **Get started**:
   app name `Mitzpe`, support email, Audience **External**, contact email → Create.
3. **Branding:** app home page `https://<prod>/`; **Application privacy policy link:**
   `https://citizen-science-liart.vercel.app/privacy.html` (static page, works without
   JavaScript — see `public/privacy.html`); **Authorized domains:** add
   `<ref>.supabase.co`. (A logo is optional and triggers a brand review — skip it.)
4. **Data access:** scopes `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`
   (the default, non-sensitive ones — no Google verification needed).
5. **Clients → Create client → Web application**, name `Mitzpe (Supabase)`:
   * Authorized JavaScript origins: `https://<prod>` (optional, plus `http://localhost:5173`)
   * **Authorized redirect URIs:** `https://<ref>.supabase.co/auth/v1/callback`
   * Create → copy **Client ID** and **Client secret**.
6. **Audience → Publish app** (status "In production"). In "Testing" only listed test users
   can sign in.

Note: school Google Workspace for Education accounts of students under 18 are often blocked
from third-party apps until the school's Workspace admin allows the app. Those students can
use username sign-up instead.

## 10. Supabase — Google provider

**Authentication → Sign In / Providers → Google → Enable.** Paste the Client ID (into
"Client IDs") and the Client secret. Save. The "Callback URL" shown there must equal the
redirect URI from step 9.5.

## 11. Test, merge, then 007

1. Open the Vercel **preview** of the branch and check: sign up without email, log out/in,
   sign up with email (confirmation mail arrives, link confirms), forgot password by username
   and by email (mail arrives, new password works), Google (first time asks for a username),
   add a measurement, profile → add/change email, change password.
2. Merge → wait for the **production** deploy.
3. Run `supabase/migrations/007_measurements_auth_only.sql` (removes the TEMPORARY
   "anyone can insert" rule; only logged-in users, as themselves).

## 12. Owner

Sign up as the owner (username `Anastasiia Khaus.tova`), then in SQL Editor:

```sql
update public.profiles set role = 'owner'
where username_key = public.username_key(public.username_normalize('Anastasiia Khaus.tova'));
```

Only possible from SQL (a trigger blocks it through the API); there can be only one owner.

## 13. Admin roles (roadmap step 4b) — migration 009

Needs 006 and an owner (step 12). Compatible with the old frontend, so it can run before the
merge. Independent of 007 / 008.

1. SQL Editor → run `supabase/migrations/009_admin_roles.sql`. Safe to re-run.
2. Check (SQL Editor):

   ```sql
   -- every existing campaign now belongs to the owner
   select slug, created_by from public.campaigns;
   -- the old TEMPORARY rules are gone
   select tablename, policyname from pg_policies
   where tablename in ('campaigns', 'campaign_fields', 'campaign_field_options', 'role_events');
   ```

   If `created_by` is empty, the owner did not exist yet: set the owner (step 12) and run 009 again.
3. Vercel **preview** of the branch, logged in as the owner → **Profile → Administration**:
   make a test user admin, let them make another user admin, revoke the first one (the
   confirmation must list both), check **Change log**. Log in as a student → no Administration
   section; the map, campaigns and adding measurements still work.
4. Merge → production deploy.

Changing roles by hand in the SQL Editor still works (it is logged as "changed directly in the
database"). The owner is changed only there.

## 14. Lab editor (roadmap step 5a) — migration 010

Needs 009. After it, **granting admin from the old frontend fails** (the grant now requires the
"teacher or staff member" confirmation), so keep the gap short: migration → preview → merge.
Everything else keeps working for the old frontend.

1. SQL Editor → run `supabase/migrations/010_lab_editor.sql`. Safe to re-run. A notice
   `campaigns_publishable: …` means an existing lab misses a title / description / map center in
   some language — fix it later in the editor (it cannot be saved until then).
2. SQL Editor → run `supabase/seed/004_equipment_translations.sql` (English / Russian equipment
   lists for the demo labs). Safe to re-run.
3. Check (SQL Editor):

   ```sql
   -- every old lab is published; equipment copied to equipment_he
   select slug, publication, edit_no, equipment_he, equipment_en from public.campaigns order by sort_order;
   -- no direct write rules left on labs (only the read rules)
   select tablename, policyname, cmd from pg_policies
   where tablename in ('campaigns', 'campaign_fields', 'campaign_field_options', 'admin_profiles');
   ```

4. Vercel **preview** of the branch:
   * as the owner: the "You are now an admin" window appears → fill in full name + workplace.
     **Profile → Administration → Users**: making someone admin now asks for the checkbox; the
     **Change log → Roles** shows "confirmed as teacher / staff".
   * as the new admin: close the window, open **Labs → New lab** → the "fill in your admin profile"
     message; fill it in; create a draft (title, a number field, a choice field, map center), save,
     reopen, check the preview in all three languages.
   * as a student / logged out: the draft is not on the home page and its link says "not found".
   * as another admin (not the author): the draft is visible with a "not published" banner, no
     "Edit" button.
   * as the owner: open a published lab → **Edit** → change a label (saves, visible at once);
     "Required", min/max, "Add field" and the protocol are disabled ("next update").
   * **Change log → Labs** lists the changes.
5. Merge → production deploy.

A draft cannot be published yet (that is step 5b: review by 3 admins). For a test only, from the
SQL Editor: `update public.campaigns set publication = 'published' where slug = '…';`

## 15. Lab review and publishing (roadmap step 5b) — migration 011

Needs 010. Works with the 5a frontend already on production, so it can run before the merge.
Publishing needs **3 admins who are not the lab's author** (and did not edit it in that round),
each with a filled admin profile.

1. SQL Editor → run `supabase/migrations/011_lab_review.sql`. Safe to re-run.
2. Check (SQL Editor):

   ```sql
   -- old labs: published, published_at empty (= "published before peer review")
   select slug, publication, review_round, published_at from public.campaigns order by sort_order;
   -- the public credit functions answer for everyone
   select public.lab_credits('obs-schoolyard-heat');   -- {"legacy": true}
   ```

3. Vercel **preview** of the branch, with 4 admin accounts (author + 3 reviewers):
   * author: create a draft → the **Submit for review** panel lists what is missing (click an item
     to jump there); fill everything, save, **Submit for review** → "In review, 0 of 3".
   * another admin: a number badge on **My profile** (a dot on the menu button on phones) and on
     **Administration → Labs** → **Waiting for review** → **Review** → **Approve**.
   * a second admin: **Request changes** with a comment → the lab is a draft again; the author sees
     the comment in the editor, fixes, submits again (a new round: earlier approvals no longer count).
   * three admins approve → "the lab is published". Logged out: the lab page shows **Created by**
     and **Approved by** with the date; the home card shows "name · workplace"; an old lab shows
     "Published before peer review".
   * a student can now add a measurement to it.
   * the author on the review page sees "you created this lab" instead of the buttons.
4. Merge → production deploy.

## 16. Revisions of published labs (roadmap step 5c) — migration 012

Needs 011. Works with the 5b frontend already on production (it just cannot propose revisions),
so it can run before the merge.

1. SQL Editor → run `supabase/migrations/012_lab_revisions.sql`. Safe to re-run.
2. Check (SQL Editor):

   ```sql
   select count(*) from public.lab_revisions;                       -- 0
   select public.lab_credits('obs-schoolyard-heat') -> 'update';     -- null (no revision applied yet)
   ```

3. Vercel **preview** of the branch, with the lab's author + 3 other admins:
   * author: open a published lab → **Edit**. Change a label (cosmetic), a maximum, archive a field,
     add a field with options, change the protocol → **Save**: "changed texts are live already; the
     structural changes are in the revision". The lab page shows the new label at once; the student
     form and the protocol page are unchanged.
   * the **Proposed revision** panel lists the changes and what is missing (click an item → the
     field opens); fill it, save, **Submit changes for review**.
   * another admin: the badge; **Waiting for review** shows the lab with an **Update** chip →
     **Review**: the list of proposed changes, the lab and form as they will become, the current
     protocol → **Approve**. The author sees "you created this lab" instead of the buttons.
   * try **Request changes** once (back to draft, the author sees the comment), and editing the
     revision while in review (approvals reset); a label-only edit does not reset them.
   * three approvals → "the changes are live": the student form has the new field, the archived
     one is gone, the protocol page shows the new protocol; logged out, the lab page shows
     **Updated on … approved by …**.
   * **Discard changes** on a new revision → the lab stays as it is.
4. Merge → production deploy.

## 17. Delete my account — migration 014 + Edge Function `account`

Needs 012 (independent of 013). Works with the frontend already on production (it only adds
functions and role-log actions), so it can run before the merge.

1. SQL Editor → run `supabase/migrations/014_delete_account.sql`. Safe to re-run.
2. Check (SQL Editor):

   ```sql
   select public.account_delete_preview();   -- error not_logged_in (the SQL Editor is nobody)
   select proname from pg_proc where proname like 'account_delete%';   -- 4 functions
   ```

3. Dashboard → **Edge Functions** → `account` → **Code** → paste the new
   `supabase/functions/account/index.ts` → **Deploy**. Keep **Verify JWT OFF** (the new `delete`
   action checks the user's token itself; the other actions are called before login).
4. Optional secrets (Dashboard → Edge Functions → **Secrets**; defaults in brackets):
   `REAUTH_MAX_AGE_MINUTES` (15), `DELETE_LIMIT_PER_USER` (10 per hour),
   `DELETE_LIMIT_PER_IP` (30 per hour). No redeploy needed.
5. Vercel **preview** of the branch. The database is shared with production — use throwaway
   accounts only:
   * username + password account with a measurement → Profile → **Delete account** → keep the
     measurements, type the username → you land on the home page with "account deleted"; the
     measurement shows "Unknown participant"; logging in with that name fails; the name can be
     registered again.
   * wait more than 15 minutes after logging in (or set `REAUTH_MAX_AGE_MINUTES` to 1) → delete →
     "sign in again" → password → delete works.
   * Google-only account → same, "sign in again" goes through Google and back to the panel.
   * admin A appointed by admin M, A appointed B → delete A → the panel said "1 admin will be moved
     under M"; in **Administration → Log**: "a deleted account … was deleted", "B moved under M".
   * the owner has no delete button.
6. Merge → production deploy → update `public/privacy.html` (all languages + date).

## 18. Comments on measurements — migration 015

Needs 014 (and 008: the cleanup job uses pg_cron). Works with the frontend already on production
(it only adds tables and functions; the three account-deletion functions keep their arguments and
only return extra keys), so it can run before the merge. **No Edge Function change.**

1. SQL Editor → run `supabase/migrations/015_comments.sql`. Safe to re-run.
2. Check (SQL Editor):

   ```sql
   select * from public.allowed_link_domains;          -- youtube.com, youtu.be, wikipedia.org, gov.il, ac.il
   select public.comment_body_error(public.comment_clean('call 050-1234567'), public.comment_domains());
                                                        -- {"code": "phone_not_allowed"}
   select public.comment_body_error(public.comment_clean('bit.ly/x'), public.comment_domains());
                                                        -- {"code": "link_shortener", ...}
   select private.comments_cleanup();                   -- {"hidden_comments": 0, "resolved_reports": 0}
   select jobname, schedule from cron.job;              -- + 'mitzpe-comments-cleanup' at 03:27 UTC
   ```

3. Vercel **preview** of the branch. The database is shared with production — use throwaway
   accounts, and delete the test comments afterwards (moderator "Delete", or SQL Editor
   `delete from public.comments where …`):
   * logged out → a point's panel says "log in to read and write comments"; the old production site
     still works (it doesn't read comments).
   * student → post a comment in each language (he/en/ru), reload: they stay. Mixed Hebrew/English
     text reads correctly in both RTL and LTR interface languages.
   * limits (instant message, then the same through the server): 1001 characters, a phone number
     (050-1234567, +972 50 123 4567), an email, `evil.com/x`, `bit.ly/x`, `https://user:pass@youtube.com`,
     `http://127.0.0.1`; the 6th comment within a minute → "writing too fast".
   * `https://www.youtube.com/watch?v=…` → clickable, shows `youtube.com`, opens a new tab.
   * edit within 15 minutes → "edited"; after 15 minutes the Edit button is gone.
   * "Report a data issue" → red comment; the point shows "flagged" (for logged-in users).
   * 3 different students report the same comment → it disappears for them; its author sees
     "hidden after reports"; the lab's admin (or a main admin) sees it in **Administration →
     Comments** with a badge, and in the header badge. "Show again" / "Hide" / "Delete" work; an
     admin who didn't create the lab can't moderate it; **Log → Comments** shows the actions
     without the text.
   * regular admin → **Administration → Comments** → propose a domain with a reason; main admin →
     badge → approve / reject with a comment; the proposer sees the decision; **Log → Link
     domains** shows every step. Removing a domain turns existing links to it into plain text.
   * delete a throwaway account that has comments → the preview counts them; after deletion
     they're gone.
4. Merge → production deploy.

## 19. Measurement photos in Storage — migration 016 + Edge Function `account`

Needs 015 (and 008: the cleanup job uses pg_cron). Works with the frontend already on production
(a photo value `true`, which the old code sends, is still accepted; the three account-deletion
functions keep their arguments and only return extra keys), so it can run before the merge.
**The Edge Function changes** (it deletes Storage files) — redeploy it right after the migration.

Why an Edge Function: Supabase does not let SQL delete Storage files (`delete from storage.objects`
is refused by Storage's own trigger, and would leave the file behind anyway). The database only
queues files in `private.storage_trash`; they are deleted through the Storage API — by the owner or
a moderator in the browser right away, otherwise by the function's daily `sweep` (secret key).

1. SQL Editor → run `supabase/migrations/016_measurement_photos.sql`. Safe to re-run. It creates the
   bucket too — nothing to click for it.
2. Check (SQL Editor):

   ```sql
   select id, public, file_size_limit, allowed_mime_types from storage.buckets;
                            -- measurement-photos | false | 1048576 | {image/jpeg}
   select policyname from pg_policies where tablename = 'objects' and schemaname = 'storage';
                            -- measurement photos: upload / read / delete
   select private.photos_cleanup();   -- {"rows": 0, "expired": 0, "orphans_queued": 0, "resolved_reports": 0}
   select jobname, schedule from cron.job;   -- + 'mitzpe-photos-cleanup' at 03:37 UTC
   ```

   Dashboard → **Storage**: the bucket `measurement-photos` shows **Private**. If the SQL could not
   create it (it should), create it by hand: name `measurement-photos`, Public **off**, file size
   limit **1 MB**, allowed MIME type **image/jpeg** — then run the migration again for the policies.
3. Dashboard → **Edge Functions** → `account` → **Code** → paste the new
   `supabase/functions/account/index.ts` → **Deploy**. Keep **Verify JWT OFF**.
4. The daily sweep:
   1. Dashboard → **Database → Extensions** → enable **pg_net**.
   2. Make a long random secret, e.g. in the SQL Editor:
      `select encode(gen_random_bytes(32), 'hex');` — copy the result.
   3. Dashboard → **Edge Functions → Secrets** → add `CRON_SECRET` = that value. (Without it the
      `sweep` action is disabled.)
   4. SQL Editor (replace both placeholders; `<project-ref>` is in your project URL). The secret
      goes to Vault, not into the job text:

      ```sql
      select vault.create_secret('<the secret>', 'mitzpe_cron_secret');
      select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/account', 'mitzpe_account_url');
      select cron.schedule('mitzpe-storage-sweep', '47 3 * * *', $job$
        select net.http_post(
          url     := (select decrypted_secret from vault.decrypted_secrets where name = 'mitzpe_account_url'),
          headers := jsonb_build_object(
                       'Content-Type', 'application/json',
                       'x-mitzpe-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'mitzpe_cron_secret')),
          body    := '{"action":"sweep"}'::jsonb)
      $job$);
      ```

   5. Test it now: run the `select net.http_post(…)` part alone, then
      `select status_code, content from net._http_response order by id desc limit 1;`
      → `200`, `{"ok":true,"removed":0,"left":0}`. With a wrong secret → `401`.
5. Vercel **preview** of the branch. The database is shared with production — use throwaway
   accounts and a lab you are allowed to test on:
   * logged out → a point with a photo says "log in to see the photo"; no photo URL works without
     logging in (the bucket's public URL `…/storage/v1/object/public/measurement-photos/<file>` → 400).
   * student → add a measurement with a photo from a phone (a 12 MP photo): it uploads, the success
     screen says "waiting for a teacher's approval". In the bucket (Dashboard → Storage) the file is
     a `.jpg` of at most 1600 px and well under 1 MB; download it and check it has no EXIF / GPS
     (any EXIF viewer). A HEIC photo in Chrome is still refused.
   * the author sees the photo with "waiting for approval"; another student sees "not shown right
     now"; the lab's admin (or a main admin) sees it in **Administration → Comments & photos** with
     a badge (also in the header) → **Approve** → the other student now sees it.
   * old measurements whose photo value is `true` show "a photo was attached but not saved".
   * another student → **Report** (reason) → "Thank you"; 3 different students → it is hidden for
     them, its author sees "hidden after reports", the admin sees it in the queue → **Show again** /
     **Hide** / **Delete** (reason) work; after Delete the author sees the reason and the file is
     gone from the bucket; **Log → Photos** shows every action without the image.
   * an admin who didn't create the lab (not a main admin) can't moderate its photos.
   * the author → **Delete my photo** → "You deleted this photo", the file is gone from the bucket.
   * from the browser console as a student, try to overwrite or delete someone else's file
     (`supabase.storage.from('measurement-photos').remove(['<their file>'])`) → nothing is deleted;
     upload a 2 MB file or a PNG → refused.
   * delete a throwaway account with photos, keeping its measurements → the preview lists the
     photos; afterwards its files are gone from the bucket and the measurements show "Photo deleted".
6. Merge → production deploy.
7. Later (after production has run the new code for a while): a small migration stops accepting
   the old value `true` for new measurements (a separate small PR; 018 went to the measurement limits).

## 20. Profile pictures and admin face photos — migration 017

Needs 016. Works with the frontend already on production (it adds a bucket, tables and functions;
`lab_begin`, `lab_credits` and the account-deletion functions keep their arguments; the admin-photo
requirement is behind a switch that starts **off**), so it can run before the merge.
**No Edge Function change** and nothing new for pg_net / Vault / `CRON_SECRET`: `delete` already
removes every file a user owns in any bucket, and the daily `sweep` empties the trash of every bucket.

1. SQL Editor → run `supabase/migrations/017_avatars.sql`. Safe to re-run. It creates the `avatars`
   bucket too — nothing to click for it.
2. Check (SQL Editor):

   ```sql
   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'avatars';
                                    -- avatars | false | 102400 | {image/jpeg}
   select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects';
                                    -- + avatars: upload / read / delete
   select * from private.settings;  -- require_admin_photo | false
   select private.avatars_cleanup(); -- {"expired": 0, "orphans_queued": 0, "resolved_reports": 0}
   select jobname, schedule from cron.job;   -- + 'mitzpe-avatars-cleanup' at 03:39 UTC
   ```

   Dashboard → **Storage**: the bucket `avatars` shows **Private**. If the SQL could not create it,
   create it by hand: name `avatars`, Public **off**, file size limit **100 KB**, allowed MIME type
   **image/jpeg** — then run the migration again.
3. Vercel **preview** of the branch. The database is shared with production — use throwaway
   accounts where you can (the checklist is in the PR description).
4. Merge → production deploy.
5. Turn the requirement on, when the admins are ready:
   1. The owner uploads a face photo (Profile → "Your photo") — it is confirmed automatically.
   2. Main admins upload theirs; the owner confirms them (Administration → Comments & photos, or
      on their profile page).
   3. Every admin uploads theirs; the person who appointed them confirms it (or the owner).
   4. Check who is still missing:

      ```sql
      select p.username, p.role, a.status
      from public.profiles p left join public.avatars a on a.user_id = p.id
      where p.role in ('admin', 'main_admin', 'owner')
      order by a.status nulls first, p.username;
      ```

   5. Turn it on (admins without a confirmed photo then get "photo needed" in every lab action):

      ```sql
      update private.settings set value = 'true' where key = 'require_admin_photo';
      ```

      Back off again: the same with `'false'`.

## 21. Measurement text and rate limits — migration 018

Needs 017. Works with the frontend already on production (valid measurements are accepted exactly
as before; only new violations are refused — the old wizard shows its generic "could not save" line
for them), so it can run before the merge. **No Edge Function change.** Existing rows are never
changed.

0. Optional, on a computer with PostgreSQL 16: `supabase/tests/run.sh` → `ALL TESTS PASSED`
   (a throwaway local database, see `supabase/tests/README.md`).
1. SQL Editor → run `supabase/migrations/018_measurement_limits.sql`. Safe to re-run.
2. Check (SQL Editor):

   ```sql
   select tgname from pg_trigger where tgrelid = 'public.measurements'::regclass and not tgisinternal;
     -- + measurements_check_update
   select private.text_safety_error('call 050-1234567', public.comment_domains());
     -- {"code": "phone_not_allowed"}
   select public.comment_body_error('see bit.ly/x', public.comment_domains()) ->> 'code';
     -- link_shortener (comments behave as before)
   ```

3. SQL Editor → run `supabase/checks/018_existing_violations.sql` (read-only). It lists old
   measurements that break the new rules (id, lab, date, which field, which rule) without showing
   the text. Nothing needs to be done about them; open a row in Table Editor if you want to look.
4. Vercel **preview** of the branch. The database is shared with production — use a throwaway
   student account and a lab you may test on; delete the test measurements afterwards (SQL Editor,
   `delete from public.measurements where id = '…'`):
   * a normal measurement with a place name and notes in Hebrew / English / Russian (numbers, dates,
     `pH 6.5-7.0`, `1013.25`) → saved; the place name and notes appear as typed (extra spaces removed).
   * place name `call 050-1234567` → the error shows under the place name at once, "Next" stays on
     step 1; notes `write me noa@gmail.com` → error under the notes; `https://evil.com` → "links are
     allowed only to: …"; `https://he.wikipedia.org/wiki/Ozone` → saved.
   * a place name longer than 120 characters can't be typed; a date two days ahead → error under the date.
   * 11 measurements within a minute (the "Add another" button) → the 11th says "You added many
     measurements in the last minute…", the form keeps the input; after a minute it saves.
   * the same text errors in the other two languages of the interface.
5. Merge → production deploy.

## 22. Row limits and paging — migration 019

Needs 018. The Data API returns at most 1000 rows per request ("Max rows" in Dashboard → Settings
→ Data API; leave it at 1000) and cuts the rest silently. The new frontend reads lists page by page
and gets its numbers and charts from two new read-only functions, so **019 must run before the
branch's preview is opened** (preview and production share the database). It works with the
frontend already on production (it only adds an index and three functions). **No Edge Function
change.**

0. Optional, on a computer with PostgreSQL 16: `supabase/tests/run.sh` → `ALL TESTS PASSED`
   (with `POSTGREST_BIN` set, also the API tests with the 1000-row limit — see
   `supabase/tests/README.md`).
1. SQL Editor → run `supabase/migrations/019_row_limits.sql`. Safe to re-run.
2. Check (SQL Editor):

   ```sql
   select public.measurement_summary() -> 'total';        -- = select count(*) from public.measurements
   select public.measurement_lab_stats('obs-schoolyard-heat', 1) ->> 'n';
   select proname, prosecdef from pg_proc
   where proname in ('measurement_summary', 'measurement_lab_stats', 'measurement_participant_counts');
     -- prosecdef = false for all three (SECURITY INVOKER)
   ```

3. Vercel **preview** of the branch (logged out, on a phone or at 360 px width, in he / en / ru):
   * home: the "measurements" counter equals `select count(*) from public.measurements`; each card's
     points / participants are right;
   * a lab → Map: points and the time slider; a point opens its panel;
   * Data: the stats count equals the lab's count in SQL; pages of 50 ("1 of N"); sort by date / a
     number column; search a place name; the date filters; export CSV / JSON / GeoJSON — the file has
     all rows (count the lines);
   * Charts: the daily line and the histogram appear;
   * a profile with measurements: the count is right.
   With today's data (~44 rows) no cap notice appears — they were tested locally with 24,000 rows.
4. Merge → production deploy.

## 23. Hide who made a measurement from logged-out visitors (audit H2) — migration 020

Needs 019. Logged-out visitors keep seeing points, values, the table, statistics, charts and
exports, but **no username and no user id** anywhere (not in responses, URLs or files), and no
profile pages. Admin credits on labs (full name, position, workplace) stay public. Logged-in users
see everything as before. **No Edge Function change.**

**Order matters, and it is the reverse of 019:** preview and production share one database, and the
production frontend from before this change asks logged-out visitors for `user_id` — after 020 its
point panel, data table, export and profile page fail for them ("permission denied"). The new
frontend works both before and after 020. So: **code first, 020 last.**

0. Optional, on a computer with PostgreSQL 16: `supabase/tests/run.sh` → `ALL TESTS PASSED`
   (with `POSTGREST_BIN` set, also the 020 API tests: every table and function logged out, and the
   app's own queries logged out and logged in — see `supabase/tests/README.md`).
1. **Preview of the branch, BEFORE 020** (on a phone or at 360 px width, in he / en / ru).
   *Logged out* (private window):
   * a lab → Map → a point: "Measured by: A participant" + "Sign in to see names"; no name;
   * Data: rows, pages, sort, search, date filters; **no "Filter by school"** and no school column;
     export CSV / JSON / GeoJSON downloads;
   * Charts appear; the home page shows the measurement and participant counts;
   * open `#/profile/<any user id>` → the "Profiles are for signed-in users" card with a Log in button;
   * browser DevTools → Network, filter `rest/v1/measurements`: no request mentions `user_id` or
     `created_at`, and nothing goes to `rest/v1/profiles`.
   *Logged in* (student, then admin): everything as before — the author's name in the point panel
   (links to the profile), "Filter by school", profiles, comments, photos, profile pictures.
2. Merge → **wait until the production deploy is finished** (Vercel → Deployments → Production →
   Ready) and hard-reload production once to be sure it serves the new code (logged out, a point
   panel shows "A participant").
3. SQL Editor → run `supabase/migrations/020_hide_identities.sql`. Safe to re-run.
4. Check queries (SQL Editor):

   ```sql
   -- anon's columns on measurements: exactly these 10 (no user_id, no created_at)
   select string_agg(column_name, ', ' order by ordinal_position) from information_schema.columns
   where table_schema = 'public' and table_name = 'measurements'
     and has_column_privilege('anon', 'public.measurements', column_name, 'select');
     -- id, observation_id, place_label, lat, lng, measured_at, verification, photo_seed, field_values, form_version
   select has_table_privilege('anon', 'public.measurements', 'select');                    -- false
   select has_column_privilege('anon', 'public.measurements', 'user_id', 'select');        -- false

   -- profiles: nothing for anon; one read policy, for authenticated
   select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'
     and has_column_privilege('anon', 'public.profiles', column_name, 'select');           -- 0
   select policyname, roles from pg_policies where schemaname = 'public' and tablename = 'profiles';
     -- logged-in users read profiles | {authenticated}

   -- participants: SECURITY DEFINER with an empty search_path; the other two stay INVOKER
   select proname, prosecdef, proconfig from pg_proc
   where proname in ('measurement_summary', 'measurement_lab_stats', 'measurement_participant_counts');
     -- measurement_participant_counts: true, {search_path=""}; the others: false

   -- the home numbers as a logged-out visitor
   begin;
   set local role anon;
   select public.measurement_summary() -> 'total';                 -- = the next line
   select count(*) from public.measurements;
   select * from public.measurement_participant_counts();         -- published labs only
   select user_id from public.measurements limit 1;               -- ERROR: permission denied
   rollback;

   -- Realtime must not publish these tables (the app doesn't use it; keep them out): expect 0 rows
   select * from pg_publication_tables
   where pubname = 'supabase_realtime' and tablename in ('measurements', 'profiles');
   ```

   If Dashboard → API Docs / GraphQL is used: GraphQL follows the same grants, nothing else to do.
5. **Production, after 020**, the same list as step 1: logged out (private window) and logged in
   (student, admin). Also: the home counts are unchanged from before 020, and a lab page's
   "Created by / Approved by" credits still show logged out.
6. **Rollback — only if needed** (e.g. step 5 fails logged out because production still serves old
   code): SQL Editor → `supabase/rollback/020_hide_identities_rollback.sql` restores the 019 state
   (anon reads `user_id` and profiles again; the new frontend keeps working). The privacy policy no
   longer matches then — fix the cause and run 020 again as soon as possible.

## 24. Account security on shared computers + honest password recovery (audit H6) — migration 021 + Edge Function `account`

What changes: password and email changes need a log-in of **this** session within the last 15
minutes (else the page asks for the current password or Google) — checked by the Edge Function
(`change-password`, `change-email`), and migration 021 makes Supabase Auth itself refuse a new
password / pending email that did not come through the function (a stolen session token calling
`PUT /auth/v1/user` directly gets nowhere). "This is a shared computer" at log-in (session only
until the browser closes, auto log-out after 30 min), "Log out on all devices", visible log-out.
"Forgot password" by email and adding / changing an email are hidden until N2 (Brevo).

**Order: Edge Function → preview → merge → production deploy → 021.** The new function only adds
actions (`change-password`, `change-email`); the old ones are unchanged, so production keeps working
with it. The new frontend changes passwords through the function, so the function must be deployed
first. 021 must come **after** the production deploy: the old frontend changes passwords directly
through Supabase Auth, which 021 ignores (the page would say "changed" and the password would stay
the same). The function works before 021 too (it skips the ticket while the RPC is missing).

0. Optional, on a computer with PostgreSQL 16: `supabase/tests/run.sh` → `ALL TESTS PASSED`
   (021 database tests + rollback, and `account/`: the Edge Function under Node).
1. **Dashboard values to check** (screenshots are enough, nothing secret):
   * Authentication → Sign In / Providers → **Email**: *Confirm email* **ON**; *Secure email change*
     **OFF** (accounts without email can't confirm the old address); *Secure password change*
     **OFF** (it sends a code by email, which our users can't receive); *Minimum password length* 8.
     If there is *Require current password when updating* — leave it **OFF for now**; it is an
     optional extra layer for direct API calls (our function uses the admin API, so it is not
     affected), but the production frontend from before this change would break with it. It can be
     turned on after step 4.
   * Authentication → Sign In / Providers: *Allow manual linking* **OFF** and *Allow anonymous
     sign-ins* **OFF**. (With manual linking a stolen token could link another Google account to
     the victim, and identity unlinking can change `auth.users.email`, which 021 does not guard.)
   * Authentication → Sessions: *time-box* / *inactivity timeout* are Pro-only — not needed, the
     shared-computer mode is done in our code.
   * JWT / access token expiry (Settings → JWT Keys, or Authentication → Sessions): the default
     3600 s means a token keeps working up to 1 hour after "log out on all devices" or a password
     change. Optional: 1800 s halves that (more token refreshes, no other effect).
   * Authentication → Hooks: nothing needed (no hook is used).
2. **Edge Function** → Dashboard → Edge Functions → `account` → Code → paste
   `supabase/functions/account/index.ts` → Deploy ("Verify JWT" stays OFF). Optional secret:
   `CHANGE_LIMIT_PER_USER` (password / email changes per account per hour, default 10).
   Quick check (production still on the old code): log in, log out, delete-account re-auth still
   work.
3. **Preview of the branch, BEFORE 021** (360 px, he / en / ru):
   * Log in page: "This is a shared computer" is ticked on a computer, not ticked on a phone; the
     choice is remembered next time on the same device.
   * Shared computer ticked: the thin "don't forget to log out" bar and a "Log out" button with its
     word in the header; open a new tab → not logged in; close the whole browser and open it again →
     not logged in (if the browser is set to restore the last session, it may bring it back — known
     limit). Leave the tab alone for 29 minutes (or test with a measurement half filled): the
     "Are you still here?" window says the measurement has not been sent; after 1 more minute →
     logged out, home page says why.
   * Not ticked: logged in in a new tab and after reopening the browser (as before).
   * Log out (header or Profile → Account): home page "You are logged out"; DevTools → Application →
     Local Storage and Session Storage have no `sb-…` key. Logged in with Google on a shared computer
     → the message also says to log out of Google.
   * Profile → Account → change password **more than 15 minutes after logging in** → "Log in again"
     box (password, or Google for Google accounts); a wrong password shows the error and counts
     toward the log-in limit (10 wrong tries in 15 min → "too many attempts"); the right one → the
     password is changed; log in with the new one works, the old one doesn't. Another browser logged
     in to the same account is logged out within the token expiry (up to 1 hour by default).
   * Right after logging in (< 15 min): change password works without the extra box.
   * "Log out on all devices" → this browser logged out; another browser follows (token expiry).
   * Sign-up: the "write your password down" box, no email field. "Forgot your password?" →
     explanation (Google / new account / old measurements stay), no form. Profile → Account →
     Email: shows the email if there is one + "possible soon", no form.
   * Delete account still works (with the re-login box after 15 minutes).
4. Merge → **wait for the production deploy** (Vercel → Deployments → Production → Ready).
5. SQL Editor → run `supabase/migrations/021_session_security.sql`. Safe to re-run. Checks:

   ```sql
   select tgname, tgenabled from pg_trigger where tgname = 'mitzpe_auth_users_change_guard';  -- 1 row, O
   select value from private.settings where key = 'require_change_ticket';                     -- true
   select has_function_privilege('anon', 'public.account_change_ticket(uuid,text,text)', 'execute'),
          has_function_privilege('authenticated', 'public.account_change_ticket(uuid,text,text)', 'execute');
     -- false, false
   select private.privacy_cleanup();   -- now also has "change_tickets"
   ```

6. **Direct API test on production** — Windows PowerShell. Use a test account, not a real student.
   The access token is a password-like credential: **never paste it into a chat, an issue, a
   screenshot or a screen share**, and close the PowerShell window when done.

   *Get the token.* In Chrome / Edge log in to the test account on production **with "This is a
   shared computer" unticked** (then the session is in Local Storage) and wait **more than 15
   minutes**. Press F12 → **Application** tab → left side **Storage → Local Storage →
   `https://citizen-science-liart.vercel.app`** → the key **`sb-<project-ref>-auth-token`** (the
   only key starting with `sb-` and ending with `-auth-token`). Its value is JSON; copy only the
   value of the field **`access_token`** (a long string starting with `eyJ`, **not**
   `refresh_token`). Copy it right before running the commands: the page renews it every hour
   (the renewed one still counts as the same old log-in). If the shared-computer box was ticked,
   the same key is under **Session Storage** instead.

   *The anon key* is the publishable key = Vercel → Settings → Environment Variables →
   `VITE_SUPABASE_ANON_KEY` (public, not a secret). The project URL is read from the token itself.

   In **PowerShell** (Windows 10/11 include `curl.exe`; the commands use `curl.exe`, not PowerShell's `curl` alias; JSON bodies go
   through a temporary file because PowerShell mangles quotes passed to programs):

   ```powershell
   $Key = '<publishable (anon) key>'
   # Paste the access_token when asked (Read-Host keeps it out of the PowerShell history file):
   $Token = Read-Host 'Paste access_token'

   # Project URL from the token's "iss" claim (https://<ref>.supabase.co/auth/v1):
   $p = $Token.Split('.')[1].Replace('-', '+').Replace('_', '/')
   switch ($p.Length % 4) { 2 { $p += '==' } 3 { $p += '=' } }
   $Url = (([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p))) | ConvertFrom-Json).iss -replace '/auth/v1$', ''
   $Url   # should print https://<project-ref>.supabase.co

   $Body = Join-Path $env:TEMP 'mitzpe-h6-body.json'
   function Send($method, $path, $json) {
     [IO.File]::WriteAllText($Body, $json)
     curl.exe -s -X $method "$Url$path" -H "apikey: $Key" -H "Authorization: Bearer $Token" `
       -H 'Content-Type: application/json' --data-binary "@$Body" -w "`nHTTP %{http_code}`n"
   }

   # a) through our Edge Function: refused
   Send POST '/functions/v1/account' '{"action":"change-password","password":"direct-test-123"}'
   #    → {"error":"reauth_required"}  HTTP 200

   # b) straight to Supabase Auth: answers OK (HTTP 200), but the password does NOT change (021)
   Send PUT '/auth/v1/user' '{"password":"direct-test-123"}'

   # c) a new email straight to Supabase Auth: refused (HTTP 4xx/5xx, e.g. "Database error updating user")
   Send PUT '/auth/v1/user' '{"email":"direct-test@example.com"}'

   Remove-Item $Body; Remove-Variable Token
   ```

   Expected: a) `reauth_required`; b) HTTP 200; c) an error. Then: log in to the test account
   with `direct-test-123` → fails; with the old password → works. Dashboard → Logs → Postgres
   shows `mitzpe: password change without a ticket ignored`. Then in the app, change the password
   normally (after the re-login box) → works. Close the PowerShell window.

   Note: with 021 on, a password change made **from the Supabase Dashboard** (Authentication →
   Users → a user → update / reset password) is **silently ignored** too — it goes through the
   same `auth.users` update without a ticket, the Dashboard says it worked, the old password stays.
   To make one on purpose, in SQL Editor:
   `update private.settings set value = 'false' where key = 'require_change_ticket';` → change the
   password in the Dashboard → **immediately** set it back:
   `update private.settings set value = 'true' where key = 'require_change_ticket';`
   (while it is `'false'`, the direct-API protection is off for everyone).
7. **Production, after 021:** step 3 again (change password old/new session, Google account, log
   out everywhere, delete account). Optional: now turn on *Require current password when updating*
   (step 1) as an extra layer.
8. **If password changes break after 021** (e.g. Supabase changed how it writes passwords):
   kill switch, no redeploy — `update private.settings set value = 'false' where key =
   'require_change_ticket';` (turn back on with `'true'`). Full rollback only if needed:
   `supabase/rollback/021_session_security_rollback.sql` (the frontend and function keep working).
   To set a password for someone by hand (not planned — admins don't reset passwords): turn the
   switch off, do it, turn it on again.

## 25. Final hardening, part A (audit Medium / Low) — migration 022 + Edge Function `account`

What changes:
* **Email links** (password reset, email confirmation) may return only to production or
  `http://localhost:5173` (`REDIRECT_ORIGINS` in the function); anything else → the Site URL.
* **Log-in lockout (M3):** wrong passwords are counted per username **and** network (10 per 15 min),
  plus 100 per username per hour from all networks — someone guessing from home can't lock a
  student out at school.
* **Username squatting (M9):** the database takes a username at sign-up only from accounts the
  Edge Function created (a mark in `app_metadata` that the public sign-up API can't set). Accounts
  started through Supabase's own API that never confirm an email, have no username and no data are
  deleted after 7 days (daily cleanup).
* **"Is this name free?"** goes through the Edge Function (`username-check`, 300 per 10 min per
  network); the browser can no longer call `username_available` directly.
* **Reports (M4):** only reporters whose account is older than 48 hours count towards hiding a
  comment / photo / student picture (still 3); one person can report the same author at most 5
  times a day. **Comments under review (M6):** the author can't delete or edit a comment that is
  hidden or has an open report. **Pictures (L1):** main admins moderate only people below them.
* **Upload limits (L2):** 30 photos / 10 profile pictures per 24 h now count uploads (deleting a
  file no longer frees a slot); the page says "limit reached" or "storage full" instead of a
  general error.
* **Photos:** the old value `true` (a photo "attached" without a file) is refused.
* Sessions not used for **30 days** are ended by the daily cleanup; admins see the admin profile
  (full name, workplace) only of current admins; RLS on `private.settings` / `storage_trash`;
  trigger functions not callable through the API; 11 foreign-key indexes; lab-revision lock order.

**Order: read-only checks → Edge Function → preview → merge → production deploy → 022 → tests on
production.** The new function works with the old frontend and before 022 (it skips the new RPC
while it is missing). 022 must come **after** the production deploy: it closes
`username_available` for browsers, and the old frontend uses it for the "name is free" hint (sign-up
itself would still work).

0. Optional, on a computer with PostgreSQL 16: `supabase/tests/run.sh` → `ALL TESTS PASSED`
   (022 database tests + rollback, `account/`: redirect list, log-in lockout, sign-up mark,
   username-check limit). With `POSTGREST_BIN` set, the 019/020 API tests run too.
1. **Read-only checks on production, before anything else** (SQL Editor → New query → paste → Run;
   they change nothing):
   * `supabase/checks/022_signup_cleanup_preview.sql` — three result tables (in the SQL Editor
     each one appears after the previous; scroll or run the parts one by one). Part 1: kinds of
     accounts; rows with `would_delete = true` are what the cleanup would remove. Part 2: those
     accounts one by one (date, provider, confirmed?, has username?, ever signed in?) — **no emails
     or names are shown**. Part 3: how many sign-in sessions are older than 30 days without use.
     **If any `would_delete` account looks like a real person (e.g. provider `google`, or
     `ever_signed_in = true`), stop and tell me** — don't run 022.
   * `supabase/checks/022_legacy_photo_true.sql` — expected: no rows.
   * `supabase/checks/022_unindexed_fks.sql` — expected now: 11 rows (after 022: none).
   * **Authentication → URL Configuration → Redirect URLs:** verify the list is exactly
     `https://<prod>/**` and `http://localhost:5173/**` (step 3). Nothing to change if so.
2. **Edge Function** → Dashboard → **Edge Functions** → `account` → **Code** → select all, paste the
   whole `supabase/functions/account/index.ts` → **Deploy** ("Verify JWT" stays OFF). No new secrets
   are needed (optional ones: step 8.4). Quick check on production (still the old frontend):
   sign up a new test account → you are logged in and the header shows its name; log out; log in;
   one wrong password → "wrong username or password".
3. **Preview of the branch, before 022** (360 px, he / en / ru):
   * Sign-up: type a free name → "Username is available"; a taken one → "taken" (the hint now comes
     from the Edge Function; wait ~½ s after typing). Sign up → logged in, name in the header.
   * Choose-a-name page can't be reached on a preview (Google returns to production) — tested in step 6.
   * Log in with a wrong password 3 times, then the right one → works.
   * Comments, photos, profile pictures: work as before (the new rules start with 022).
   * Upload a measurement photo and a profile picture → both work (the new limits start with 022).
4. Merge → **wait for the production deploy** (Vercel → Deployments → Production → Ready).
5. SQL Editor → paste and run `supabase/migrations/022_hardening.sql`. Safe to re-run. Checks:

   ```sql
   select has_function_privilege('anon', 'public.username_available(text)', 'execute');   -- false
   select value from private.settings where key = 'upload_limit_by_hits';                 -- true
   select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and cmd = 'INSERT' and with_check like '%_upload_take(name)%';                        -- 2
   select private.privacy_cleanup();
     -- has "sessions" and "unconfirmed_signups" with NUMBERS; if either says "error", tell me
     -- (Dashboard → Logs → Postgres shows the reason) — the rest of the cleanup still ran.
   ```
   Then `supabase/checks/022_unindexed_fks.sql` → no rows.
6. **Tests on production after 022** (use test accounts, not real students):
   * **Uploads (L2) — right away, because the new check runs inside Storage's own upload:**
     1. Profile → upload a profile picture → works. Remove it, upload another → works.
     2. Add a measurement with a photo (a lab with a photo field) → sent, photo visible to you.
     3. Hit the picture limit: upload profile pictures until the 11th in 24 h (10 is the limit,
        the ones from 1. count) → "You reached the limit: 10 pictures in 24 hours".
     4. Hit the photo limit without 30 uploads: in SQL Editor, with the test account's name,
        (the first line empties this account's photo counter, the second fills in 29):
        ```sql
        delete from private.rate_limit_hits where bucket = 'photo_upload:user:' ||
          (select id from public.profiles where username = '<test name>')::text;
        insert into private.rate_limit_hits (bucket)
        select 'photo_upload:user:' || (select id from public.profiles where username = '<test name>')
        from generate_series(1, 29);
        ```
        → one more measurement with a photo works (30th), the next one says "30 photos in 24
        hours". Clean up: run the `delete …` line again.
     5. **If uploads fail for everyone** ("can't upload right now") — kill switch, no redeploy:
        `update private.settings set value = 'false' where key = 'upload_limit_by_hits';`
        → uploads use the old rule again; tell me. Back on: the same with `'true'`.
   * Sign-up name hint (free / taken) works; sign up a new account → name shown.
   * Google sign-in with a new Google test account → "choose a name" page, the hint works, the name
     is saved. An existing Google account signs in as before.
   * Log in with a wrong password 3 times from your phone on mobile data, then the right one from
     the computer → works.
   * Comment M6: account B reports account A's comment; A tries to delete / edit it → "Someone
     reported this comment…"; after a moderator presses "keep" → A can delete it.
   * Reports M4: 3 reports from accounts created today → the comment stays visible (the reports are
     in the moderation queue). Hiding needs 3 accounts older than 2 days.
   * Main admin: can't hide / delete the owner's or another main admin's photo (error); can a
     student's picture. Owner: can any.
   * Forgot password (explanation only, as before) — no change.
7. **If something breaks:**
   * Uploads → the kill switch in 6.5.
   * Anything else → `supabase/rollback/022_hardening_rollback.sql` (puts back the 006–021 versions;
     keeps indexes and RLS). The new frontend and Edge Function keep working after a rollback.

**Emergency stop for the cleanup of unconfirmed sign-ups** (if the preview in step 1 was wrong):
the cleanup runs daily at 03:17 UTC. To stop it at once, re-run the 021 version of the cleanup from
`supabase/rollback/022_hardening_rollback.sql` (only the `private.privacy_cleanup` part), and tell me.
