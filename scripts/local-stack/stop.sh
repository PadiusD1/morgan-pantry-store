#!/usr/bin/env bash
# Stops the local stack. Kills only the process group start.sh created, then
# stops the local cluster. Data stays in /srv/tools/frc-stack/pgdata.
set -uo pipefail

STACK_ROOT=/srv/tools/frc-stack
PG_BIN=/srv/tools/pg17/usr/lib/postgresql/17/bin
PG_LIB=/srv/tools/pg17/usr/lib/x86_64-linux-gnu
PIDFILE="$STACK_ROOT/server.pid"

if [[ -f "$PIDFILE" ]]; then
  PID="$(cat "$PIDFILE")"
  # setsid made the server the leader of its own group, so the group id is its pid.
  if kill -0 "$PID" 2>/dev/null; then
    kill -TERM -- "-$PID" 2>/dev/null
    for _ in $(seq 1 15); do
      pgrep -g "$PID" > /dev/null || break
      sleep 1
    done
    if pgrep -g "$PID" > /dev/null; then kill -KILL -- "-$PID" 2>/dev/null; sleep 1; fi
  fi
  if pgrep -g "$PID" > /dev/null; then
    echo "server group $PID is still running" >&2
  else
    echo "server group $PID stopped"
    rm -f "$PIDFILE"
  fi
else
  echo "no server pid file, nothing to stop"
fi

env -i PATH=/usr/bin:/bin LD_LIBRARY_PATH="$PG_LIB" "$PG_BIN/pg_ctl" -D "$STACK_ROOT/pgdata" status > /dev/null 2>&1 \
  && env -i PATH=/usr/bin:/bin LD_LIBRARY_PATH="$PG_LIB" "$PG_BIN/pg_ctl" -D "$STACK_ROOT/pgdata" -w -m fast stop
env -i PATH=/usr/bin:/bin LD_LIBRARY_PATH="$PG_LIB" "$PG_BIN/pg_ctl" -D "$STACK_ROOT/pgdata" status
exit 0
