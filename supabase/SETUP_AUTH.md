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
* **Redirect URLs** (Add URL, one per line):
  * `https://<prod>/**`
  * `https://*-<team>.vercel.app/**` — all Vercel preview deployments
  * `http://localhost:5173/**` — local dev

Email links and Google return here. A URL not on this list silently falls back to the Site URL.

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
   `SIGNUP_LIMIT_GLOBAL` (150/hour), `LOGIN_FAIL_LIMIT_PER_USER` (10 per 15 min),
   `RECOVER_LIMIT_PER_IP` (20/hour), `RECOVER_LIMIT_PER_USER` (3/hour), `CLIENT_IP_HEADER` (auto).
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
