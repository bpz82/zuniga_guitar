#!/usr/bin/env sh
# Runs the Supabase migration on a throwaway local Postgres (16+) and checks
# the security rules: per-user isolation, append-only log, reminder rules.
# Needs the Postgres server binaries (initdb, pg_ctl, psql). Not part of
# `npm test` because most machines don't have them; run `npm run test:sql`.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${PG_BIN:-$(pg_config --bindir 2>/dev/null || ls -d /usr/lib/postgresql/*/bin | tail -1)}"
DIR="$(mktemp -d)"
RUN=""
if [ "$(id -u)" = "0" ]; then chown postgres "$DIR"; RUN="runuser -u postgres --"; fi
cleanup() { $RUN "$BIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
$RUN "$BIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
$RUN "$BIN/pg_ctl" -D "$DIR/data" -o "-k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
PSQL="$RUN $BIN/psql -h $DIR -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
$PSQL -f "$ROOT/test/sql/supabase-stubs.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do $PSQL -f "$f"; done  # in name order, as Supabase applies them
$PSQL -o /dev/null -f "$ROOT/test/sql/rls.test.sql"
echo "SQL tests passed"
