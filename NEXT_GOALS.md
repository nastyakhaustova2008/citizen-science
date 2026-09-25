# Next goals — Mitzpe (Field)

Status: steps 1–5 of the original roadmap are done (Supabase, campaigns, form engine, accounts and roles, lab editor with peer review). This file lists the next goals.

Each goal is one task = one branch = one PR. Before each one: plan first, code after approval. Any goal that changes what is collected, who receives it or how long it's kept must also update `public/privacy.html` in all languages (rule from CLAUDE.md).

## Suggested order

1. Coordinate rounding (~100 m) — safety, before schools start using the site
2. Delete my account
3. Privacy policy details + Brevo emails
4. Date and time of a measurement
5. Six languages
6. Save comments to the database
7. Automatic translation of comments and user data

Goals 1–3 should be done before real schools use the platform. Goal 5 comes before goal 7, because translation depends on the final list of languages. Goal 6 comes before goal 7, because there must be stored comments to translate.

## 1. Coordinate rounding (~100 m)

**Goal:** the public sees each point snapped to a grid of about 100 × 100 m. The database still stores the exact coordinates — nothing is lost for the science. The author still sees their own exact point. The public (map, table, export) sees only the rounded version.

Notes:

* Must be enforced in the database, not only in the UI: today anyone can read exact coordinates directly through the public API.
* Snap to a grid (e.g. 3 decimal places), don't add random offsets — random offsets can be averaged out over repeated measurements from the same place.
* The author seeing their own exact point needs a separate database function (column-level hiding works per column, not per person).
* Adding a measurement currently reads the saved row back with exact coordinates — adjust that.
* Decide: do admins see exact coordinates?
* Update the privacy policy and the "don't measure at home" tip.

## 2. Delete my account

**Goal:** a "Delete my account" button in the profile.

Decisions already made:

* Measurements stay on the map as "unknown participant" by default.
* Offer an option to delete the measurements too.
* Names in the role log and lab credits become "former staff member".

To decide:

* Confirmation step (type the username? re-enter the password?).
* Admins: what happens to admins they granted (`role_granted_by` chain)?
* Labs the user created: keep them, credited to "former staff member".
* The owner cannot delete their own account from the app.
* Needs the secret key, so it runs in the Edge Function.
* Update the privacy policy ("deletion on request" → "delete button + on request").

## 3. Privacy policy details + Brevo

**Goal:** a complete policy and working emails.

* Fill in `[RESPONSIBLE BODY]` and `[PRIVACY EMAIL]` in all languages.
* Review how the policy describes emails and names (Google name and email, admin full names and workplaces, usernames).
* Set up Brevo SMTP in Supabase with the mechina's email as sender (not a personal email). Steps are in `supabase/SETUP_AUTH.md`.
* Replace the email templates (reset password, change email, confirm signup) with the `token_hash` links from `SETUP_AUTH.md`.
* Test: password reset and email confirmation actually arrive (check spam).
* Update the policy: Brevo moves from "planned" to a current service.

## 4. Date and time of a measurement

**Goal:** when adding a measurement, the student can set the day and time it was taken (not only "now").

Notes:

* First check whether the wizard already has a date/time input (the step-3 plan mentioned one).
* Default: now. Not in the future. Propose a limit for the past (e.g. up to 30 days back).
* Validate in the database too.
* Charts, filters and the time slider use this time, not the time of saving.
* Keep `created_at` (when it was saved) separately.

## 5. Six languages

**Goal:** Hebrew, English, Russian, Ukrainian, French, Spanish.

Notes:

* UI strings: add uk, fr, es to `src/i18n/strings.js`. Hebrew stays the default and the fallback.
* Database: labs and fields have separate columns per language (`title_he/en/ru` …). Adding 3 languages means many new columns — consider moving to a different structure; decide first.
* Lab editor: which languages are required for publishing? Requiring all 6 is heavy for teachers. Proposal: he + en required, others optional with fallback (or filled by goal 7).
* Username rules: currently Hebrew/Latin/Cyrillic letters. Ukrainian letters (і, ї, є, ґ) and French/Spanish accents (é, ñ, ü …) must be allowed. Keep the rule against mixing look-alike scripts.
* Privacy policy in 6 languages.
* Check layout: all new languages are left-to-right.

## 6. Save comments to the database

**Goal:** comments on measurement points (and the forum, if in scope) are stored and survive a reload.

Notes:

* Only logged-in users can comment (already so in the UI).
* Users are minors: decide on moderation — who can hide or delete comments (admins? the author of the comment?), and a "report" button.
* Decide: can a user edit or delete their own comment?
* Include "flags" (problem reports on measurements) — they are also in-memory only today.
* Deleted accounts: comments stay as "unknown participant" or are deleted — decide.
* Update the privacy policy (comments are now stored).

## 7. Automatic translation

**Goal:** everything on the page appears in the page's language, whatever language it was written in: comments, and user-written data (notes, text fields, place names). Always keep a "show original" option.

Notes:

* Needs a translation service (e.g. an AI model or a translation API), called from the server (Edge Function) so the key stays secret. Consider cost and limits.
* Store the original and cache translations, so each text is translated once per language.
* Show "translated from X · show original".
* Texts are sent to a third party: update the privacy policy.
* Numbers, units and choice options are already translated by the field definitions — only free text needs machine translation.
* Possible extra: help admins fill lab texts in all 6 languages with a translation draft (the admin checks and edits it before submitting).
