#!/usr/bin/env bash
# Local database tests: a throwaway PostgreSQL cluster with Supabase stand-ins, all migrations in
# the documented order, then the tests of each migration that has a folder here (018/ …).
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

[ "$FAILED" = 0 ] && [ "$MIRROR_OK" = 1 ] && echo "ALL TESTS PASSED" || { echo "SOME TESTS FAILED"; exit 1; }
