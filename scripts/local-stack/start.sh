#!/usr/bin/env bash
# Starts a local copy of the portal on synthetic data. It can never reach
# production. See README.md in this folder.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK_ROOT=/srv/tools/frc-stack
PG_BIN=/srv/tools/pg17/usr/lib/postgresql/17/bin
PG_LIB=/srv/tools/pg17/usr/lib/x86_64-linux-gnu
PGDATA="$STACK_ROOT/pgdata"
PGSOCK="$STACK_ROOT/sock"
PG_PORT=55418
APP_PORT="${PORT:-5055}"
RUN_DIR="$STACK_ROOT/run"
PIDFILE="$STACK_ROOT/server.pid"
SERVER_LOG="$STACK_ROOT/server.log"
DATABASE_URL="postgres://frc@localhost:$PG_PORT/frc_stack"
ADMIN_EMAIL=admin@local-stack.invalid
VOLUNTEER_EMAIL=volunteer@local-stack.invalid
FIXTURE="$REPO/scripts/local-stack/barcode-fixture.json"
MIGRATION_0001="$REPO/migrations/0001_release_one.sql"
INDEXES="$REPO/tests/fixtures/prod-only-indexes.json"
PROD_OBJECTS=/srv/office/projects/frc-portal/schema/prod-objects.json

refuse() { echo "local stack refused because $*" >&2; exit 2; }

# Guards. Nothing named UPSTASH may reach the server, the database must be
# local, and the server folder must hold no .env for dotenv to load.
# Redis.fromEnv also reads the KV_REST_API names, so those are refused too.
if compgen -e | grep -qE '^(UPSTASH|KV_REST_API)'; then refuse "an UPSTASH or KV_REST_API variable is set in this shell"; fi
[[ "$DATABASE_URL" =~ ^postgres://[a-z]+@localhost:[0-9]+/[a-z_]+$ ]] || refuse "DATABASE_URL is not localhost"
[[ "$APP_PORT" =~ ^[0-9]+$ ]] || refuse "PORT is not a number"
if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then refuse "a server from this script is already running, run stop.sh first"; fi

mkdir -p "$STACK_ROOT" "$PGSOCK" "$RUN_DIR" "$STACK_ROOT/home" "$STACK_ROOT/vite-cache"
[[ -e "$RUN_DIR/.env" ]] && refuse "$RUN_DIR holds a .env file"

pgc() { env -i PATH=/usr/bin:/bin LD_LIBRARY_PATH="$PG_LIB" TZ=UTC "$PG_BIN/$1" "${@:2}"; }

if [[ ! -f "$PGDATA/PG_VERSION" ]]; then
  pgc initdb -D "$PGDATA" -U frc --auth=trust -E UTF8 --locale=C.UTF-8 > "$STACK_ROOT/initdb.log"
fi
if ! pgc pg_ctl -D "$PGDATA" status > /dev/null 2>&1; then
  pgc pg_ctl -D "$PGDATA" -l "$STACK_ROOT/pg.log" -w -t 60 \
    -o "-p $PG_PORT -k $PGSOCK -c listen_addresses=localhost" start > /dev/null
fi

# Migration 0001 and the production only index list come from the working
# tree when present, otherwise from the server branch or the office schema file.
if [[ ! -f "$MIGRATION_0001" ]]; then
  MIGRATION_0001="$STACK_ROOT/0001_release_one.sql"
  git --no-optional-locks -C "$REPO" show frc-r1-server:migrations/0001_release_one.sql > "$MIGRATION_0001" \
    || refuse "migration 0001 is neither in the tree nor on frc-r1-server"
fi
[[ -f "$INDEXES" ]] || INDEXES="$PROD_OBJECTS"
[[ -f "$INDEXES" ]] || refuse "no production index list was found"

ADMIN_PASSWORD="$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
VOLUNTEER_PASSWORD="$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
SESSION_SECRET="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
NODE_DIR="$(dirname "$(command -v node)")"

env -i PATH="$NODE_DIR:/usr/bin:/bin" HOME="$STACK_ROOT/home" TZ=UTC \
  DATABASE_URL="$DATABASE_URL" STACK_MIGRATION_0001="$MIGRATION_0001" STACK_INDEXES="$INDEXES" \
  ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  VOLUNTEER_EMAIL="$VOLUNTEER_EMAIL" VOLUNTEER_PASSWORD="$VOLUNTEER_PASSWORD" \
  node "$REPO/scripts/local-stack/setup-db.mjs"

# The allowlist is the whole environment of the server.
SERVER_ENV=(
  PATH="$NODE_DIR:/usr/bin:/bin"
  HOME="$STACK_ROOT/home"
  NODE_ENV=development
  PORT="$APP_PORT"
  FRC_LISTEN_HOST=127.0.0.1
  TZ=UTC
  DATABASE_URL="$DATABASE_URL"
  SESSION_SECRET="$SESSION_SECRET"
  COOKIE_SECURE=false
  ADMIN_EMAIL="$ADMIN_EMAIL"
  ADMIN_PASSWORD="$ADMIN_PASSWORD"
  ADMIN_NAME="Local Admin"
  FRC_BARCODE_STUB="$FIXTURE"
  VITE_CACHE_DIR="$STACK_ROOT/vite-cache"
)
printf '%s\n' "${SERVER_ENV[@]}" | grep -qE '^(UPSTASH|KV_REST_API)' && refuse "the allowlist names an UPSTASH or KV_REST_API variable"

cd "$RUN_DIR"
setsid env -i "${SERVER_ENV[@]}" "$REPO/node_modules/.bin/tsx" --tsconfig "$REPO/tsconfig.json" \
  "$REPO/server/index.ts" > "$SERVER_LOG" 2>&1 < /dev/null &
echo $! > "$PIDFILE"

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" > /dev/null 2>&1; then
    echo "Local stack ready at http://127.0.0.1:$APP_PORT (server pid $(cat "$PIDFILE"), log $SERVER_LOG)"
    echo "Admin     $ADMIN_EMAIL  $ADMIN_PASSWORD"
    echo "Volunteer $VOLUNTEER_EMAIL  $VOLUNTEER_PASSWORD"
    echo "These passwords are shown once and change on every start."
    exit 0
  fi
  if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    tail -20 "$SERVER_LOG" >&2
    refuse "the server exited during start"
  fi
  sleep 1
done
tail -20 "$SERVER_LOG" >&2
refuse "the server did not answer /api/health within 60 seconds, run stop.sh"
