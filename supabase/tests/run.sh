#!/usr/bin/env bash
# Local database tests: a throwaway PostgreSQL cluster with Supabase stand-ins, all migrations in
# the documented order, then the tests of each migration that has a folder here (018/ … 023/) and of
# the Edge Function `account` (account/).
# See README.md. Usage: supabase/tests/run.sh   (from anywhere; exit code 1 = a test failed)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb)")}"
PORT="${PGTEST_PORT:-55432}"
# Short path: the socket path must stay under ~100 characters.
WORK="$(mktemp -d /tmp/mitzpe-db.XXXXXX)"
chmod 755 "$WORK"

# initdb refuses to run as root: then run the server as the postgres user.
AS=()
if [ "$(id -u)" = 0 ]; then
  chown postgres "$WORK"
  AS=(runuser -u postgres --)
fi

cleanup() { "${AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"${AS[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U postgres -A trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
"${AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" start >/dev/null

export PGOPTIONS='-c client_min_messages=warning'
PSQL=("$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1)
STRINGS="$(cat "$HERE/018/strings.json")"

# pg_cron isn't installed locally: the stubs provide cron.schedule instead.
apply() { sed 's/^create extension if not exists pg_cron.*$/-- (pg_cron: stubbed)/' "$REPO/supabase/$1" | "${PSQL[@]}" -f - >/dev/null; }

"${PSQL[@]}" -f "$HERE/supabase_stubs.sql" >/dev/null
for f in migrations/001_measurements.sql seed/001_measurements_seed.sql \
         migrations/002_campaigns.sql seed/002_campaigns_seed.sql \
         migrations/003_measurements_campaign_fk.sql migrations/004_form_engine.sql \
         seed/003_water_quality_example.sql migrations/005_drop_legacy_measurement_columns.sql \
         migrations/006_profiles_auth.sql migrations/007_measurements_auth_only.sql \
         migrations/008_privacy_cleanup.sql migrations/009_admin_roles.sql \
         migrations/010_lab_editor.sql seed/004_equipment_translations.sql \
         migrations/011_lab_review.sql migrations/012_lab_revisions.sql \
         migrations/013_round_coordinates.sql migrations/013b_round_existing_coordinates.sql \
         migrations/014_delete_account.sql migrations/015_comments.sql \
         migrations/016_measurement_photos.sql migrations/017_avatars.sql; do
  apply "$f" || { echo "FAILED to apply $f"; exit 1; }
done
echo "migrations 001–017: applied"

# ---- 018 ----------------------------------------------------------------------------------
"${PSQL[@]}" -v strings="$STRINGS" -f "$HERE/018/before.sql" >/dev/null
apply migrations/018_measurement_limits.sql
apply migrations/018_measurement_limits.sql   # safe to re-run
echo "migration 018: applied twice"

RESULT="$("${PSQL[@]}" -At -f "$HERE/018/tests.sql" | grep -E '^(PASS|FAIL)')"
echo "$RESULT"
FAILED=$(grep -c '^FAIL' <<<"$RESULT" || true)
echo "018 database: $(grep -c '^PASS' <<<"$RESULT") passed, $FAILED failed"

"${PSQL[@]}" -At -v strings="$STRINGS" -f "$HERE/018/mirror.sql" > "$WORK/mirror-sql.json"
"$REPO/node_modules/.bin/esbuild" "$HERE/018/mirror.js" --bundle --platform=node --format=esm \
  --log-level=warning --outfile="$WORK/mirror.mjs"
MIRROR_OK=1
node "$WORK/mirror.mjs" "$WORK/mirror-sql.json" || MIRROR_OK=0

# ---- 019 ----------------------------------------------------------------------------------
apply migrations/019_row_limits.sql
apply migrations/019_row_limits.sql   # safe to re-run
echo "migration 019: applied twice"
"${PSQL[@]}" -v big="${BIG_LAB_ROWS:-0}" -f "$HERE/019/bulk.sql" >/dev/null
echo "019 test data: $("${PSQL[@]}" -At -c 'select count(*) from public.measurements') measurements"

RESULT19="$("${PSQL[@]}" -At -f "$HERE/019/tests.sql" | grep -E '^(PASS|FAIL)')"
echo "$RESULT19"
FAILED19=$(grep -c '^FAIL' <<<"$RESULT19" || true)
echo "019 database: $(grep -c '^PASS' <<<"$RESULT19") passed, $FAILED19 failed"

ESB=("$REPO/node_modules/.bin/esbuild" --bundle --platform=node --format=esm --log-level=warning '--define:import.meta.env={}')
"${PSQL[@]}" -At -f "$HERE/019/mirror.sql" > "$WORK/mirror19.json"
"${ESB[@]}" "$HERE/019/mirror.js" --outfile="$WORK/mirror19.mjs"
node "$WORK/mirror19.mjs" "$WORK/mirror19.json" || MIRROR_OK=0

# ---- 020 ----------------------------------------------------------------------------------
apply migrations/020_hide_identities.sql
apply migrations/020_hide_identities.sql   # safe to re-run
echo "migration 020: applied twice"
# 021 before the 020 tests: 020's allow-lists (what anon may read / execute) must still hold.
apply migrations/021_session_security.sql
apply migrations/021_session_security.sql   # safe to re-run
echo "migration 021: applied twice"
apply migrations/022_hardening.sql
apply migrations/022_hardening.sql   # safe to re-run
echo "migration 022: applied twice"
apply migrations/023_home_participants.sql
apply migrations/023_home_participants.sql   # safe to re-run
echo "migration 023: applied twice"
RESULT20="$("${PSQL[@]}" -At -f "$HERE/020/tests.sql" | grep -E '^(PASS|FAIL)')"
echo "$RESULT20"
FAILED20=$(grep -c '^FAIL' <<<"$RESULT20" || true)
echo "020 database: $(grep -c '^PASS' <<<"$RESULT20") passed, $FAILED20 failed"
OUT21="$("${PSQL[@]}" -At -f "$HERE/021/tests.sql" 2>/dev/null)"
RESULT21="$(grep -E '^(PASS|FAIL)' <<<"$OUT21")"
echo "$RESULT21"
FAILED21=$(grep -c '^FAIL' <<<"$RESULT21" || true)
# On a failure: the errors of the statements the checks ran (expected ones included).
[ "$FAILED21" = 0 ] || grep '^LOG' <<<"$OUT21" || true
echo "021 database: $(grep -c '^PASS' <<<"$RESULT21") passed, $FAILED21 failed"
RESULT22="$("${PSQL[@]}" -At -f "$HERE/022/tests.sql" 2>/dev/null | grep -E '^(PASS|FAIL)')"
echo "$RESULT22"
FAILED22=$(grep -c '^FAIL' <<<"$RESULT22" || true)
echo "022 database: $(grep -c '^PASS' <<<"$RESULT22") passed, $FAILED22 failed"
RESULT23="$("${PSQL[@]}" -At -f "$HERE/023/tests.sql" 2>/dev/null | grep -E '^(PASS|FAIL)')"
echo "$RESULT23"
FAILED23=$(grep -c '^FAIL' <<<"$RESULT23" || true)
echo "023 database: $(grep -c '^PASS' <<<"$RESULT23") passed, $FAILED23 failed"
# Every user id, username and anonymised id: no anon API response may contain one (020/api.js).
"${PSQL[@]}" -At -c "select json_build_object(
  'ids', (select json_agg(x) from (select id::text x from auth.users union select id::text from public.profiles
          union select distinct user_id from public.measurements) s),
  'usernames', (select json_agg(username) from public.profiles where username is not null),
  'cols', (select json_object_agg(t, cols) from (
     select c.relname t, json_agg(a.attname order by a.attnum) cols from pg_class c
     join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')
       and has_column_privilege('anon', c.oid, a.attnum, 'select') group by 1) g))" > "$WORK/ids20.json"

# API tests need PostgREST (db-max-rows = 1000, like Supabase). Set POSTGREST_BIN or put
# postgrest on PATH; without it they are skipped (the database tests above still run).
API_OK=1
PGRST="${POSTGREST_BIN:-$(command -v postgrest || true)}"
if [ -n "$PGRST" ] && [ -x "$PGRST" ]; then
  API_PORT="${PGRST_PORT:-55499}"
  # A test-only JWT secret: 020/api.js signs logged-in tokens (and the anon key) with it.
  JWT_SECRET="mitzpe-local-test-secret-not-a-real-key-0123456789"
  cat > "$WORK/pgrst.conf" <<CONF
db-uri = "postgres:///postgres?host=$WORK&port=$PORT&user=authenticator"
db-schemas = "public"
db-anon-role = "anon"
db-max-rows = 1000
server-port = $API_PORT
jwt-secret = "$JWT_SECRET"
CONF
  "$PGRST" "$WORK/pgrst.conf" > "$WORK/pgrst.log" 2>&1 &
  PGRST_PID=$!
  trap 'kill $PGRST_PID 2>/dev/null || true; cleanup' EXIT
  for _ in $(seq 50); do curl -s -o /dev/null "http://localhost:$API_PORT/" && break; sleep 0.2; done
  "${ESB[@]}" "$HERE/019/api.js" --outfile="$WORK/api19.mjs"
  node "$WORK/api19.mjs" "http://localhost:$API_PORT" || API_OK=0
  # 020: the app's own query code (supabase-js) through a proxy at /rest/v1, logged out and in.
  PROXY_PORT="${PROXY_PORT:-55498}"
  ANON_KEY="$(node -e '
    const c = require("crypto"); const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const h = b({ alg: "HS256", typ: "JWT" }), p = b({ role: "anon", exp: 4102444800 });
    console.log(h + "." + p + "." + c.createHmac("sha256", process.argv[1]).update(h + "." + p).digest("base64url"));' "$JWT_SECRET")"
  "${ESB[@]}" "--define:import.meta.env.VITE_SUPABASE_URL=\"http://localhost:$PROXY_PORT\"" \
    "--define:import.meta.env.VITE_SUPABASE_ANON_KEY=\"$ANON_KEY\"" \
    "$HERE/020/api.js" --outfile="$WORK/api20.mjs"
  node "$WORK/api20.mjs" "http://localhost:$API_PORT" "$PROXY_PORT" "$JWT_SECRET" "$WORK/ids20.json" || API_OK=0
else
  echo "019 / 020 API tests: SKIPPED (no postgrest binary; set POSTGREST_BIN)"
fi

# 021 rollback file: guard removed, then 021 again.
RESULTRB21="$("${PSQL[@]}" -At -f "$HERE/021/rollback.sql" 2>/dev/null | grep -E '^(PASS|FAIL)')"
echo "$RESULTRB21"
FAILEDRB21=$(grep -c '^FAIL' <<<"$RESULTRB21" || true)
echo "021 rollback: $(grep -c '^PASS' <<<"$RESULTRB21") passed, $FAILEDRB21 failed"
# 021 re-applied its own privacy_cleanup: 022 on top again, then the 022 rollback file.
apply migrations/022_hardening.sql
RESULTRB22="$("${PSQL[@]}" -At -f "$HERE/022/rollback.sql" 2>/dev/null | grep -E '^(PASS|FAIL)')"
echo "$RESULTRB22"
FAILEDRB22=$(grep -c '^FAIL' <<<"$RESULTRB22" || true)
echo "022 rollback: $(grep -c '^PASS' <<<"$RESULTRB22") passed, $FAILEDRB22 failed"

# Edge Function `account` (Node, with Deno / Supabase stand-ins): account/test.js.
ACCOUNT_OK=1
"$REPO/node_modules/.bin/esbuild" "$HERE/account/test.js" --bundle --platform=node --format=esm --log-level=warning \
  "--alias:npm:@supabase/supabase-js@2=$HERE/account/supabase-stub.js" --outfile="$WORK/account-test.mjs"
node "$WORK/account-test.mjs" || ACCOUNT_OK=0
# Client-side checks without a browser (client/): the moderator's JPEG metadata check (M1).
"$REPO/node_modules/.bin/esbuild" "$HERE/client/jpegCheck.test.js" --bundle --platform=node --format=esm --log-level=warning \
  --outfile="$WORK/jpeg-test.mjs"
node "$WORK/jpeg-test.mjs" || ACCOUNT_OK=0

# 020 rollback file: back to the 019 state, then 020 again (runs last: it changes grants).
RESULTRB="$("${PSQL[@]}" -At -f "$HERE/020/rollback.sql" | grep -E '^(PASS|FAIL)')"
echo "$RESULTRB"
FAILEDRB=$(grep -c '^FAIL' <<<"$RESULTRB" || true)
echo "020 rollback: $(grep -c '^PASS' <<<"$RESULTRB") passed, $FAILEDRB failed"

[ "$FAILED" = 0 ] && [ "$FAILED19" = 0 ] && [ "$FAILED20" = 0 ] && [ "$FAILEDRB" = 0 ] \
  && [ "$FAILED21" = 0 ] && [ "$FAILEDRB21" = 0 ] && [ "$FAILED22" = 0 ] && [ "$FAILEDRB22" = 0 ] && [ "$FAILED23" = 0 ] && [ "$ACCOUNT_OK" = 1 ] && [ "$MIRROR_OK" = 1 ] && [ "$API_OK" = 1 ] \
  && echo "ALL TESTS PASSED" || { echo "SOME TESTS FAILED"; exit 1; }
