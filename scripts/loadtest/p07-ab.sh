#!/usr/bin/env bash
# p07-ab.sh — the P0-7 #2 / #3 BEFORE-AFTER measurement.
#
#   bash scripts/loadtest/p07-ab.sh up      # stack + schema + seed (once)
#   bash scripts/loadtest/p07-ab.sh arm off # restart the API with the fast path OFF
#   bash scripts/loadtest/p07-ab.sh arm on  # …and ON
#   bash scripts/loadtest/p07-ab.sh run <name>   # one drill pass → .out/<name>.json
#   bash scripts/loadtest/p07-ab.sh down
#
# WHY IT EXISTS. #2 changes ONE drill (Redis down) and #3 changes ONE drill
# (API restart). Re-running the whole ~20-minute suite twice would put a
# different machine state under each arm — the exact confounder the ramp
# comment in loadtest.mjs warns about. This runs both arms against the SAME
# seeded fleet, the SAME image and the SAME box, differing in exactly one
# environment variable (EMERGENCY_REV_RAISE), with LOADTEST_PHASES limiting
# each pass to the drills under test.
#
# ⚠️ Same guarantee as run.sh: it never reads a repo `.env`, every connection
# string is container-local, and loadtest.mjs re-checks the resolved hosts via
# assertDisposableStack() before it does anything.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

mkdir -p scripts/loadtest/.out
ENV_FILE=scripts/loadtest/.out/stack.env
export LOADTEST_ENV_FILE="$ENV_FILE"
export LOADTEST_API_IMAGE="${LOADTEST_API_IMAGE:-edu-cms:loadtest-p07}"
# Own ports, so this A/B stack can coexist with anything already holding the
# harness defaults (a leftover scratchpad postgres was on 55432 when this ran).
export LOADTEST_PG_PORT="${LOADTEST_PG_PORT:-55433}"
export LOADTEST_REDIS_PORT="${LOADTEST_REDIS_PORT:-56380}"
export LOADTEST_API_PORT="${LOADTEST_API_PORT:-58081}"
export LOADTEST_API_URL="${LOADTEST_API_URL:-http://127.0.0.1:$LOADTEST_API_PORT}"
export LOADTEST_DATABASE_URL="${LOADTEST_DATABASE_URL:-postgresql://venueos:loadtest_local_only@127.0.0.1:$LOADTEST_PG_PORT/venueos_loadtest}"

write_env() {
  local raise="$1"
  # Secrets are generated ONCE and reused across arms — the device tokens the
  # seed minted must keep verifying after an arm flip, or the second arm would
  # measure a re-pair, not a delivery path.
  if [ ! -f "$ENV_FILE" ]; then
    {
      echo "LOADTEST_JWT_SECRET=$(openssl rand -hex 32)"
      echo "LOADTEST_SESSION_SECRET=$(openssl rand -hex 32)"
      echo "LOADTEST_DEVICE_SECRET_KEY=$(openssl rand -hex 32)"
      echo "LOADTEST_DEVICE_JWT_SECRET=$(openssl rand -hex 32)"
    } > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  fi
  grep -v '^LOADTEST_API_IMAGE=\|^LOADTEST_EMERGENCY_REV_RAISE=\|^LOADTEST_PG_PORT=\|^LOADTEST_REDIS_PORT=\|^LOADTEST_API_PORT=' "$ENV_FILE" > "$ENV_FILE.tmp"
  echo "LOADTEST_API_IMAGE=$LOADTEST_API_IMAGE" >> "$ENV_FILE.tmp"
  echo "LOADTEST_EMERGENCY_REV_RAISE=$raise" >> "$ENV_FILE.tmp"
  echo "LOADTEST_PG_PORT=$LOADTEST_PG_PORT" >> "$ENV_FILE.tmp"
  echo "LOADTEST_REDIS_PORT=$LOADTEST_REDIS_PORT" >> "$ENV_FILE.tmp"
  echo "LOADTEST_API_PORT=$LOADTEST_API_PORT" >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

compose() {
  docker compose --env-file "$ENV_FILE" -f docker-compose.loadtest.yml -p venueos-loadtest "$@"
}

case "${1:-}" in
  up)
    write_env "${LOADTEST_EMERGENCY_REV_RAISE:-on}"
    compose up -d --wait pg redis
    # `db push`, not `migrate deploy` — FINDING LT-1, see docker-compose.loadtest.yml.
    compose run --rm --no-deps \
      --entrypoint /app/packages/database/node_modules/.bin/prisma \
      api db push --schema=packages/database/prisma/schema.prisma --accept-data-loss --skip-generate
    compose up -d --wait api
    node scripts/loadtest/seed.mjs
    ;;
  arm)
    write_env "${2:?usage: p07-ab.sh arm on|off}"
    compose up -d --force-recreate --wait api
    # Say out loud which arm is live, read back from the container, so a
    # report can never be labelled from intent instead of from fact.
    echo -n "[p07-ab] live arm: "
    docker inspect venueos-loadtest-api-1 --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | grep '^EMERGENCY_REV_RAISE=' || echo 'EMERGENCY_REV_RAISE=(unset → on)'
    ;;
  run)
    # Label the arm from the LIVE CONTAINER, never from this shell's intent.
    # The first version of this script exported nothing and loadtest.mjs read
    # its own environment, so a correctly-armed `off` run produced a report
    # that said `on`. A report that can mislabel its own arm is worse than no
    # report.
    live_arm=$(docker inspect venueos-loadtest-api-1 \
      --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | sed -n 's/^EMERGENCY_REV_RAISE=//p' | head -1)
    export LOADTEST_EMERGENCY_REV_RAISE="${live_arm:-on(unset)}"
    echo "[p07-ab] running with the container's live arm: EMERGENCY_REV_RAISE=$LOADTEST_EMERGENCY_REV_RAISE"
    LOADTEST_REPORT_NAME="${2:?usage: p07-ab.sh run <report-name>}.json" \
      node scripts/loadtest/loadtest.mjs
    ;;
  down)
    compose down -v --remove-orphans
    ;;
  *)
    sed -n '2,20p' "${BASH_SOURCE[0]}"
    exit 1
    ;;
esac
