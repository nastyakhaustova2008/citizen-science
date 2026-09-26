# Next goals — Mitzpe (Field)

Status: steps 1–5 of the original roadmap are done (Supabase, campaigns, form engine, accounts and roles, lab editor with peer review). This file lists the next goals.

Each goal is one task = one branch = one PR. Before each one: plan first, code after approval. Any goal that changes what is collected, who receives it or how long it's kept must also update `public/privacy.html` in all languages (rule from CLAUDE.md).

## Suggested order

Done: goal 1 (coordinate rounding) and goal 2 (delete my account).

3. Privacy policy details + Brevo emails
4. Date and time of a measurement
5. Six languages
6. Save comments to the database
7. Automatic translation of comments and user data

Goal 3 should be done before real schools use the platform (goals 1 and 2, also needed before that, are done). Goal 5 comes before goal 7, because translation depends on the final list of languages. Goal 6 comes before goal 7, because there must be stored comments to translate.

## 1. Coordinate rounding (~100 m) — done

**Built (migrations 013, 013b):** coordinates are rounded to 3 decimal places (~100 m) for every lab. Exact coordinates are not stored for anyone — not the author, not admins.

* Rounded twice: in the browser as soon as a point is picked on the map or from "my location" (the exact point never enters the wizard state), and by a database trigger on every insert and coordinate change (013), so the client can't bypass it.
* Snapped to a grid, no random offset (random offsets can be averaged out over repeated measurements from the same place).
* Existing rows were rounded by 013b (destructive; run after a CSV export and the production deploy).
* Photos: EXIF/GPS and other metadata are stripped in the browser by redrawing the image. A photo that can't be cleaned (e.g. HEIC in Chrome) is not attached.
* The wizard shows a rounding note and the "don't measure at your home" tip next to the map.
* The privacy policy describes this.

## 2. Delete my account — done

**Built (migration 014, `account` Edge Function):** a "Delete account" button in the profile (Account).

Decisions:

* Measurements: kept by default as "unknown participant" with a new random id (one per deleted account), so they can't be linked back; or deleted, if the user chooses.
* Admins they appointed move up one level (under whoever appointed the deleted admin); their own chains stay under them.
* Labs and drafts stay, credited to "former staff member"; the user's open revisions are discarded; approvals and review comments stay without a name.
* Names are removed from the role log; the lab log never had names.
* The owner cannot delete their own account.
* Confirmation: type your username, and sign in again (password or Google) if this session's sign-in is older than 15 minutes.
* Runs in the Edge Function (needs the secret key). Deletion by email request is still possible, done manually (steps in CLAUDE.md).
* The privacy policy describes the button and what is deleted.

Future: once photo Storage exists, photos are **always** deleted on account deletion, even when the measurements are kept.

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
