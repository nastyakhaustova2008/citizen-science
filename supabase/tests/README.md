# Database tests (local only)

These tests run the SQL migrations on a **throwaway local PostgreSQL**. They never touch the
Supabase project. Use them before running a new migration in the SQL Editor.

## What you need

- PostgreSQL **16** server binaries (`initdb`, `pg_ctl`, `psql`):
  - Ubuntu: `sudo apt install postgresql-16`
  - macOS: `brew install postgresql@16`
  - If they are not in the default place, set `PG_BIN=/path/to/bin`.
- Node 18+ and `npm install` in the repo, which provides `esbuild` for the JS mirror test.

## Run

```sh
supabase/tests/run.sh
```

The script:

1. creates a temporary database cluster in `/tmp/mitzpe-db.*` on port 55432 (change it with
   `PGTEST_PORT`), and always deletes it at the end;
2. loads `supabase_stubs.sql`: minimal stand-ins for what Supabase provides (API roles, `auth.uid()`,
   `storage.objects`, `cron.schedule`, `vault`). pg_cron isn't installed locally, so its
   `create extension` line is skipped;
3. applies all migrations and seeds in the order from CLAUDE.md (the list is in `run.sh`):
   001 → seed 001 → 002 → seed 002 → 003 → 004 → seed 003 → 005 → 006 → 007 → 008 → 009 →
   010 → seed 004 → 011 → 012 → 013 → 013b → 014 → 015 → 016 → 017. Then, for 018:
   `018/before.sql` → 018 → 018 again (it must be safe to re-run) → `018/tests.sql` → the mirror check;
   then 019 twice → `019/bulk.sql` (3000+ measurements, above the API's 1000-row limit) →
   `019/tests.sql` → `019/mirror.*`; then 020 twice → 021 twice → 022 twice → 023 twice → `020/tests.sql` (its
   allow-lists must still hold with 021 and 022) → `021/tests.sql` → `022/tests.sql` → `023/tests.sql`; then (needs
   PostgREST, see below) `019/api.js` → `020/api.js`; then `021/rollback.sql` → 022 again →
   `022/rollback.sql` → `account/test.js` (the Edge Function, no database) → `client/jpegCheck.test.js`; last `020/rollback.sql`;
4. runs the tests of each migration that has a folder here. The last line says
   `ALL TESTS PASSED`; if any test failed, the exit code is 1.

It takes a few seconds. If you run it as root, the database server runs as the `postgres` user.

## What is tested

| Folder | Migration | Tests |
|---|---|---|
| `018/` | `018_measurement_limits.sql` | see below |
| `019/` | `019_row_limits.sql` | see below |
| `020/` | `020_hide_identities.sql` | see below |
| `021/` | `021_session_security.sql` | guard on `auth.users`, tickets, kill switch, rollback |
| `022/` | `022_hardening.sql` | every part of 022 (see the header of `022/tests.sql`) + rollback |
| `023/` | `023_home_participants.sql` | participants total (anon / student / admin, drafts), a retry with the same measurement id (L3), rollback |
| `client/` | `src/lib/jpegCheck.js` | which JPEG files the moderator's browser flags (EXIF, XMP, IPTC, comments, trailing data), stripping our own output |
| `account/` | Edge Function `account` | re-auth, change password / email, log-in limit per username + IP, redirect allow-list, sign-up mark + safety net, username-check limit |

**`018/`** runs its files in this order:

- **`before.sql`** runs before 018. It adds test users and a measurement that breaks the new rules,
  saved under the 017 rules. It also records comment check results so they can be compared after 018.
- **`tests.sql`** runs after 018 is applied twice. It checks:
  - valid inserts;
  - text cleaning;
  - every rejection code;
  - the rate limits (minute, hour, day, admins 3×);
  - update rules;
  - account deletion that keeps an old rule-breaking row;
  - the existing-violations query;
  - comments unchanged;
  - no API access to `private`.

  It prints one `PASS` / `FAIL` line per check.
- **`mirror.sql` + `mirror.js`** run every string in `strings.json` through the database checks and
  through `src/lib/fields.js`, and require identical results. They also print each string's
  verdict, so false positives are easy to spot.

**`019/`** (row limits, audit H5):

- **`bulk.sql`** adds 30 test users and 3000 measurements over 4 labs, some without a primary
  value, plus rows with tricky place names for the search tests. Psql variable `big` (env
  `BIG_LAB_ROWS` in `run.sh`, default 0) adds that many rows to one more lab — 21000 hits the
  export cap in UI tests.
- **`tests.sql`**: `measurement_summary` and `measurement_lab_stats` called as anon equal the same
  numbers computed directly in SQL; no user ids / names in the output; drafts invisible to anon;
  `p_step` / `p_campaign` validation (`bad_step`, `bad_campaign`) and widening (≤ 200 bins);
  all three functions are SECURITY INVOKER; an **H2 simulation** (anon loses `measurements.user_id`
  → the summary fails loudly; switching only `measurement_participant_counts()` to SECURITY DEFINER
  gives the same numbers; rolled back); the new index.
- **`mirror.sql` + `mirror.js`**: the stats as the client reads them (`labStatsFromRpc`) equal the
  same numbers computed in JS from the raw rows.
- **`api.js`** — only when a PostgREST binary is available (`POSTGREST_BIN=/path/to/postgrest`
  or `postgrest` on PATH; download from github.com/PostgREST/postgrest/releases, the
  `linux-static-x64` build needs nothing else). `run.sh` starts it with `db-max-rows = 1000` like
  Supabase. It reproduces the bug (one select is cut at 1000 rows), checks `fetchAllPaged` /
  `fetchPage` (`src/lib/paging.js`), and runs the table search (`searchFilter`) with needles like
  `a,b`, `a)b`, `"x"`, `50%`, `a_b`, `\`, `.or(id.neq.0)`, Hebrew and Russian text: each must
  return exactly the rows a plain JS "contains" finds. Without PostgREST it prints `SKIPPED`.

**`020/`** (hide who made a measurement from logged-out visitors, audit H2):

- **`tests.sql`** (after 020 is applied twice, on the 019 data):
  - **allow-lists**: every column anon may read (schemas public, auth, storage) and every function anon
    may execute must be on a list in the file — a new one fails the test until it is reviewed; no
    anon column looks like a person (`user_id`, `username`, `created_by`, …);
  - anon: `user_id` / `created_at` can't be selected, filtered, sorted or embedded (42501), `select *`
    is refused, `profiles` is refused; the public columns and `count(*)` work;
  - logged in (student, admin): `user_id`, the profile filter, profiles and insert … returning work;
  - home numbers: `measurement_participant_counts` is SECURITY DEFINER with an empty search_path and
    equals the direct count; a draft lab counts only for admins; the summary as anon is right;
  - credits: `lab_credits` / `lab_credits_all` show the admins' full names logged out, with no ids,
    usernames or photos;
  - account deletion (keep anonymised, delete) still works; anon can't read the new random id.
- **`api.js`** (PostgREST with `db-max-rows = 1000` and a test JWT secret; the app's
  `src/lib/supabase.js` points at a small proxy that maps `/rest/v1` to PostgREST and stubs
  `/auth/v1`):
  - logged out: every table and every RPC in the anon OpenAPI is called (all rows of each table,
    every granted column); no answer may contain any user id, username or anonymised id from the
    database (`ids20.json`, dumped by `run.sh`) or a key like `user_id`;
  - probes that must be refused: `select=user_id|created_at`, filters, `or=()`, `order=`, embedding,
    `profiles`, a HEAD count filtered by `user_id`;
  - the app's own queries (`src/lib/measurementsApi.js`): home numbers, map, statistics, the table
    with every sort / filters / search, export (CSV and GeoJSON built from it), point panel — none
    refused, none returns an identifier, none asks for `user_id` / `created_at`;
  - logged in as a student, then an admin (signed JWT + `setSession`): the same queries with authors,
    profiles, the profile page query, the author filter.
- **`rollback.sql`** (last): `supabase/rollback/020_hide_identities_rollback.sql` restores the 019
  state, and 020 applied again hides identities again.

### 021 (audit H6) — `021/`

- **`tests.sql`** — the guard on `auth.users`, run as `supabase_auth_admin` (the role Supabase Auth
  uses; a stub role here):
  - not blocked: sign-up (insert with a password), Google new user (insert, no password) and
    returning user (metadata), username sign-in (incl. re-writing the same password — the value is
    kept, no error), a full-row update, the `email` column itself, removing a password, confirming a
    pending email, account deletion (prepare → delete as Supabase Auth → finish; a pending ticket
    cascades), the Edge Function's admin update with a ticket;
  - blocked: a new password without a ticket (kept, no error), a first password for a Google user
    without a ticket, a used / expired / other user's ticket, a pending email without a ticket or
    with a ticket for another address (42501);
  - tickets: exact columns (no password or hash of it; email → sha256 of the normalised address),
    deleted on use, expired ones removed by `privacy_cleanup`; `account_change_ticket` only for
    `service_role` (anon / authenticated / PUBLIC can't execute it), `private` not reachable;
  - kill switch off → changes go through; back on → guarded.
- **`rollback.sql`** — `supabase/rollback/021_session_security_rollback.sql` removes the guard (a
  direct password change goes through, `privacy_cleanup` is the 008 version), 021 again guards.

### Edge Function `account` — `account/`

`test.js` runs the real `supabase/functions/account/index.ts` under Node: `deno-env.js` provides
`Deno.env` / `Deno.serve`, `supabase-stub.js` replaces `npm:@supabase/supabase-js@2` (esbuild alias)
and records calls, `fetch` is a fake Supabase Auth. Checks: `change-password` / `change-email` —
no token, session older than 15 min → `reauth_required` and nothing changed; after re-login, Google
(2 / 30 min), recovery link → ok; order ticket → admin update → sign out other sessions; the ticket
carries no password; before 021 (no ticket RPC) still works; 10 changes per hour; email: invalid /
placeholder domain / taken, the user's own token + publishable key for `PUT /auth/v1/user`;
`login` wrong password counted (10, then `too_many_attempts`); `delete` and `recover` unchanged.

## Adding tests for a new migration

1. Add the migration to the list in `run.sh`.
2. Create a folder `NNN/` with the SQL files and call them from `run.sh`.
3. Print `PASS` / `FAIL` lines in the same format as `018/tests.sql`.

`t_ins` inserts as a logged-in user (role `authenticated` + JWT `sub`, like the API).
`t_sql` runs SQL as the SQL Editor would.

**PostgREST for the API tests:** download the static Linux binary of PostgREST 12 from its GitHub
releases (`postgrest-v12.2.3-linux-static-x64.tar.xz`), unpack it and run
`POSTGREST_BIN=/path/to/postgrest supabase/tests/run.sh`. `020/browser-env.js` gives the app's
code in-memory `localStorage` / `sessionStorage` (since 021 the session lives there); test helper
tables and functions (`t21_*`, `t22_*`) are closed to anon so the anon OpenAPI stays exact.
