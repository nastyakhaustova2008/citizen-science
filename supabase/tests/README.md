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
3. applies all migrations and seeds in the order from CLAUDE.md;
4. runs the tests of each migration that has a folder here. The last line says
   `ALL TESTS PASSED`; if any test failed, the exit code is 1.

It takes a few seconds. If you run it as root, the database server runs as the `postgres` user.

## What is tested

| Folder | Migration | Tests |
|---|---|---|
| `018/` | `018_measurement_limits.sql` | see below |

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

## Adding tests for a new migration

1. Add the migration to the list in `run.sh`.
2. Create a folder `NNN/` with the SQL files and call them from `run.sh`.
3. Print `PASS` / `FAIL` lines in the same format as `018/tests.sql`.

`t_ins` inserts as a logged-in user (role `authenticated` + JWT `sub`, like the API).
`t_sql` runs SQL as the SQL Editor would.
